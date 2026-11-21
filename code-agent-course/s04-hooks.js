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

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Act, don't explain.`;

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

const hooks = { UserPromptSubmit: [], PreToolUse: [], PostToolUse: [], Stop: [] };

function registerHook(event, callback) {
  hooks[event].push(callback);
}

async function triggerHooks(event, ...args) {
  for (const callback of hooks[event]) {
    const result = await callback(...args);
    if (result != null) return result;
  }
  return null;
}

const DENY = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
const RISKY = ["rm ", "> /etc/", "chmod 777"];

async function permissionHook(name, args, confirm) {
  if (name !== "bash") return null;
  const command = args.command || "";
  if (DENY.some((p) => command.includes(p))) return "Permission denied: 命中黑名单。";
  if (RISKY.some((p) => command.includes(p))) {
    const answer = confirm ? await confirm(`⚠ 可能有破坏性的命令: ${command} 允许? [y/N] `) : "";
    if (!/^y(es)?$/i.test(String(answer).trim())) return "Permission denied by user.";
  }
  return null;
}

function logHook(name) {
  console.log(`[hook] PreToolUse → ${name}`);
  return null;
}

function largeOutputHook(name, output) {
  if (String(output).length > 100000) {
    console.log(`[hook] PostToolUse → ${name} 输出过大`);
  }
  return null;
}

function summaryHook(messages) {
  const used = messages.filter((m) => m.role === "tool").length;
  console.log(`[hook] Stop → 本轮用了 ${used} 次工具`);
  return null;
}

function contextHook() {
  console.log(`[hook] UserPromptSubmit → cwd ${process.cwd()}`);
  return null;
}

registerHook("UserPromptSubmit", contextHook);
registerHook("PreToolUse", permissionHook);
registerHook("PreToolUse", logHook);
registerHook("PostToolUse", largeOutputHook);
registerHook("Stop", summaryHook);

export async function agentLoop(messages, confirm) {
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });

    if (!message.tool_calls?.length) {
      const force = await triggerHooks("Stop", messages);
      if (force != null) {
        messages.push({ role: "user", content: String(force) });
        continue;
      }
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");

      const blocked = await triggerHooks("PreToolUse", name, args, confirm);
      let output;
      if (blocked != null) {
        output = String(blocked);
      } else {
        const handler = handlers[name];
        output = handler ? handler(args) : `Unknown tool: ${name}`;
        await triggerHooks("PostToolUse", name, output);
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s04 >> ",
    onPrompt: async ({ prompt, messages, ask }) => {
      await triggerHooks("UserPromptSubmit", prompt);
      return agentLoop(messages, ask);
    },
  });
}

export { registerHook, triggerHooks, permissionHook };

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
