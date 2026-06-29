import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import { parseFrontmatter } from "./utils.js";
import { agentLoop, scanSkills, skillRegistry } from "./s07-skill-loading.js";

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

// frontmatter 解析（纯函数）。
test("parseFrontmatter 取 name/description", () => {
  const { meta } = parseFrontmatter("---\nname: code-review\ndescription: review code\n---\n\n# body");
  expect(meta.name).toBe("code-review");
  expect(meta.description).toBe("review code");
});

// 扫描 skills/ 目录建注册表（用临时目录）。
test("scanSkills 扫描目录建注册表", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skills-"));
  try {
    mkdirSync(path.join(dir, "git"));
    writeFileSync(
      path.join(dir, "git", "SKILL.md"),
      "---\nname: git\ndescription: git tips\n---\n# git\nuse git status",
    );
    const reg = scanSkills(dir);
    expect(reg.git.description).toBe("git tips");
    expect(reg.git.content).toContain("use git status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 第二级：模型 load_skill 时，完整内容作为 tool_result 注入。
test("s07-skill-loading load_skill 按需返回完整内容", async () => {
  skillRegistry.demo = { name: "demo", description: "d", content: "DEMO SKILL: do the thing" };
  const messages = [{ role: "user", content: "用 demo 技能" }];
  await withFakeLlm(
    [toolReply("c1", "load_skill", { name: "demo" }), final("已加载")],
    () => agentLoop(messages, async () => "y"),
  );
  const toolMsg = messages.find((m) => m.role === "tool");
  expect(toolMsg.content).toContain("DEMO SKILL");
});
