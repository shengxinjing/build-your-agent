import { createInterface } from "node:readline/promises";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 
  appendFileSync, 
  existsSync, 
  readFileSync, 
  writeFileSync, 
  mkdirSync, 
  readdirSync, 
  rmSync 
} from "node:fs";
import path from "node:path";

// 当前页面选择的模型服务商会被注入到这里。
export const llmProvider = "__BUILD_YOUR_AGENT_LLM_PROVIDER__";

// 当前页面输入的 API token 会被注入到这里。
export const apiToken = "__BUILD_YOUR_AGENT_API_TOKEN__";

// 所有服务商的请求地址、模型名和 token 都集中放在这张表里。
export const llmProviderConfigs = {
  openai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    token: apiToken,
  },
  deepseek: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro",
    token: apiToken,
  },
  kimi: {
    provider: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    token: apiToken,
  },
};

// callLlm —— 调用当前配置的大模型，支持普通对话、system prompt 和 tools。
// callLlm — calls the configured LLM with optional system prompt and tools.
// 用原生 fetch 展示 HTTP 调用的本质；真实项目可换成 axios（超时/重试/拦截器）：
// Uses raw fetch to show what an HTTP call is; real projects might use axios:
// https://github.com/axios/axios
export async function callLlm(messages, { system, tools, model, provider = llmProvider, maxTokens } = {}) {
  const config = llmProviderConfigs[provider] || llmProviderConfigs.openai;

  if (!config.token) {
    throw new Error("Missing API token.");
  }

  const body = {
    model: model || config.model,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (maxTokens) body.max_tokens = maxTokens;

  let response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const cause = error.cause?.code
      ? `${error.cause.code}: ${error.cause.message}`
      : error.cause?.message || error.message;
    throw new Error(`Network request failed: ${cause}`);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data.error || data)}`);
  }

  // 返回整个 choice，让调用方自己读取文本或 tool_calls。
  // Return the whole choice so callers can read either text or tool_calls.
  return data.choices[0];
}

// runBash —— 在工作目录执行一条 shell 命令的工具函数（带危险命令拦截）。
// runBash — a tool function that runs one shell command in the cwd (with a danger guard).
export function runBash(command) {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];

  if (dangerous.some((item) => command.includes(item))) {
    return "Error: dangerous command blocked.";
  }

  try {
    return (
      execSync(command, {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      }).trim() || "(no output)"
    );
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || error.message}`.trim();
  }
}

// 获取文件系统的绝对路径，并确保不越界到工作目录外。
// Get an absolute path and ensure it doesn't escape the cwd.
export function safeJoin(relativePath) {
  const root = process.cwd();
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return target;
}

