import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  callLlm,
  runBash,
  readFile,
  writeFile,
  tool,
  isMainModule,
  colorLog,
} from "./helper.js";

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks concisely.`;

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
];

const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path: filePath, limit }) => readFile(filePath, limit),
  write_file: ({ path: filePath, content }) => writeFile(filePath, content),
};

function assertValidSessionId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id || ""))) {
    throw new Error(`Invalid session id: ${id}`);
  }
  return id;
}

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

function repairRecoveredToolCalls(messages) {
  const result = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    result.push(msg);
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;

    const answered = new Set();
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      answered.add(messages[j].tool_call_id);
      result.push(messages[j]);
      j += 1;
    }
    for (const call of msg.tool_calls) {
      if (call.id && !answered.has(call.id)) {
        result.push({
          role: "tool",
          tool_call_id: call.id,
          content: "[Recovered: tool did not finish before crash]",
        });
      }
    }
    i = j - 1;
  }
  return result;
}

export function buildModelMessages(events) {
  let lastCompactIdx = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "compaction") {
      lastCompactIdx = i;
      break;
    }
  }
  if (lastCompactIdx === -1) {
    return repairRecoveredToolCalls(events.filter((e) => e.type === "message").map((e) => e.message));
  }
  const compact = events[lastCompactIdx];
  const keepFromSeq = compact.keepFromSeq ?? Number.MAX_SAFE_INTEGER;
  const tail = events
    .filter((e) => e.type === "message" && e.seq >= keepFromSeq)
    .map((e) => e.message);
  return repairRecoveredToolCalls([
    { role: "user", content: `[Compacted Session Summary]\n${compact.summary}` },
    ...tail,
  ]);
}

export function createSessionStore(sessionsDir = path.join(process.cwd(), ".sessions")) {
  const ensureDir = () => mkdirSync(sessionsDir, { recursive: true });
  const filePath = (id) => path.join(sessionsDir, `${assertValidSessionId(id)}.jsonl`);
  const seqCache = new Map();

  const readEvents = (id) => {
    const file = filePath(id);
    if (!existsSync(file)) throw new Error(`Session not found: ${id}`);
    const events = [];
    let meta = null;
    let lastSeq = 0;
    let corruptedLines = 0;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session_meta") {
          meta = entry;
        } else {
          events.push(entry);
          if (typeof entry.seq === "number" && entry.seq > lastSeq) lastSeq = entry.seq;
        }
      } catch {
        corruptedLines += 1;
      }
    }
    seqCache.set(id, lastSeq);
    return { meta, events, lastSeq, corruptedLines };
  };

  const nextSeq = (id) => {
    if (!seqCache.has(id)) readEvents(id);
    const next = (seqCache.get(id) || 0) + 1;
    seqCache.set(id, next);
    return next;
  };

  const createSession = ({ id, parentId = null, forkedFromSeq = null, cwd = process.cwd() } = {}) => {
    ensureDir();
    const sessionId = assertValidSessionId(
      id || `sess_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    );
    const meta = {
      type: "session_meta",
      id: sessionId,
      parentId,
      forkedFromSeq,
      cwd,
      createdAt: new Date().toISOString(),
    };
    appendFileSync(filePath(sessionId), `${JSON.stringify(meta)}\n`);
    seqCache.set(sessionId, 0);
    return meta;
  };

  const appendMessage = (id, message) => {
    const entry = { type: "message", seq: nextSeq(id), ts: Date.now(), message };
    appendFileSync(filePath(id), `${JSON.stringify(entry)}\n`);
    return entry;
  };

  const appendCompaction = (id, summary, keepFromSeq) => {
    const entry = { type: "compaction", seq: nextSeq(id), ts: Date.now(), summary, keepFromSeq };
    appendFileSync(filePath(id), `${JSON.stringify(entry)}\n`);
    return entry;
  };

  const loadModelMessages = (id) => buildModelMessages(readEvents(id).events);

  const forkSession = (sourceId, { upToSeq, id } = {}) => {
    const { meta, events } = readEvents(sourceId);
    const copied = upToSeq == null ? events : events.filter((e) => e.seq <= upToSeq);
    const cutoff = copied.length ? copied[copied.length - 1].seq : 0;
    const forked = createSession({
      id,
      parentId: sourceId,
      forkedFromSeq: cutoff,
      cwd: meta?.cwd || process.cwd(),
    });
    for (const event of copied) {
      appendFileSync(filePath(forked.id), `${JSON.stringify(event)}\n`);
    }
    seqCache.set(forked.id, cutoff);
    return forked;
  };

  const listSessions = () => {
    if (!existsSync(sessionsDir)) return [];
    return readdirSync(sessionsDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => {
        const id = name.replace(/\.jsonl$/, "");
        const { meta, events, lastSeq, corruptedLines } = readEvents(id);
        return {
          id,
          parentId: meta?.parentId || null,
          forkedFromSeq: meta?.forkedFromSeq ?? null,
          messageCount: events.filter((e) => e.type === "message").length,
          lastSeq,
          corruptedLines,
        };
      });
  };

  return {
    createSession,
    readEvents,
    appendMessage,
    appendCompaction,
    loadModelMessages,
    forkSession,
    listSessions,
  };
}

