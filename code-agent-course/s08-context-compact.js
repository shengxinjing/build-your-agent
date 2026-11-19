import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  parseFrontmatter,
  prepareHistoryForSummary,
} from "./helper.js";

const SKILLS_DIR = path.join(process.cwd(), "skills");

export function scanSkills(dir = SKILLS_DIR) {
  const registry = {};
  if (!existsSync(dir)) return registry;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(dir, entry.name, "SKILL.md");
    if (!existsSync(manifest)) continue;
    const raw = readFileSync(manifest, "utf8");
    const { meta } = parseFrontmatter(raw);
    const name = meta.name || entry.name;
    registry[name] = { name, description: meta.description || "", content: raw };
  }
  return registry;
}

export const skillRegistry = scanSkills();

function listSkills() {
  const all = Object.values(skillRegistry);
  return all.length ? all.map((s) => `- ${s.name}: ${s.description}`).join("\n") : "(no skills found)";
}

function loadSkill({ name }) {
  const skill = skillRegistry[name];
  return skill ? skill.content : `Skill not found: ${name}`;
}

const TRANSCRIPT_DIR = path.join(process.cwd(), ".transcripts");
const TOOL_RESULTS_DIR = path.join(process.cwd(), ".task_outputs", "tool-results");

const CONTEXT_LIMIT = 12000;
const KEEP_RECENT = 3;
const PERSIST_THRESHOLD = 30000;
const MAX_REACTIVE_RETRIES = 1;

export const estimateSize = (messages) => JSON.stringify(messages).length;

const isToolResult = (m) => m.role === "tool";

function apply(messages, next) {
  if (next !== messages) messages.splice(0, messages.length, ...next);
  return messages;
}

export function snipCompact(messages, maxMessages = 50) {
  if (messages.length <= maxMessages) return messages;
  let head = 3;
  let tail = messages.length - (maxMessages - 3);
  while (head < messages.length && isToolResult(messages[head])) head += 1;
  while (tail < messages.length && isToolResult(messages[tail])) tail += 1;
  if (head >= tail) return messages;
  return [
    ...messages.slice(0, head),
    { role: "user", content: `[snipped ${tail - head} messages from the middle]` },
    ...messages.slice(tail),
  ];
}

export function microCompact(messages) {
  const toolMsgs = messages.filter(isToolResult);
  if (toolMsgs.length <= KEEP_RECENT) return messages;
  for (const m of toolMsgs.slice(0, -KEEP_RECENT)) {
    if (m.content.length > 120) m.content = "[Earlier tool result compacted. Re-run if needed.]";
  }
  return messages;
}

function persistLargeOutput(id, output) {
  if (output.length <= PERSIST_THRESHOLD) return output;
  mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  const file = path.join(TOOL_RESULTS_DIR, `${id}.txt`);
  if (!existsSync(file)) writeFileSync(file, output);
  return `<persisted-output>\nFull output: ${file}\nPreview:\n${output.slice(0, 2000)}\n</persisted-output>`;
}

export function toolResultBudget(messages, maxBytes = 200000) {
  const tail = [];
  for (let i = messages.length - 1; i >= 0 && isToolResult(messages[i]); i -= 1) tail.push(messages[i]);
  let total = tail.reduce((n, m) => n + m.content.length, 0);
  if (total <= maxBytes) return messages;
  for (const m of [...tail].sort((a, b) => b.content.length - a.content.length)) {
    if (total <= maxBytes) break;
    if (m.content.length <= PERSIST_THRESHOLD) continue;
    const before = m.content.length;
    m.content = persistLargeOutput(m.tool_call_id, m.content);
    total -= before - m.content.length;
  }
  return messages;
}

function writeTranscript(messages) {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const file = path.join(TRANSCRIPT_DIR, `transcript-${Date.now()}.jsonl`);
  writeFileSync(file, messages.map((m) => JSON.stringify(m)).join("\n"));
  return file;
}

async function summarizeHistory(messages) {
  const conversation = prepareHistoryForSummary(messages);
  const prompt = `Summarize this coding-agent conversation so work can continue.
Preserve: 1) current goal, 2) key findings/decisions, 3) files read/changed, 4) remaining work, 5) user constraints.
Be compact but concrete.

${conversation}`;
  const { message } = await callLlm([{ role: "user", content: prompt }], {});
  return (message.content || "").trim() || "(empty summary)";
}

export async function compactHistory(messages) {
  writeTranscript(messages);
  const summary = await summarizeHistory(messages);
  return [{ role: "user", content: `[Compacted]\n\n${summary}` }];
}

