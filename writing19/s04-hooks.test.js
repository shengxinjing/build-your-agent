import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, permissionHook, registerHook } from "./s04-hooks.js";

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

// 权限判断现在是个 PreToolUse hook，但判定逻辑仍可单独测：返回字符串=拦截，null=放行。
test("permissionHook 三档", async () => {
  expect(await permissionHook("bash", { command: "rm -rf /" })).toMatch(/denied/i);
  expect(await permissionHook("bash", { command: "rm x" }, async () => "n")).toMatch(/denied by user/i);
  expect(await permissionHook("read_file", { path: "a.txt" })).toBe(null);
});

// PreToolUse hook（权限）能拦住危险工具，handler 不执行 → 回灌的是拒绝信息。
test("s04-hooks PreToolUse hook 拦住危险命令", async () => {
  const messages = [{ role: "user", content: "删库" }];
  await withFakeLlm(
    [toolReply("c1", "bash", { command: "rm -rf /" }), final("停")],
    () => agentLoop(messages, async () => "y"),
  );
  expect(messages.find((m) => m.role === "tool").content).toMatch(/denied/i);
});

// PostToolUse hook 会在工具执行之后触发（用一个临时探针 hook 记录）。
test("s04-hooks PostToolUse hook 在工具后触发", async () => {
  const seen = [];
  registerHook("PostToolUse", (name) => {
    seen.push(name);
    return null;
  });
  const messages = [{ role: "user", content: "echo" }];
  await withFakeLlm(
    [toolReply("c1", "bash", { command: "echo hi" }), final("好")],
    () => agentLoop(messages, async () => "y"),
  );
  expect(seen).toContain("bash");
});
