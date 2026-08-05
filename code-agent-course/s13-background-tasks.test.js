import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  setTasksDir,
  setMemoryDir,
  setSleepFn,
  canStart,
  claimTask,
  completeTask,
  isSlowOperation,
  shouldRunBackground,
  startBackgroundTask,
  collectBackgroundResults,
  resetBackgroundTasks,
} from "./s13-background-tasks.js";

setSleepFn(() => Promise.resolve());

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
const flush = () => new Promise((r) => setTimeout(r, 0)); // 让未 await 的后台 Promise 完成

function withTmpDirs(fn) {
  const mem = mkdtempSync(path.join(tmpdir(), "mem-"));
  const tasks = mkdtempSync(path.join(tmpdir(), "tasks-"));
  setMemoryDir(mem);
  setTasksDir(tasks);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      setMemoryDir(path.join(process.cwd(), ".memory"));
      setTasksDir(path.join(process.cwd(), ".tasks"));
      rmSync(mem, { recursive: true, force: true });
      rmSync(tasks, { recursive: true, force: true });
    });
}

test("s13 保留 s12：缺失 task_id 返回错误文本", () =>
  withTmpDirs(() => {
    expect(canStart("missing")).toBe(false);
    expect(claimTask("missing")).toBe("Error: Task missing not found");
    expect(completeTask("missing")).toBe("Error: Task missing not found");
  }));

// 判定：显式 run_in_background 优先，关键词启发式兜底。
test("shouldRunBackground：显式参数优先，关键词兜底", () => {
  expect(isSlowOperation("bash", { command: "npm install" })).toBe(true);
  expect(isSlowOperation("bash", { command: "echo hi" })).toBe(false);
  expect(isSlowOperation("read_file", { command: "install" })).toBe(false); // 非 bash
  expect(shouldRunBackground("bash", { command: "echo hi", run_in_background: true })).toBe(true);
  expect(shouldRunBackground("bash", { command: "echo hi" })).toBe(false);
});

// 生命周期：dispatch → running → 完成后 collect 得到 <task_notification>，并移除。
test("startBackgroundTask + collectBackgroundResults 生命周期", async () => {
  resetBackgroundTasks();
  const bgId = startBackgroundTask("bash", { command: "echo hi" }, () => "RESULT-TEXT");
  expect(bgId).toBe("bg_0001");
  expect(collectBackgroundResults()).toHaveLength(0); // 还在 running
  await flush();
  const notifs = collectBackgroundResults();
  expect(notifs).toHaveLength(1);
  expect(notifs[0]).toContain("<task_notification>");
  expect(notifs[0]).toContain("bg_0001");
  expect(notifs[0]).toContain("RESULT-TEXT");
  expect(collectBackgroundResults()).toHaveLength(0); // 收集后已移除
});

// 循环集成：慢操作先回占位，下一轮把完成通知注入对话。
test("s13-background-tasks 慢操作丢后台 + 通知注入", () =>
  withTmpDirs(() => {
    resetBackgroundTasks();
    const messages = [{ role: "user", content: "install deps then check" }];
    return withFakeLlm(
      [
        toolReply("c1", "bash", { command: "echo bg-done", run_in_background: true }), // turn1：后台
        toolReply("c2", "bash", { command: "echo foreground" }), // turn2：同步（其间后台完成）
        final("done"), // turn3
        final("[]"), // 轮末 extractMemories
      ],
      async () => {
        const text = await agentLoop(messages, async () => "y");
        expect(typeof text).toBe("string");
        // turn1 的占位 tool_result
        expect(
          messages.some(
            (m) => m.role === "tool" && String(m.content).includes("[Background task bg_0001 started]"),
          ),
        ).toBe(true);
        // 后台完成后注入的独立通知（含命令输出）
        const notif = messages.find((m) => m.role === "user" && String(m.content).includes("<task_notification>"));
        expect(notif).toBeTruthy();
        expect(String(notif.content)).toContain("bg-done");
      },
    );
  }));

test("s13-background-tasks 后台 bash 不阻塞后续工具", () =>
  withTmpDirs(() => {
    resetBackgroundTasks();
    const messages = [{ role: "user", content: "background sleep and read README" }];
    return withFakeLlm(
      [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: "bash",
                  arguments: JSON.stringify({
                    command: "sleep 0.5 && echo bg-done",
                    run_in_background: true,
                  }),
                },
              },
              {
                id: "c2",
                type: "function",
                function: { name: "read_file", arguments: JSON.stringify({ path: "README.md" }) },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
        final("done"),
        final("[]"),
      ],
      async () => {
        const started = Date.now();
        await agentLoop(messages, async () => "y");
        const elapsed = Date.now() - started;
        expect(elapsed).toBeLessThan(350);
        expect(
          messages.some((m) => m.role === "tool" && String(m.content).includes("build-your-agent")),
        ).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 600));
        resetBackgroundTasks();
      },
    );
  }));