export async function reactiveCompact(messages) {
  writeTranscript(messages);
  let tail = Math.max(0, messages.length - 5);
  while (tail < messages.length && isToolResult(messages[tail])) tail += 1;
  const summary = await summarizeHistory(messages.slice(0, tail));
  return [{ role: "user", content: `[Reactive compact]\n\n${summary}` }, ...messages.slice(tail)];
}

const isPromptTooLong = (error) =>
  /prompt.*too.*long|too many tokens|context.*length/i.test(String(error.message));

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks.
Before a multi-step task, use todo_write to plan and update status as you go.
For a complex sub-problem, use the task tool to spawn a subagent.
Skills available:
${listSkills()}
Use load_skill to get a skill's full content when you need it.
When context gets large, call compact to summarize earlier work and free space.`;
const SUB_SYSTEM = `You are a coding subagent at ${process.cwd()}. Complete the task, then return a concise summary. Do not delegate further.`;

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
  tool("task", "Launch a subagent to handle a complex subtask. Returns only the final summary.", {
    type: "object",
    properties: { description: { type: "string" } },
    required: ["description"],
  }),
  tool("load_skill", "Load a skill's full content by name (see the catalog in the system prompt).", {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  }),
  tool("compact", "Summarize earlier conversation to free context space.", {
    type: "object",
    properties: { focus: { type: "string" } },
  }),
];

let currentTodos = [];
export function getTodos() {
  return currentTodos;
}

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
  task: ({ description }, confirm) => spawnSubagent(description, confirm),
  load_skill: loadSkill,
};

const SUB_EXCLUDE = ["task", "todo_write", "load_skill", "compact"];
const subTools = tools.filter((t) => !SUB_EXCLUDE.includes(t.function.name));
const subHandlers = Object.fromEntries(
  Object.entries(handlers).filter(([name]) => !SUB_EXCLUDE.includes(name)),
);
const MAX_SUB_TURNS = 30;

async function spawnSubagent(description, confirm) {
  const messages = [{ role: "user", content: description }];
  for (let turn = 0; turn < MAX_SUB_TURNS; turn += 1) {
    const { message } = await callLlm(messages, { system: SUB_SYSTEM, tools: subTools });
    messages.push(message);
    if (!message.tool_calls?.length) return message.content || "(subagent returned no text)";

    for (const call of message.tool_calls) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");
      const blocked = await triggerHooks("PreToolUse", name, args, confirm);
      const handler = subHandlers[name];
      const output =
        blocked != null ? String(blocked) : handler ? handler(args) : `Unknown tool: ${name}`;
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
  return "Subagent stopped after 30 turns without a final answer.";
}

export { spawnSubagent };

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

export async function agentLoop(messages, confirm) {
  let roundsSinceTodo = 0;
  let reactiveRetries = 0;
  while (true) {
    if (roundsSinceTodo >= 3) {
      messages.push({ role: "user", content: "<reminder>Update your todos.</reminder>" });
      roundsSinceTodo = 0;
    }

    apply(messages, toolResultBudget(messages));
    apply(messages, snipCompact(messages));
    apply(messages, microCompact(messages));
    if (estimateSize(messages) > CONTEXT_LIMIT) {
      console.log("[auto compact] compactHistory");
      apply(messages, await compactHistory(messages));
    }

    let message;
    try {
      ({ message } = await callLlm(messages, { system: SYSTEM, tools }));
      reactiveRetries = 0;
    } catch (error) {
      if (reactiveRetries < MAX_REACTIVE_RETRIES && isPromptTooLong(error)) {
        console.log("[reactive compact] reactiveCompact");
        apply(messages, await reactiveCompact(messages));
        reactiveRetries += 1;
        continue;
      }
      throw error;
    }

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    roundsSinceTodo += 1;
    let compacted = false;
    for (const call of message.tool_calls) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");

      if (name === "compact") {
        console.log("[manual compact] compactHistory");
        apply(messages, await compactHistory(messages));
        compacted = true;
        break;
      }

      const blocked = await triggerHooks("PreToolUse", name, args, confirm);
      let output;
      if (blocked != null) {
        output = String(blocked);
      } else {
        const handler = handlers[name];
        output = handler ? await handler(args, confirm) : `Unknown tool: ${name}`;
      }

      if (name === "todo_write") roundsSinceTodo = 0;
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
    if (compacted) continue;
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s08 >> ",
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
