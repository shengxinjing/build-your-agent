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
  createTask,
  listTasks,
  canStart,
  claimTask,
  completeTask,
} from "./s12-task-system.js";

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

// 任务持久化为 .tasks/{id}.json，可列出。
test("createTask + listTasks 持久化", () =>
  withTmpDirs(() => {
    const t = createTask("setup db", "create schema");
    expect(t.status).toBe("pending");
    const all = listTasks();
    expect(all).toHaveLength(1);
    expect(all[0].subject).toBe("setup db");
  }));

// 依赖检查：blockedBy 全部 completed 才能开始。
test("canStart 依赖检查（blockedBy）", () =>
  withTmpDirs(() => {
    const a = createTask("schema");
    const b = createTask("api", "", [a.id]);
    expect(canStart(a.id)).toBe(true); // 无依赖
    expect(canStart(b.id)).toBe(false); // a 未完成
    claimTask(a.id);
    completeTask(a.id);
    expect(canStart(b.id)).toBe(true); // a 完成后解锁
  }));

// 状态机：pending→in_progress；依赖未完成拒绝；重复认领拒绝。
test("claimTask 状态机", () =>
  withTmpDirs(() => {
    const a = createTask("schema");
    const b = createTask("api", "", [a.id]);
    expect(claimTask(b.id)).toContain("Blocked by"); // 依赖未完成
    expect(claimTask(a.id)).toContain("Claimed");
    const reloaded = listTasks().find((t) => t.id === a.id);
    expect(reloaded.status).toBe("in_progress");
    expect(reloaded.owner).toBe("agent");
    expect(claimTask(a.id)).toContain("cannot claim"); // 已 in_progress
  }));

// 模型可能传错 task_id，工具要返回错误文本，而不是让 agent loop 崩溃。
test("缺失 task_id 返回可读错误", () =>
  withTmpDirs(() => {
    expect(canStart("missing")).toBe(false);
    expect(claimTask("missing")).toContain("not found");
    expect(completeTask("missing")).toContain("not found");
  }));

// 完成任务 → 解锁下游。
test("completeTask 解锁下游", () =>
  withTmpDirs(() => {
    const a = createTask("schema");
    createTask("api", "", [a.id]);
    claimTask(a.id);
    const msg = completeTask(a.id);
    expect(msg).toContain("Completed");
    expect(msg).toContain("Unblocked");
    expect(msg).toContain("api");
  }));

// 循环集成：模型调用 create_task → 任务落盘。
test("s12-task-system 模型创建任务并持久化", () =>
  withTmpDirs(() =>
    withFakeLlm(
      [
        toolReply("c1", "create_task", { subject: "setup database schema" }),
        final("created"),
        final("[]"), // 轮末 extractMemories
      ],
      async () => {
        const text = await agentLoop([{ role: "user", content: "create a task" }], async () => "y");
        expect(text).toBe("created");
        expect(listTasks().map((t) => t.subject)).toContain("setup database schema");
      },
    )));
