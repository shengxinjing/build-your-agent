const fs = require("fs");
const path = require("path");
const { execSync, spawn, spawnSync } = require("child_process");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function loadEnv(envPath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const text = fs.readFileSync(envPath, "utf8");
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getProviderConfig(providerName) {
  const provider = String(
    providerName || process.env.LLM_PROVIDER || "openai",
  ).toLowerCase();

  if (provider === "kimi" || provider === "moonshot") {
    return {
      provider: "kimi",
      apiKey:
        process.env.KIMI_API_KEY ||
        process.env.MOONSHOT_API_KEY ||
        process.env.LLM_API_KEY ||
        "",
      baseUrl:
        process.env.KIMI_BASE_URL ||
        process.env.MOONSHOT_BASE_URL ||
        process.env.LLM_BASE_URL ||
        "https://api.moonshot.cn/v1",
      model:
        process.env.KIMI_MODEL ||
        process.env.MOONSHOT_MODEL ||
        process.env.LLM_MODEL ||
        "kimi-k2-0711-preview",
    };
  }

  return {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "",
    baseUrl:
      process.env.OPENAI_BASE_URL ||
      process.env.LLM_BASE_URL ||
      "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4.1-mini",
  };
}

async function callChatModel({
  provider,
  system,
  messages,
  tools = [],
  temperature = 0,
  mockResponse,
}) {
  const config = getProviderConfig(provider);
  const shouldMock = process.env.MOCK_LLM === "1" || !config.apiKey;

  if (shouldMock) {
    if (!mockResponse) {
      throw new Error(
        "No API key found, and no mockResponse was provided for this script.",
      );
    }

    return mockResponse({
      config,
      system,
      messages,
      tools,
      temperature,
    });
  }

  const payload = {
    model: config.model,
    temperature,
    messages: system
      ? [{ role: "system", content: system }, ...messages]
      : messages,
  };

  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${JSON.stringify(data.error || data)}`,
    );
  }

  return data.choices[0];
}

function makeTool(name, description, parameters) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters,
    },
  };
}

function makeToolCall(name, args, id) {
  return {
    id: id || randomId("call"),
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args || {}),
    },
  };
}

function makeToolChoice(toolCalls) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: toolCalls,
    },
    finish_reason: "tool_calls",
  };
}

function makeTextChoice(text) {
  return {
    message: {
      role: "assistant",
      content: text,
    },
    finish_reason: "stop",
  };
}

function appendAssistantChoice(messages, choice) {
  const assistantMessage = {
    role: "assistant",
    content: choice.message.content || "",
  };

  if (choice.message.tool_calls) {
    assistantMessage.tool_calls = choice.message.tool_calls;
  }

  messages.push(assistantMessage);
}

function assistantText(choice) {
  const content = choice.message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return "";
}

function parseToolArgs(toolCall) {
  return JSON.parse(toolCall.function.arguments || "{}");
}

function toolResultMessage(toolCallId, result) {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content:
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
  };
}

function safeJoin(rootDir, relativePath) {
  const fullPath = path.resolve(rootDir, relativePath);
  const normalizedRoot = path.resolve(rootDir);

  if (
    fullPath !== normalizedRoot &&
    !fullPath.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return fullPath;
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readTextMaybe(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return readText(filePath);
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2));
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function listFiles(rootDir) {
  const output = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        output.push(path.relative(rootDir, fullPath));
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }

  return output.sort();
}

function replaceTextInFile(filePath, oldText, newText) {
  const current = readText(filePath);
  if (!current.includes(oldText)) {
    throw new Error("Target text was not found in file.");
  }
  writeText(filePath, current.replace(oldText, newText));
}

function runShell(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs || 120000;
  const blocked = [
    "rm -rf /",
    "shutdown",
    "reboot",
    "mkfs",
    "dd if=",
    "> /dev/",
  ];

  if (blocked.some((item) => command.includes(item))) {
    return "Error: blocked dangerous command.";
  }

  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim() || "(no output)";
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : "";
    const stderr = error.stderr ? String(error.stderr) : "";
    return (stdout + stderr).trim() || String(error.message);
  }
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Command failed").trim());
  }

  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactConversation(messages, keepRecent = 8) {
  if (messages.length <= keepRecent) {
    return {
      summary: "",
      recentMessages: [...messages],
    };
  }

  const older = messages.slice(0, messages.length - keepRecent);
  const recentMessages = messages.slice(messages.length - keepRecent);

  const summary = older
    .map((message) => {
      if (message.role === "tool") {
        return `tool -> ${String(message.content).slice(0, 120)}`;
      }

      if (Array.isArray(message.content)) {
        return `${message.role} -> [structured content]`;
      }

      return `${message.role} -> ${String(message.content || "").slice(0, 120)}`;
    })
    .join("\n");

  return {
    summary,
    recentMessages,
  };
}

class TaskBoard {
  constructor(boardDir) {
    this.boardDir = ensureDir(boardDir);
  }

  taskPath(taskId) {
    return path.join(this.boardDir, `${taskId}.json`);
  }

  nextId() {
    const ids = this.list()
      .map((task) => {
        const match = String(task.id).match(/(\d+)$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isFinite(value));
    const nextNumber = ids.length === 0 ? 1 : Math.max(...ids) + 1;
    return `task-${String(nextNumber).padStart(3, "0")}`;
  }

  create(title, extra = {}) {
    const task = {
      id: this.nextId(),
      title,
      status: "pending",
      blockedBy: [],
      owner: "",
      worktree: "",
      createdAt: new Date().toISOString(),
      ...extra,
    };
    writeJson(this.taskPath(task.id), task);
    return task;
  }

  get(taskId) {
    const task = readJson(this.taskPath(taskId));
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  list() {
    return listFiles(this.boardDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => readJson(path.join(this.boardDir, fileName)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  update(taskId, patch) {
    const task = this.get(taskId);
    const updated = {
      ...task,
      ...patch,
    };
    writeJson(this.taskPath(taskId), updated);

    if (updated.status === "completed") {
      for (const other of this.list()) {
        if (other.id === taskId) {
          continue;
        }
        if (other.blockedBy.includes(taskId)) {
          other.blockedBy = other.blockedBy.filter((id) => id !== taskId);
          writeJson(this.taskPath(other.id), other);
        }
      }
    }

    return updated;
  }

  ready() {
    return this.list().filter(
      (task) => task.status === "pending" && task.blockedBy.length === 0,
    );
  }

  claimNext(owner) {
    const nextTask = this.ready()[0];
    if (!nextTask) {
      return null;
    }
    return this.update(nextTask.id, {
      status: "in_progress",
      owner,
    });
  }

  render() {
    const lines = this.list().map((task) => {
      const blocked = task.blockedBy.length
        ? ` <- ${task.blockedBy.join(", ")}`
        : "";
      const owner = task.owner ? ` @${task.owner}` : "";
      return `${task.id} [${task.status}]${owner} ${task.title}${blocked}`;
    });
    return lines.join("\n");
  }
}

class MailboxStore {
  constructor(rootDir) {
    this.rootDir = ensureDir(rootDir);
  }

  mailboxDir(agentName) {
    return ensureDir(path.join(this.rootDir, agentName));
  }

  send(message) {
    const mail = {
      id: randomId("mail"),
      createdAt: new Date().toISOString(),
      ...message,
    };
    writeJson(path.join(this.mailboxDir(message.to), `${mail.id}.json`), mail);
    return mail;
  }

  inbox(agentName) {
    return listFiles(this.mailboxDir(agentName))
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) =>
        readJson(path.join(this.mailboxDir(agentName), fileName)),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

class BackgroundJobs {
  constructor() {
    this.jobs = new Map();
    this.nextNumber = 1;
  }

  start(name, command, options = {}) {
    const id = `job-${String(this.nextNumber++).padStart(3, "0")}`;
    const job = {
      id,
      name,
      command,
      status: "running",
      stdout: "",
      stderr: "",
      notified: false,
    };

    const child = spawn(command, {
      cwd: options.cwd || process.cwd(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      job.stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      job.stderr += chunk.toString();
    });

    job.promise = new Promise((resolve) => {
      child.on("close", (code) => {
        job.status = code === 0 ? "completed" : "failed";
        job.exitCode = code;
        job.finishedAt = new Date().toISOString();
        resolve(job);
      });
    });

    this.jobs.set(job.id, job);
    return job;
  }

  notifications() {
    const ready = [];
    for (const job of this.jobs.values()) {
      if ((job.status === "completed" || job.status === "failed") && !job.notified) {
        job.notified = true;
        ready.push(job);
      }
    }
    return ready;
  }
}

class WorktreeManager {
  constructor({ repoDir, worktreeRoot, taskBoard }) {
    this.repoDir = repoDir;
    this.worktreeRoot = ensureDir(worktreeRoot);
    this.indexPath = path.join(this.worktreeRoot, "index.json");
    this.taskBoard = taskBoard;
    if (!fs.existsSync(this.indexPath)) {
      writeJson(this.indexPath, []);
    }
  }

  loadIndex() {
    return readJson(this.indexPath, []);
  }

  saveIndex(items) {
    writeJson(this.indexPath, items);
  }

  create(name, taskId) {
    const index = this.loadIndex();
    const branch = `agent/${name}`;
    const worktreePath = path.join(this.worktreeRoot, name);

    runProcess(
      "git",
      ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
      { cwd: this.repoDir },
    );

    const record = {
      name,
      branch,
      path: worktreePath,
      taskId: taskId || "",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    index.push(record);
    this.saveIndex(index);

    if (taskId && this.taskBoard) {
      this.taskBoard.update(taskId, {
        status: "in_progress",
        worktree: name,
      });
    }

    return record;
  }

  remove(name, options = {}) {
    const index = this.loadIndex();
    const record = index.find((item) => item.name === name);

    if (!record) {
      throw new Error(`Worktree not found: ${name}`);
    }

    runProcess("git", ["worktree", "remove", "--force", record.path], {
      cwd: this.repoDir,
    });

    record.status = "removed";
    record.removedAt = new Date().toISOString();
    this.saveIndex(index);

    if (options.completeTask && record.taskId && this.taskBoard) {
      this.taskBoard.update(record.taskId, {
        status: "completed",
        worktree: "",
      });
    }

    return record;
  }

  list() {
    return this.loadIndex();
  }
}

function randomId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanRuntime(stepName) {
  const runtimeDir = path.join(__dirname, ".runtime", stepName);
  removeDir(runtimeDir);
  ensureDir(runtimeDir);
  return runtimeDir;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function initDemoRepo(repoDir) {
  ensureDir(repoDir);
  runProcess("git", ["init"], { cwd: repoDir });
  runProcess("git", ["config", "user.name", "Tutorial Agent"], { cwd: repoDir });
  runProcess("git", ["config", "user.email", "agent@example.com"], {
    cwd: repoDir,
  });
  writeText(path.join(repoDir, "README.md"), "# demo\n");
  runProcess("git", ["add", "README.md"], { cwd: repoDir });
  runProcess("git", ["commit", "-m", "init"], { cwd: repoDir });
}

module.exports = {
  BackgroundJobs,
  MailboxStore,
  TaskBoard,
  WorktreeManager,
  appendAssistantChoice,
  appendJsonl,
  assistantText,
  assert,
  callChatModel,
  cleanRuntime,
  compactConversation,
  ensureDir,
  getProviderConfig,
  initDemoRepo,
  listFiles,
  loadEnv,
  makeTextChoice,
  makeTool,
  makeToolCall,
  makeToolChoice,
  parseToolArgs,
  randomId,
  readJson,
  readText,
  readTextMaybe,
  removeDir,
  replaceTextInFile,
  runProcess,
  runShell,
  safeJoin,
  sleep,
  toolResultMessage,
  writeJson,
  writeText,
};
