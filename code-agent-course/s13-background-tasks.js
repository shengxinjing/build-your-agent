import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

// s13：后台任务 —— 慢操作丢后台，Agent 继续干别的，完成后把通知注入对话。
// s13: background tasks — fire slow ops off, keep the agent working, inject a notification when done.
// 慢操作（模型传 run_in_background，或命中关键词启发式）不在原地等，先回一个占位 tool_result；
// JS 单线程，"后台" = 不 await 的 Promise，结果在之后某一轮以 <task_notification> 注入。

// ── 技能加载（沿用 s07/s08）。/ Skill loading (from s07/s08). ──
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
//  s09 新增：记忆系统（存储 + 加载 + 提取 + 整理）
//  NEW in s09: memory system (store + load + extract + consolidate)
// ═══════════════════════════════════════════════════════════

const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

// 记忆目录可被测试重定向到临时目录（默认 .memory/，已被 gitignore）。
// The memory dir can be redirected to a tmp dir in tests (defaults to .memory/).
let memoryDir = path.join(process.cwd(), ".memory");
export function setMemoryDir(dir) {
  memoryDir = dir;
}
const indexPath = () => path.join(memoryDir, "MEMORY.md");

// 写入一条记忆（Markdown + frontmatter），随后重建索引。
// Write one memory (Markdown + frontmatter), then rebuild the index.
export function writeMemoryFile(name, type, description, body) {
  mkdirSync(memoryDir, { recursive: true });
  const slug = name.toLowerCase().replace(/[\s/]+/g, "-");
  writeFileSync(
    path.join(memoryDir, `${slug}.md`),
    `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`,
  );
  rebuildIndex();
}

export function listMemoryFiles() {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    .sort()
    .map((filename) => {
      const raw = readFileSync(path.join(memoryDir, filename), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        filename,
        name: meta.name || filename.replace(/\.md$/, ""),
        description: meta.description || "",
        type: meta.type || "user",
        body,
        content: raw,
      };
    });
}

function rebuildIndex() {
  const lines = listMemoryFiles().map((m) => `- [${m.name}](${m.filename}) — ${m.description}`);
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(indexPath(), lines.length ? `${lines.join("\n")}\n` : "");
}

// 路径一：索引常驻 SYSTEM。
export function readMemoryIndex() {
  return existsSync(indexPath()) ? readFileSync(indexPath(), "utf8").trim() : "";
}

// 路径二：用 LLM 从目录里选出与当前对话相关的记忆；失败则降级到关键词匹配。
// Use an LLM side-query to pick memories relevant to the current talk; fall back to keyword match.
export async function selectRelevantMemories(messages, maxItems = 5) {
  const files = listMemoryFiles();
  if (!files.length) return [];
  const recent = messages
    .filter((m) => m.role === "user" && typeof m.content === "string")
    .slice(-3)
    .map((m) => m.content)
    .join(" ")
    .slice(0, 2000);
  if (!recent.trim()) return [];
  const catalog = files.map((f, i) => `${i}: ${f.name} — ${f.description}`).join("\n");
  try {
    const { message } = await callLlm(
      [
        {
          role: "user",
          content: `Given the recent conversation and the memory catalog, return ONLY a JSON array of the indices that are clearly relevant (e.g. [0, 2]). If none, return [].

Recent conversation:
${recent}

Memory catalog:
${catalog}`,
        },
      ],
      {},
    );
    const match = (message.content || "").match(/\[.*?\]/s);
    if (match) {
      const indices = JSON.parse(match[0]);
      return indices
        .filter((i) => Number.isInteger(i) && i >= 0 && i < files.length)
        .slice(0, maxItems)
        .map((i) => files[i].filename);
    }
  } catch {
    // 降级到关键词匹配
  }
  const keywords = recent.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  return files
    .filter((f) => keywords.some((kw) => `${f.name} ${f.description}`.toLowerCase().includes(kw)))
    .slice(0, maxItems)
    .map((f) => f.filename);
}

// 把选中的记忆全文包成一段，供注入当前 user turn。
export async function loadMemories(messages) {
  const selected = await selectRelevantMemories(messages);
  if (!selected.length) return "";
  const parts = ["<relevant_memories>"];
  for (const filename of selected) parts.push(readFileSync(path.join(memoryDir, filename), "utf8"));
  parts.push("</relevant_memories>");
  return parts.join("\n\n");
}

