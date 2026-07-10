import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { withFakeLlm } from "./fake-llm.js";
import {
  agentLoop,
  resetCron,
  resetMcp,
  resetProtocol,
  resetTeammates,
  setCronStorePath,
  setMailboxDir,
  setMemoryDir,
  setSleepFn,
  setTasksDir,
} from "./s17-mcp-plugin.js";

setSleepFn(() => Promise.resolve());

const CHAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));

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

function withTmpEnv(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "s17-"));
  setMemoryDir(path.join(dir, ".memory"));
  setTasksDir(path.join(dir, ".tasks"));
  setCronStorePath(path.join(dir, ".scheduled_tasks.json"));
  setMailboxDir(path.join(dir, ".mailboxes"));
  resetCron();
  resetMcp();
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
      resetMcp();
      resetTeammates();
      resetProtocol();
      rmSync(dir, { recursive: true, force: true });
    });
}

test("s17 does not import runtime.js", () => {
  const source = readFileSync(path.join(CHAPTER_DIR, "s17-mcp-plugin.js"), "utf8");
  expect(source).not.toContain("./runtime.js");
});

test("connect_mcp discovers MCP tools and adds them to the next tool list", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [
        toolReply("c1", "connect_mcp", { name: "docs" }),
        toolReply("c2", "mcp__docs__search", { query: "agent loop" }),
        final("done"),
        final("[]"),
      ],
      async (requests) => {
        const output = await agentLoop([{ role: "user", content: "connect docs" }], async () => "n");

        expect(output).toBe("done");
        expect(requests[0].tools.map((t) => t.function.name)).toContain("connect_mcp");
        expect(requests[0].tools.map((t) => t.function.name)).not.toContain("mcp__docs__search");
        expect(requests[1].tools.map((t) => t.function.name)).toContain("mcp__docs__search");
      },
    )));

test("destructive MCP tools are blocked before their handler runs", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [
        toolReply("c1", "connect_mcp", { name: "deploy" }),
        toolReply("c2", "mcp__deploy__trigger", { service: "api" }),
        final("done"),
        final("[]"),
      ],
      async () => {
        const messages = [{ role: "user", content: "connect deploy and trigger" }];
        await agentLoop(messages, async () => "n");

        expect(
          messages.some(
            (m) =>
              m.role === "tool" &&
              m.content === "Permission blocked: mcp__deploy__trigger is marked destructive.",
          ),
        ).toBe(true);
        expect(messages.some((m) => String(m.content).includes("deploy triggered for"))).toBe(false);
      },
    )));

test("s17 keeps s16 task system behavior while adding MCP", () =>
  withTmpEnv((dir) =>
    withFakeLlm(
      [
        toolReply("c1", "create_task", { subject: "Audit README" }),
        final("created"),
        final("[]"),
      ],
      async () => {
        await agentLoop([{ role: "user", content: "create a task" }], async () => "n");
        expect(existsSync(path.join(dir, ".tasks"))).toBe(true);
      },
    )));

test("agent loop prints MCP logs while executing discovered tools", () =>
  withTmpEnv(() =>
    withFakeLlm(
      [
        toolReply("c1", "connect_mcp", { name: "docs" }),
        toolReply("c2", "mcp__docs__search", { query: "agent loop" }),
        final("done"),
        final("[]"),
      ],
      async () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (line = "") => logs.push(String(line));
        try {
          await agentLoop([{ role: "user", content: "connect docs" }], async () => "n");
        } finally {
          console.log = originalLog;
        }

        expect(logs).toContain("> connect_mcp({\"name\":\"docs\"})");
        expect(logs).toContain("[mcp] discovered: mcp__docs__search, mcp__docs__get_version");
        expect(logs).toContain("> mcp__docs__search({\"query\":\"agent loop\"})");
      },
    )));
