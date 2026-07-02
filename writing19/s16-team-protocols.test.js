import { test, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  spawnTeammate,
  sendMessage,
  readInbox,
  matchResponse,
  consumeLeadInbox,
  pendingRequests,
  resetProtocol,
  setMailboxDir,
  resetTeammates,
  setMemoryDir,
  setTasksDir,
  setCronStorePath,
  resetCron,
  setSleepFn,
} from "./s16-team-protocols.js";

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

async function waitFor(predicate, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return false;
}

function withTmpEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "s16-"));
  setMemoryDir(path.join(dir, ".memory"));
  setTasksDir(path.join(dir, ".tasks"));
  setCronStorePath(path.join(dir, ".scheduled_tasks.json"));
  setMailboxDir(path.join(dir, ".mailboxes"));
  resetCron();
  resetTeammates();
  resetProtocol();
  const root = process.cwd();
  process.chdir(dir);
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      process.chdir(root);
      setMemoryDir(path.join(root, ".memory"));
      setTasksDir(path.join(root, ".tasks"));
      setCronStorePath(path.join(root, ".scheduled_tasks.json"));
      setMailboxDir(path.join(root, ".mailboxes"));
      resetCron();
      resetTeammates();
      resetProtocol();
      rmSync(dir, { recursive: true, force: true });
    });
}

// 状态机：用 request_id 关联 + 类型校验 + 幂等。
test("matchResponse 关联 + 类型校验 + 幂等", () =>
  withTmpEnv(() => {
    pendingRequests.set("req_0", { request_id: "req_0", type: "shutdown", sender: "lead", target: "alice", status: "pending", payload: "" });
    matchResponse("plan_approval_response", "req_0", true); // 类型不符 → 忽略
    expect(pendingRequests.get("req_0").status).toBe("pending");
    matchResponse("shutdown_response", "req_0", true); // 匹配 → approved
    expect(pendingRequests.get("req_0").status).toBe("approved");
    matchResponse("shutdown_response", "req_0", false); // 已结案 → 忽略重复
    expect(pendingRequests.get("req_0").status).toBe("approved");
  }));

// 统一消费 Lead 收件箱时，协议响应被路由进状态机。
test("consumeLeadInbox 路由协议响应", () =>
  withTmpEnv(() => {
    pendingRequests.set("req_1", { request_id: "req_1", type: "shutdown", sender: "lead", target: "alice", status: "pending", payload: "" });
    sendMessage("alice", "lead", "ok", "shutdown_response", { request_id: "req_1", approve: true });
    const msgs = consumeLeadInbox();
    expect(msgs).toHaveLength(1);
    expect(pendingRequests.get("req_1").status).toBe("approved");
  }));

// 队友侧：收到 shutdown_request → 回 shutdown_response 并停。
test("队友收到 shutdown_request → 回应并停", () =>
  withTmpEnv(() =>
    withFakeLlm([final("unused")], async () => {
      sendMessage("lead", "alice", "shut down", "shutdown_request", { request_id: "req_2" });
      spawnTeammate("alice", "dev", "do work", async () => "y");
      const leadInbox = await waitForInbox("lead");
      expect(
        leadInbox.some((m) => m.type === "shutdown_response" && m.metadata?.request_id === "req_2"),
      ).toBe(true);
    })));

// 队友完成初始回复后会进入 idle，后续仍能消费 lead 发来的普通消息。
test("队友 idle 后继续消费 lead 消息", () =>
  withTmpEnv((dir) => {
    const idleResolvers = [];
    setSleepFn(() => new Promise((resolve) => idleResolvers.push(resolve)));
    const file = "config.yaml";
    return withFakeLlm(
      [
        final("ready"),
        toolReply("c1", "write_file", { path: file, content: "ok: true\n" }),
        final("created"),
      ],
      async (requests) => {
        try {
          spawnTeammate("alice", "dev", "wait", async () => "y");
          expect(await waitFor(() => requests.length === 1)).toBe(true);
          sendMessage("lead", "alice", "create config.yaml");
          idleResolvers.shift()?.();
          expect(await waitFor(() => requests.length === 3)).toBe(true);
          expect(existsSync(path.join(dir, file))).toBe(true);
          sendMessage("lead", "alice", "shut down", "shutdown_request", { request_id: "req_idle" });
          idleResolvers.shift()?.();
          const leadInbox = await waitForInbox("lead");
          expect(leadInbox.some((m) => m.type === "shutdown_response" && m.metadata?.request_id === "req_idle")).toBe(true);
        } finally {
          setSleepFn(() => Promise.resolve());
        }
      },
    );
  }));

// Lead 侧：request_shutdown 发出握手请求（建 pending 态 + 投递到队友收件箱）。
test("s16-team-protocols Lead request_shutdown 发出握手", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [toolReply("c1", "request_shutdown", { teammate: "alice" }), final("requested"), final("[]")],
      async () => {
        await agentLoop([{ role: "user", content: "shut down alice" }], async () => "y");
        expect(readInbox("alice").some((m) => m.type === "shutdown_request")).toBe(true);
        expect([...pendingRequests.values()].some((s) => s.type === "shutdown" && s.status === "pending")).toBe(true);
      },
    )));

// Lead 侧：review_plan 审批后更新状态机 + 回复队友。
test("s16-team-protocols review_plan 审批并回复队友", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [toolReply("c1", "review_plan", { request_id: "req_5", approve: true }), final("approved"), final("[]")],
      async () => {
        pendingRequests.set("req_5", { request_id: "req_5", type: "plan_approval", sender: "bob", target: "lead", status: "pending", payload: "refactor" });
        await agentLoop([{ role: "user", content: "approve bob's plan req_5" }], async () => "y");
        expect(pendingRequests.get("req_5").status).toBe("approved");
        expect(readInbox("bob").some((m) => m.type === "plan_approval_response" && m.metadata?.approve === true)).toBe(true);
      },
    )));
