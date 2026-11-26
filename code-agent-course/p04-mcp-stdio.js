import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { callLlm, readFile, tool, runChatCli, isMainModule, colorLog } from "./helper.js";

const SYSTEM = `You are a coding agent connected to external MCP servers over stdio. Use built-in and mcp__* tools to solve tasks concisely.`;

const BUILTIN_TOOLS = [
  tool("read_file", "Read a local file (optional line limit).", {
    type: "object",
    properties: { path: { type: "string" }, limit: { type: "integer" } },
    required: ["path"],
  }),
];

const BUILTIN_HANDLERS = {
  read_file: ({ path, limit }) => readFile(path, limit),
};

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

export function createStdioMcpClient(serverName, command, args = [], { timeoutMs = 5000, cwd } = {}) {
  let child = null;
  let rl = null;
  let nextId = 1;
  let tools = [];
  let serverInfo = null;
  const stderrLines = [];
  const pending = new Map();

  const rejectAllPending = (reason) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  };

  const close = () => {
    rejectAllPending(`MCP client "${serverName}" closed`);
    rl?.close();
    rl = null;
    if (!child) return;
    const proc = child;
    child = null;
    proc.stdin?.end();
    if (!proc.killed) proc.kill();
  };

  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (!child || child.killed) {
        reject(new Error(`MCP server "${serverName}" is not running.`));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method, params = {}) => {
    if (!child || child.killed) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const connect = async () => {
    child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        entry.resolve(msg.result);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderrLines.push(chunk.trim()));
    child.on("error", (err) => rejectAllPending(`MCP spawn error: ${err.message}`));
    child.on("exit", (code, sig) =>
      rejectAllPending(`MCP server "${serverName}" exited (code=${code}, signal=${sig})`),
    );

    try {
      const init = await request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "build-your-agent-p04", version: "0.1.0" },
      });
      serverInfo = init?.serverInfo || { name: serverName };
      notify("notifications/initialized");

      const listed = await request("tools/list");
      tools = (listed?.tools || []).map((t) => ({
        fullName: `mcp__${serverName}__${t.name}`,
        serverName,
        rawName: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || { type: "object", properties: {} },
        annotations: t.annotations || {},
      }));
      return { serverInfo, tools };
    } catch (error) {
      close();
      throw error;
    }
  };

  const callTool = async (rawName, toolArgs = {}) => {
    const result = await request("tools/call", { name: rawName, arguments: toolArgs });
    const text = (result?.content || [])
      .map((item) => (item.type === "text" ? item.text : JSON.stringify(item)))
      .join("\n");
    return result?.isError ? `MCP Tool Error: ${text}` : text || "(empty mcp result)";
  };

  return {
    serverName,
    connect,
    request,
    callTool,
    close,
    getTools: () => tools,
    getServerInfo: () => serverInfo,
    getStderr: () => stderrLines.join("\n"),
  };
}

export async function agentLoop(messages, { mcpClients = [], confirm } = {}) {
  const mcpRegistry = new Map();
  const dynamicTools = [];
  for (const client of mcpClients) {
    for (const desc of client.getTools()) {
      mcpRegistry.set(desc.fullName, { client, desc });
      dynamicTools.push(
        tool(desc.fullName, `[MCP:${desc.serverName}] ${desc.description}`, desc.inputSchema),
      );
    }
  }
  const allTools = [...BUILTIN_TOOLS, ...dynamicTools];

  while (true) {
    const { message } = await callLlm(messages, { system: SYSTEM, tools: allTools });
    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const name = call.function.name;
      const parsed = safeParseArgs(call.function.arguments);
      let output;

      if (!parsed.ok) {
        output = parsed.error;
      } else if (BUILTIN_HANDLERS[name]) {
        output = BUILTIN_HANDLERS[name](parsed.value);
      } else if (mcpRegistry.has(name)) {
        const { client, desc } = mcpRegistry.get(name);
        try {
          if (desc.annotations?.destructiveHint) {
            const answer = await confirm?.(
              `允许执行高危 MCP 工具 ${name}(${JSON.stringify(parsed.value)})? [y/N] `,
            );
            output = /^y(es)?$/i.test(String(answer || "").trim())
              ? await client.callTool(desc.rawName, parsed.value)
              : `Permission blocked: ${name} has destructiveHint=true.`;
          } else {
            output = await client.callTool(desc.rawName, parsed.value);
          }
        } catch (error) {
          output = `MCP Call Error: ${error.message}`;
        }
      } else {
        output = `Unknown tool: ${name}`;
      }

      colorLog("cyan", `> ${name}: ${String(output).slice(0, 140)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  const sepIdx = process.argv.indexOf("--");
  const customCmd = sepIdx !== -1 ? process.argv.slice(sepIdx + 1) : [];
  const demoServerPath = fileURLToPath(new URL("./p04-mcp-demo-server.js", import.meta.url));
  const [serverName, command, args] = customCmd.length
    ? ["custom", customCmd[0], customCmd.slice(1)]
    : ["demo", process.execPath, [demoServerPath]];

  const client = createStdioMcpClient(serverName, command, args);
  const { serverInfo, tools } = await client.connect();
  colorLog(
    "green",
    `[mcp-stdio] connected ${serverInfo.name}: ${tools.map((t) => t.fullName).join(", ")}`,
  );

  try {
    await runChatCli({
      promptLabel: "p04 >> ",
      onPrompt: ({ messages, ask }) => agentLoop(messages, { mcpClients: [client], confirm: ask }),
    });
  } finally {
    client.close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
