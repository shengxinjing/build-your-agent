import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, getTodos } from "./s05-todo-write.js";

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

// 模型调用 todo_write → 计划被存成可见状态。
test("s05-todo-write todo_write 把计划存成可见状态", async () => {
  const messages = [{ role: "user", content: "做个计划" }];
  await withFakeLlm(
    [
      toolReply("c1", "todo_write", {
        todos: [
          { content: "写文件", status: "in_progress" },
          { content: "测试", status: "pending" },
        ],
      }),
      final("计划好了"),
    ],
    () => agentLoop(messages, async () => "y"),
  );
  expect(getTodos()).toHaveLength(2);
  expect(getTodos()[0].content).toBe("写文件");
});

// 连续 3 轮工具调用都没更新计划 → 注入一条提醒。
test("s05-todo-write 连续 3 轮没更新计划会注入提醒", async () => {
  const messages = [{ role: "user", content: "干活" }];
  await withFakeLlm(
    [
      toolReply("c1", "bash", { command: "echo 1" }),
      toolReply("c2", "bash", { command: "echo 2" }),
      toolReply("c3", "bash", { command: "echo 3" }),
      final("完成"),
    ],
    () => agentLoop(messages, async () => "y"),
  );
  expect(messages.some((m) => String(m.content).includes("Update your todos"))).toBe(true);
});
