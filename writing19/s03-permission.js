import {
  callLlm,
  runBash,
  readFile,
  writeFile,
  editFile,
  glob,
  tool,
  runChatCli,
  isMainModule,
} from "./helper.js";

// s03：在 s02（多工具）基础上，给工具执行加一道权限门。
// s03: add a permission gate before tool execution, on top of s02 (multi-tool).
// 模型负责“想做什么”，权限门负责“这次能不能做”。
// The model decides what to attempt; the gate decides whether it's allowed this time.

const SYSTEM = `You are a coding agent at ${process.cwd()}. Destructive actions need user approval.`;

// 工具和分发表与 s02 完全一样（沿用上一步）。
// Tools and dispatch table are identical to s02 (carried over).
const tools = [
  tool("bash", "Run a shell command.", {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  }),
  tool("read_file", "Read a file (optional line limit).", {
    type: "object",
    properties: { path: { type: "string" }, limit: { type: "integer" } },
    required: ["path"],
  }),
  tool("write_file", "Write content to a file.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  }),
  tool("edit_file", "Replace exact text in a file once.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  }),
  tool("glob", "Find files by glob pattern.", {
    type: "object",
    properties: { pattern: { type: "string" } },
    required: ["pattern"],
  }),
];

const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
};

// ── s03 新增：权限门 / NEW in s03: the permission gate ──

// 硬黑名单：永远拒绝。/ Hard deny-list: always refused.
const DENY = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
// 风险命令：执行前问用户。/ Risky commands: ask the user first.
const RISKY = ["rm ", "> /etc/", "chmod 777"];

// 权限判定（纯函数，方便测试）：返回 allow / deny / ask 三档之一。
// Permission check (pure, easy to test): returns one of allow / deny / ask.
export function checkPermission(name, args = {}) {
  const command = args.command || "";
  if (name === "bash" && DENY.some((p) => command.includes(p))) {
    return { decision: "deny", reason: "命中黑名单" };
  }
  if (name === "bash" && RISKY.some((p) => command.includes(p))) {
    return { decision: "ask", reason: "可能有破坏性的命令" };
  }
  return { decision: "allow" };
}

// agent loop：和 s02 完全一样，只在执行工具前插入一道权限门。
// Same loop as s02, with a single permission gate inserted before tool execution.
export async function agentLoop(messages, confirm) {
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) return message.content || "";

    messages.push(message);
    for (const call of message.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      const gate = checkPermission(call.function.name, args); // ← s03 新增的一道门

      let output;
      if (gate.decision === "deny") {
        output = `Permission denied: ${gate.reason}.`;
      } else if (gate.decision === "ask" && !(await approved(confirm, gate.reason, call.function.name, args))) {
        output = "Permission denied by user.";
      } else {
        const handler = handlers[call.function.name];
        output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;
      }

      console.log(`> ${call.function.name}: ${String(output).slice(0, 200)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

// 问用户 y/N（confirm 由 runChatCli 注入；缺省视为拒绝）。
// Ask the user y/N (confirm is injected by runChatCli; default to deny when absent).
async function approved(confirm, reason, name, args) {
  if (!confirm) return false;
  const answer = await confirm(`⚠ ${reason}: ${name}(${JSON.stringify(args)}) 允许? [y/N] `);
  return /^y(es)?$/i.test(String(answer).trim());
}

async function main() {
  await runChatCli({
    promptLabel: "s03 >> ",
    onPrompt: ({ messages, ask }) => agentLoop(messages, ask),
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
