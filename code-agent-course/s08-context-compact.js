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
} from "./helper.js";

// s08：上下文一定会满 —— 在每轮调用模型前压缩历史，腾出空间。
// s08: context always fills up — compact history before each model call to make room.
// 四层管线，简单规则先跑、LLM 摘要后跑：L3 大结果写入文件 → L1 裁中间 → L2 旧结果缩成一句说明 → L4 LLM 全量摘要；
// 真到 API 拒绝（prompt_too_long）再用更激进的 reactiveCompact 兜底。
// Four layers, cheap first: L3 persist big results → L1 snip middle → L2 placeholder old results → L4 LLM summary.

// ── 技能加载（沿用 s07）。/ Skill loading (from s07). ──
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

// ═══════════════════════════════════════════════════════════
//  s08 新增：四层压缩流程（简单规则先跑，LLM 摘要后跑）
//  NEW in s08: four-layer compaction flow (simple rules first, LLM summary last)
// ═══════════════════════════════════════════════════════════

const TRANSCRIPT_DIR = path.join(process.cwd(), ".transcripts");
const TOOL_RESULTS_DIR = path.join(process.cwd(), ".task_outputs", "tool-results");

const CONTEXT_LIMIT = 12000; // 教程阈值故意调低，方便在命令行里触发 compact
const KEEP_RECENT = 3; // micro 压缩保留最近几条工具结果的全文
const PERSIST_THRESHOLD = 30000; // 单条工具结果超过它才写入文件保存
const MAX_REACTIVE_RETRIES = 1;

// 粗略估算上下文大小（教程版用 JSON 字符数，不引入 tokenizer）。
// Rough context size (chars of JSON; no tokenizer in the teaching version).
export const estimateSize = (messages) => JSON.stringify(messages).length;

// OpenAI 格式下：role:"tool" 是一条工具结果；assistant 带 tool_calls 表示发起了工具调用。
// In OpenAI format: role:"tool" is a tool result; an assistant with tool_calls made the call.
const isToolResult = (m) => m.role === "tool";

// 把压缩结果写回原数组（保持同一引用，跨轮次、跨次提问都生效）。
// Write the result back into the same array (so compaction persists across turns).
function apply(messages, next) {
  if (next !== messages) messages.splice(0, messages.length, ...next);
  return messages;
}

// L1: snipCompact —— 消息太多时省略中间，保留头 3 + 尾 N，且不拆开"工具调用 ↔ 它的结果"。
// Trim the middle when there are too many messages; keep head 3 + tail N, never orphaning a tool result.
export function snipCompact(messages, maxMessages = 50) {
  if (messages.length <= maxMessages) return messages;
  let head = 3;
  let tail = messages.length - (maxMessages - 3);
  while (head < messages.length && isToolResult(messages[head])) head += 1; // 头部别停在半截工具结果上
  while (tail < messages.length && isToolResult(messages[tail])) tail += 1; // 尾部别以孤立工具结果开头
  if (head >= tail) return messages;
  return [
    ...messages.slice(0, head),
    { role: "user", content: `[snipped ${tail - head} messages from the middle]` },
    ...messages.slice(tail),
  ];
}

// L2: microCompact —— 只保留最近 KEEP_RECENT 条工具结果的全文，更旧的换成一行简短说明。
// Keep only the most recent KEEP_RECENT tool results in full; replace older ones with a one-liner.
export function microCompact(messages) {
  const toolMsgs = messages.filter(isToolResult);
  if (toolMsgs.length <= KEEP_RECENT) return messages;
  for (const m of toolMsgs.slice(0, -KEEP_RECENT)) {
    if (m.content.length > 120) m.content = "[Earlier tool result compacted. Re-run if needed.]";
  }
  return messages;
}

// L3: toolResultBudget —— 最近一批工具结果总量太大时，从最大的开始写入文件，上下文里只留路径和预览。
// When the latest batch of tool results exceeds the budget, persist the largest to disk, keep a reference.
function persistLargeOutput(id, output) {
  if (output.length <= PERSIST_THRESHOLD) return output;
  mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  const file = path.join(TOOL_RESULTS_DIR, `${id}.txt`);
  if (!existsSync(file)) writeFileSync(file, output);
  return `<persisted-output>\nFull output: ${file}\nPreview:\n${output.slice(0, 2000)}\n</persisted-output>`;
}

