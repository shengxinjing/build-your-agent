import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import { ask } from "./s00-llm-http.js";
import { callLlm, llmProviderConfigs } from "./helper.js";

// s00-llm-http 应把模型回复的文本原样返回。
test("s00-llm-http ask 返回模型的回答", async () => {
  await withFakeLlm(
    [{ message: { role: "assistant", content: "hello world" }, finish_reason: "stop" }],
    async () => {
      const reply = await ask([{ role: "user", content: "hi" }]);
      expect(reply).toBe("hello world");
    },
  );
});

// 切换 provider 时，请求里的 model 应跟着切到对应 provider 的默认模型。
test("s00-llm-http callLlm 按 provider 切换模型", async () => {
  await withFakeLlm(
    [
      { message: { role: "assistant", content: "a" }, finish_reason: "stop" },
      { message: { role: "assistant", content: "b" }, finish_reason: "stop" },
    ],
    async (requests) => {
      await callLlm([{ role: "user", content: "hi" }], { provider: "openai" });
      await callLlm([{ role: "user", content: "hi" }], { provider: "kimi" });
      expect(requests[0].model).toBe(llmProviderConfigs.openai.model);
      expect(requests[1].model).toBe(llmProviderConfigs.kimi.model);
    },
  );
});
