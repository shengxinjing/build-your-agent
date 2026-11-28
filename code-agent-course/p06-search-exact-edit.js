import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { callLlm, colorLog, isMainModule, tool } from "./helper.js";

const SYSTEM = `You are a coding agent for large files. Use search_code to locate targets, read_file(offset, limit) to inspect exact line ranges and capture revision, and replace_lines with expected_lines to edit precisely.`;
const DEFAULT_SKIP_DIRS = new Set([".git", "node_modules"]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const tools = [
  tool("search_code", "Search text recursively in the workspace with stable sorting and bounds.", {
    type: "object",
    properties: { query: { type: "string" }, path: { type: "string" }, maxMatches: { type: "integer" } },
    required: ["query"],
  }),
  tool("read_file", "Read a paginated slice of a UTF-8 file with line numbers and full-file revision.", {
    type: "object",
    properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
    required: ["path"],
  }),
  tool("replace_lines", "Replace exact 1-based lines after checking read window, revision, and expected_lines.", {
    type: "object",
    properties: {
      path: { type: "string" },
      start_line: { type: "integer" },
      end_line: { type: "integer" },
      revision: { type: "string" },
      expected_lines: { type: "array", items: { type: "string" } },
      replacement_lines: { type: "array", items: { type: "string" } },
    },
    required: ["path", "start_line", "end_line", "revision", "expected_lines", "replacement_lines"],
  }),
];

export const computeRevision = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
const compareLex = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const toPosixRel = (rootReal, target) => path.relative(rootReal, target).split(path.sep).join("/") || ".";
const isInsideRoot = (rootReal, target) => target === rootReal || target.startsWith(rootReal + path.sep);

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

export function resolveInsideWorkspace(cwd, relPath = ".") {
  if (typeof relPath !== "string" || !relPath.trim()) throw new Error("Path must be a non-empty string.");
  const rootReal = realpathSync(path.resolve(cwd));
  const lexical = path.resolve(rootReal, relPath);
  if (!isInsideRoot(rootReal, lexical)) throw new Error(`Path escapes workspace: ${relPath}`);
  const targetReal = realpathSync(lexical);
  if (!isInsideRoot(rootReal, targetReal)) throw new Error(`Path escapes workspace via symlink: ${relPath}`);
  return { rootReal, targetReal, relPosix: toPosixRel(rootReal, lexical) };
}

export function decodeUtf8File(buffer) {
  if (buffer.includes(0)) return { ok: false, error: "binary file (contains NUL byte)" };
  try {
    return { ok: true, text: UTF8_DECODER.decode(buffer) };
  } catch {
    return { ok: false, error: "binary or invalid UTF-8 file" };
  }
}

export function splitLinesWithMeta(text) {
  if (!text.length) return { lines: [], eol: "\n", hasTrailingNewline: false };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingNewline = text.endsWith("\r\n") || text.endsWith("\n");
  const body = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
  return { lines: body.split(/\r?\n/), eol, hasTrailingNewline };
}

export function serializeLinesWithMeta(lines, eol, hasTrailingNewline) {
  return lines.length ? lines.join(eol) + (hasTrailingNewline ? eol : "") : "";
}

function truncateUtf8(str, maxBytes) {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return { text: str, truncated: false };
  let used = 0;
  let out = "";
  for (const ch of str) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return { text: `${out}...`, truncated: true };
}

function mergeIntervals(intervals) {
  if (intervals.length <= 1) return intervals.map(([s, e]) => [s, e]);
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    const last = merged[merged.length - 1];
    if (start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function validateLineArray(label, value) {
  if (!Array.isArray(value)) return `Error: ${label} must be an array of strings.`;
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") return `Error: ${label}[${i}] must be a string.`;
    if (item.includes("\0")) return `Error: ${label}[${i}] contains unsupported binary NUL byte.`;
    if (/[\r\n]/.test(item)) return `Error: ${label}[${i}] must not contain raw line breaks.`;
  }
  return null;
}

function loadTextFile(cwd, filePath, action) {
  try {
    const resolved = resolveInsideWorkspace(cwd, filePath);
    if (!lstatSync(resolved.targetReal).isFile()) return { ok: false, error: `Error: ${filePath} is not a file.` };
    const buf = readFileSync(resolved.targetReal);
    const decoded = decodeUtf8File(buf);
    if (!decoded.ok) return { ok: false, error: `Error: cannot ${action} ${filePath} - ${decoded.error}.` };
    return { ok: true, resolved, buf, text: decoded.text };
  } catch (error) {
    return { ok: false, error: `Error: ${error.message}` };
  }
}

export function createCodeEditor({
  cwd = process.cwd(),
  maxFileBytes = 512 * 1024,
  maxLineBytes = 200,
  defaultMaxMatches = 50,
  maxFiles = 2000,
  skipDirs = DEFAULT_SKIP_DIRS,
} = {}) {
  const seenFiles = new Map();

  const searchFile = (fileReal, relPosix, query, limit, state) => {
    let buf;
    try {
      if (lstatSync(fileReal).size > maxFileBytes) return void (state.skipped.tooLarge += 1);
      buf = readFileSync(fileReal);
    } catch {
      return;
    }
    const decoded = decodeUtf8File(buf);
    if (!decoded.ok) return void (state.skipped.binary += 1);
    const { lines } = splitLinesWithMeta(decoded.text);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes(query)) continue;
      if (state.matches.length >= limit) return void (state.truncatedByMatches = true);
      const preview = truncateUtf8(lines[i], maxLineBytes);
      if (preview.truncated) state.truncatedByLineBytes = true;
      state.matches.push({ path: relPosix, line: i + 1, preview: preview.text, lineTruncated: preview.truncated });
    }
  };

  const searchCode = ({ query, path: targetPath = ".", maxMatches = defaultMaxMatches } = {}) => {
    if (typeof query !== "string" || !query.length) return { ok: false, error: "Error: query must be non-empty." };
    if (!Number.isInteger(maxMatches) || maxMatches < 1) {
      return { ok: false, error: "Error: maxMatches must be a positive integer." };
    }
    let resolved;
    try {
      resolved = resolveInsideWorkspace(cwd, targetPath);
    } catch (error) {
      return { ok: false, error: `Error: ${error.message}` };
    }
    const state = {
      matches: [], visitedDirs: new Set(), filesScanned: 0,
      truncatedByMatches: false, truncatedByLineBytes: false, truncatedByFiles: false,
      skipped: { binary: 0, tooLarge: 0, symlinkOutside: 0 },
    };
    const walk = (dirReal) => {
      if (state.visitedDirs.has(dirReal)) return;
      state.visitedDirs.add(dirReal);
      const entries = readdirSync(dirReal, { withFileTypes: true }).sort((a, b) => compareLex(a.name, b.name));
      for (const entry of entries) {
        if (state.truncatedByMatches || state.truncatedByFiles) return;
        if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
        const entryPath = path.join(dirReal, entry.name);
        let entryReal;
        try {
          entryReal = entry.isSymbolicLink() ? realpathSync(entryPath) : entryPath;
        } catch {
          continue;
        }
        if (!isInsideRoot(resolved.rootReal, entryReal)) {
          state.skipped.symlinkOutside += 1;
          continue;
        }
        const stat = lstatSync(entryReal);
        if (stat.isDirectory()) {
          if (!skipDirs.has(path.basename(entryReal))) walk(entryReal);
        } else if (stat.isFile()) {
          if (state.filesScanned >= maxFiles) return void (state.truncatedByFiles = true);
          state.filesScanned += 1;
          searchFile(entryReal, toPosixRel(resolved.rootReal, entryPath), query, maxMatches, state);
        }
      }
    };
    const rootStat = lstatSync(resolved.targetReal);
    if (rootStat.isFile()) searchFile(resolved.targetReal, resolved.relPosix, query, maxMatches, state);
    else if (rootStat.isDirectory()) walk(resolved.targetReal);

    const truncated = state.truncatedByMatches || state.truncatedByLineBytes || state.truncatedByFiles;
    const formatted = state.matches.map((m) => `${m.path}:${m.line}: ${m.preview}`);
    const footer = truncated
      ? `\n(truncated: true; matches=${state.truncatedByMatches}, lineBytes=${state.truncatedByLineBytes}, files=${state.truncatedByFiles})`
      : "";
    return {
      ok: true, query, matches: state.matches, truncated, skipped: state.skipped,
      truncatedByMatches: state.truncatedByMatches, truncatedByLineBytes: state.truncatedByLineBytes,
      truncatedByFiles: state.truncatedByFiles,
      text: (formatted.length ? formatted.join("\n") : "(no matches)") + footer,
    };
  };

  const readFile = ({ path: filePath, offset = 1, limit = 100 } = {}) => {
    if (!Number.isInteger(offset) || offset < 1 || !Number.isInteger(limit) || limit < 1) {
      return { ok: false, error: "Error: offset and limit must be integers >= 1." };
    }
    const loaded = loadTextFile(cwd, filePath, "read");
    if (!loaded.ok) return loaded;

    const revision = computeRevision(loaded.buf);
    const { lines, eol, hasTrailingNewline } = splitLinesWithMeta(loaded.text);
    const totalLines = lines.length;
    if ((totalLines > 0 && offset > totalLines) || (totalLines === 0 && offset > 1)) {
      return { ok: false, error: `Error: offset ${offset} exceeds total lines (${totalLines}).` };
    }
    const startLine = totalLines === 0 ? 0 : offset;
    const endLine = totalLines === 0 ? 0 : Math.min(totalLines, offset + limit - 1);
    const slice = totalLines === 0 ? [] : lines.slice(startLine - 1, endLine);
    const prev = seenFiles.get(loaded.resolved.targetReal);
    const windows =
      totalLines === 0
        ? []
        : mergeIntervals(
            prev && prev.revision === revision ? [...prev.windows, [startLine, endLine]] : [[startLine, endLine]],
          );
    seenFiles.set(loaded.resolved.targetReal, { revision, windows });

    const pad = String(Math.max(endLine, 1)).length;
    const numbered = slice.map((t, i) => `${String(startLine + i).padStart(pad, " ")} | ${t}`);
    const hasMore = endLine < totalLines;
    const header = `File: ${loaded.resolved.relPosix} | revision=${revision} | lines=${startLine}-${endLine}/${totalLines}${hasMore ? " | hasMore=true" : ""}`;
    return {
      ok: true, path: loaded.resolved.relPosix, revision, startLine, endLine, totalLines, hasMore, eol, hasTrailingNewline,
      lines: slice.map((text, i) => ({ line: startLine + i, text })),
      text: numbered.length ? `${header}\n${numbered.join("\n")}` : `${header}\n(empty file)`,
    };
  };

  const replaceLines = ({ path: filePath, start_line: startLine, end_line: endLine, revision, expected_lines: expectedLines, replacement_lines: replacementLines } = {}) => {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      return { ok: false, error: `Error: invalid line range ${startLine}-${endLine}.` };
    }
    if (typeof revision !== "string" || !revision.trim()) return { ok: false, error: "Error: revision is required." };
    const inputErr =
      validateLineArray("expected_lines", expectedLines) ||
      validateLineArray("replacement_lines", replacementLines) ||
      (expectedLines.length !== endLine - startLine + 1
        ? "Error: expected_lines length must match start_line..end_line."
        : null);
    if (inputErr) return { ok: false, error: inputErr };

    const loaded = loadTextFile(cwd, filePath, "edit");
    if (!loaded.ok) return loaded;
    const currentRev = computeRevision(loaded.buf);
    const seen = seenFiles.get(loaded.resolved.targetReal);
    if (!seen) return { ok: false, error: `Error: call read_file on ${filePath} before replace_lines.` };
    if (revision !== currentRev || seen.revision !== currentRev) {
      return { ok: false, error: `Error: stale revision for ${filePath} (disk=${currentRev}, given=${revision}).` };
    }
    const { lines, eol, hasTrailingNewline } = splitLinesWithMeta(loaded.text);
    if (endLine > lines.length) {
      return { ok: false, error: `Error: line range ${startLine}-${endLine} exceeds file length (${lines.length}).` };
    }
    if (!seen.windows.some(([s, e]) => s <= startLine && endLine <= e)) {
      return { ok: false, error: `Error: lines ${startLine}-${endLine} are outside read windows for ${filePath}.` };
    }
    for (let i = 0; i < expectedLines.length; i += 1) {
      if (lines[startLine - 1 + i] !== expectedLines[i]) {
        return { ok: false, error: `Error: expected_lines mismatch at line ${startLine + i} of ${filePath}.` };
      }
    }

    lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
    const nextBuf = Buffer.from(serializeLinesWithMeta(lines, eol, hasTrailingNewline), "utf8");
    writeFileSync(loaded.resolved.targetReal, nextBuf);

    const nextRev = computeRevision(nextBuf);
    const delta = replacementLines.length - (endLine - startLine + 1);
    const shifted = seen.windows
      .map(([s, e]) => [s > endLine ? s + delta : s, e >= startLine ? e + delta : e])
      .filter(([s, e]) => s >= 1 && e >= s && s <= lines.length)
      .map(([s, e]) => [s, Math.min(e, lines.length)]);
    seenFiles.set(loaded.resolved.targetReal, { revision: nextRev, windows: mergeIntervals(shifted) });

    const text = `Replaced ${loaded.resolved.relPosix} lines ${startLine}-${endLine} (${replacementLines.length} lines, revision=${nextRev})`;
    return { ok: true, path: loaded.resolved.relPosix, revision: nextRev, totalLines: lines.length, eol, hasTrailingNewline, text };
  };

  return { searchCode, readFile, replaceLines };
}

