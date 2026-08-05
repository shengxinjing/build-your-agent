import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  assembleSystemPrompt,
  getSystemPrompt,
  resetSystemPromptCache,
  buildContext,
  setMemoryDir,
  writeMemoryFile,
} from "./s10-system-prompt.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}
const final = (content) => ({ message: { role: "assistant", content }, finish_reason: "stop" });

function withMemoryDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "mem-"));
  setMemoryDir(dir);
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      setMemoryDir(path.join(process.cwd(), ".memory"));
      rmSync(dir, { recursive: true, force: true });
    });
}

// 始终加载 identity/tools/compaction；skills/memory 按真实状态选段。
test("assembleSystemPrompt 按真实状态选段", () => {
  const base = assembleSystemPrompt({ tools: ["bash", "read_file"], skills: "", memories: "" });
  expect(base).toContain("You are a coding agent");
  expect(base).toContain("Available tools: bash, read_file.");
  expect(base).toContain("call compact");
  expect(base).not.toContain("Skills available");
  expect(base).not.toContain("Memories available");

  const withSkills = assembleSystemPrompt({ tools: ["bash"], skills: "- git: tips", memories: "" });
  expect(withSkills).toContain("Skills available:\n- git: tips");

  const withMem = assembleSystemPrompt({ tools: ["bash"], skills: "", memories: "- [t](t.md) — x" });
  expect(withMem).toContain("Memories available:");
});

// 缓存：context 变了输出变；同 context 输出稳定。
test("getSystemPrompt 随 context 变化、同 context 稳定", () => {
  resetSystemPromptCache();
  const a = getSystemPrompt({ tools: ["bash"], skills: "", memories: "" });
  const a2 = getSystemPrompt({ tools: ["bash"], skills: "", memories: "" });
  const b = getSystemPrompt({ tools: ["bash"], skills: "", memories: "- m" });
  expect(a2).toBe(a); // 同 context → 复用
  expect(b).not.toBe(a); // context 变 → 重组装
  expect(b).toContain("Memories available:");
});

// context 从真实状态派生：工具列表 + 记忆索引。
test("buildContext 反映真实状态", () =>
  withMemoryDir(() => {
    const before = buildContext();
    expect(before.tools).toContain("bash");
    expect(before.tools).toContain("compact");
    expect(before.tools).toHaveLength(9);
    expect(before.memories).toBe(""); // 还没有记忆

    writeMemoryFile("tabs", "user", "prefers tabs", "body");
    expect(buildContext().memories).toContain("[tabs](tabs.md)"); // 索引出现
  }));

// 循环集成：用运行时组装的 system prompt 跑通一轮工具调用。
test("s10-system-prompt 用运行时组装的 system prompt 跑通工具调用", () =>
  withMemoryDir(() => {
    resetSystemPromptCache();
    const messages = [{ role: "user", content: "list files" }];
    return withFakeLlm(
      [
        toolReply("b1", "bash", { command: "echo hi-s10" }),
        final("done"),
        final("[]"), // 轮末 extractMemories：无新记忆
      ],
      async (requests) => {
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("done");
        expect(messages.find((m) => m.role === "tool").content).toContain("hi-s10");
        // 第一个请求的 system 是运行时组装的：含工具段、不含记忆段。
        const system = requests[0].messages[0].content;
        expect(system).toContain("You are a coding agent");
        expect(system).toContain("Available tools: bash, read_file");
        expect(system).toContain("compact.");
        expect(system).not.toContain("Memories available");
      },
    );
  }));
