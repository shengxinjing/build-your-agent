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

const SYSTEM = `You are a coding agent at ${process.cwd()}. Destructive actions need user approval.`;

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

const DENY = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
const RISKY = ["rm ", "> /etc/", "chmod 777"];

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

export async function agentLoop(messages, confirm) {
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) return message.content || "";

    messages.push(message);
    for (const call of message.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      const gate = checkPermission(call.function.name, args);

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