// 写入：每轮结束后用 LLM 从对话里提取新记忆（已有的跳过）。返回新增条数。
// Extract new memories from the dialogue after each turn (skip ones already covered).
export async function extractMemories(messages) {
  const dialogue = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);
  if (!dialogue.trim()) return 0;
  const existing = listMemoryFiles();
  const existingDesc = existing.length
    ? existing.map((m) => `- ${m.name}: ${m.description}`).join("\n")
    : "(none)";
  try {
    const { message } = await callLlm(
      [
        {
          role: "user",
          content: `Extract durable user preferences, constraints, or project facts from this dialogue.
Return a JSON array; each item: {name, type, description, body}.
- name: short kebab-case id; type: one of ${MEMORY_TYPES.join("/")}; description: one-line; body: markdown detail.
If nothing new or already covered, return [].

Existing memories:
${existingDesc}

Dialogue:
${dialogue}`,
        },
      ],
      {},
    );
    const match = (message.content || "").match(/\[.*\]/s);
    if (!match) return 0;
    const items = JSON.parse(match[0]);
    let count = 0;
    for (const m of items) {
      if (m.description && m.body) {
        writeMemoryFile(
          m.name || `memory-${count}`,
          MEMORY_TYPES.includes(m.type) ? m.type : "user",
          m.description,
          m.body,
        );
        count += 1;
      }
    }
    if (count) console.log(`[Memory: extracted ${count} new memories]`);
    return count;
  } catch {
    return 0;
  }
}

// 整理：文件数到阈值就用 LLM 去重/合并矛盾/淘汰过时（教学版用文件数阈值，CC 用更复杂的门控）。
// Consolidate: when file count hits the threshold, let the LLM dedup/merge/prune.
const CONSOLIDATE_THRESHOLD = 10;
export async function consolidateMemories() {
  const files = listMemoryFiles();
  if (files.length < CONSOLIDATE_THRESHOLD) return;
  const catalog = files
    .map((f) => `## ${f.filename}\nname: ${f.name}\ndescription: ${f.description}\n${f.body}`)
    .join("\n\n")
    .slice(0, 16000);
  try {
    const { message } = await callLlm(
      [
        {
          role: "user",
          content: `Consolidate these memory files: merge duplicates, drop outdated/contradicted ones, keep under 30, preserve user preferences above all.
Return a JSON array; each item: {name, type, description, body}.

${catalog}`,
        },
      ],
      {},
    );
    const match = (message.content || "").match(/\[.*\]/s);
    if (!match) return;
    const items = JSON.parse(match[0]);
    for (const f of readdirSync(memoryDir)) {
      if (f.endsWith(".md") && f !== "MEMORY.md") rmSync(path.join(memoryDir, f));
    }
    for (const m of items) {
      if (m.description && m.body) {
        writeMemoryFile(
          m.name || "memory",
          MEMORY_TYPES.includes(m.type) ? m.type : "user",
          m.description,
          m.body,
        );
      }
    }
    console.log(`[Memory: consolidated ${files.length} → ${items.length} memories]`);
  } catch {
    // 整理失败就保持原样
  }
}

// 把相关记忆临时拼到最近一条字符串 user 消息前面（只用于本次请求，不写回历史 → 不破坏 cache）。
// Prepend relevant memories to the latest string user message (request-only, never persisted).
function buildRequest(messages, memoriesContent) {
  if (!memoriesContent) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user" && typeof messages[i].content === "string") {
      idx = i;
      break;
    }
  }
  if (idx === -1) return messages;
  const copy = messages.slice();
  copy[idx] = { ...messages[idx], content: `${memoriesContent}\n\n${messages[idx].content}` };
  return copy;
}

// ═══════════════════════════════════════════════════════════
//  s12 新增：任务系统（持久化的依赖图：.tasks/{id}.json + blockedBy）
//  NEW in s12: a file-persisted task graph (.tasks/{id}.json + blockedBy deps)
// ═══════════════════════════════════════════════════════════

// 任务目录可被测试重定向（默认 .tasks/，已被 gitignore）。
let tasksDir = path.join(process.cwd(), ".tasks");
export function setTasksDir(dir) {
  tasksDir = dir;
}
let taskSeq = 0; // 进程内自增，保证同毫秒创建多个任务也不撞 id
const taskPath = (id) => path.join(tasksDir, `${id}.json`);

