import { test, expect } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import { compactSession, createSessionStore, runSessionTurn } from "./p03-session-persistence.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "p03-lab-"));
}

test("p03 逐事件落盘 JSONL，新 store 实例可断点续跑并带完整历史", async () => {
  const dir = makeTempDir();
  try {
    const store1 = createSessionStore(dir);
    const { id } = store1.createSession({ id: "sess_demo" });

    await withFakeLlm(
      [
        toolReply("t1", "bash", { command: "echo hi-session" }),
        { message: { role: "assistant", content: "第一轮完成" }, finish_reason: "stop" },
        { message: { role: "assistant", content: "已衔接上一轮" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const r1 = await runSessionTurn(store1, id, "先跑个命令");
        expect(r1.content).toBe("第一轮完成");

        const store2 = createSessionStore(dir);
        const r2 = await runSessionTurn(store2, id, "继续总结");
        expect(r2.content).toBe("已衔接上一轮");

        const sent = requests[2].messages;
        expect(sent.map((m) => m.role)).toEqual([
          "system",
          "user",
          "assistant",
          "tool",
          "assistant",
          "user",
        ]);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p03 断电坏行容错、工具中途崩溃自愈与非法 sessionId 路径穿越拦截", () => {
  const dir = makeTempDir();
  try {
    const store = createSessionStore(dir);
    expect(() => store.readEvents("../escape")).toThrow(/Invalid session id/);

    const { id } = store.createSession({ id: "sess_crash" });
    store.appendMessage(id, { role: "user", content: "run check" });
    store.appendMessage(id, {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "lost_1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }],
    });
    // 模拟断电时半截 JSON 写入，且 lost_1 对应的 tool 结果尚未落盘
    appendFileSync(path.join(dir, `${id}.jsonl`), '{"type":"message","seq":3,"message":{"role":"to');

    const loaded = store.readEvents(id);
    expect(loaded.corruptedLines).toBe(1);
    expect(loaded.events).toHaveLength(2);

    const view = store.loadModelMessages(id);
    expect(view.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(view[2]).toEqual({
      role: "tool",
      tool_call_id: "lost_1",
      content: "[Recovered: tool did not finish before crash]",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p03 forkSession 从历史节点分叉试错且不污染原会话", () => {
  const dir = makeTempDir();
  try {
    const store = createSessionStore(dir);
    const { id: mainId } = store.createSession({ id: "sess_main" });
    store.appendMessage(mainId, { role: "user", content: "方案背景" });
    store.appendMessage(mainId, { role: "assistant", content: "收到背景" });
    store.appendMessage(mainId, { role: "user", content: "试方案 A" });
    store.appendMessage(mainId, { role: "assistant", content: "方案 A 失败" });

    const forked = store.forkSession(mainId, { upToSeq: 2, id: "sess_branch_b" });
    store.appendMessage(forked.id, { role: "user", content: "改试方案 B" });

    expect(forked.parentId).toBe("sess_main");
    expect(forked.forkedFromSeq).toBe(2);
    expect(store.loadModelMessages(mainId)).toHaveLength(4);
    expect(store.loadModelMessages(forked.id).map((m) => m.content)).toEqual([
      "方案背景",
      "收到背景",
      "改试方案 B",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p03 compactSession 对齐工具调用边界且支持增量多次压缩，磁盘保留完整原文", async () => {
  const dir = makeTempDir();
  try {
    const store = createSessionStore(dir);
    const { id } = store.createSession({ id: "sess_compact" });
    store.appendMessage(id, { role: "user", content: "step 1" });
    store.appendMessage(id, { role: "assistant", content: "done 1" });
    store.appendMessage(id, {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "tc_1", type: "function", function: { name: "bash", arguments: "{}" } }],
    });
    store.appendMessage(id, { role: "tool", tool_call_id: "tc_1", content: "ok" });
    store.appendMessage(id, { role: "assistant", content: "done 2" });

    await withFakeLlm(
      [
        { message: { role: "assistant", content: "- 摘要 1：完成 step 1" }, finish_reason: "stop" },
        { message: { role: "assistant", content: "- 摘要 2：合并 step 1 与 step 2" }, finish_reason: "stop" },
      ],
      async (requests) => {
        // keepTail=2 原本会落在 seq=4 (role: tool)，必须自动回退到 seq=3 (assistant tool_calls) 避免孤立 tool
        const ev1 = await compactSession(store, id, { keepTail: 2 });
        expect(ev1.keepFromSeq).toBe(3);
        const view1 = store.loadModelMessages(id);
        expect(view1.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);

        // 继续追加新消息并做第 2 次压缩：应基于「摘要 1 + 增量消息」，不再重读 seq=1 的原文
        store.appendMessage(id, { role: "user", content: "step 3" });
        store.appendMessage(id, { role: "assistant", content: "done 3" });
        const ev2 = await compactSession(store, id, { keepTail: 2 });
        expect(ev2.keepFromSeq).toBe(7);

        const secondSummaryInput = requests[1].messages[1].content;
        expect(secondSummaryInput).toContain("[Previous Summary]");
        expect(secondSummaryInput).not.toContain('"step 1"');

        // 原始磁盘日志包含全部 7 条消息 + 2 条压缩事件，未丢失任何历史
        expect(store.readEvents(id).events).toHaveLength(9);
        const view2 = store.loadModelMessages(id);
        expect(view2).toHaveLength(3);
        expect(view2[0].content).toContain("摘要 2");
        expect(view2[1].content).toBe("step 3");
        expect(view2[2].content).toBe("done 3");
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
