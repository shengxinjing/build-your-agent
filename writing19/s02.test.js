import { test, expect } from "vitest";
import { unlinkSync } from "node:fs";
import { withFakeLlm } from "./fake-llm.js";
import { writeFile, readFile, safeJoin } from "./helper.js";
import { agentLoop } from "./s02-tool-use.js";

// 构造一个 OpenAI 格式的 tool_call 响应。
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

// 模型连续用 write_file → edit_file → read_file 三个工具：验证 loop 靠 handlers 表分发，
// 新增工具完全不需要改 loop。
test("s02 agentLoop 依次分发多个工具", async () => {
  const tmp = "tmp-s02.txt";
  try {
    await withFakeLlm(
      [
        toolReply("c1", "write_file", { path: tmp, content: "draft" }),
        toolReply("c2", "edit_file", { path: tmp, old_text: "draft", new_text: "final" }),
        toolReply("c3", "read_file", { path: tmp }),
        { message: { role: "assistant", content: "done" }, finish_reason: "stop" },
      ],
      async () => {
        const out = await agentLoop([{ role: "user", content: "write, edit, read" }]);
        expect(out).toBe("done");
        expect(readFile(tmp)).toBe("final"); // 文件确实被写入并编辑
      },
    );
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
});

// helper 文件工具的单元测试。
test("helper write/read 往返", () => {
  const f = "tmp-rw.txt";
  try {
    writeFile(f, "abc");
    expect(readFile(f)).toBe("abc");
  } finally {
    try {
      unlinkSync(f);
    } catch {}
  }
});

test("helper safeJoin 拦截越界路径", () => {
  expect(() => safeJoin("../escape.txt")).toThrow();
});