function saveTask(task) {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
}
function loadTask(id) {
  if (!existsSync(taskPath(id))) return null;
  return JSON.parse(readFileSync(taskPath(id), "utf8"));
}

// 创建任务：写一个 JSON 文件（status=pending）；blockedBy 声明上游依赖。
export function createTask(subject, description = "", blockedBy = []) {
  const id = `task_${Date.now()}_${String(taskSeq++).padStart(4, "0")}`;
  const task = { id, subject, description, status: "pending", owner: null, blockedBy };
  saveTask(task);
  return task;
}

export function listTasks() {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter((f) => f.startsWith("task_") && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(tasksDir, f), "utf8")));
}

// 依赖检查：blockedBy 必须全部 completed（缺失的依赖按未完成处理）。
export function canStart(id) {
  const task = loadTask(id);
  if (!task) return false;
  return task.blockedBy.every((dep) => existsSync(taskPath(dep)) && loadTask(dep).status === "completed");
}

// 认领：pending → in_progress，设 owner；已认领或依赖未完成则拒绝。
export function claimTask(id, owner = "agent") {
  const task = loadTask(id);
  if (!task) return `Error: Task ${id} not found`;
  if (task.status !== "pending") return `Task ${id} is ${task.status}, cannot claim`;
  if (!canStart(id)) {
    const deps = task.blockedBy.filter((d) => !existsSync(taskPath(d)) || loadTask(d).status !== "completed");
    return `Blocked by: ${deps.join(", ")}`;
  }
  task.owner = owner;
  task.status = "in_progress";
  saveTask(task);
  return `Claimed ${id} (${task.subject})`;
}

// 完成：in_progress → completed，并报告刚被解锁的下游任务。
export function completeTask(id) {
  const task = loadTask(id);
  if (!task) return `Error: Task ${id} not found`;
  if (task.status !== "in_progress") return `Task ${id} is ${task.status}, cannot complete`;
  task.status = "completed";
  saveTask(task);
  const unblocked = listTasks()
    .filter((t) => t.status === "pending" && t.blockedBy.length && canStart(t.id))
    .map((t) => t.subject);
  let msg = `Completed ${id} (${task.subject})`;
  if (unblocked.length) msg += `\nUnblocked: ${unblocked.join(", ")}`;
  return msg;
}

// 工具 handlers（list/get/create 有点格式化逻辑，claim/complete 直接转发）。
function runCreateTask({ subject, description, blockedBy }) {
  const task = createTask(subject, description || "", blockedBy || []);
  const deps = task.blockedBy.length ? ` (blockedBy: ${task.blockedBy.join(", ")})` : "";
  return `Created ${task.id}: ${task.subject}${deps}`;
}
function runListTasks() {
  const tasks = listTasks();
  if (!tasks.length) return "No tasks. Use create_task to add some.";
  const icon = { pending: "○", in_progress: "●", completed: "✓" };
  return tasks
    .map((t) => {
      const deps = t.blockedBy.length ? ` (blockedBy: ${t.blockedBy.join(", ")})` : "";
      const owner = t.owner ? ` [${t.owner}]` : "";
      return `${icon[t.status] || "?"} ${t.id}: ${t.subject} [${t.status}]${owner}${deps}`;
    })
    .join("\n");
}
function runGetTask({ task_id }) {
  const task = loadTask(task_id);
  return task ? JSON.stringify(task, null, 2) : `Error: Task ${task_id} not found`;
}

// ═══════════════════════════════════════════════════════════
//  s13 新增：后台任务（慢操作异步执行 + 通知注入）
//  NEW in s13: background tasks (async slow ops + notification injection)
// ═══════════════════════════════════════════════════════════

let bgCounter = 0;
const backgroundTasks = new Map(); // bgId → { command, status, result }
export function resetBackgroundTasks() {
  backgroundTasks.clear();
  bgCounter = 0;
}

// 启发式兜底：看起来可能长时间运行的命令。模型显式传 run_in_background 时用不到它。
const SLOW_KEYWORDS = ["install", "build", "test", "deploy", "compile", "pytest", "make", "cargo"];
const BACKGROUND_POLL_MS = 25;

