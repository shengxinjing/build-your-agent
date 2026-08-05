import { test, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  RecoveryState,
  withRetry,
  retryDelay,
  setSleepFn,
  setMemoryDir,
} from "./s11-error-recovery.js";

setSleepFn(() => Promise.resolve()); // 测试里不真的等待退避

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}
const final = (content) => ({ message: { role: "assistant", content }, finish_reason: "stop" });
const truncated = (content) => ({ message: { role: "assistant", content }, finish_reason: "length" });

function withMemoryDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "mem-"));
  setMemoryDir(dir);
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      setMemoryDir(path.join(process.cwd(), ".memory"));
      rmSync(dir, { recursive: true, force: true });
    });
}

afterAll(() => {
  for (const dir of [".transcripts", ".task_outputs"]) {
    rmSync(path.join(process.cwd(), dir), { recursive: true, force: true });
  }
});

// 退避公式：指数增长、有上限、Retry-After 优先。
test("retryDelay 指数增长、有上限、Retry-After 优先", () => {
  expect(retryDelay(0)).toBeGreaterThanOrEqual(500);
  expect(retryDelay(0)).toBeLessThan(500 * 1.25 + 1);
  expect(retryDelay(20)).toBeLessThanOrEqual(32000 * 1.25); // 封顶 32s + 抖动
  expect(retryDelay(2, 9999)).toBe(9999); // 服务器给的 Retry-After 优先
});

// 路径③：429 退避后重试成功。
test("withRetry 429 退避后重试成功", async () => {
  const state = new RecoveryState();
  let calls = 0;
  const result = await withRetry(() => {
    calls += 1;
    if (calls < 3) throw new Error("HTTP 429: rate limited");
    return "ok";
  }, state);
  expect(result).toBe("ok");
  expect(calls).toBe(3);
});

// 路径③：连续 3 次 529 → 切换备用模型。
test("withRetry 连续 529 切换备用模型", async () => {
  process.env.FALLBACK_MODEL_ID = "backup-model";
  try {
    const state = new RecoveryState();
    let calls = 0;
    const result = await withRetry(() => {
      calls += 1;
      if (calls <= 3) throw new Error("HTTP 529: overloaded");
      return "ok";
    }, state);
    expect(result).toBe("ok");
    expect(state.currentModel).toBe("backup-model");
  } finally {
    delete process.env.FALLBACK_MODEL_ID;
  }
});

// 非瞬态错误立即上抛，不重试。
test("withRetry 非瞬态错误立即上抛", async () => {
  const state = new RecoveryState();
  let calls = 0;
  await expect(
    withRetry(() => {
      calls += 1;
      throw new Error("HTTP 400: bad request");
    }, state),
  ).rejects.toThrow("bad request");
  expect(calls).toBe(1);
});

// 路径①：输出截断 → 升级 max_tokens 重试同一请求。
test("s11-error-recovery 输出截断 → 升级 max_tokens 8K→64K", () =>
  withMemoryDir(() => {
    const messages = [{ role: "user", content: "write a long thing" }];
    return withFakeLlm(
      [truncated("partial..."), final("complete output"), final("[]")],
      async (requests) => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("complete output");
        expect(requests[0].max_tokens).toBe(8000);
        expect(requests[1].max_tokens).toBe(64000);
      },
    );
  }));

// 路径①：升级后仍截断 → 注入续写提示。
test("s11-error-recovery 升级后仍截断 → 注入续写提示", () =>
  withMemoryDir(() => {
    const messages = [{ role: "user", content: "write" }];
    return withFakeLlm(
      [truncated("a"), truncated("b"), final("finally done"), final("[]")],
      async () => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("finally done");
        expect(messages.some((m) => m.role === "user" && String(m.content).includes("Resume directly"))).toBe(
          true,
        );
      },
    );
  }));

// 路径②：上下文超限（API 报错）→ 应急压缩后重试。
test("s11-error-recovery 上下文超限 → 应急压缩后重试", () =>
  withMemoryDir(() => {
    const messages = [{ role: "user", content: "huge prompt" }];
    return withFakeLlm(
      [
        { __error: { status: 400, message: "prompt is too long" } },
        final("REACTIVE SUMMARY"), // reactiveCompact 的摘要调用
        final("recovered"),
        final("[]"),
      ],
      async () => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("recovered");
        expect(messages.some((m) => String(m.content).includes("[Reactive compact]"))).toBe(true);
      },
    );
  }));

// 路径③接入循环：429 在主循环里被 withRetry 退避重试。
test("s11-error-recovery 主循环里 429 被退避重试", () =>
  withMemoryDir(() => {
    const messages = [{ role: "user", content: "hi" }];
    return withFakeLlm(
      [{ __error: { status: 429, message: "rate limited" } }, final("ok"), final("[]")],
      async () => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("ok");
      },
    );
  }));

// 回归：普通工具调用仍正常分发。
test("s11-error-recovery 普通工具仍正常分发", () =>
  withMemoryDir(() => {
    const messages = [{ role: "user", content: "list files" }];
    return withFakeLlm(
      [toolReply("b1", "bash", { command: "echo hi-s11" }), final("done"), final("[]")],
      async () => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("done");
        expect(messages.find((m) => m.role === "tool").content).toContain("hi-s11");
      },
    );
  }));
