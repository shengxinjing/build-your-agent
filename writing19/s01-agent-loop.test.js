import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { runBash } from "./helper.js";
import { agentLoop } from "./s01-agent-loop.js";

// 模型先让跑一条 bash，拿到结果后再给最终答案 —— 验证整个循环闭环。
test("s01-agent-loop agentLoop 执行工具后给出最终答案", async () => {
  await withFakeLlm(
    [
      {
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "echo regression-ok" }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
      { message: { role: "assistant", content: "all done" }, finish_reason: "stop" },
    ],
    async () => {
      const out = await agentLoop([{ role: "user", content: "run echo" }]);
      expect(out).toBe("all done");
    },
  );
});

// 模型直接回答、不调工具 —— 循环应立即返回。
test("s01-agent-loop agentLoop 无工具调用时直接返回", async () => {
  await withFakeLlm(
    [{ message: { role: "assistant", content: "just text" }, finish_reason: "stop" }],
    async () => {
      const out = await agentLoop([{ role: "user", content: "say hi" }]);
      expect(out).toBe("just text");
    },
  );
});

test("runBash 执行命令并返回输出", () => {
  expect(runBash("echo hi")).toBe("hi");
});

test("runBash 拦截危险命令", () => {
  expect(runBash("sudo rm -rf /")).toMatch(/blocked/);
});
