import {
  callLlm,
  runBash,
  readFile,
  writeFile,
  editFile,
  glob,
  tool,
  runChatCli,
  isMainModule,
} from "./helper.js";

// s02：把工具从“写死在 loop 里”改成“挂进分发表”——新增工具不改 loop 的形状。
// s02: move tools out of the loop into a dispatch table — adding a tool never reshapes the loop.

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Act, don't explain.`;

// tools：给模型看的工具描述（schema）。
// tools: the tool schemas shown to the model.
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
  tool("edit_file", "Replace exact text in a file once.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  }),
  tool("glob", "Find files by glob pattern.", {
    type: "object",
    properties: { pattern: { type: "string" } },
    required: ["pattern"],
  }),
];

// handlers：工具名 → 实际执行函数（实现都在 helper 里）。新增工具 = 加一项，loop 不变。
// handlers: tool name → the function that runs it (implementations live in helper).
// Adding a tool = one more entry here; the loop never changes.
const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
};

// agent loop：和 s01 几乎一样，唯一区别是工具执行改成查 handlers 表。
// The agent loop: almost identical to s01; only tool execution now looks up the handlers table.
export async function agentLoop(messages) {
  while (true) {
    const choice = await callLlm(messages, { system: SYSTEM, tools });
    const { message } = choice;

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const handler = handlers[call.function.name];
      const args = JSON.parse(call.function.arguments || "{}");
      const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;

      console.log(`> ${call.function.name}: ${String(output).slice(0, 200)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s02 >> ",
    onPrompt: ({ messages }) => agentLoop(messages),
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
