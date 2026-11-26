import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  DEFAULT_EVAL_CASES,
  formatScorecard,
  runEvalSuite,
  runInstrumentedAgent,
} from "./p05-mini-eval.js";

function toolReply(id, name, args, usage) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
    __usage: usage,
  };
}

test("p05 runEvalSuite 在隔离沙箱中客观打分（覆盖 3 道内置题）并统计 Prompt Cache 与成本", async () => {
  await withFakeLlm(
    [
      // 任务 1: fix-sum-bug 成功修复
      toolReply(
        "c1",
        "edit_file",
        { path: "math.mjs", old_text: "i < nums.length - 1", new_text: "i < nums.length" },
        { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } },
      ),
      {
        message: { role: "assistant", content: "fixed" },
        finish_reason: "stop",
        __usage: {
          prompt_tokens: 1000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 800 },
        },
      },
      // 任务 2: add-slugify 正确实现
      toolReply(
        "c2",
        "write_file",
        {
          path: "utils.mjs",
          content:
            'export function slugify(text) { return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }\n',
        },
        { prompt_tokens: 1000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 600 } },
      ),
      {
        message: { role: "assistant", content: "implemented" },
        finish_reason: "stop",
        __usage: {
          prompt_tokens: 1000,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 900 },
        },
      },
      // 任务 3: fix-json-config 故意改错，验证 Verifier 客观判 FAIL（不轻信模型自称完成）
      toolReply(
        "c3",
        "write_file",
        { path: "config.json", content: '{"host":"127.0.0.1","port":3000}' },
        { prompt_tokens: 500, completion_tokens: 50, prompt_cache_hit_tokens: 200 },
      ),
      {
        message: { role: "assistant", content: "全部搞定啦！" },
        finish_reason: "stop",
        __usage: { prompt_tokens: 500, completion_tokens: 50, prompt_cache_hit_tokens: 500 },
      },
    ],
    async () => {
      const report = await runEvalSuite(DEFAULT_EVAL_CASES);

      expect(report.total).toBe(3);
      expect(report.passed).toBe(2);
      expect(report.results.map((r) => r.passed)).toEqual([true, true, false]);
      // 5000 prompt tokens 中有 3000 命中缓存 -> 60%
      expect(report.usage).toEqual({
        promptTokens: 5000,
        cachedTokens: 3000,
        completionTokens: 350,
      });
      expect(report.cacheHitRate).toBe(0.6);
      expect(report.totalUsd).toBeGreaterThan(0);

      const text = formatScorecard(report);
      expect(text).toContain("2/3 passed (67%)");
      expect(text).toContain("cacheHit=60%");
    },
  );
});

test("p05 Doom-Loop 熔断忽略参数键顺序差异，并验证 max_steps 步数上限与单题异常隔离", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p05-doom-"));
  try {
    // JSON 字段顺序不同（a,b vs b,a）仍应被规范化为同一签名并触发 doom_loop
    await withFakeLlm(
      [
        toolReply("d1", "edit_file", { path: "a.js", old_text: "x", new_text: "y" }, { prompt_tokens: 200, completion_tokens: 20 }),
        toolReply("d2", "edit_file", { new_text: "y", path: "a.js", old_text: "x" }, { prompt_tokens: 250, completion_tokens: 20 }),
        toolReply("d3", "edit_file", { old_text: "x", new_text: "y", path: "a.js" }, { prompt_tokens: 300, completion_tokens: 20 }),
      ],
      async (requests) => {
        const res = await runInstrumentedAgent("edit missing file", {
          cwd: dir,
          maxSteps: 10,
          doomLoopThreshold: 3,
        });
        expect(res.stopReason).toBe("doom_loop");
        expect(res.steps).toBe(3);
        expect(requests).toHaveLength(3);
      },
    );

    // 每次参数不同但超过 maxSteps 时以 max_steps 终止
    await withFakeLlm(
      [
        toolReply("m1", "read_file", { path: "f1.js" }, { prompt_tokens: 100, completion_tokens: 10 }),
        toolReply("m2", "read_file", { path: "f2.js" }, { prompt_tokens: 120, completion_tokens: 10 }),
      ],
      async () => {
        const res = await runInstrumentedAgent("loop", { cwd: dir, maxSteps: 2 });
        expect(res.stopReason).toBe("max_steps");
        expect(res.steps).toBe(2);
      },
    );

    // 单题遇到 HTTP 500 时记录为 error 而不拖垮整套评测输出
    await withFakeLlm(
      [
        { __error: { status: 500, message: "upstream boom" } },
        toolReply("ok1", "write_file", { path: "config.json", content: '{"host":"127.0.0.1","port":8080}' }, { prompt_tokens: 100, completion_tokens: 20 }),
        { message: { role: "assistant", content: "done" }, finish_reason: "stop", __usage: { prompt_tokens: 100, completion_tokens: 10 } },
      ],
      async () => {
        const report = await runEvalSuite([DEFAULT_EVAL_CASES[0], DEFAULT_EVAL_CASES[2]]);
        expect(report.results[0].stopReason).toBe("error");
        expect(report.results[0].passed).toBe(false);
        expect(report.results[1].passed).toBe(true);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