// 判断一个工具调用是否“看起来很慢”：这里只对 bash 做关键词启发式判断。
// Decide whether a tool call looks slow: this teaching version only checks bash keywords.
export function isSlowOperation(name, args) {
  if (name !== "bash") return false;
  const cmd = (args.command || "").toLowerCase();
  return SLOW_KEYWORDS.some((kw) => cmd.includes(kw));
}

// 模型显式请求优先，启发式兜底。/ Model's explicit request wins; heuristic is the fallback.
export function shouldRunBackground(name, args) {
  return Boolean(args.run_in_background) || isSlowOperation(name, args);
}

// 丢后台：JS 单线程，用未 await 的 Promise 推迟执行，完成后回填结果（派发本身不阻塞主循环）。
// Fire it off: single-threaded JS → a non-awaited Promise; backfill the result when it settles.
export function startBackgroundTask(name, args, run) {
  bgCounter += 1;
  const bgId = `bg_${String(bgCounter).padStart(4, "0")}`;
  backgroundTasks.set(bgId, { command: args.command || name, status: "running", result: "" });
  console.log(`  [background] dispatched ${bgId}: ${preview(args.command || name, 60)}`);
  Promise.resolve()
    .then(run)
    .then((result) => {
      const task = backgroundTasks.get(bgId);
      if (task) {
        task.status = "completed";
        task.result = String(result);
      }
    });
  return bgId;
}

// 用 spawn 真正启动异步子进程；不要用 execSync，否则会卡住 Node 事件循环。
// Use spawn for a real async child process; execSync would still block Node's event loop.
function runBashInBackground(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: process.cwd(), shell: true });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      resolve(`Error: ${error.message}`);
    });
    child.on("close", () => {
      resolve(output.trim() || "(no output)");
    });
  });
}

// 收集已完成的后台任务 → <task_notification>，并从表里移除（独立事件，不复用原 tool_call_id）。
// Collect finished tasks as <task_notification> and drop them (a separate event, not a tool reply).
export function collectBackgroundResults() {
  const notifications = [];
  for (const [bgId, task] of backgroundTasks) {
    if (task.status !== "completed") continue;
    backgroundTasks.delete(bgId);
    notifications.push(
      `<task_notification>\n  <task_id>${bgId}</task_id>\n  <status>completed</status>\n  <command>${task.command}</command>\n  <summary>${task.result.slice(0, 200)}</summary>\n</task_notification>`,
    );
  }
  return notifications;
}

