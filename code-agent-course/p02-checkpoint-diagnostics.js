import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { callLlm, tool, isMainModule, colorLog } from "./helper.js";

const SYSTEM = `You are a coding agent. Always read_file before edit_file or overwriting an existing file. If a tool result includes [Diagnostics], fix the reported error immediately before finishing.`;

const tools = [
  tool("read_file", "Read a file (optional line limit).", {
    type: "object",
    properties: { path: { type: "string" }, limit: { type: "integer" } },
    required: ["path"],
  }),
  tool("write_file", "Write a new file or overwrite a previously read file, then run automatic diagnostics.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  }),
  tool("edit_file", "Replace exact unique text in a file (requires fresh read_file) and run diagnostics.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  }),
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

function resolveInside(cwd, relativePath) {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return target;
}

export function runDiagnostics(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    try {
      const source = readFileSync(absPath, "utf8");
      const isEsm = ext === ".mjs" || (ext === ".js" && /^\s*(?:import\s|export\s)/m.test(source));
      if (isEsm) {
        execFileSync(process.execPath, ["--check", "--input-type=module"], {
          input: source,
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        execFileSync(process.execPath, ["--check", absPath], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
      return null;
    } catch (error) {
      return (error.stderr || error.message).trim().split(/\r?\n/).slice(0, 6).join("\n");
    }
  }
  if (ext === ".json") {
    try {
      JSON.parse(readFileSync(absPath, "utf8"));
      return null;
    } catch (error) {
      return `JSON SyntaxError: ${error.message}`;
    }
  }
  return null;
}

export function createWorkspaceGuard({ cwd = process.cwd(), diagnose = runDiagnostics } = {}) {
  const seenHashes = new Map();
  const checkpoints = [];
  let active = null;
  let seq = 0;

  const beginCheckpoint = (label, messageCount) => {
    active = {
      id: `cp_${String(++seq).padStart(3, "0")}`,
      label: String(label || "").slice(0, 60),
      messageCount,
      snapshots: new Map(),
      saved: false,
    };
    return active.id;
  };

  const assertFreshRead = (absPath, filePath, current, action) => {
    const lastHash = seenHashes.get(absPath);
    if (!lastHash) {
      return `Error: call read_file on ${filePath} before ${action}.`;
    }
    if (lastHash !== sha256(current)) {
      return `Error: stale read - ${filePath} changed on disk since last read. Call read_file again.`;
    }
    return null;
  };

  const snapshotBeforeWrite = (absPath) => {
    if (!active) beginCheckpoint("auto", 0);
    if (!active.snapshots.has(absPath)) {
      const existed = existsSync(absPath);
      active.snapshots.set(absPath, {
        existed,
        content: existed ? readFileSync(absPath, "utf8") : null,
      });
    }
    if (!active.saved) {
      checkpoints.push(active);
      active.saved = true;
    }
  };

  const readFileChecked = (filePath, limit) => {
    try {
      const absPath = resolveInside(cwd, filePath);
      const text = readFileSync(absPath, "utf8");
      seenHashes.set(absPath, sha256(text));
      const lines = text.split(/\r?\n/);
      if (limit && limit < lines.length) {
        return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`].join("\n");
      }
      return text;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  };

  const writeFileChecked = (filePath, content) => {
    try {
      const absPath = resolveInside(cwd, filePath);
      if (existsSync(absPath)) {
        const current = readFileSync(absPath, "utf8");
        const err = assertFreshRead(absPath, filePath, current, "overwriting with write_file");
        if (err) return err;
      }
      snapshotBeforeWrite(absPath);
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, content);
      seenHashes.set(absPath, sha256(content));
      const diag = diagnose(absPath);
      return diag
        ? `Wrote ${content.length} bytes to ${filePath}\n[Diagnostics]\n${diag}`
        : `Wrote ${content.length} bytes to ${filePath} (diagnostics clean)`;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  };

  const editFileChecked = (filePath, oldText, newText) => {
    try {
      if (!oldText) return "Error: old_text must not be empty.";
      const absPath = resolveInside(cwd, filePath);
      const current = readFileSync(absPath, "utf8");
      const err = assertFreshRead(absPath, filePath, current, "edit_file");
      if (err) return err;
      const parts = current.split(oldText);
      if (parts.length === 1) return `Error: old_text not found in ${filePath}`;
      if (parts.length > 2) {
        return `Error: old_text matched ${parts.length - 1} times in ${filePath}; provide more context.`;
      }
      snapshotBeforeWrite(absPath);
      const updated = `${parts[0]}${newText}${parts[1]}`;
      writeFileSync(absPath, updated);
      seenHashes.set(absPath, sha256(updated));
      const diag = diagnose(absPath);
      return diag
        ? `Edited ${filePath}\n[Diagnostics]\n${diag}`
        : `Edited ${filePath} (diagnostics clean)`;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  };

  const listCheckpoints = () =>
    checkpoints.map((cp) => ({
      id: cp.id,
      label: cp.label,
      messageCount: cp.messageCount,
      files: [...cp.snapshots.keys()].map((p) => path.relative(path.resolve(cwd), p)),
    }));

  const rewind = (checkpointId, messages) => {
    if (!checkpoints.length) return { ok: false, error: "No checkpoints available." };
    const targetIdx = checkpointId
      ? checkpoints.findIndex((cp) => cp.id === checkpointId)
      : checkpoints.length - 1;
    if (targetIdx === -1) return { ok: false, error: `Checkpoint not found: ${checkpointId}` };

    const restored = new Set();
    for (let i = checkpoints.length - 1; i >= targetIdx; i -= 1) {
      for (const [absPath, snap] of checkpoints[i].snapshots.entries()) {
        if (snap.existed) {
          mkdirSync(path.dirname(absPath), { recursive: true });
          writeFileSync(absPath, snap.content);
        } else if (existsSync(absPath)) {
          rmSync(absPath);
        }
        restored.add(path.relative(path.resolve(cwd), absPath));
      }
    }
    const target = checkpoints[targetIdx];
    checkpoints.splice(targetIdx);
    seenHashes.clear();
    active = null;
    if (Array.isArray(messages)) messages.length = target.messageCount;
    return { ok: true, checkpointId: target.id, restoredFiles: [...restored].sort() };
  };

  return {
    beginCheckpoint,
    readFileChecked,
    writeFileChecked,
    editFileChecked,
    listCheckpoints,
    rewind,
  };
}

export async function agentLoop(messages, { guard = createWorkspaceGuard(), turnLabel } = {}) {
  const handlers = {
    read_file: ({ path: filePath, limit }) => guard.readFileChecked(filePath, limit),
    write_file: ({ path: filePath, content }) => guard.writeFileChecked(filePath, content),
    edit_file: ({ path: filePath, old_text, new_text }) =>
      guard.editFileChecked(filePath, old_text, new_text),
  };

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "turn";
  guard.beginCheckpoint(turnLabel || lastUser, Math.max(0, messages.length - 1));

  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const parsed = safeParseArgs(call.function.arguments);
      let output;
      if (!parsed.ok) {
        output = parsed.error;
      } else {
        const handler = handlers[call.function.name];
        output = handler ? handler(parsed.value) : `Unknown tool: ${call.function.name}`;
      }
      colorLog("cyan", `> ${call.function.name}: ${String(output).slice(0, 140)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const guard = createWorkspaceGuard();
  const messages = [];

  console.log("p02 Checkpoint & Diagnostics 演示：支持 /checkpoints、/rewind [id]，输入 q 退出。\n");
  try {
    while (true) {
      let input;
      try {
        input = (await rl.question("p02 >> ")).trim();
      } catch {
        break;
      }
      if (!input) continue;
      if (input === "q" || input === "exit") break;

      if (input === "/checkpoints") {
        const list = guard.listCheckpoints();
        console.log(
          list.length
            ? list.map((c) => `  ${c.id} (${c.files.join(", ")}) - ${c.label}`).join("\n")
            : "  (暂无 checkpoint)",
        );
        console.log("");
        continue;
      }

      if (input.startsWith("/rewind")) {
        const id = input.split(/\s+/)[1];
        const res = guard.rewind(id, messages);
        colorLog(
          res.ok ? "green" : "yellow",
          res.ok
            ? `[rewind] 已回滚至 ${res.checkpointId}，还原文件: ${res.restoredFiles.join(", ")}`
            : `[rewind] ${res.error}`,
        );
        console.log("");
        continue;
      }

      messages.push({ role: "user", content: input });
      const answer = await agentLoop(messages, { guard, turnLabel: input });
      messages.push({ role: "assistant", content: answer });
      console.log(`\n${answer}\n`);
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
