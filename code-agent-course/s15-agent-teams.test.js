import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  spawnTeammate,
  sendMessage,
  readInbox,
  setMailboxDir,
  resetTeammates,
  setMemoryDir,
  setTasksDir,
  setCronStorePath,
  resetCron,
  setSleepFn,
  scheduleJob,
  cronTick,
  consumeCronQueue,
  processCronQueue,
} from "./s15-agent-teams.js";

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

async function waitForInbox(agent, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const msgs = readInbox(agent);
    if (msgs.length) return msgs;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return [];
}

function withTmpEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "s15-"));
  setMemoryDir(path.join(dir, ".memory"));
  setTasksDir(path.join(dir, ".tasks"));
  setCronStorePath(path.join(dir, ".scheduled_tasks.json"));
  setMailboxDir(path.join(dir, ".mailboxes"));
  resetCron();
  resetTeammates();
  const root = process.cwd();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      setMemoryDir(path.join(root, ".memory"));
      setTasksDir(path.join(root, ".tasks"));
      setCronStorePath(path.join(root, ".scheduled_tasks.json"));
      setMailboxDir(path.join(root, ".mailboxes"));
      resetCron();
      resetTeammates();
      rmSync(dir, { recursive: true, force: true });
    });
}

// MessageBus：发到收件箱，读完即删（消费式）。
test("MessageBus send + readInbox 消费式", () =>
  withTmpEnv(() => {
    sendMessage("alice", "lead", "hello lead");
    sendMessage("bob", "lead", "hi from bob");
    const msgs = readInbox("lead");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].from).toBe("alice");
    expect(msgs[0].content).toBe("hello lead");
    expect(readInbox("lead")).toHaveLength(0); // 读完已删除
  }));

// 队友跑自己的多轮子循环，完成后把总结发回 Lead 收件箱。
test("spawnTeammate 跑子循环并回报 Lead", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [toolReply("t1", "bash", { command: "echo teammate-ran" }), final("done by alice")],
      async () => {
        const result = spawnTeammate("alice", "backend dev", "do the thing", async () => "y");
        expect(result).toContain("alice");
        const inbox = await waitForInbox("lead");
        expect(inbox).toHaveLength(1);
        expect(inbox[0].from).toBe("alice");
        expect(inbox[0].content).toBe("done by alice");
      },
    )));

// spawn 之后再发消息：JS 版也要像 Python 版一样，让后台队友能从 mailbox 收到指令。
test("spawnTeammate 后台运行时可以收到 lead 的 mailbox 消息", () =>
  withTmpEnv(() =>
    withFakeLlm([final("schema created")], async (requests) => {
      spawnTeammate("alice", "backend dev", "wait for instructions", async () => "y");
      sendMessage("lead", "alice", "create schema.sql");
      const inbox = await waitForInbox("lead");
      expect(inbox[0].content).toBe("schema created");
      expect(JSON.stringify(requests[0].messages)).toContain("create schema.sql");
    })));

// 循环集成：Lead 启动队友后先返回；队友稍后把结果留在 Lead 收件箱。
test("s15-agent-teams Lead 启动队友 → 结果保留在 mailbox", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [
        toolReply("c1", "spawn_teammate", { name: "alice", role: "dev", prompt: "build it" }), // Lead
        final("alice finished the build"), // 队友：一轮直接交付
        final("team work done"), // Lead 收尾
        final("[]"), // 轮末 extractMemories
      ],
      async () => {
        const messages = [{ role: "user", content: "build with a teammate" }];
        const text = await agentLoop(messages, async () => "y");
        expect(text).toBe("team work done");
        const inbox = await waitForInbox("lead");
        expect(inbox[0].content).toBe("alice finished the build");
      },
    )));

// 回归测试：s15 新增队友后，仍然保留 s14 的空闲队列处理器。
test("s15-agent-teams 保留 s14 cron queue processor", () =>
  withTmpEnv(() =>
    withFakeLlm([final("cron handled"), final("[]")], async () => {
      scheduleJob("* * * * *", "run date", true, false);
      cronTick(new Date());
      expect(await processCronQueue(async () => "n")).toBe(true);
      expect(consumeCronQueue()).toHaveLength(0);
    })));
