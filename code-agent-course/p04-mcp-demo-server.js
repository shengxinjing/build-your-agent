import { createInterface } from "node:readline";

const DOCS = [
  { topic: "agent-loop", text: "An agent loop repeats callLlm -> execute tools -> append results until no tool_calls remain." },
  { topic: "mcp-stdio", text: "MCP stdio transport exchanges newline-delimited JSON-RPC 2.0 messages on stdin/stdout; logs must go to stderr." },
  { topic: "prompt-cache", text: "Keep system prompt prefix and tool schemas stable across turns to maximize cached_tokens." },
];

const TOOLS = [
  {
    name: "docs_search",
    description: "Search local course docs by keyword.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "calc_stats",
    description: "Compute count, sum, avg, min, max for an array of numbers.",
    inputSchema: {
      type: "object",
      properties: { numbers: { type: "array", items: { type: "number" } } },
      required: ["numbers"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "deploy_trigger",
    description: "Trigger a production deployment for a named service.",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
    annotations: { destructiveHint: true },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handleToolCall(name, args = {}) {
  if (name === "docs_search") {
    const q = String(args.query || "").toLowerCase();
    const hits = DOCS.filter((d) => d.topic.includes(q) || d.text.toLowerCase().includes(q));
    const text = hits.length ? hits.map((h) => `[${h.topic}] ${h.text}`).join("\n") : `No docs matched "${args.query}".`;
    return { content: [{ type: "text", text }], isError: false };
  }
  if (name === "calc_stats") {
    const nums = Array.isArray(args.numbers) ? args.numbers.map(Number).filter(Number.isFinite) : [];
    if (!nums.length) {
      return { content: [{ type: "text", text: "Provide at least one finite number." }], isError: true };
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    const stats = {
      count: nums.length,
      sum,
      avg: Number((sum / nums.length).toFixed(4)),
      min: Math.min(...nums),
      max: Math.max(...nums),
    };
    return { content: [{ type: "text", text: JSON.stringify(stats) }], isError: false };
  }
  if (name === "deploy_trigger") {
    return { content: [{ type: "text", text: `Triggered deployment for ${args.service || "unknown"}.` }], isError: false };
  }
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

function handleMessage(msg) {
  if (msg.method === "notifications/initialized") {
    process.stderr.write("[demo-mcp-server] initialized\n");
    return;
  }
  if (msg.id === undefined) return;

  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "demo-mcp-server", version: "0.1.0" },
      },
    });
  }
  if (msg.method === "ping") {
    return send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
  if (msg.method === "tools/list") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  }
  if (msg.method === "tools/call") {
    const result = handleToolCall(msg.params?.name, msg.params?.arguments);
    return send({ jsonrpc: "2.0", id: msg.id, result });
  }
  send({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`[demo-mcp-server] parse error: ${error.message}\n`);
  }
});
