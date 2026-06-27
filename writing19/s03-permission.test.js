import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, checkPermission } from "./s03-permission.js";

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

// 纯函数：三档判定。
test("checkPermission 三档判定", () => {
  expect(checkPermission("bash", { command: "rm -rf /" }).decision).toBe("deny");
  expect(checkPermission("bash", { command: "rm notes.txt" }).decision).toBe("ask");
  expect(checkPermission("read_file", { path: "a.txt" }).decision).toBe("allow");
});

// 硬黑名单：循环里直接拒，不执行（confirm 不会被调用）。
test("s03-permission 硬黑名单命令被直接拒绝", async () => {
  const messages = [{ role: "user", content: "删库" }];
  await withFakeLlm(
    [toolReply("c1", "bash", { command: "rm -rf /" }), final("我停下了")],
    () => agentLoop(messages, async () => "y"),
  );
  const toolMsg = messages.find((m) => m.role === "tool");
  expect(toolMsg.content).toMatch(/denied/i);
});

// 风险操作 + 用户拒绝。
test("s03-permission 风险操作被用户拒绝", async () => {
  const messages = [{ role: "user", content: "删文件" }];
  await withFakeLlm(
    [toolReply("c1", "bash", { command: "rm notes.txt" }), final("好的")],
    () => agentLoop(messages, async () => "n"),
  );
  const toolMsg = messages.find((m) => m.role === "tool");
  expect(toolMsg.content).toMatch(/denied by user/i);
});

// 风险操作 + 用户同意 → 真正执行（不再是 denied）。
test("s03-permission 风险操作经用户同意后执行", async () => {
  const messages = [{ role: "user", content: "看 rm 帮助" }];
  await withFakeLlm(
    [toolReply("c1", "bash", { command: "rm --help" }), final("好的")],
    () => agentLoop(messages, async () => "y"),
  );
  const toolMsg = messages.find((m) => m.role === "tool");
  expect(toolMsg.content).not.toMatch(/Permission denied/i);
});
