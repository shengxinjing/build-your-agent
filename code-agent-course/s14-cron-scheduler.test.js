import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import { cronMatches, validateCron } from "./helper.js";
import {
  agentLoop,
  scheduleJob,
  cancelJob,
  listCronJobs,
  cronTick,
  consumeCronQueue,
  processCronQueue,
  resetCron,
  setCronStorePath,
  loadDurableJobs,
  setMemoryDir,
  setTasksDir,
  setSleepFn,
} from "./s14-cron-scheduler.js";

setSleepFn(() => Promise.resolve());

const final = (content) => ({ message: { role: "assistant", content }, finish_reason: "stop" });

function withTmpEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "s14-"));
  setMemoryDir(path.join(dir, ".memory"));
  setTasksDir(path.join(dir, ".tasks"));
  setCronStorePath(path.join(dir, ".scheduled_tasks.json"));
  resetCron();
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      setMemoryDir(path.join(process.cwd(), ".memory"));
      setTasksDir(path.join(process.cwd(), ".tasks"));
      setCronStorePath(path.join(process.cwd(), ".scheduled_tasks.json"));
      resetCron();
      rmSync(dir, { recursive: true, force: true });
    });
}

// 五段式匹配。2024-01-15 09:30 是周一（getDay()=1）。
test("cronMatches 五段式（含 DOM/DOW 的 OR 语义）", () => {
  const mon0930 = new Date(2024, 0, 15, 9, 30);
  expect(cronMatches("* * * * *", mon0930)).toBe(true);
  expect(cronMatches("30 9 * * *", mon0930)).toBe(true);
  expect(cronMatches("0 9 * * *", mon0930)).toBe(false); // 分钟不符
  expect(cronMatches("*/15 * * * *", mon0930)).toBe(true); // 30 % 15 == 0
  expect(cronMatches("*/7 * * * *", mon0930)).toBe(false);
  expect(cronMatches("30 9 * * 1", mon0930)).toBe(true); // 周一
  expect(cronMatches("30 9 * * 0", mon0930)).toBe(false); // 非周日
  expect(cronMatches("30 9 16 * 1", mon0930)).toBe(true); // DOM 16 否 / DOW 周一 是 → OR
  expect(cronMatches("30 9 16 * 2", mon0930)).toBe(false); // 两者都不符
});

// 校验：5 段、边界、步长。
test("validateCron 拒绝非法表达式", () => {
  expect(validateCron("0 9 * * *")).toBeNull();
  expect(validateCron("*/5 * * * 1-5")).toBeNull();
  expect(validateCron("0 9 * *")).toContain("Expected 5");
  expect(validateCron("60 9 * * *")).toContain("minute");
  expect(validateCron("0 9 * * 9")).toContain("day-of-week");
  expect(validateCron("*/0 * * * *")).toContain("minute");
});

// 注册 / 取消 / 列出 + 非法表达式拒绝。
test("scheduleJob / cancelJob", () =>
  withTmpEnv(() => {
    const job = scheduleJob("0 9 * * *", "morning", true, false);
    expect(typeof job).toBe("object");
    expect(listCronJobs()).toHaveLength(1);
    expect(cancelJob(job.id)).toContain("Cancelled");
    expect(listCronJobs()).toHaveLength(0);
    expect(typeof scheduleJob("bad cron", "x")).toBe("string"); // 非法 → 错误串
  }));

// 心跳：到点入队；一次性触发后删除；同分钟去重。
test("cronTick 入队 + 一次性删除 + 去重", () =>
  withTmpEnv(() => {
    const now = new Date(2024, 0, 15, 9, 30);
    scheduleJob("30 9 * * *", "ping", true, false);
    cronTick(now);
    cronTick(now); // 同一分钟，应去重
    const fired = consumeCronQueue();
    expect(fired).toHaveLength(1);
    expect(fired[0].prompt).toBe("ping");
    expect(consumeCronQueue()).toHaveLength(0); // 消费后清空

    const once = scheduleJob("30 9 * * *", "once", false, false);
    cronTick(now);
    expect(consumeCronQueue()[0].prompt).toBe("once");
    expect(listCronJobs().find((j) => j.id === once.id)).toBeUndefined(); // 一次性已删除
  }));

// durable：写盘后能重新加载。
test("durable 任务写盘并可重新加载", () =>
  withTmpEnv(() => {
    scheduleJob("0 9 * * *", "durtest", true, true);
    resetCron(); // 清空内存
    expect(listCronJobs()).toHaveLength(0);
    loadDurableJobs(); // 从盘恢复
    expect(listCronJobs().map((j) => j.prompt)).toContain("durtest");
  }));

// 循环集成：到点的任务被注入为 [Scheduled] 消息。
test("s14-cron-scheduler 到点任务注入 agent loop", () =>
  withTmpEnv(() =>
    withFakeLlm([final("handled"), final("[]")], async () => {
      scheduleJob("* * * * *", "run the daily report", true, false);
      cronTick(new Date()); // "* * * * *" 任何时间都匹配 → 入队
      const messages = [{ role: "user", content: "hi" }];
      const text = await agentLoop(messages, async () => "y");
      expect(text).toBe("handled");
      expect(messages.some((m) => String(m.content).includes("[Scheduled] run the daily report"))).toBe(
        true,
      );
    })));

// queue processor：不等下一次用户输入，自动把到点任务交给 agent loop。
test("queue processor 自动交付 cron 任务", () =>
  withTmpEnv(() =>
    withFakeLlm([final("auto handled"), final("[]")], async () => {
      scheduleJob("* * * * *", "run date", true, false);
      cronTick(new Date());
      expect(await processCronQueue(async () => "n")).toBe(true);
      expect(consumeCronQueue()).toHaveLength(0);
    })));
