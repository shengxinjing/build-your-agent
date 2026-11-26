import { test, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { withFakeLlm } from "./fake-llm.js";
import { agentLoop, createStdioMcpClient } from "./p04-mcp-stdio.js";

const demoServerPath = fileURLToPath(new URL("./p04-mcp-demo-server.js", import.meta.url));

function toolReply(id, name, args) {
  return {
    message: {
      role: "assistant",
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    finish_reason: "tool_calls",
  };
}

test("p04 通过真实 stdio 子进程跑通握手，且 stderr 诊断日志不污染 JSON-RPC stdout", async () => {
  const client = createStdioMcpClient("demo", process.execPath, [demoServerPath]);
  try {
    const { serverInfo, tools } = await client.connect();
    expect(serverInfo.name).toBe("demo-mcp-server");
    expect(tools.map((t) => t.fullName)).toEqual([
      "mcp__demo__docs_search",
      "mcp__demo__calc_stats",
      "mcp__demo__deploy_trigger",
    ]);

    const statsText = await client.callTool("calc_stats", { numbers: [10, 20, 30] });
    expect(JSON.parse(statsText)).toEqual({ count: 3, sum: 60, avg: 20, min: 10, max: 30 });
    expect(client.getStderr()).toContain("initialized");
  } finally {
    client.close();
  }
});

test("p04 agentLoop 将真实 stdio MCP 工具并入循环，并按 destructiveHint 拦截或放行", async () => {
  const client = createStdioMcpClient("demo", process.execPath, [demoServerPath]);
  await client.connect();
  try {
    await withFakeLlm(
      [
        toolReply("m1", "mcp__demo__docs_search", { query: "stdio" }),
        toolReply("m2", "mcp__demo__deploy_trigger", { service: "billing" }),
        { message: { role: "assistant", content: "查询完成，部署被拒" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const messages = [{ role: "user", content: "查 stdio 文档并尝试部署 billing" }];
        const out = await agentLoop(messages, {
          mcpClients: [client],
          confirm: async () => "n",
        });
        expect(out).toBe("查询完成，部署被拒");
        const toolResults = requests[2].messages.filter((m) => m.role === "tool");
        expect(toolResults[0].content).toContain("JSON-RPC 2.0");
        expect(toolResults[1].content).toContain("Permission blocked");
      },
    );

    await withFakeLlm(
      [
        toolReply("m3", "mcp__demo__deploy_trigger", { service: "billing" }),
        { message: { role: "assistant", content: "已触发部署" }, finish_reason: "stop" },
      ],
      async (requests) => {
        const messages = [{ role: "user", content: "确认部署 billing" }];
        const out = await agentLoop(messages, {
          mcpClients: [client],
          confirm: async () => "y",
        });
        expect(out).toBe("已触发部署");
        const toolResult = requests[1].messages.find((m) => m.tool_call_id === "m3");
        expect(toolResult.content).toContain("Triggered deployment for billing");
      },
    );
  } finally {
    client.close();
  }
});

test("p04 MCP 调用中途断开时在 agentLoop 内优雅降级为工具错误，不崩主循环", async () => {
  const client = createStdioMcpClient("demo", process.execPath, [demoServerPath]);
  await client.connect();
  // 模拟服务在运行中途崩溃关闭
  client.close();

  await withFakeLlm(
    [
      toolReply("m4", "mcp__demo__docs_search", { query: "stdio" }),
      { message: { role: "assistant", content: "MCP 服务已离线，改为本地处理" }, finish_reason: "stop" },
    ],
    async (requests) => {
      const messages = [{ role: "user", content: "查一下文档" }];
      const out = await agentLoop(messages, { mcpClients: [client] });
      expect(out).toBe("MCP 服务已离线，改为本地处理");
      const toolResult = requests[1].messages.find((m) => m.tool_call_id === "m4");
      expect(toolResult.content).toContain("MCP Call Error:");
    },
  );
});

test("p04 子进程异常退出或超时时立即拒绝并自动清理子进程，不永久卡死", async () => {
  const badClient = createStdioMcpClient("broken", process.execPath, ["-e", "process.exit(1)"], {
    timeoutMs: 1000,
  });
  await expect(badClient.connect()).rejects.toThrow(/exited/);

  const slowClient = createStdioMcpClient("slow", process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    timeoutMs: 150,
  });
  await expect(slowClient.connect()).rejects.toThrow(/timed out/);
});
