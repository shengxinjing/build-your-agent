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

// s04：把扩展逻辑从主循环里搬到生命周期 hook 上 —— 主循环保持干净。
// s04: move extension logic out of the loop onto lifecycle hooks — the loop stays clean.
// s03 的权限判断不再写死在 loop 里，而是变成挂在 PreToolUse 上的一个 hook。
// s03's permission check is no longer hard-coded in the loop; it becomes a PreToolUse hook.

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Act, don't explain.`;

// ── 工具与分发表：与 s02 / s03 相同（沿用）。/ Tools + handlers: same as s02 / s03. ──
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

// ── s04 新增：hook 系统 ──
// 把主循环的关键生命周期点命名出来；加能力 = 往对应事件挂一个回调，而不是改 loop。
// Name the loop's lifecycle points; adding behavior = register a callback, not edit the loop.
const hooks = { UserPromptSubmit: [], PreToolUse: [], PostToolUse: [], Stop: [] };

function registerHook(event, callback) {
  hooks[event].push(callback);
}

// 依次执行该事件的 hook；任一 hook 返回非空值就提前拦截（PreToolUse 用它阻断工具）。
// Run an event's hooks in order; first non-null return short-circuits (PreToolUse blocks a tool).
async function triggerHooks(event, ...args) {
  for (const callback of hooks[event]) {
    const result = await callback(...args);
    if (result != null) return result;
  }
  return null;
}

// ── 挂在各生命周期点上的 hook ──

// 硬黑名单 / 风险命令（和 s03 一样）。/ Same lists as s03.
const DENY = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
const RISKY = ["rm ", "> /etc/", "chmod 777"];

// PreToolUse：s03 的权限判断，现在是一个 hook；返回字符串即拦截这次工具调用。
// PreToolUse: s03's permission check, now a hook; returning a string blocks the call.
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

// PreToolUse：记录每次工具调用（只观察，不拦截）。/ PreToolUse: log each call (observe only).
function logHook(name) {
  console.log(`[hook] PreToolUse → ${name}`);
  return null;
}

// PostToolUse：输出过大时提醒。/ PostToolUse: warn on very large output.
function largeOutputHook(name, output) {
  if (String(output).length > 100000) {
    console.log(`[hook] PostToolUse → ${name} 输出过大`);
  }
  return null;
}

// Stop：循环结束时统计用了几次工具。/ Stop: summarize tool usage when the loop ends.
function summaryHook(messages) {
  const used = messages.filter((m) => m.role === "tool").length;
  console.log(`[hook] Stop → 本轮用了 ${used} 次工具`);
  return null;
}

// UserPromptSubmit：用户输入到达模型前触发。/ Fires before the user's input reaches the model.
function contextHook() {
  console.log(`[hook] UserPromptSubmit → cwd ${process.cwd()}`);
  return null;
}

registerHook("UserPromptSubmit", contextHook);
registerHook("PreToolUse", permissionHook);
registerHook("PreToolUse", logHook);
registerHook("PostToolUse", largeOutputHook);
registerHook("Stop", summaryHook);

// ── agent loop：结构和 s03 一样，但权限判断换成了 PreToolUse hook ──
// Same structure as s03, but the permission check is now a PreToolUse hook.
export async function agentLoop(messages, confirm) {
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });

    if (!message.tool_calls?.length) {
      // Stop hook 可以要求继续（返回值会作为新消息注入再跑一轮）。
      // A Stop hook may force continuation (its return value is injected and we loop again).
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

      // PreToolUse：任一 hook 返回值即拦截这次工具调用（权限就长在这里）。
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
