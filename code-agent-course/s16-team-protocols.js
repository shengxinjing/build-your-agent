import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
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
  cronMatches,
  validateCron,
  colorLog,
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

const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

let memoryDir = path.join(process.cwd(), ".memory");
export function setMemoryDir(dir) {
  memoryDir = dir;
}
const indexPath = () => path.join(memoryDir, "MEMORY.md");

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

export function readMemoryIndex() {
  return existsSync(indexPath()) ? readFileSync(indexPath(), "utf8").trim() : "";
}

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
  }
  const keywords = recent.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  return files
    .filter((f) => keywords.some((kw) => `${f.name} ${f.description}`.toLowerCase().includes(kw)))
    .slice(0, maxItems)
    .map((f) => f.filename);
}

export async function loadMemories(messages) {
  const selected = await selectRelevantMemories(messages);
  if (!selected.length) return "";
  const parts = ["<relevant_memories>"];
  for (const filename of selected) parts.push(readFileSync(path.join(memoryDir, filename), "utf8"));
  parts.push("</relevant_memories>");
  return parts.join("\n\n");
}

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
  }
}

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

let tasksDir = path.join(process.cwd(), ".tasks");
export function setTasksDir(dir) {
  tasksDir = dir;
}
let taskSeq = 0;
const taskPath = (id) => path.join(tasksDir, `${id}.json`);

function saveTask(task) {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
}
function loadTask(id) {
  if (!existsSync(taskPath(id))) return null;
  return JSON.parse(readFileSync(taskPath(id), "utf8"));
}

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

export function canStart(id) {
  const task = loadTask(id);
  if (!task) return false;
  return task.blockedBy.every((dep) => existsSync(taskPath(dep)) && loadTask(dep).status === "completed");
}

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

let bgCounter = 0;
const backgroundTasks = new Map();
export function resetBackgroundTasks() {
  backgroundTasks.clear();
  bgCounter = 0;
}

const SLOW_KEYWORDS = ["install", "build", "test", "deploy", "compile", "pytest", "make", "cargo"];
const BACKGROUND_POLL_MS = 25;
export function isSlowOperation(name, args) {
  if (name !== "bash") return false;
  const cmd = (args.command || "").toLowerCase();
  return SLOW_KEYWORDS.some((kw) => cmd.includes(kw));
}

export function shouldRunBackground(name, args) {
  return Boolean(args.run_in_background) || isSlowOperation(name, args);
}

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

