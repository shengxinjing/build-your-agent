import { test, expect, afterAll } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  snipCompact,
  microCompact,
  toolResultBudget,
  compactHistory,
  reactiveCompact,
  estimateSize,
} from "./s08-context-compact.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [
        { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
      ],
    },
    finish_reason: "tool_calls",
  };
}
const final = (content) => ({ message: { role: "assistant", content }, finish_reason: "stop" });

async function captureLogs(fn) {
  const logs = [];
  const oldLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    return { value: await fn(), logs };
  } finally {
    console.log = oldLog;
  }
}

// 清理压缩管线写到磁盘的产物（transcript / 落盘的大结果）。
afterAll(() => {
  for (const dir of [".transcripts", ".task_outputs"]) {
    rmSync(path.join(process.cwd(), dir), { recursive: true, force: true });
  }
});

// L1：消息太多 → 裁中间，保留头 3 + 尾部。
test("snipCompact 裁掉中间，保留头尾", () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: "user", content: `m${i}` }));
  const out = snipCompact(messages); // maxMessages=50 → 头3 + 占位 + 尾47
  expect(out.length).toBe(51);
  expect(out[0].content).toBe("m0");
  expect(out[3].content).toContain("snipped");
  expect(out[out.length - 1].content).toBe("m59");
});

// L1：裁切点不能把孤立的 tool 结果留在尾部开头。
test("snipCompact 不让尾部以孤立工具结果开头", () => {
  const messages = Array.from({ length: 60 }, (_, i) =>
    i === 13 ? { role: "tool", tool_call_id: "t", content: "r" } : { role: "user", content: `m${i}` },
  );
  const out = snipCompact(messages);
  const firstTail = out[out.indexOf(out.find((m) => m.content?.includes("snipped"))) + 1];
  expect(firstTail.role).not.toBe("tool");
});

// L2：只保留最近 3 条工具结果全文，更旧的占位。
test("microCompact 旧工具结果占位、保留最近 3 条", () => {
  const messages = [];
  for (let i = 0; i < 5; i += 1) {
    messages.push({ role: "tool", tool_call_id: `t${i}`, content: "X".repeat(500) });
  }
  microCompact(messages);
  expect(messages[0].content).toContain("compacted"); // 旧的被占位
  expect(messages[1].content).toContain("compacted");
  expect(messages[4].content.length).toBe(500); // 最近的保留全文
});

// L3：最近一批工具结果超预算 → 大结果落盘，上下文里只留引用。
test("toolResultBudget 大结果落盘", () => {
  const messages = [{ role: "tool", tool_call_id: "big", content: "y".repeat(250000) }];
  toolResultBudget(messages);
  expect(messages[0].content).toContain("<persisted-output>");
  expect(messages[0].content).toContain("Preview:");
  expect(messages[0].content.length).toBeLessThan(5000);
});

// L4：前三层不够 → LLM 摘要，整段历史塌缩成一条 [Compacted]。
test("compactHistory 用一条摘要替换整段历史", async () => {
  const messages = [
    { role: "user", content: "build a parser" },
    { role: "assistant", content: "working on it" },
    { role: "user", content: "also add tests" },
  ];
  const out = await withFakeLlm([final("SUMMARY: parser + tests in progress")], () =>
    compactHistory(messages),
  );
  expect(out).toHaveLength(1);
  expect(out[0].content).toContain("[Compacted]");
  expect(out[0].content).toContain("SUMMARY: parser + tests");
});

// 应急：摘要旧历史，但保留尾部少量消息。
test("reactiveCompact 摘要旧历史并保留尾部", async () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `m${i}` }));
  const out = await withFakeLlm([final("REACTIVE SUMMARY")], () => reactiveCompact(messages));
  expect(out[0].content).toContain("[Reactive compact]");
  expect(out[0].content).toContain("REACTIVE SUMMARY");
  expect(out.length).toBeGreaterThan(1); // 尾部保留
  expect(out[out.length - 1].content).toBe("m9");
});

// 循环里：模型主动调用 compact → 触发 compactHistory，用压缩后的上下文继续。
test("compact 工具触发压缩后继续", async () => {
  const messages = [{ role: "user", content: "do work then compact" }];
  const { value: text, logs } = await captureLogs(() =>
    withFakeLlm(
      [
        toolReply("c1", "compact", { focus: "earlier work" }), // 模型请求压缩
        final("SUMMARY of earlier work"), // compactHistory 的摘要调用
        final("all done after compaction"), // 压缩后模型收尾
      ],
      () => agentLoop(messages, async () => "y"),
    ),
  );
  expect(text).toBe("all done after compaction");
  expect(logs).toContain("[manual compact] compactHistory");
  expect(messages.some((m) => String(m.content).includes("[Compacted]"))).toBe(true);
});

// 循环里：估算大小超阈值 → 调模型前自动压缩。
test("超过阈值在调用模型前自动压缩", async () => {
  const messages = [{ role: "user", content: "x".repeat(60000) }];
  const { value: text, logs } = await captureLogs(() =>
    withFakeLlm(
      [final("AUTO SUMMARY"), final("answer after auto compact")],
      () => agentLoop(messages, async () => "y"),
    ),
  );
  expect(logs).toContain("[auto compact] compactHistory");
  expect(estimateSize(messages)).toBeLessThan(12000); // 压缩后低于教程阈值
  expect(messages.some((m) => String(m.content).includes("[Compacted]"))).toBe(true);
  expect(text).toBe("answer after auto compact");
});

// 回归：普通工具仍正常分发（s08-context-compact 重构循环后不应破坏 s02–s07 的行为）。
test("s08-context-compact 普通工具仍正常分发", async () => {
  const messages = [{ role: "user", content: "list files" }];
  const text = await withFakeLlm(
    [toolReply("b1", "bash", { command: "echo hi-from-s08" }), final("done")],
    () => agentLoop(messages, async () => "y"),
  );
  expect(text).toBe("done");
  expect(messages.find((m) => m.role === "tool").content).toContain("hi-from-s08");
});
