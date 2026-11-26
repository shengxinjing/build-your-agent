import { test, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, createWorkspaceGuard } from "./p02-checkpoint-diagnostics.js";

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "p02-lab-"));
}

test("p02 写入语法错误的 JS 文件后自动附带 [Diagnostics]，模型立即自愈修复", async () => {
  const dir = makeTempDir();
  try {
    const guard = createWorkspaceGuard({ cwd: dir });
    const messages = [{ role: "user", content: "写一个 calc.js" }];

    await withFakeLlm(
      [
        toolReply("c1", "write_file", { path: "calc.js", content: "export function add(a, b { return a + b; }\n" }),
        toolReply("c2", "write_file", { path: "calc.js", content: "export function add(a, b) { return a + b; }\n" }),
        { message: { role: "assistant", content: "已修复语法错误" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const answer = await agentLoop(messages, { guard });
        expect(answer).toBe("已修复语法错误");
        const secondReqMessages = requests[1].messages;
        const firstToolMsg = secondReqMessages.find((m) => m.tool_call_id === "c1");
        expect(firstToolMsg.content).toContain("[Diagnostics]");
        expect(firstToolMsg.content).toContain("SyntaxError");
        expect(readFileSync(path.join(dir, "calc.js"), "utf8")).toContain("add(a, b)");
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p02 编辑与覆写护栏：拦截未读/stale-read、空 old_text、多处匹配及非法 JSON 诊断", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "app.js");
    writeFileSync(file, "const v = 1;\nconst w = 1;\n");
    const guard = createWorkspaceGuard({ cwd: dir });

    // 未先读文件就 edit 或 write 覆盖已有文件：均被拒
    expect(guard.editFileChecked("app.js", "v = 1", "v = 2")).toContain("call read_file");
    expect(guard.writeFileChecked("app.js", "const v = 9;\n")).toContain("call read_file");

    // 读过文件后，拦截空 old_text 与非唯一匹配
    expect(guard.readFileChecked("app.js")).toContain("const v = 1;");
    expect(guard.editFileChecked("app.js", "", "x")).toContain("must not be empty");
    expect(guard.editFileChecked("app.js", "= 1", "= 2")).toContain("matched 2 times");

    // 外部悄悄改了文件后，edit 和 write 覆盖均触发 stale-read 拦截
    writeFileSync(file, "const v = 1;\nconst w = 1;\nconst extra = true;\n");
    expect(guard.editFileChecked("app.js", "v = 1", "v = 2")).toContain("stale read");
    expect(guard.writeFileChecked("app.js", "const fresh = 1;\n")).toContain("stale read");

    // 重新读取后再改，成功且通过诊断
    guard.readFileChecked("app.js");
    const ok = guard.editFileChecked("app.js", "v = 1", "v = 2");
    expect(ok).toContain("diagnostics clean");
    expect(readFileSync(file, "utf8")).toContain("const v = 2;");

    // 写入损坏 JSON 时返回 [Diagnostics]
    const badJson = guard.writeFileChecked("cfg.json", '{"port": 3000,}');
    expect(badJson).toContain("[Diagnostics]");
    expect(badJson).toContain("JSON SyntaxError");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("p02 多轮 Checkpoint 支持单步回滚与跨轮反向精确回滚，并同步截断对话历史", async () => {
  const dir = makeTempDir();
  try {
    writeFileSync(path.join(dir, "index.js"), "export const mode = 'v0';\n");
    const guard = createWorkspaceGuard({ cwd: dir });
    const messages = [];

    // 第 1 轮：改 index.js 为 v1 并新建 extra.js
    await withFakeLlm(
      [
        toolReply("a1", "read_file", { path: "index.js" }),
        toolReply("a2", "edit_file", { path: "index.js", old_text: "v0", new_text: "v1" }),
        toolReply("a3", "write_file", { path: "extra.js", content: "export const x = 1;\n" }),
        { message: { role: "assistant", content: "turn 1 ok" }, finish_reason: "stop" },
      ],
      async () => {
        messages.push({ role: "user", content: "turn 1" });
        const out = await agentLoop(messages, { guard, turnLabel: "turn 1" });
        messages.push({ role: "assistant", content: out });
      },
    );

    const turn1MsgCount = messages.length;

    // 第 2 轮：把 index.js 继续改成 v2
    await withFakeLlm(
      [
        toolReply("b1", "edit_file", { path: "index.js", old_text: "v1", new_text: "v2" }),
        { message: { role: "assistant", content: "turn 2 ok" }, finish_reason: "stop" },
      ],
      async () => {
        messages.push({ role: "user", content: "turn 2" });
        const out = await agentLoop(messages, { guard, turnLabel: "turn 2" });
        messages.push({ role: "assistant", content: out });
      },
    );

    expect(guard.listCheckpoints().map((c) => c.id)).toEqual(["cp_001", "cp_002"]);

    // 不传 ID 默认只回滚最新一轮（cp_002），保留 cp_001 的改动
    const latest = guard.rewind(undefined, messages);
    expect(latest.ok).toBe(true);
    expect(latest.checkpointId).toBe("cp_002");
    expect(readFileSync(path.join(dir, "index.js"), "utf8")).toBe("export const mode = 'v1';\n");
    expect(existsSync(path.join(dir, "extra.js"))).toBe(true);
    expect(messages).toHaveLength(turn1MsgCount);
    expect(guard.listCheckpoints().map((c) => c.id)).toEqual(["cp_001"]);

    // 再回滚到 cp_001，恢复最初版本并删除新建的 extra.js
    const first = guard.rewind("cp_001", messages);
    expect(first.ok).toBe(true);
    expect(first.restoredFiles).toEqual(["extra.js", "index.js"]);
    expect(readFileSync(path.join(dir, "index.js"), "utf8")).toBe("export const mode = 'v0';\n");
    expect(existsSync(path.join(dir, "extra.js"))).toBe(false);
    expect(messages).toHaveLength(0);
    expect(guard.listCheckpoints()).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
