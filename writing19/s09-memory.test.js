import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  setMemoryDir,
  writeMemoryFile,
  listMemoryFiles,
  readMemoryIndex,
  selectRelevantMemories,
  loadMemories,
  extractMemories,
  consolidateMemories,
} from "./s09-memory.js";

const final = (content) => ({ message: { role: "assistant", content }, finish_reason: "stop" });

// 每个测试用一个临时 .memory 目录，结束后还原并清理（隔离、可重复）。
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

// 存储：写文件 → 重建索引 → 解析回来。
test("writeMemoryFile 写文件 + 重建索引 + listMemoryFiles 解析", () =>
  withMemoryDir(() => {
    writeMemoryFile("tabs", "user", "prefers tabs", "User prefers tabs not spaces.");
    const files = listMemoryFiles();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("tabs");
    expect(files[0].type).toBe("user");
    expect(files[0].body).toContain("prefers tabs not spaces");
    expect(readMemoryIndex()).toContain("[tabs](tabs.md) — prefers tabs");
  }));

// 加载路径二：LLM side-query 选中相关记忆。
test("selectRelevantMemories 用 LLM 选中相关记忆", () =>
  withMemoryDir(() =>
    withFakeLlm([final("[0]")], async () => {
      writeMemoryFile("tabs", "user", "prefers tabs", "tabs body");
      const sel = await selectRelevantMemories([{ role: "user", content: "what about indentation?" }]);
      expect(sel).toEqual(["tabs.md"]);
    })));

// LLM 没返回数组 → 降级到关键词匹配 name + description。
test("selectRelevantMemories LLM 无数组时降级关键词", () =>
  withMemoryDir(() =>
    withFakeLlm([final("hmm no idea")], async () => {
      writeMemoryFile("indentation-pref", "user", "tabs over spaces", "body");
      const sel = await selectRelevantMemories([
        { role: "user", content: "tell me about indentation rules" },
      ]);
      expect(sel).toEqual(["indentation-pref.md"]);
    })));

// 选中的记忆全文包进 <relevant_memories> 供注入。
test("loadMemories 把选中记忆全文包进标签", () =>
  withMemoryDir(() =>
    withFakeLlm([final("[0]")], async () => {
      writeMemoryFile("tabs", "user", "prefers tabs", "TAB RULE: use tabs");
      const text = await loadMemories([{ role: "user", content: "indent?" }]);
      expect(text).toContain("<relevant_memories>");
      expect(text).toContain("TAB RULE: use tabs");
    })));

// 写入：从对话提取新记忆并落盘。
test("extractMemories 从对话提取并写入新记忆", () =>
  withMemoryDir(() =>
    withFakeLlm(
      [final('[{"name":"quotes","type":"user","description":"single quotes","body":"Use single quotes."}]')],
      async () => {
        const n = await extractMemories([
          { role: "user", content: "I prefer single quotes" },
          { role: "assistant", content: "noted" },
        ]);
        expect(n).toBe(1);
        expect(listMemoryFiles().map((m) => m.name)).toContain("quotes");
      },
    )));

// 没有新信息 → 不写文件。
test("extractMemories 无新信息时不写文件", () =>
  withMemoryDir(() =>
    withFakeLlm([final("[]")], async () => {
      const n = await extractMemories([{ role: "user", content: "hi" }]);
      expect(n).toBe(0);
      expect(listMemoryFiles()).toHaveLength(0);
    })));

// 整理：文件数达阈值（10）→ LLM 去重合并。
test("consolidateMemories 达阈值时去重合并", () =>
  withMemoryDir(() =>
    withFakeLlm(
      [final('[{"name":"merged","type":"user","description":"all prefs","body":"Merged prefs."}]')],
      async () => {
        for (let i = 0; i < 10; i += 1) writeMemoryFile(`m${i}`, "user", `d${i}`, `b${i}`);
        expect(listMemoryFiles()).toHaveLength(10);
        await consolidateMemories();
        const files = listMemoryFiles();
        expect(files).toHaveLength(1);
        expect(files[0].name).toBe("merged");
      },
    )));

// 循环集成：轮首注入相关记忆 + 轮末提取新记忆。
test("s09-memory 注入相关记忆 + 轮末提取新记忆", () =>
  withMemoryDir(() =>
    withFakeLlm(
      [
        final("[0]"), // select：选中已有的 tabs
        final("got it, noted"), // 主循环：直接回答（无工具）
        final('[{"name":"quotes","type":"user","description":"single quotes","body":"Use single quotes."}]'), // extract
      ],
      async (requests) => {
        writeMemoryFile("tabs", "user", "prefers tabs", "User prefers tabs not spaces.");
        const messages = [{ role: "user", content: "remember I like single quotes" }];
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("got it, noted");
        expect(requests).toHaveLength(3);
        // 注入：主循环请求带上了 tabs 记忆全文
        expect(JSON.stringify(requests[1].messages)).toContain("User prefers tabs not spaces");
        // 提取：新记忆已写入
        expect(listMemoryFiles().map((m) => m.name)).toContain("quotes");
      },
    )));