export function toolResultBudget(messages, maxBytes = 200000) {
  const tail = []; // 末尾连续的 tool 消息 = 最近一次工具执行产生的结果
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

// L4: compactHistory —— 前三层还不够，就把整段历史交给 LLM 摘要，只留一条 [Compacted]。
// Cheap layers weren't enough → let the LLM summarize the whole history into one [Compacted] message.
function writeTranscript(messages) {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const file = path.join(TRANSCRIPT_DIR, `transcript-${Date.now()}.jsonl`);
  writeFileSync(file, messages.map((m) => JSON.stringify(m)).join("\n"));
  return file;
}

async function summarizeHistory(messages) {
  const conversation = JSON.stringify(messages).slice(0, 80000);
  const prompt = `Summarize this coding-agent conversation so work can continue.
Preserve: 1) current goal, 2) key findings/decisions, 3) files read/changed, 4) remaining work, 5) user constraints.
Be compact but concrete.

${conversation}`;
  const { message } = await callLlm([{ role: "user", content: prompt }], {});
  return (message.content || "").trim() || "(empty summary)";
}

export async function compactHistory(messages) {
  writeTranscript(messages); // 先存完整 transcript（可恢复），再丢历史
  const summary = await summarizeHistory(messages);
  return [{ role: "user", content: `[Compacted]\n\n${summary}` }];
}

// 应急：API 仍返回 prompt_too_long（上下文涨得比压缩快）→ 摘要旧历史，仅保留尾部少量消息。
// Emergency: if the API still says prompt_too_long, summarize the old part, keep only a short tail.
export async function reactiveCompact(messages) {
  writeTranscript(messages);
  let tail = Math.max(0, messages.length - 5);
  while (tail < messages.length && isToolResult(messages[tail])) tail += 1; // 别让尾部以孤立工具结果开头
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

// ── 工具：s07 的 8 个 + 本步新增的 compact。/ Tools: s07's 8 + the new compact. ──
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

// ── 计划状态（沿用 s05）。/ Plan state (from s05). ──
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

// compact 不在这里——它要替换整段历史，由 agent loop 单独处理。
// compact is NOT here — it replaces the whole history, handled specially in the loop.
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

// ── 子代理（沿用 s06/s07）。子工具排除 task/todo_write/load_skill/compact。──
// Subagent (from s06/s07). Sub-tools exclude task/todo_write/load_skill/compact.
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

// ── hook 系统（沿用 s04–s07）。/ Hook system (from s04–s07). ──
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

// ── agent loop：s08 在每轮调用模型前跑压缩流程；compact 工具单独处理。──
// s08 runs the compaction flow before each model call; the compact tool is handled specially.
export async function agentLoop(messages, confirm) {
  let roundsSinceTodo = 0;
  let reactiveRetries = 0;
  while (true) {
    if (roundsSinceTodo >= 3) {
      messages.push({ role: "user", content: "<reminder>Update your todos.</reminder>" });
      roundsSinceTodo = 0;
    }

    // s08：三层简单预处理（0 次 API），顺序固定 budget → snip → micro。
    // L3 先控制大小：超大的工具输出写入 .task_outputs 文件夹，只在上下文里留下文件路径和预览。
    apply(messages, toolResultBudget(messages));
    // L1 再缩短历史：消息太多时省略中间较旧的消息，保留开头和最近上下文。
    apply(messages, snipCompact(messages));
    // L2 最后精简旧结果：较早的工具结果换成一句说明，只保留最近几条工具结果全文。
    apply(messages, microCompact(messages));
    // 还不够小？再花一次 API 让 LLM 全量摘要。
    if (estimateSize(messages) > CONTEXT_LIMIT) {
      console.log("[auto compact] compactHistory");
      apply(messages, await compactHistory(messages));
    }

    let message;
    try {
      ({ message } = await callLlm(messages, { system: SYSTEM, tools }));
      reactiveRetries = 0;
    } catch (error) {
      // 应急：上下文涨得比压缩还快，API 直接拒绝 → reactiveCompact 后重试一次。
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

      // s08：compact 工具替换整段历史 → 丢弃本批其余工具，用压缩后的上下文重开一轮。
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
