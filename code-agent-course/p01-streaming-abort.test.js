import { test, expect } from "vitest";
import { unlinkSync } from "node:fs";
import { withFakeLlm } from "./fake-llm.js";
import { readFile } from "./helper.js";
import { agentLoop, repairOrphanToolCalls, streamLlm } from "./p01-streaming-abort.js";

test("p01 streamLlm 逐片消费 SSE 并分离 reasoning 与正文", async () => {
  const tokens = [];
  const reasons = [];

  await withFakeLlm(
    [
      {
        __sse: [
          ": keepalive comment\n\n",
          { choices: [{ delta: { reasoning_content: "先查一下" } }] },
          // 刻意把一条 SSE 事件拆成两段写入，验证跨 chunk 缓冲拼接
          'data: {"choices":[{"delta":{"content":"你',
          '好，世界"}}]}\n\n',
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
    ],
    async (requests) => {
      const choice = await streamLlm([{ role: "user", content: "hi" }], {
        onToken: (t) => tokens.push(t),
        onReasoning: (r) => reasons.push(r),
      });
      expect(requests[0].stream).toBe(true);
      expect(reasons).toEqual(["先查一下"]);
      expect(tokens).toEqual(["你好，世界"]);
      expect(choice.message.content).toBe("你好，世界");
      expect(choice.message.reasoning_content).toBe("先查一下");
    },
  );
});

test("p01 agentLoop 增量拼接分片 tool_calls 参数（兼容代理重复 id）并完成工具闭环", async () => {
  const tmp = "tmp-p01-stream.txt";
  try {
    await withFakeLlm(
      [
        {
          __sse: [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"' } },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      // 某些兼容代理会在后续 chunk 重复附带相同 id
                      { index: 0, id: "call_1", function: { arguments: `${tmp}","content":"stream ok"}` } },
                    ],
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            "data: [DONE]\n\n",
          ],
        },
        {
          __sse: [
            { choices: [{ delta: { content: "写入" } }] },
            { choices: [{ delta: { content: "完成" }, finish_reason: "stop" }] },
            "data: [DONE]\n\n",
          ],
        },
      ],
      async () => {
        const tokens = [];
        const messages = [{ role: "user", content: "write file" }];
        const res = await agentLoop(messages, { onToken: (t) => tokens.push(t) });
        expect(res).toEqual({ content: "写入完成", aborted: false });
        expect(tokens).toEqual(["写入", "完成"]);
        expect(readFile(tmp)).toBe("stream ok");
      },
    );
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
});

test("p01 流式正文传输途中触发 Abort：立即中止并保持对话轮次交替合法", async () => {
  const controller = new AbortController();
  const messages = [{ role: "user", content: "长篇大论讲一下" }];

  await withFakeLlm(
    [
      {
        __delayMs: 25,
        __sse: [
          { choices: [{ delta: { content: "第一段" } }] },
          { choices: [{ delta: { content: "第二段" } }] },
          { choices: [{ delta: { content: "第三段" }, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
      {
        __sse: [
          { choices: [{ delta: { content: "好的，一句话总结" }, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
    ],
    async (requests) => {
      const received = [];
      const first = await agentLoop(messages, {
        signal: controller.signal,
        onToken: (t) => {
          received.push(t);
          if (received.length === 1) controller.abort();
        },
      });
      expect(first.aborted).toBe(true);
      expect(first.content).toBe("第一段");
      expect(messages[messages.length - 1]).toEqual({
        role: "assistant",
        content: "第一段\n[Aborted by user]",
      });

      messages.push({ role: "user", content: "一句话总结" });
      const second = await agentLoop(messages);
      expect(second).toEqual({ content: "好的，一句话总结", aborted: false });
      expect(requests[1].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    },
  );
});

test("p01 中途 Abort 后自动补齐孤立 tool_call_id，下一轮仍可继续对话", async () => {
  const controller = new AbortController();
  const messages = [{ role: "user", content: "run two tools" }];

  await withFakeLlm(
    [
      {
        __sse: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"echo one"}' } },
                    { index: 1, id: "c2", type: "function", function: { name: "bash", arguments: '{"command":"echo two"}' } },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          "data: [DONE]\n\n",
        ],
      },
      {
        __sse: [
          { choices: [{ delta: { content: "已按新要求继续" }, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
    ],
    async (requests) => {
      const first = await agentLoop(messages, {
        signal: controller.signal,
        onTool: (name, args) => {
          if (args.command === "echo one") controller.abort();
        },
      });
      expect(first.aborted).toBe(true);

      const toolReplies = messages.filter((m) => m.role === "tool");
      expect(toolReplies.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
      expect(toolReplies[1].content).toContain("Aborted");

      messages.push({ role: "user", content: "换个方向吧" });
      const second = await agentLoop(messages);
      expect(second).toEqual({ content: "已按新要求继续", aborted: false });
      expect(requests[1].messages.some((m) => m.tool_call_id === "c2")).toBe(true);
    },
  );
});

test("p01 畸形工具 JSON 参数不会炸掉循环，而是以 tool 错误反馈让模型自愈", async () => {
  const messages = [{ role: "user", content: "run bash" }];

  await withFakeLlm(
    [
      {
        __sse: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "bad_1", type: "function", function: { name: "bash", arguments: '{"command": broken}' } },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          "data: [DONE]\n\n",
        ],
      },
      {
        __sse: [
          { choices: [{ delta: { content: "参数有误，已修正" }, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
    ],
    async (requests) => {
      const res = await agentLoop(messages);
      expect(res).toEqual({ content: "参数有误，已修正", aborted: false });
      const toolMsg = requests[1].messages.find((m) => m.tool_call_id === "bad_1");
      expect(toolMsg.content).toContain("invalid JSON arguments");
    },
  );
});

test("p01 工具执行间隙注入 steering 纠偏消息", async () => {
  const steeringQueue = ["不要只读，直接总结关键结论"];
  const messages = [{ role: "user", content: "check" }];

  await withFakeLlm(
    [
      {
        __sse: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "s1", type: "function", function: { name: "bash", arguments: '{"command":"echo ok"}' } },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          "data: [DONE]\n\n",
        ],
      },
      {
        __sse: [
          { choices: [{ delta: { content: "收到纠偏，总结如下" }, finish_reason: "stop" }] },
          "data: [DONE]\n\n",
        ],
      },
    ],
    async (requests) => {
      const res = await agentLoop(messages, {
        getSteering: () => steeringQueue.shift() || null,
      });
      expect(res.content).toBe("收到纠偏，总结如下");
      const sent = requests[1].messages;
      expect(sent[sent.length - 1]).toEqual({
        role: "user",
        content: "[Steering] 不要只读，直接总结关键结论",
      });
    },
  );
});

test("p01 repairOrphanToolCalls 单独修复残缺历史", () => {
  const history = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "a", type: "function", function: { name: "bash", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "bash", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "a", content: "ok" },
  ];
  expect(repairOrphanToolCalls(history)).toBe(1);
  expect(history[3]).toEqual({
    role: "tool",
    tool_call_id: "b",
    content: "[Aborted before tool execution]",
  });
});