// 把日志里的长文本压短，避免教学 trace 被大段输出淹没。
// Shorten long text in logs so the teaching trace stays readable.
function preview(value, max = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// 把模型请求的工具调用变成一行人能读懂的 trace。
// Render a model-requested tool call as a human-readable trace line.
function describeToolCall(name, args, background) {
  if (name === "bash") {
    return `bash "${preview(args.command, 60)}" (${background ? "run_in_background=true" : "fast, sync"})`;
  }
  if (name === "read_file") return `read_file "${args.path}" (fast, sync)`;
  if (name === "write_file") return `write_file "${args.path}" (fast, sync)`;
  return `${name} ${preview(JSON.stringify(args), 60)} (${background ? "run_in_background=true" : "fast, sync"})`;
}

// 从 <task_notification> 里取 task_id，只用于打印 collect 日志。
// Extract task_id from <task_notification>; used only for the collect log.
function notificationTaskId(notification) {
  return notification.match(/<task_id>(.*?)<\/task_id>/)?.[1] || "background task";
}

// 把已经完成的后台任务作为新的 user 消息塞回 messages，让下一轮 LLM 能看到结果。
// Inject completed background tasks as new user messages so the next LLM turn can see them.
function injectBackgroundNotifications(messages) {
  const notifications = collectBackgroundResults();
  for (const notification of notifications) {
    messages.push({ role: "user", content: notification });
    console.log(`  → collect: ${notificationTaskId(notification)} done! inject <task_notification>`);
  }
  return notifications.length;
}

// 给超快后台任务一个很短的完成窗口，避免 echo 这类命令刚好慢半拍导致测试不稳定。
// Give very fast background tasks a tiny completion window, avoiding flaky misses for commands like echo.
async function waitForBackgroundTick() {
  if (backgroundTasks.size) {
    await new Promise((resolve) => setTimeout(resolve, BACKGROUND_POLL_MS));
  }
}

// ═══════════════════════════════════════════════════════════
//  压缩管线（沿用 s08）/ Compaction pipeline (from s08)
// ═══════════════════════════════════════════════════════════

const TRANSCRIPT_DIR = path.join(process.cwd(), ".transcripts");
const TOOL_RESULTS_DIR = path.join(process.cwd(), ".task_outputs", "tool-results");

const CONTEXT_LIMIT = 12000;
const KEEP_RECENT = 3;
const PERSIST_THRESHOLD = 30000;

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
  const conversation = JSON.stringify(messages).slice(0, 80000);
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

// ═══════════════════════════════════════════════════════════
//  s11 新增：错误恢复（截断升级 / 上下文超限压缩 / 瞬态退避重试）
//  NEW in s11: error recovery (truncation escalate / prompt-too-long compact / transient backoff)
// ═══════════════════════════════════════════════════════════

const DEFAULT_MAX_TOKENS = 8000;
const ESCALATED_MAX_TOKENS = 64000;
const MAX_RECOVERY_RETRIES = 3; // 续写次数上限
const MAX_RETRIES = 10; // 瞬态错误退避次数上限
const BASE_DELAY_MS = 500;
const MAX_CONSECUTIVE_529 = 3; // 连续过载达到此数 → 切换备用模型
const CONTINUATION_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought.";

// 跨循环跟踪恢复状态。/ Tracks recovery progress across the loop.
export class RecoveryState {
  constructor() {
    this.escalated = false; // 是否已把 max_tokens 升到 64K
    this.recoveryCount = 0; // 已续写次数
    this.consecutive529 = 0; // 连续 529 次数
    this.attemptedReactiveCompact = false; // 是否已应急压缩过
    this.currentModel = null; // null = provider 默认模型；切换后 = 备用模型
  }
}

// 指数退避 + 抖动；服务器给了 Retry-After 就优先用它。
// Exponential backoff with jitter; a Retry-After value wins if present.
export function retryDelay(attempt, retryAfter) {
  if (retryAfter) return retryAfter;
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, 32000);
  return base + Math.random() * base * 0.25;
}

// 睡眠函数（测试可替换为立即返回，避免真实等待）。/ Sleep (tests swap in an instant no-op).
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function setSleepFn(fn) {
  sleep = fn;
}

const isRateLimit = (msg) => /\b429\b|rate.?limit/i.test(msg);
const isOverloaded = (msg) => /\b529\b|overloaded/i.test(msg);

// 路径③：瞬态错误（429/529）→ 退避重试；连续 529 达上限且配了备用模型就切换。其它错误原样抛给外层。
// Path 3: transient errors → backoff retry; switch to the fallback model after enough 529s. Others re-thrown.
export async function withRetry(fn, state) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const result = await fn();
      state.consecutive529 = 0;
      return result;
    } catch (error) {
      const msg = String(error.message);
      if (isOverloaded(msg)) {
        state.consecutive529 += 1;
        const fallback = process.env.FALLBACK_MODEL_ID;
        if (state.consecutive529 >= MAX_CONSECUTIVE_529 && fallback) {
          state.currentModel = fallback;
          state.consecutive529 = 0;
          console.log(`[529 x${MAX_CONSECUTIVE_529}] switching to ${fallback}`);
        }
        await sleep(retryDelay(attempt));
        continue;
      }
      if (isRateLimit(msg)) {
        await sleep(retryDelay(attempt));
        continue;
      }
      throw error; // 非瞬态 → 交给外层 try/catch
    }
  }
  throw new Error(`Max retries (${MAX_RETRIES}) exceeded`);
}

// ═══════════════════════════════════════════════════════════
//  s10 新增：system prompt 运行时分段组装 + 缓存（替换 s09 的 buildSystem）
//  NEW in s10: assemble the system prompt from sections at runtime, with caching
// ═══════════════════════════════════════════════════════════