export async function agentLoop(messages, { editor = createCodeEditor() } = {}) {
  const handlers = {
    search_code: (args) => editor.searchCode(args),
    read_file: (args) => editor.readFile(args),
    replace_lines: (args) => editor.replaceLines(args),
  };
  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools });
    if (!message.tool_calls?.length) return message.content || "";
    messages.push(message);
    for (const call of message.tool_calls) {
      const parsed = safeParseArgs(call.function.arguments);
      const handler = parsed.ok ? handlers[call.function.name] : null;
      const res = !parsed.ok
        ? { ok: false, error: parsed.error }
        : handler
          ? handler(parsed.value)
          : { ok: false, error: `Unknown tool: ${call.function.name}` };
      const output = res.ok ? res.text : res.error;
      colorLog("cyan", `> ${call.function.name}: ${String(output).slice(0, 140)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const editor = createCodeEditor();
  const messages = [];
  console.log("p06 Code Search & Line-Anchored Edits 演示：大文件精准检索、分页读取与行锚定替换，输入 q 退出。\n");
  try {
    while (true) {
      let input;
      try {
        input = (await rl.question("p06 >> ")).trim();
      } catch {
        break;
      }
      if (!input) continue;
      if (input === "q" || input === "exit") break;
      messages.push({ role: "user", content: input });
      const answer = await agentLoop(messages, { editor });
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
