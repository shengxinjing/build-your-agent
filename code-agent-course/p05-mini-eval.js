import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { llmProvider, llmProviderConfigs, tool, isMainModule } from "./helper.js";

const DEFAULT_SYSTEM = `You are a coding agent inside an isolated task workspace. Use tools to inspect files, make minimal edits, and verify your changes before replying.`;

const DEFAULT_PRICING = {
  inputPer1M: 1.0,
  cachedInputPer1M: 0.25,
  outputPer1M: 4.0,
};

const tools = [
  tool("read_file", "Read a file in the task workspace.", {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  }),
  tool("write_file", "Write a file in the task workspace.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  }),
  tool("edit_file", "Replace exact text once in a workspace file.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  }),
  tool("bash", "Run a shell command in the task workspace.", {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  }),
];

function resolveInside(cwd, relPath) {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return target;
}

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function createSandboxHandlers(cwd) {
  return {
    read_file: ({ path: filePath }) => {
      try {
        return readFileSync(resolveInside(cwd, filePath), "utf8");
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },
    write_file: ({ path: filePath, content }) => {
      try {
        const target = resolveInside(cwd, filePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
        return `Wrote ${content.length} bytes to ${filePath}`;
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },
    edit_file: ({ path: filePath, old_text, new_text }) => {
      try {
        const target = resolveInside(cwd, filePath);
        const text = readFileSync(target, "utf8");
        if (!old_text) return "Error: old_text must not be empty.";
        if (!text.includes(old_text)) return `Error: old_text not found in ${filePath}`;
        writeFileSync(target, text.replace(old_text, new_text));
        return `Edited ${filePath}`;
      } catch (error) {
        return `Error: ${error.message}`;
      }
    },
    bash: ({ command }) => {
      try {
        return (
          execSync(command, { cwd, encoding: "utf8", timeout: 15000 }).trim() || "(no output)"
        );
      } catch (error) {
        return `${error.stdout || ""}${error.stderr || error.message}`.trim();
      }
    },
  };
}

export async function callLlmWithUsage(
  messages,
  { system, tools: toolDefs, model, provider = llmProvider } = {},
) {
  const config = llmProviderConfigs[provider] || llmProviderConfigs.openai;
  if (!config.token) throw new Error("Missing API token.");

  const body = {
    model: model || config.model,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
  };
  if (toolDefs?.length) {
    body.tools = toolDefs;
    body.tool_choice = "auto";
  }

  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {}
  if (!response.ok) {
    const detail = data?.error ? JSON.stringify(data.error) : rawText.slice(0, 300);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  if (!data?.choices?.[0]) {
    throw new Error("Invalid LLM response: missing choices[0].");
  }

  const raw = data.usage || {};
  const promptTokens = raw.prompt_tokens || 0;
  const completionTokens = raw.completion_tokens || 0;
  const cachedTokens =
    raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0;

  return {
    choice: data.choices[0],
    usage: { promptTokens, cachedTokens, completionTokens },
    latencyMs: Date.now() - startedAt,
  };
}

export function estimateCostUsd(usage, pricing = DEFAULT_PRICING) {
  const uncachedPrompt = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const cost =
    (uncachedPrompt / 1_000_000) * pricing.inputPer1M +
    (usage.cachedTokens / 1_000_000) * pricing.cachedInputPer1M +
    (usage.completionTokens / 1_000_000) * pricing.outputPer1M;
  return Number(cost.toFixed(6));
}

function buildRunResult({ answer, stopReason, steps, toolCalls, totals, pricing, totalLatencyMs, trace }) {
  return {
    answer,
    stopReason,
    steps,
    toolCalls,
    usage: totals,
    cacheHitRate: totals.promptTokens ? Number((totals.cachedTokens / totals.promptTokens).toFixed(4)) : 0,
    estimatedUsd: estimateCostUsd(totals, pricing),
    latencyMs: totalLatencyMs,
    trace,
  };
}

export async function runInstrumentedAgent(
  prompt,
  {
    cwd = process.cwd(),
    system = DEFAULT_SYSTEM,
    maxSteps = 10,
    doomLoopThreshold = 3,
    pricing = DEFAULT_PRICING,
  } = {},
) {
  const handlers = createSandboxHandlers(cwd);
  const messages = [{ role: "user", content: prompt }];
  const totals = { promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  const trace = [];
  let totalLatencyMs = 0;
  let toolCalls = 0;
  let lastSig = "";
  let repeatCount = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    const { choice, usage, latencyMs } = await callLlmWithUsage(messages, { system, tools });
    totals.promptTokens += usage.promptTokens;
    totals.cachedTokens += usage.cachedTokens;
    totals.completionTokens += usage.completionTokens;
    totalLatencyMs += latencyMs;

    const { message } = choice;
    if (!message.tool_calls?.length) {
      trace.push({ step, latencyMs, usage, tools: [] });
      return buildRunResult({
        answer: message.content || "",
        stopReason: "completed",
        steps: step,
        toolCalls,
        totals,
        pricing,
        totalLatencyMs,
        trace,
      });
    }

    messages.push(message);
    const stepTools = [];
    for (const call of message.tool_calls) {
      const name = call.function.name;
      const parsed = safeParseArgs(call.function.arguments);
      const sig = parsed.ok ? `${name}:${canonicalJson(parsed.value)}` : `${name}:${call.function.arguments || ""}`;
      repeatCount = sig === lastSig ? repeatCount + 1 : 1;
      lastSig = sig;

      if (repeatCount >= doomLoopThreshold) {
        trace.push({ step, latencyMs, usage, tools: [...stepTools, `${name}(DOOM_LOOP)`] });
        return buildRunResult({
          answer: "",
          stopReason: "doom_loop",
          steps: step,
          toolCalls,
          totals,
          pricing,
          totalLatencyMs,
          trace,
        });
      }

      let output;
      if (!parsed.ok) {
        output = parsed.error;
      } else {
        const handler = handlers[name];
        output = handler ? handler(parsed.value) : `Unknown tool: ${name}`;
      }
      toolCalls += 1;
      stepTools.push(name);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
    trace.push({ step, latencyMs, usage, tools: stepTools });
  }

  return buildRunResult({
    answer: "",
    stopReason: "max_steps",
    steps: maxSteps,
    toolCalls,
    totals,
    pricing,
    totalLatencyMs,
    trace,
  });
}

export const DEFAULT_EVAL_CASES = [
  {
    id: "fix-sum-bug",
    name: "修复数组求和越界 Bug",
    files: {
      "math.mjs": "export function sum(nums) {\n  let total = 0;\n  for (let i = 0; i < nums.length - 1; i += 1) total += nums[i];\n  return total;\n}\n",
      "check.mjs": 'import assert from "node:assert/strict";\nimport { sum } from "./math.mjs";\nassert.equal(sum([1, 2, 3, 4]), 10);\nassert.equal(sum([5]), 5);\nconsole.log("PASS");\n',
    },
    prompt: "修复 math.mjs 里的 sum 函数，使 `node check.mjs` 运行通过。",
    verify: (cwd) => {
      try {
        const out = execFileSync(process.execPath, ["check.mjs"], {
          cwd,
          encoding: "utf8",
          timeout: 10000,
        }).trim();
        return { passed: out.includes("PASS"), detail: out };
      } catch (error) {
        return { passed: false, detail: (error.stderr || error.message).trim() };
      }
    },
  },
  {
    id: "add-slugify",
    name: "实现 slugify 工具函数",
    files: {
      "utils.mjs": "export function slugify(text) {\n  return text;\n}\n",
    },
    prompt: '实现 utils.mjs 的 slugify(text)：转小写、去除首尾空白、把连续非字母数字字符替换为单个 "-" 并去掉首尾 "-"。',
    verify: (cwd) => {
      const code =
        'import assert from "node:assert/strict"; import { slugify } from "./utils.mjs"; assert.equal(slugify("  Hello, World!  "), "hello-world"); assert.equal(slugify("Build___Your Agent 2026"), "build-your-agent-2026"); console.log("PASS");';
      try {
        const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
          cwd,
          encoding: "utf8",
          timeout: 10000,
        }).trim();
        return { passed: out.includes("PASS"), detail: out };
      } catch (error) {
        return { passed: false, detail: (error.stderr || error.message).trim() };
      }
    },
  },
  {
    id: "fix-json-config",
    name: "修复损坏 JSON 并改端口",
    files: {
      "config.json": '{\n  "host": "127.0.0.1",\n  "port": 3000,\n}\n',
    },
    prompt: "修复 config.json 的语法错误，并把 port 改为 8080。",
    verify: (cwd) => {
      try {
        const cfg = JSON.parse(readFileSync(path.join(cwd, "config.json"), "utf8"));
        const ok = cfg.host === "127.0.0.1" && cfg.port === 8080;
        return { passed: ok, detail: JSON.stringify(cfg) };
      } catch (error) {
        return { passed: false, detail: error.message };
      }
    },
  },
];

export async function runEvalSuite(cases = DEFAULT_EVAL_CASES, options = {}) {
  const results = [];
  for (const item of cases) {
    const cwd = mkdtempSync(path.join(os.tmpdir(), `p05-${item.id}-`));
    try {
      for (const [relPath, content] of Object.entries(item.files || {})) {
        const target = resolveInside(cwd, relPath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
      let run;
      let check;
      try {
        run = await runInstrumentedAgent(item.prompt, { ...options, cwd });
        check = item.verify(cwd);
      } catch (error) {
        if (/Missing API token/.test(error.message)) throw error;
        run = buildRunResult({
          answer: "",
          stopReason: "error",
          steps: 0,
          toolCalls: 0,
          totals: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
          pricing: options.pricing || DEFAULT_PRICING,
          totalLatencyMs: 0,
          trace: [],
        });
        check = { passed: false, detail: error.message };
      }
      results.push({ id: item.id, name: item.name, ...check, ...run });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const promptTokens = results.reduce((s, r) => s + r.usage.promptTokens, 0);
  const cachedTokens = results.reduce((s, r) => s + r.usage.cachedTokens, 0);
  const completionTokens = results.reduce((s, r) => s + r.usage.completionTokens, 0);
  const totalUsd = Number(results.reduce((s, r) => s + r.estimatedUsd, 0).toFixed(6));

  return {
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    avgSteps: results.length ? Number((results.reduce((s, r) => s + r.steps, 0) / results.length).toFixed(2)) : 0,
    usage: { promptTokens, cachedTokens, completionTokens },
    cacheHitRate: promptTokens ? Number((cachedTokens / promptTokens).toFixed(4)) : 0,
    totalUsd,
    results,
  };
}

export function formatScorecard(report) {
  const lines = [
    `Eval Scorecard: ${report.passed}/${report.total} passed (${Math.round(report.passRate * 100)}%) | avgSteps=${report.avgSteps} | cacheHit=${Math.round(report.cacheHitRate * 100)}% | estCost=$${report.totalUsd}`,
    "",
    ...report.results.map(
      (r) =>
        `  [${r.passed ? "PASS" : "FAIL"}] ${r.id.padEnd(16)} stop=${r.stopReason.padEnd(9)} steps=${r.steps} prompt=${r.usage.promptTokens} cached=${r.usage.cachedTokens} cost=$${r.estimatedUsd}`,
    ),
  ];
  return lines.join("\n");
}

async function main() {
  const asJson = process.argv.includes("--json");
  const caseIdx = process.argv.indexOf("--case");
  const targetId = caseIdx !== -1 ? process.argv[caseIdx + 1] : null;
  const cases = targetId ? DEFAULT_EVAL_CASES.filter((c) => c.id === targetId) : DEFAULT_EVAL_CASES;
  if (!cases.length) {
    throw new Error(`Unknown eval case: ${targetId}`);
  }
  const report = await runEvalSuite(cases);
  console.log(asJson ? JSON.stringify(report, null, 2) : formatScorecard(report));
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
