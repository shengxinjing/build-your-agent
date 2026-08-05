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

// s05：给 agent 一个“可见计划” —— todo_write 工具 + 不更新就提醒。
// s05: give the agent a *visible plan* — a todo_write tool + a nag if it forgets.
// todo_write 不执行任何动作，只把“当前任务拆成可见状态”，防止模型在多步任务里漂移。
// todo_write does nothing in the world; it just makes the current plan explicit, to stop drift.

const SYSTEM = `You are a coding agent at ${process.cwd()}. Before a multi-step task, use todo_write to plan; update status as you go.`;

// ── 工具：s04 的 5 个 + 本步新增的 todo_write。/ Tools: s04's 5 + the new todo_write. ──
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
  // s05 新增：只规划、不执行的工具。/ NEW in s05: a plan-only tool.
  tool("todo_write", "Create and manage a task list for the current session.", {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  }),
];

// ── 计划状态（本步新增）。/ The plan state (new in s05). ──
let currentTodos = [];
export function getTodos() {
  return currentTodos;
}

// todo_write 的实现：把计划写进 currentTodos，并打印成可见清单。
// The todo_write handler: store the plan in currentTodos and print it as a visible list.
function runTodoWrite({ todos = [] }) {
  currentTodos = todos;
  const icon = { pending: " ", in_progress: "▸", completed: "✓" };
  console.log("## Current Tasks");
  for (const t of currentTodos) console.log(`  [${icon[t.status]}] ${t.content}`);
  return `Updated ${currentTodos.length} tasks`;
}

const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
  todo_write: runTodoWrite,
};

// ── hook 系统（沿用 s04）。/ Hook system (from s04). ──
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

registerHook("PreToolUse", permissionHook);

// ── agent loop：结构和 s04 一样，只多了一个“计划提醒”计数器。 ──
// Same loop as s04, plus one "nag" counter for the plan.
export async function agentLoop(messages, confirm) {
  let roundsSinceTodo = 0;
  while (true) {
    // s05：模型连续 3 轮没更新计划，就注入一条提醒，把注意力拉回来。
    // s05: if the model hasn't touched the plan for 3 rounds, inject a reminder.
    if (roundsSinceTodo >= 3) {
      messages.push({ role: "user", content: "<reminder>Update your todos.</reminder>" });
      roundsSinceTodo = 0;
    }

    const { message } = await callLlm(messages, { system: SYSTEM, tools });

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    roundsSinceTodo += 1;
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
      }

      if (name === "todo_write") roundsSinceTodo = 0; // 更新了计划，计数清零
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s05 >> ",
    onPrompt: async ({ prompt, messages, ask }) => {
      return agentLoop(messages, ask);
    },
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
