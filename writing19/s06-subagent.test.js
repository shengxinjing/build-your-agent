import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, spawnSubagent } from "./s06-subagent.js";

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

// 父调用 task 派生子代理：子代理用全新上下文跑，只把摘要回传；中间过程不进入父 messages。
test("s06-subagent task 派生子代理，只回传摘要（上下文隔离）", async () => {
  const messages = [{ role: "user", content: "去做个子任务" }];
  await withFakeLlm(
    [
      toolReply("p1", "task", { description: "find something" }), // 父：派活给子代理
      toolReply("s1", "bash", { command: "echo from-sub" }), // 子：自己跑 bash
      final("subtask done"), // 子：交回摘要
      final("all done"), // 父：收尾
    ],
    () => agentLoop(messages, async () => "y"),
  );
  // 父 messages 里 task 的结果就是子代理的摘要
  const taskResult = messages.find((m) => m.role === "tool");
  expect(taskResult.content).toContain("subtask done");
  // 子代理执行 bash 的中间细节没有泄露进父 messages（上下文隔离）
  expect(messages.some((m) => String(m.content).includes("from-sub"))).toBe(false);
});

// spawnSubagent 直接调用：跑完自己的子循环，返回最终文本。
test("s06-subagent spawnSubagent 返回最终摘要", async () => {
  await withFakeLlm(
    [
      toolReply("s1", "read_file", { path: "x.txt" }),
      final("here is the summary"),
    ],
    async () => {
      const summary = await spawnSubagent("read x.txt and summarize", async () => "y");
      expect(summary).toBe("here is the summary");
    },
  );
});