// 每个 section 独立维护：(context) => string | null（返回 null 表示本轮不加载）。
// Each section is independent: (context) => string | null (null = skip this turn).
const PROMPT_SECTIONS = {
  identity: () =>
    `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Before a multi-step task, use todo_write to plan and update status as you go. For a complex sub-problem, use the task tool to spawn a subagent.`,
  tools: (ctx) => (ctx.tools.length ? `Available tools: ${ctx.tools.join(", ")}.` : null),
  skills: (ctx) =>
    ctx.skills ? `Skills available:\n${ctx.skills}\nUse load_skill to load a skill's full content when needed.` : null,
  compaction: () => "When context gets large, call compact to summarize earlier work and free space.",
  memory: (ctx) =>
    ctx.memories
      ? `Memories available:\n${ctx.memories}\nRespect user preferences from memory; new ones are saved automatically.`
      : null,
};
const SECTION_ORDER = ["identity", "tools", "skills", "compaction", "memory"];

// 按 context 的真实状态选段拼接（不靠消息里的关键词）。
// Select + join sections by the real state in context (not message keywords).
export function assembleSystemPrompt(context) {
  return SECTION_ORDER.map((key) => PROMPT_SECTIONS[key](context)).filter(Boolean).join("\n\n");
}

// context 没变就复用上次结果（确定性 JSON key；buildContext 的 key 顺序固定，无需排序）。
// Reuse the last result when context is unchanged (deterministic JSON key, not hash()).
let lastContextKey = null;
let lastSystemPrompt = null;
export function getSystemPrompt(context) {
  const key = JSON.stringify(context);
  if (key === lastContextKey && lastSystemPrompt) return lastSystemPrompt;
  lastContextKey = key;
  lastSystemPrompt = assembleSystemPrompt(context);
  return lastSystemPrompt;
}
export function resetSystemPromptCache() {
  lastContextKey = null;
  lastSystemPrompt = null;
}

// 从真实状态派生 context：注册了哪些工具、有没有技能、记忆索引内容。
// Derive context from real state: registered tools, skills present, memory index.
export function buildContext() {
  const skills = listSkills();
  return {
    tools: tools.map((t) => t.function.name),
    skills: skills === "(no skills found)" ? "" : skills,
    memories: readMemoryIndex(),
  };
}

const SUB_SYSTEM = `You are a coding subagent at ${process.cwd()}. Complete the task, then return a concise summary. Do not delegate further.`;

