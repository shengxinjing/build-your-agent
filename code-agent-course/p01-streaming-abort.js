import { createInterface } from "node:readline/promises";
import {
  llmProvider,
  llmProviderConfigs,
  runBash,
  readFile,
  writeFile,
  tool,
  isMainModule,
  colorLog,
} from "./helper.js";

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Keep answers concise.`;

const tools = [
  tool("bash", "Run a shell command.", {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  }),
  tool("read_file", "Read a file (optional line limit).", {
    type: "object",
    properties: { path: { type: "string" }, limit: { type: "integer" } },
    required: ["path"],
  }),
  tool("write_file", "Write content to a file.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  }),
];

const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
};

function isAbortError(error, signal) {
  return Boolean(signal?.aborted || error?.name === "AbortError");
}

function safeParseArgs(raw) {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch (error) {
    return { ok: false, error: `Error: invalid JSON arguments - ${error.message}` };
  }
}

function mergeToolCallDelta(toolCalls, delta) {
  const index = delta.index ?? 0;
  const current =
    toolCalls[index] ||
    (toolCalls[index] = {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    });
  if (delta.id && delta.id !== current.id) current.id += delta.id;
  if (delta.type) current.type = delta.type;
  if (delta.function?.name) current.function.name += delta.function.name;
  if (delta.function?.arguments) current.function.arguments += delta.function.arguments;
}

function parseSseLine(rawLine, state, { onToken, onReasoning }) {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return;

  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return;
  }

  const choice = chunk.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  const delta = choice.delta || {};

  if (delta.reasoning_content) {
    state.reasoning += delta.reasoning_content;
    onReasoning?.(delta.reasoning_content);
  }
  if (delta.content) {
    state.content += delta.content;
    onToken?.(delta.content);
  }
  for (const tc of delta.tool_calls || []) {
    mergeToolCallDelta(state.toolCalls, tc);
  }
}

export async function streamLlm(
  messages,
  { system, tools: toolDefs, model, provider = llmProvider, signal, onToken, onReasoning } = {},
) {
  const config = llmProviderConfigs[provider] || llmProviderConfigs.openai;
  if (!config.token) throw new Error("Missing API token.");

  const body = {
    model: model || config.model,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    stream: true,
  };
  if (toolDefs?.length) {
    body.tools = toolDefs;
    body.tool_choice = "auto";
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { content: "", reasoning: "", finishReason: null, toolCalls: [] };
  let buffer = "";
  let finished = false;

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        parseSseLine(line, state, { onToken, onReasoning });
        if (signal?.aborted) break;
      }
    }
    if (!signal?.aborted) {
      buffer += decoder.decode();
      for (const line of buffer.split(/\r?\n/)) parseSseLine(line, state, { onToken, onReasoning });
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
  }
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  const message = { role: "assistant", content: state.content || null };
  if (state.reasoning) message.reasoning_content = state.reasoning;
  const compactCalls = state.toolCalls.filter(Boolean);
  if (compactCalls.length) message.tool_calls = compactCalls;
  return { message, finish_reason: state.finishReason || "stop" };
}

export function repairOrphanToolCalls(messages) {
  let repaired = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;
    const answered = new Set();
    let end = i + 1;
    while (end < messages.length && messages[end].role === "tool") {
      answered.add(messages[end].tool_call_id);
      end += 1;
    }
    const missing = msg.tool_calls
      .filter((call) => call.id && !answered.has(call.id))
      .map((call) => ({
        role: "tool",
        tool_call_id: call.id,
        content: "[Aborted before tool execution]",
      }));
    if (missing.length) {
      messages.splice(end, 0, ...missing);
      repaired += missing.length;
      i = end + missing.length - 1;
    }
  }
  return repaired;
}

function finalizeAbortedTurn(messages, partialContent) {
  repairOrphanToolCalls(messages);
  if (messages[messages.length - 1]?.role === "user") {
    messages.push({
      role: "assistant",
      content: partialContent ? `${partialContent}\n[Aborted by user]` : "[Aborted by user]",
    });
  }
  return { content: partialContent, aborted: true };
}

export async function agentLoop(
  messages,
  { signal, onToken, onReasoning, getSteering, onTool } = {},
) {
  repairOrphanToolCalls(messages);
  let lastContent = "";

  while (true) {
    if (signal?.aborted) return finalizeAbortedTurn(messages, lastContent);

    let partial = "";
    let choice;
    try {
      choice = await streamLlm(messages, {
        system: SYSTEM,
        tools,
        signal,
        onReasoning,
        onToken: (text) => {
          partial += text;
          onToken?.(text);
        },
      });
    } catch (error) {
      if (isAbortError(error, signal)) {
        return finalizeAbortedTurn(messages, partial || lastContent);
      }
      throw error;
    }

    const { message } = choice;
    lastContent = message.content || "";

    if (!message.tool_calls?.length) {
      const steering = getSteering?.();
      if (steering) {
        messages.push({ role: "assistant", content: lastContent });
        messages.push({ role: "user", content: `[Steering] ${steering}` });
        continue;
      }
      return { content: lastContent, aborted: false };
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      if (signal?.aborted) return finalizeAbortedTurn(messages, lastContent);
      const parsed = safeParseArgs(call.function.arguments);
      let output;
      if (!parsed.ok) {
        output = parsed.error;
      } else {
        const handler = handlers[call.function.name];
        onTool?.(call.function.name, parsed.value);
        output = handler ? handler(parsed.value) : `Unknown tool: ${call.function.name}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }

    const steering = getSteering?.();
    if (steering) {
      messages.push({ role: "user", content: `[Steering] ${steering}` });
    }
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const messages = [];
  const steeringQueue = [];
  let activeController = null;

  const onSigint = () => {
    if (activeController) {
      if (!activeController.signal.aborted) {
        activeController.abort();
        console.log("");
        colorLog("yellow", "[aborted] 已中断本轮流式生成，历史已修复，可继续输入。");
      }
      return;
    }
    rl.close();
    process.exit(0);
  };
  rl.on("SIGINT", onSigint);
  process.on("SIGINT", onSigint);

  console.log("p01 Streaming & Abort 演示：生成中按 Ctrl+C 中断，支持 /steer <指令>，输入 q 退出。\n");
  try {
    while (true) {
      let prompt;
      try {
        prompt = (await rl.question("p01 >> ")).trim();
      } catch {
        break;
      }
      if (!prompt) continue;
      if (prompt === "q" || prompt === "exit") break;
      if (prompt.startsWith("/steer ")) {
        const note = prompt.slice(7).trim();
        if (note) {
          steeringQueue.push(note);
          colorLog("yellow", `[steer] 已预置纠偏消息，将在下轮工具执行后注入: ${note}\n`);
        }
        continue;
      }

      messages.push({ role: "user", content: prompt });
      activeController = new AbortController();
      let printedReasoning = false;
      const result = await agentLoop(messages, {
        signal: activeController.signal,
        getSteering: () => steeringQueue.shift() || null,
        onReasoning: (text) => {
          if (!printedReasoning) {
            process.stdout.write("\x1b[2m[thinking] ");
            printedReasoning = true;
          }
          process.stdout.write(text);
        },
        onToken: (text) => {
          if (printedReasoning) {
            process.stdout.write("\x1b[0m\n");
            printedReasoning = false;
          }
          process.stdout.write(text);
        },
        onTool: (name) => colorLog("cyan", `\n[tool] ${name}`),
      });
      if (printedReasoning) process.stdout.write("\x1b[0m");
      activeController = null;
      console.log("\n");
      if (!result.aborted) {
        messages.push({ role: "assistant", content: result.content });
      }
    }
  } finally {
    rl.off("SIGINT", onSigint);
    process.off("SIGINT", onSigint);
    rl.close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