// 读文件（可选限制行数）。
// Read a file (optionally limit the number of lines).
export function readFile(filePath, limit) {
  try {
    const lines = readFileSync(safeJoin(filePath), "utf8").split(/\r?\n/);
    if (limit && limit < lines.length) {
      return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`].join("\n");
    }
    return lines.join("\n");
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// 写文件（自动创建父目录）。
// Write a file (creating parent directories).
export function writeFile(filePath, content) {
  try {
    const target = safeJoin(filePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// 把文件里第一处 old_text 替换成 new_text。
// Replace the first occurrence of old_text with new_text in a file.
export function editFile(filePath, oldText, newText) {
  try {
    const target = safeJoin(filePath);
    const text = readFileSync(target, "utf8");
    if (!text.includes(oldText)) {
      return `Error: text not found in ${filePath}`;
    }
    writeFileSync(target, text.replace(oldText, newText));
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// 用 glob 模式在工作目录下找文件（支持 * ** ?；跳过 node_modules/.git）。
// Find files under the cwd by glob pattern (supports * ** ?; skips node_modules/.git).
export function glob(pattern) {
  const re = globToRegExp(pattern);
  const root = process.cwd();
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(path.join(dir, entry.name));
      } else {
        const rel = path.relative(root, path.join(dir, entry.name));
        if (re.test(rel)) out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort().join("\n") || "(no matches)";
}

// 把 glob 模式转成锚定的正则（* 不跨目录，** 跨目录，? 单字符）。
// Turn a glob pattern into an anchored RegExp (* stays in a dir, ** crosses dirs, ? one char).
function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

// 构造一个工具的 schema（给模型看的工具描述）。
// Build a tool's schema (the tool description shown to the model).
export function tool(name, description, parameters) {
  return { type: "function", function: { name, description, parameters } };
}

// 解析 Markdown frontmatter，供 skill / memory 等需要元信息的章节复用。
// Parse Markdown frontmatter so skill / memory lessons can reuse metadata parsing.
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text };
  }

  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { meta: {}, body: text };
  }

  const meta = {};
  for (const line of text.slice(3, end).trim().split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }

  return { meta, body: text.slice(end + 4).trim() };
}

// 匹配 cron 单个字段：支持 * / */N / N / N-M / N,M,...。
// Match one cron field: supports * / */N / N / N-M / N,M,...
function cronFieldMatches(field, value) {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return step > 0 && value % step === 0;
  }
  if (field.includes(",")) return field.split(",").some((f) => cronFieldMatches(f.trim(), value));
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    return value >= lo && value <= hi;
  }
  return value === Number(field);
}

// 判断某个时间是否命中五段式 cron 表达式。
// Check whether a date matches a five-field cron expression.
export function cronMatches(expr, date) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, month, dow] = fields;
  if (!cronFieldMatches(min, date.getMinutes())) return false;
  if (!cronFieldMatches(hour, date.getHours())) return false;
  if (!cronFieldMatches(month, date.getMonth() + 1)) return false;
  const domOk = cronFieldMatches(dom, date.getDate());
  const dowOk = cronFieldMatches(dow, date.getDay());
  if (dom === "*" && dow === "*") return true;
  if (dom === "*") return dowOk;
  if (dow === "*") return domOk;
  return domOk || dowOk;
}

const CRON_BOUNDS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

// 校验 cron 单个字段，避免非法表达式进入调度器。
// Validate one cron field before it reaches the scheduler.
function validateCronField(field, [lo, hi]) {
  for (const part of field.split(",")) {
    if (part === "*") continue;
    let m;
    if ((m = part.match(/^\*\/(\d+)$/))) {
      if (Number(m[1]) <= 0) return false;
    } else if ((m = part.match(/^(\d+)-(\d+)$/))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < lo || b > hi || a > b) return false;
    } else if (/^\d+$/.test(part)) {
      const v = Number(part);
      if (v < lo || v > hi) return false;
    } else {
      return false;
    }
  }
  return true;
}

// 校验五段式 cron 表达式；合法返回 null，非法返回错误说明。
// Validate a five-field cron expression; return null when valid, or an error message.
export function validateCron(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return `Expected 5 cron fields, got ${fields.length}`;
  const names = ["minute", "hour", "day-of-month", "month", "day-of-week"];
  for (let i = 0; i < 5; i += 1) {
    if (!validateCronField(fields[i], CRON_BOUNDS[i])) return `Invalid ${names[i]}: ${fields[i]}`;
  }
  return null;
}

const ANSI_COLORS = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  reset: "\x1b[0m",
};

// colorLog —— 打印彩色教学日志，方便区分不同运行事件。
// colorLog — prints colored teaching logs to make runtime events easier to scan.
export function colorLog(color, message) {
  console.log(`  ${ANSI_COLORS[color] || ""}${message}${ANSI_COLORS.reset}`);
}

// isMainModule —— 判断当前文件是被直接运行还是被 import（用于守卫 main()）。
// isMainModule — true when the file is run directly, not imported (used to guard main()).
export function isMainModule(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

// 这个函数用 Node 原生 readline 展示命令行交互的本质。
// 真实项目里通常会换成 CLI 框架来处理参数、help、version、子命令和更完整的用户体验：
// cac: https://github.com/cacjs/cac
// commander: https://github.com/tj/commander.js
export async function runChatCli({
  promptLabel = "llm >> ",
  onPrompt,
} = {}) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const messages = [];

  console.log("输入问题，回车发送。输入 q 退出。\n");

  try {
    while (true) {
      const input = await rl.question(promptLabel);
      const prompt = input.trim();

      if (!prompt) continue;
      if (prompt.toLowerCase() === "q" || prompt.toLowerCase() === "exit") {
        break;
      }

      messages.push({ role: "user", content: prompt });

      try {
        // ask 把命令行提问能力传给 onPrompt，供需要二次确认的流程使用。
        // `ask` passes CLI questioning to onPrompt for flows that need confirmation.
        const text = await onPrompt({ prompt, messages, ask: (q) => rl.question(q) });
        messages.push({ role: "assistant", content: text });
        console.log(text);
        console.log();
      } catch (error) {
        console.error(error.message);
      }
    }
  } finally {
    rl.close();
  }
}

// makeTool —— 用更短的参数创建 OpenAI tools schema。
// makeTool — creates an OpenAI tools schema with less boilerplate.
export const stringField = { type: "string" };
export const booleanField = { type: "boolean" };
export const stringListField = { type: "array", items: stringField };
export const makeTool = (name, description, properties = {}, required = []) =>
  tool(name, description, { type: "object", properties, required });

// sleep —— 返回一个延迟指定毫秒后 resolve 的 Promise。
// sleep — returns a Promise that resolves after the given milliseconds.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// createTaskStore —— 创建一个基于 JSON 文件的任务存储，负责读写和状态流转。
// createTaskStore — creates a JSON-file task store for persistence and status changes.
export function createTaskStore(tasksDir, { log = colorLog } = {}) {
  let seq = 0;
  const ensure = () => mkdirSync(tasksDir, { recursive: true });
  const taskPath = (taskId) => path.join(tasksDir, `${taskId}.json`);
  const save = (task) => {
    ensure();
    writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
  };
  const load = (taskId) => JSON.parse(readFileSync(taskPath(taskId), "utf8"));
  const list = () => {
    ensure();
    return readdirSync(tasksDir)
      .filter((name) => /^task_.*\.json$/.test(name))
      .sort()
      .map((name) => JSON.parse(readFileSync(path.join(tasksDir, name), "utf8")));
  };
  const canStart = (taskId) => {
    const task = load(taskId);
    return task.blockedBy.every((depId) => existsSync(taskPath(depId)) && load(depId).status === "completed");
  };
  const create = (subject, description = "", blockedBy = []) => {
    const task = {
      id: `task_${Date.now()}_${String(seq++).padStart(4, "0")}`,
      subject,
      description,
      status: "pending",
      owner: null,
      blockedBy,
    };
    save(task);
    log("cyan", `[create] ${subject}`);
    return task;
  };
  const claim = (taskId, owner = "agent") => {
    const task = load(taskId);
    if (task.status !== "pending") return `Task ${taskId} is ${task.status}, cannot claim`;
    if (task.owner) return `Task ${taskId} already owned by ${task.owner}`;
    if (!canStart(taskId)) return `Cannot start ${taskId}: dependencies are not completed`;
    task.owner = owner;
    task.status = "in_progress";
    save(task);
    log("cyan", `[claim] ${task.subject} -> in_progress`);
    return `Claimed ${task.id} (${task.subject})`;
  };
  const complete = (taskId) => {
    const task = load(taskId);
    if (task.status !== "in_progress") return `Task ${taskId} is ${task.status}, cannot complete`;
    task.status = "completed";
    save(task);
    const unblocked = list()
      .filter((t) => t.status === "pending" && t.blockedBy.length && canStart(t.id))
      .map((t) => t.subject);
    log("green", `[complete] ${task.subject} done`);
    return [`Completed ${task.id} (${task.subject})`, unblocked.length ? `Unblocked: ${unblocked.join(", ")}` : ""]
      .filter(Boolean)
      .join("\n");
  };
  const scanUnclaimed = () => list().filter((task) => task.status === "pending" && !task.owner && canStart(task.id));
  const render = () => {
    const tasks = list();
    if (!tasks.length) return "No tasks.";
    return tasks.map((t) => `  ${t.id}: ${t.subject} [${t.status}] owner=${t.owner || "-"}`).join("\n");
  };
  return { create, list, load, save, canStart, claim, complete, scanUnclaimed, render };
}

// createMailbox —— 创建文件邮箱，每个 agent 使用一个 jsonl 收件箱。
// createMailbox — creates file-based mailboxes, one jsonl inbox per agent.
export function createMailbox(mailboxDir, { log = colorLog } = {}) {
  const ensure = () => mkdirSync(mailboxDir, { recursive: true });
  const mailboxPath = (agent) => path.join(mailboxDir, `${agent}.jsonl`);
  const readLines = (agent) => {
    const file = mailboxPath(agent);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  return {
    send(from, to, content, type = "message", metadata = {}) {
      ensure();
      appendFileSync(mailboxPath(to), `${JSON.stringify({ from, to, content, type, ts: Date.now(), metadata })}\n`);
      log("yellow", `[bus] ${from} -> ${to}: (${type}) ${String(content).slice(0, 50)}`);
    },
    read(agent) {
      const messages = readLines(agent);
      if (messages.length) rmSync(mailboxPath(agent));
      return messages;
    },
    peek(agent) {
      return readLines(agent);
    },
  };
}

// createRequestStore —— 管理 request-response 协议里的请求 id 和审批状态。
// createRequestStore — manages request ids and approval status for request-response protocols.
export function createRequestStore({ log = colorLog } = {}) {
  let seq = 0;
  const pending = new Map();
  const newRequestId = () => `req_${String(seq++).padStart(6, "0")}`;
  const matchResponse = (responseType, requestId, approve) => {
    const state = pending.get(requestId);
    if (!state) return;
    if (state.type === "shutdown" && responseType !== "shutdown_response") return;
    if (state.type === "plan_approval" && responseType !== "plan_approval_response") return;
    state.status = approve ? "approved" : "rejected";
    log(approve ? "green" : "yellow", `[protocol] ${state.type} ${state.status} (${requestId})`);
  };
  return { pending, newRequestId, matchResponse };
}