function preview(value, max = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function describeToolCall(name, args, background) {
  if (name === "bash") {
    return `bash "${preview(args.command, 60)}" (${background ? "run_in_background=true" : "fast, sync"})`;
  }
  if (name === "read_file") return `read_file "${args.path}" (fast, sync)`;
  if (name === "write_file") return `write_file "${args.path}" (fast, sync)`;
  return `${name} ${preview(JSON.stringify(args), 60)} (${background ? "run_in_background=true" : "fast, sync"})`;
}

function notificationTaskId(notification) {
  return notification.match(/<task_id>(.*?)<\/task_id>/)?.[1] || "background task";
}

function injectBackgroundNotifications(messages) {
  const notifications = collectBackgroundResults();
  for (const notification of notifications) {
    messages.push({ role: "user", content: notification });
    console.log(`  [task notification] ${notificationTaskId(notification)} done → inject <task_notification>`);
  }
  return notifications.length;
}

async function waitForBackgroundTick() {
  if (backgroundTasks.size) {
    await new Promise((resolve) => setTimeout(resolve, BACKGROUND_POLL_MS));
  }
}

let cronStorePath = path.join(process.cwd(), ".scheduled_tasks.json");
export function setCronStorePath(p) {
  cronStorePath = p;
}

const scheduledJobs = new Map();
const cronQueue = [];
const lastFired = new Map();
let cronSeq = 0;
let cronProcessing = false;
let agentRunning = false;
export function resetCron() {
  scheduledJobs.clear();
  cronQueue.length = 0;
  lastFired.clear();
  cronSeq = 0;
  cronProcessing = false;
  agentRunning = false;
}

function saveDurableJobs() {
  const durable = [...scheduledJobs.values()].filter((j) => j.durable);
  writeFileSync(cronStorePath, JSON.stringify(durable, null, 2));
}
export function loadDurableJobs() {
  if (!existsSync(cronStorePath)) return;
  try {
    let count = 0;
    for (const j of JSON.parse(readFileSync(cronStorePath, "utf8"))) {
      if (!validateCron(j.cron)) {
        scheduledJobs.set(j.id, j);
        count += 1;
      }
    }
    if (count) console.log(`  [cron] loaded ${count} durable job(s)`);
  } catch {
  }
}

export function scheduleJob(cron, prompt, recurring = true, durable = true) {
  const err = validateCron(cron);
  if (err) return err;
  const job = { id: `cron_${String(cronSeq++).padStart(4, "0")}`, cron, prompt, recurring, durable };
  scheduledJobs.set(job.id, job);
  if (durable) saveDurableJobs();
  console.log(`  [cron register] ${job.id} '${cron}' → ${preview(prompt, 40)}`);
  return job;
}
export function cancelJob(id) {
  const job = scheduledJobs.get(id);
  if (!job) return `Job ${id} not found`;
  scheduledJobs.delete(id);
  if (job.durable) saveDurableJobs();
  return `Cancelled ${id}`;
}
export function listCronJobs() {
  return [...scheduledJobs.values()];
}

export function cronTick(now = new Date()) {
  const marker = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
  for (const job of [...scheduledJobs.values()]) {
    try {
      if (!cronMatches(job.cron, now)) continue;
      if (lastFired.get(job.id) !== marker) {
        cronQueue.push(job);
        lastFired.set(job.id, marker);
        console.log(`  [cron fire] ${job.id} → ${preview(job.prompt, 40)}`);
      }
      if (!job.recurring) {
        scheduledJobs.delete(job.id);
        if (job.durable) saveDurableJobs();
      }
    } catch {
    }
  }
}

export function consumeCronQueue() {
  return cronQueue.splice(0);
}

export function hasCronQueue() {
  return cronQueue.length > 0;
}

function injectCronJobs(messages) {
  const fired = consumeCronQueue();
  for (const job of fired) {
    messages.push({ role: "user", content: `[Scheduled] ${job.prompt}` });
    console.log(`  [inject cron] ${preview(job.prompt, 50)}`);
  }
  return fired.length;
}

export async function processCronQueue(confirm = async () => "n") {
  if (cronProcessing || agentRunning || !hasCronQueue()) return false;
  cronProcessing = true;
  agentRunning = true;
  try {
    if (!hasCronQueue()) return false;
    console.log("\n  [queue processor] delivering scheduled work");
    const text = await agentLoop([], confirm);
    if (text) console.log(text);
    console.log();
    return true;
  } catch (error) {
    console.error(`[queue processor error] ${error.message}`);
    return false;
  } finally {
    agentRunning = false;
    cronProcessing = false;
  }
}

function runScheduleCron({ cron, prompt, recurring = true, durable = true }) {
  const result = scheduleJob(cron, prompt, recurring, durable);
  return typeof result === "string" ? `Error: ${result}` : `Scheduled ${result.id}: '${cron}' → ${prompt}`;
}
function runListCrons() {
  const jobs = listCronJobs();
  if (!jobs.length) return "No cron jobs. Use schedule_cron to add one.";
  return jobs
    .map(
      (j) =>
        `${j.id}: '${j.cron}' → ${j.prompt.slice(0, 40)} [${j.recurring ? "recurring" : "one-shot"}, ${j.durable ? "durable" : "session"}]`,
    )
    .join("\n");
}
function runCancelCron({ job_id }) {
  return cancelJob(job_id);
}

let mailboxDir = path.join(process.cwd(), ".mailboxes");
export function setMailboxDir(dir) {
  mailboxDir = dir;
}
export function sendMessage(from, to, content, type = "message", metadata = {}) {
  mkdirSync(mailboxDir, { recursive: true });
  appendFileSync(path.join(mailboxDir, `${to}.jsonl`), `${JSON.stringify({ from, to, content, type, ts: Date.now(), metadata })}\n`);
  console.log(`  [bus] ${from} → ${to}: ${preview(content, 50)}`);
  if (type !== "message") {
    const req = metadata.request_id ? ` ${metadata.request_id}` : "";
    colorLog("cyan", `[protocol] ${type}${req}: ${from} → ${to}`);
  }
}
export function readInbox(agent) {
  const file = path.join(mailboxDir, `${agent}.jsonl`);
  if (!existsSync(file)) return [];
  const msgs = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  rmSync(file);
  return msgs;
}

const activeTeammates = new Set();
export function resetTeammates() {
  activeTeammates.clear();
}
const TEAMMATE_TURNS = 20;
const TEAMMATE_IDLE_TICKS = 20;
const TEAMMATE_IDLE_MS = 250;

export function spawnTeammate(name, role, prompt, confirm) {
  if (activeTeammates.has(name)) return `Teammate '${name}' already exists`;
  activeTeammates.add(name);
  const system = `You are '${name}', a ${role}. Use tools to complete tasks. Send results via send_message to 'lead'.`;
  const teamTools = [
    tool("bash", "Run a shell command.", {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    }),
    tool("read_file", "Read a file.", {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    }),
    tool("write_file", "Write content to a file.", {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    }),
    tool("send_message", "Send a message to another agent (e.g. 'lead').", {
      type: "object",
      properties: { to: { type: "string" }, content: { type: "string" } },
      required: ["to", "content"],
    }),
    tool("submit_plan", "Submit a plan to the lead for approval before acting.", {
      type: "object",
      properties: { plan: { type: "string" } },
      required: ["plan"],
    }),
  ];
  const teamHandlers = {
    bash: ({ command }) => runBash(command),
    read_file: ({ path }) => readFile(path),
    write_file: ({ path, content }) => writeFile(path, content),
    send_message: ({ to, content }) => {
      sendMessage(name, to, content);
      return `Sent to ${to}`;
    },
    submit_plan: ({ plan }) => teammateSubmitPlan(name, plan),
  };
  const run = async () => {
    const messages = [{ role: "user", content: prompt }];
    let summary = "Done.";
    let needsModel = true;
    let idleTicks = 0;
    let pendingShutdown = null;
    for (let turn = 0; turn < TEAMMATE_TURNS; turn += 1) {
      const inbox = readInbox(name);
      const nonProtocol = [];
      for (const msg of inbox) {
        if (msg.type === "shutdown_request") {
          pendingShutdown = msg;
        } else if (msg.type === "plan_approval_response") {
          colorLog(msg.metadata?.approve ? "green" : "yellow", `[protocol] ${name} received plan review ${msg.metadata?.request_id}`);
          messages.push({
            role: "user",
            content: msg.metadata?.approve ? "[Plan approved] Proceed." : `[Plan rejected] ${msg.content}`,
          });
          needsModel = true;
          idleTicks = 0;
        } else {
          nonProtocol.push(msg);
        }
      }
      if (nonProtocol.length) {
        messages.push({ role: "user", content: `<inbox>${JSON.stringify(nonProtocol)}</inbox>` });
        needsModel = true;
        idleTicks = 0;
      }
      if (pendingShutdown && !needsModel) {
        colorLog("cyan", `[protocol] ${name} received shutdown request ${pendingShutdown.metadata?.request_id}`);
        sendMessage(name, "lead", "Shutting down gracefully.", "shutdown_response", {
          request_id: pendingShutdown.metadata?.request_id,
          approve: true,
        });
        summary = "Shut down gracefully.";
        break;
      }
      if (!needsModel) {
        idleTicks += 1;
        if (idleTicks >= TEAMMATE_IDLE_TICKS) break;
        await sleep(TEAMMATE_IDLE_MS);
        continue;
      }
      const { message } = await callLlm(messages.slice(-20), { system, tools: teamTools });
      messages.push(message);
      if (!message.tool_calls?.length) {
        summary = message.content || summary;
        needsModel = false;
        continue;
      }
      idleTicks = 0;
      for (const call of message.tool_calls) {
        const toolName = call.function.name;
        const args = JSON.parse(call.function.arguments || "{}");
        const blocked = await triggerHooks("PreToolUse", toolName, args, confirm);
        const handler = teamHandlers[toolName];
        const output =
          blocked != null ? String(blocked) : handler ? handler(args) : `Unknown tool: ${toolName}`;
        messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
      }
    }
    sendMessage(name, "lead", summary, "result");
  };

  Promise.resolve()
    .then(run)
    .catch((error) => sendMessage(name, "lead", `Error: ${error.message}`, "error"))
    .finally(() => {
      activeTeammates.delete(name);
      console.log(`  [teammate] ${name} finished`);
    });

  console.log(`  [teammate] ${name} spawned as ${role}`);
  return `Teammate '${name}' spawned as ${role}`;
}

function runSpawnTeammate({ name, role, prompt }, confirm) {
  return spawnTeammate(name, role, prompt, confirm);
}
function runSendMessage({ to, content }) {
  sendMessage("lead", to, content);
  return `Sent to ${to}`;
}
function runCheckInbox() {
  const msgs = consumeLeadInbox(true);
  if (!msgs.length) return "(inbox empty)";
  return msgs
    .map((m) => {
      const reqId = m.metadata?.request_id;
      const tag = reqId ? `[${m.type} req:${reqId}]` : `[${m.type}]`;
      return `[${m.from}]${tag} ${m.content.slice(0, 200)}`;
    })
    .join("\n");
}

export const pendingRequests = new Map();
let reqSeq = 0;
export function resetProtocol() {
  pendingRequests.clear();
  reqSeq = 0;
}
const newRequestId = () => `req_${String(reqSeq++).padStart(4, "0")}`;

export function matchResponse(responseType, requestId, approve) {
  const state = pendingRequests.get(requestId);
  if (!state) return;
  if (state.type === "shutdown" && responseType !== "shutdown_response") return;
  if (state.type === "plan_approval" && responseType !== "plan_approval_response") return;
  if (state.status !== "pending") return;
  state.status = approve ? "approved" : "rejected";
  colorLog(approve ? "green" : "yellow", `[protocol] ${requestId} ${state.status}`);
}

export function consumeLeadInbox(routeProtocol = true) {
  const msgs = readInbox("lead");
  if (routeProtocol) {
    for (const msg of msgs) {
      const reqId = msg.metadata?.request_id;
      if (reqId && msg.type?.endsWith("_response")) {
        colorLog("cyan", `[protocol] route response ${reqId} from ${msg.from}`);
        matchResponse(msg.type, reqId, msg.metadata?.approve || false);
      }
    }
  }
  return msgs;
}

function teammateSubmitPlan(fromName, plan) {
  const reqId = newRequestId();
  pendingRequests.set(reqId, { request_id: reqId, type: "plan_approval", sender: fromName, target: "lead", status: "pending", payload: plan });
  colorLog("cyan", `[protocol] ${fromName} submitted plan ${reqId}`);
  sendMessage(fromName, "lead", plan, "plan_approval_request", { request_id: reqId });
  return `Plan submitted (${reqId}). Waiting for approval...`;
}

function runRequestShutdown({ teammate }) {
  const reqId = newRequestId();
  pendingRequests.set(reqId, { request_id: reqId, type: "shutdown", sender: "lead", target: teammate, status: "pending", payload: "" });
  sendMessage("lead", teammate, "Please shut down gracefully.", "shutdown_request", { request_id: reqId });
  return `Shutdown request sent to ${teammate} (req: ${reqId})`;
}
function runRequestPlan({ teammate, task }) {
  colorLog("cyan", `[protocol] ask ${teammate} for a plan`);
  sendMessage("lead", teammate, `Please submit a plan for: ${task}`, "message");
  return `Asked ${teammate} to submit a plan`;
}
function runReviewPlan({ request_id, approve, feedback = "" }) {
  const state = pendingRequests.get(request_id);
  if (!state) return `Request ${request_id} not found`;
  if (state.status !== "pending") return `Request ${request_id} already ${state.status}`;
  state.status = approve ? "approved" : "rejected";
  sendMessage("lead", state.sender, feedback || (approve ? "Approved" : "Rejected"), "plan_approval_response", { request_id, approve });
  return `Plan ${approve ? "approved" : "rejected"} (${request_id})`;
}

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

const DEFAULT_MAX_TOKENS = 8000;
const ESCALATED_MAX_TOKENS = 64000;
const MAX_RECOVERY_RETRIES = 3;
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 500;
const MAX_CONSECUTIVE_529 = 3;
const CONTINUATION_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap. Pick up mid-thought.";

export class RecoveryState {
  constructor() {
    this.escalated = false;
    this.recoveryCount = 0;
    this.consecutive529 = 0;
    this.attemptedReactiveCompact = false;
    this.currentModel = null;
  }
}

export function retryDelay(attempt, retryAfter) {
  if (retryAfter) return retryAfter;
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, 32000);
  return base + Math.random() * base * 0.25;
}

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function setSleepFn(fn) {
  sleep = fn;
}