// ── 工具：沿用 s08 的 9 个（bash/read/write/edit/glob/todo_write/task/load_skill/compact）。──
const tools = [
  tool("bash", "Run a shell command. Set run_in_background for slow ops (install/build/test).", {
    type: "object",
    properties: { command: { type: "string" }, run_in_background: { type: "boolean" } },
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
  // s12：任务系统工具（持久化、有依赖，区别于内存版 todo_write）。
  tool("create_task", "Create a persistent task with optional blockedBy dependencies.", {
    type: "object",
    properties: {
      subject: { type: "string" },
      description: { type: "string" },
      blockedBy: { type: "array", items: { type: "string" } },
    },
    required: ["subject"],
  }),
  tool("list_tasks", "List all tasks with status, owner, and dependencies.", {
    type: "object",
    properties: {},
  }),
  tool("get_task", "Get full details of a task by id.", {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  }),
  tool("claim_task", "Claim a pending task (sets owner, pending → in_progress).", {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  }),
  tool("complete_task", "Complete an in-progress task; reports unblocked downstream tasks.", {
    type: "object",
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
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

const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
  todo_write: runTodoWrite,
  task: ({ description }, confirm) => spawnSubagent(description, confirm),
  load_skill: loadSkill,
  // s12：任务系统（持久化依赖图）。
  create_task: runCreateTask,
  list_tasks: runListTasks,
  get_task: runGetTask,
  claim_task: ({ task_id }) => claimTask(task_id),
  complete_task: ({ task_id }) => completeTask(task_id),
};

// ── 子代理（沿用 s06–s08）。──
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

// ── hook 系统（沿用 s04–s08）。──
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

// ── agent loop：s11 在 s10 基础上，把 LLM 调用包进 withRetry + 三条恢复路径。──
// s11 builds on s10: wrap the LLM call in withRetry + three recovery paths.
export async function agentLoop(messages, confirm) {
  let roundsSinceTodo = 0;
  const state = new RecoveryState(); // s11：跟踪截断升级 / 压缩 / 529 / 模型切换
  let maxTokens = DEFAULT_MAX_TOKENS; // s11：输出截断时升级到 64K
  let context = buildContext();
  let system = getSystemPrompt(context);
  const memoriesContent = await loadMemories(messages);
  let preCompress = messages.map((m) => ({ role: m.role, content: m.content }));
  let turn = 0;

  while (true) {
    turn += 1;
    console.log(`\nTurn ${turn}:`);
    injectBackgroundNotifications(messages);

    if (roundsSinceTodo >= 3) {
      messages.push({ role: "user", content: "<reminder>Update your todos.</reminder>" });
      roundsSinceTodo = 0;
    }

    preCompress = messages.map((m) => ({ role: m.role, content: m.content })); // s09：压缩前快照（提取用）

    apply(messages, toolResultBudget(messages));
    apply(messages, snipCompact(messages));
    apply(messages, microCompact(messages));
    if (estimateSize(messages) > CONTEXT_LIMIT) apply(messages, await compactHistory(messages));

    let choice;
    try {
      // s11：withRetry 处理 429/529 退避；相关记忆仍临时拼进请求（不写回 messages）。
      choice = await withRetry(
        () =>
          callLlm(buildRequest(messages, memoriesContent), {
            system,
            tools,
            model: state.currentModel,
            maxTokens,
          }),
        state,
      );
    } catch (error) {
      // 路径②：上下文超限 → 应急压缩一次再重试，仍失败就退出。
      if (isPromptTooLong(error) && !state.attemptedReactiveCompact) {
        apply(messages, await reactiveCompact(messages));
        state.attemptedReactiveCompact = true;
        continue;
      }
      console.error(`[unrecoverable] ${error.message}`);
      return `[Error] ${error.message}`;
    }

    const message = choice.message;

    // 路径①：输出被截断（finish_reason "length"）→ 先把上限升到 64K 重试同一请求；
    // 仍截断则保存输出 + 注入续写提示，最多续写 MAX_RECOVERY_RETRIES 次。
    if (choice.finish_reason === "length") {
      if (!state.escalated) {
        maxTokens = ESCALATED_MAX_TOKENS;
        state.escalated = true;
        continue;
      }
      messages.push(message);
      if (state.recoveryCount < MAX_RECOVERY_RETRIES) {
        messages.push({ role: "user", content: CONTINUATION_PROMPT });
        state.recoveryCount += 1;
        continue;
      }
      return message.content || "";
    }

    if (!message.tool_calls?.length) {
      if (injectBackgroundNotifications(messages)) continue;
      await waitForBackgroundTick();
      if (injectBackgroundNotifications(messages)) continue;
      console.log(`  LLM → ${preview(message.content || "(no text)", 100)}`);
      // s09：对话告一段落 → 从压缩前快照提取新记忆 + 必要时整理。
      await extractMemories(preCompress);
      await consolidateMemories();
      return message.content || "";
    }

    messages.push(message);
    roundsSinceTodo += 1;
    let compacted = false;
    for (const call of message.tool_calls) {
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");
      const runInBackground = shouldRunBackground(name, args);
      console.log(`  LLM → ${describeToolCall(name, args, runInBackground)}`);

      if (name === "compact") {
        apply(messages, await compactHistory(messages));
        compacted = true;
        break;
      }

      const blocked = await triggerHooks("PreToolUse", name, args, confirm);
      let output;
      if (blocked != null) {
        output = String(blocked);
      } else if (runInBackground) {
        // s13：慢操作丢后台，先回占位 tool_result；真正结果稍后以通知注入。
        const bgId = startBackgroundTask(name, args, () => {
          const handler = handlers[name];
          if (name === "bash") return runBashInBackground(args.command);
          return handler ? handler(args, confirm) : `Unknown tool: ${name}`;
        });
        console.log(`  → start_background_task → ${bgId}`);
        output = `[Background task ${bgId} started] ${args.command || name}. Result will arrive when complete.`;
      } else {
        const handler = handlers[name];
        output = handler ? await handler(args, confirm) : `Unknown tool: ${name}`;
      }

      if (name === "todo_write") roundsSinceTodo = 0;
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
      console.log(`  → tool_result: "${preview(output, 90)}"`);
    }
    if (compacted) continue;

    // s13：把已完成的后台任务作为独立 user 消息注入（OpenAI 格式下不复用 tool_call_id）。
    await waitForBackgroundTick();
    injectBackgroundNotifications(messages);

    // s10：工具轮结束 → 重新派生 context；变了就重组装，没变命中缓存。
    context = buildContext();
    system = getSystemPrompt(context);
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s13 >> ",
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