export async function compactSession(store, sessionId, { keepTail = 2 } = {}) {
  const { events } = store.readEvents(sessionId);
  let lastCompact = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "compaction") {
      lastCompact = events[i];
      break;
    }
  }

  const activeMsgs = events.filter(
    (e) => e.type === "message" && (!lastCompact || e.seq >= lastCompact.keepFromSeq),
  );
  if (activeMsgs.length <= keepTail) return null;

  let cutIdx = activeMsgs.length - keepTail;
  while (cutIdx > 0 && activeMsgs[cutIdx].message.role === "tool") {
    cutIdx -= 1;
  }
  if (cutIdx <= 0) return null;

  const keepFromSeq = activeMsgs[cutIdx].seq;
  const toSummarize = [];
  if (lastCompact) {
    toSummarize.push({ role: "user", content: `[Previous Summary]\n${lastCompact.summary}` });
  }
  toSummarize.push(...activeMsgs.slice(0, cutIdx).map((e) => e.message));

  const { message } = await callLlm(
    [
      {
        role: "user",
        content: `Summarize the key goals, decisions, and file changes concisely:\n${JSON.stringify(toSummarize)}`,
      },
    ],
    { system: "You summarize coding agent sessions accurately in a few bullet points." },
  );
  return store.appendCompaction(sessionId, message.content || "(empty summary)", keepFromSeq);
}

export async function runSessionTurn(store, sessionId, userPrompt) {
  store.appendMessage(sessionId, { role: "user", content: userPrompt });
  const messages = store.loadModelMessages(sessionId);

  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) {
      const content = message.content || "";
      store.appendMessage(sessionId, { role: "assistant", content });
      return { content, sessionId };
    }

    messages.push(message);
    store.appendMessage(sessionId, message);
    for (const call of message.tool_calls) {
      const parsed = safeParseArgs(call.function.arguments);
      let output;
      if (!parsed.ok) {
        output = parsed.error;
      } else {
        const handler = handlers[call.function.name];
        output = handler ? handler(parsed.value) : `Unknown tool: ${call.function.name}`;
      }
      const toolMsg = { role: "tool", tool_call_id: call.id, content: String(output) };
      colorLog("cyan", `> ${call.function.name}: ${String(output).slice(0, 120)}`);
      messages.push(toolMsg);
      store.appendMessage(sessionId, toolMsg);
    }
  }
}

async function main() {
  const store = createSessionStore();
  const resumeIdx = process.argv.indexOf("--resume");
  let sessionId;
  if (resumeIdx !== -1 && process.argv[resumeIdx + 1]) {
    sessionId = process.argv[resumeIdx + 1];
    const loaded = store.readEvents(sessionId);
    colorLog(
      "green",
      `[resume] 已加载 ${sessionId} (${loaded.events.length} 条事件${loaded.corruptedLines ? `, 跳过 ${loaded.corruptedLines} 条损坏行` : ""})`,
    );
  } else {
    sessionId = store.createSession().id;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`p03 Session Event Log 演示 (当前会话: ${sessionId})`);
  console.log("支持命令: /sessions, /resume <id>, /fork [seq], /compact, /log, q\n");
  try {
    while (true) {
      let input;
      try {
        input = (await rl.question(`p03(${sessionId.slice(-6)}) >> `)).trim();
      } catch {
        break;
      }
      if (!input) continue;
      if (input === "q" || input === "exit") break;

      try {
        if (input === "/sessions") {
          for (const s of store.listSessions()) {
            const from = s.parentId ? ` (fork of ${s.parentId}@${s.forkedFromSeq})` : "";
            console.log(`  ${s.id}  msgs=${s.messageCount} seq=${s.lastSeq}${from}`);
          }
          console.log("");
          continue;
        }
        if (input.startsWith("/resume ")) {
          const nextId = input.slice(8).trim();
          const { events, corruptedLines } = store.readEvents(nextId);
          sessionId = nextId;
          colorLog(
            "green",
            `[resume] 已切换到 ${sessionId} (${events.length} 条事件${corruptedLines ? `, 跳过 ${corruptedLines} 条损坏行` : ""})`,
          );
          continue;
        }
        if (input.startsWith("/fork")) {
          const arg = input.split(/\s+/)[1];
          const upToSeq = arg == null ? undefined : Number(arg);
          if (upToSeq !== undefined && (!Number.isInteger(upToSeq) || upToSeq < 0)) {
            colorLog("yellow", `[fork] 无效序号: ${arg}`);
            continue;
          }
          const forked = store.forkSession(sessionId, { upToSeq });
          sessionId = forked.id;
          colorLog("green", `[fork] 新分叉会话 ${forked.id} (from ${forked.parentId}@${forked.forkedFromSeq})`);
          continue;
        }
        if (input === "/compact") {
          const entry = await compactSession(store, sessionId);
          colorLog("yellow", entry ? `[compact] 已追加压缩事件 seq=${entry.seq}` : "[compact] 消息太少，无需压缩");
          continue;
        }
        if (input === "/log") {
          const { events } = store.readEvents(sessionId);
          for (const e of events) {
            const preview =
              e.type === "compaction"
                ? `COMPACT keepFrom=${e.keepFromSeq}`
                : `${e.message.role}: ${String(e.message.content || "[tool_calls]").slice(0, 60)}`;
            console.log(`  #${e.seq} [${e.type}] ${preview}`);
          }
          console.log("");
          continue;
        }

        const { content } = await runSessionTurn(store, sessionId, input);
        console.log(`\n${content}\n`);
      } catch (error) {
        colorLog("yellow", `[error] ${error.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