const isRateLimit = (msg) => /\b429\b|rate.?limit/i.test(msg);
const isOverloaded = (msg) => /\b529\b|overloaded/i.test(msg);

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
      throw error;
    }
  }
  throw new Error(`Max retries (${MAX_RETRIES}) exceeded`);
}

const PROMPT_SECTIONS = {
  identity: () =>
    `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Before a multi-step task, use todo_write to plan and update status as you go. For a complex sub-problem, use the task tool to spawn a subagent. When delegating to a teammate, prefer check_inbox for teammate updates; do not use sleep loops to wait for files unless the user explicitly asks you to wait.`,
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

export function assembleSystemPrompt(context) {
  return SECTION_ORDER.map((key) => PROMPT_SECTIONS[key](context)).filter(Boolean).join("\n\n");
}

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

export function buildContext() {
  const skills = listSkills();
  return {
    tools: tools.map((t) => t.function.name),
    skills: skills === "(no skills found)" ? "" : skills,
    memories: readMemoryIndex(),
  };
}

const SUB_SYSTEM = `You are a coding subagent at ${process.cwd()}. Complete the task, then return a concise summary. Do not delegate further.`;

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
  tool("schedule_cron", "Schedule a cron job (5-field: min hour dom month dow) to inject a prompt when it fires.", {
    type: "object",
    properties: {
      cron: { type: "string" },
      prompt: { type: "string" },
      recurring: { type: "boolean" },
      durable: { type: "boolean" },
    },
    required: ["cron", "prompt"],
  }),
  tool("list_crons", "List all registered cron jobs.", { type: "object", properties: {} }),
  tool("cancel_cron", "Cancel a cron job by id.", {
    type: "object",
    properties: { job_id: { type: "string" } },
    required: ["job_id"],
  }),
  tool("spawn_teammate", "Spawn a teammate agent (its own multi-round loop) to help with a task.", {
    type: "object",
    properties: { name: { type: "string" }, role: { type: "string" }, prompt: { type: "string" } },
    required: ["name", "role", "prompt"],
  }),
  tool("send_message", "Send a message to a teammate via the message bus.", {
    type: "object",
    properties: { to: { type: "string" }, content: { type: "string" } },
    required: ["to", "content"],
  }),
  tool("check_inbox", "Check the lead's inbox for teammate messages.", { type: "object", properties: {} }),
  tool("request_shutdown", "Ask a teammate to shut down gracefully (handshake).", {
    type: "object",
    properties: { teammate: { type: "string" } },
    required: ["teammate"],
  }),
  tool("request_plan", "Ask a teammate to submit a plan before acting.", {
    type: "object",
    properties: { teammate: { type: "string" }, task: { type: "string" } },
    required: ["teammate", "task"],
  }),
  tool("review_plan", "Approve or reject a submitted plan by request_id.", {
    type: "object",
    properties: {
      request_id: { type: "string" },
      approve: { type: "boolean" },
      feedback: { type: "string" },
    },
    required: ["request_id", "approve"],
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
  create_task: runCreateTask,
  list_tasks: runListTasks,
  get_task: runGetTask,
  claim_task: ({ task_id }) => claimTask(task_id),
  complete_task: ({ task_id }) => completeTask(task_id),
  schedule_cron: runScheduleCron,
  list_crons: runListCrons,
  cancel_cron: runCancelCron,
  spawn_teammate: runSpawnTeammate,
  send_message: runSendMessage,
  check_inbox: runCheckInbox,
  request_shutdown: runRequestShutdown,
  request_plan: runRequestPlan,
  review_plan: runReviewPlan,
};

const SUB_EXCLUDE = [
  "task",
  "todo_write",
  "load_skill",
  "compact",
  "spawn_teammate",
  "send_message",
  "check_inbox",
  "request_shutdown",
  "request_plan",
  "review_plan",
];
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
  const state = new RecoveryState();
  let maxTokens = DEFAULT_MAX_TOKENS;
  let context = buildContext();
  let system = getSystemPrompt(context);
  const memoriesContent = await loadMemories(messages);
  let preCompress = messages.map((m) => ({ role: m.role, content: m.content }));
  let turn = 0;

  while (true) {
    turn += 1;
    injectBackgroundNotifications(messages);

    injectCronJobs(messages);
    for (const m of consumeLeadInbox()) {
      messages.push({ role: "user", content: `[Inbox] From ${m.from}: ${m.content.slice(0, 200)}` });
    }
    if (roundsSinceTodo >= 3) {
      messages.push({ role: "user", content: "<reminder>Update your todos.</reminder>" });
      roundsSinceTodo = 0;
    }

    preCompress = messages.map((m) => ({ role: m.role, content: m.content }));

    apply(messages, toolResultBudget(messages));
    apply(messages, snipCompact(messages));
    apply(messages, microCompact(messages));
    if (estimateSize(messages) > CONTEXT_LIMIT) apply(messages, await compactHistory(messages));

    let choice;
    try {
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
      if (isPromptTooLong(error) && !state.attemptedReactiveCompact) {
        apply(messages, await reactiveCompact(messages));
        state.attemptedReactiveCompact = true;
        continue;
      }
      console.error(`[unrecoverable] ${error.message}`);
      return `[Error] ${error.message}`;
    }

    const message = choice.message;

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
      console.log(`> ${describeToolCall(name, args, runInBackground)}`);

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
        const bgId = startBackgroundTask(name, args, () => {
          const handler = handlers[name];
          if (name === "bash") return runBashInBackground(args.command);
          return handler ? handler(args, confirm) : `Unknown tool: ${name}`;
        });
        output = `[Background task ${bgId} started] ${args.command || name}. Result will arrive when complete.`;
      } else {
        const handler = handlers[name];
        output = handler ? await handler(args, confirm) : `Unknown tool: ${name}`;
      }

      if (name === "todo_write") roundsSinceTodo = 0;
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
    if (compacted) continue;

    await waitForBackgroundTick();
    injectBackgroundNotifications(messages);

    context = buildContext();
    system = getSystemPrompt(context);
  }
}

async function runInteractiveAgentTurn(messages, confirm) {
  while (agentRunning) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  agentRunning = true;
  try {
    return await agentLoop(messages, confirm);
  } finally {
    agentRunning = false;
  }
}

async function main() {
  loadDurableJobs();
  console.log("  [queue processor] started");
  const ticker = setInterval(() => {
    cronTick(new Date());
    processCronQueue(async () => "n");
  }, 1000);
  ticker.unref?.();
  await runChatCli({
    promptLabel: "s16 >> ",
    onPrompt: async ({ prompt, messages, ask }) => {
      return runInteractiveAgentTurn(messages, ask);
    },
  });
  clearInterval(ticker);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
