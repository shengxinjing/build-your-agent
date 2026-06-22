import { callLlm, runBash, runChatCli, isMainModule } from "./helper.js";

// s01：在 s00 基础上加“工具调用”，形成最小 agent loop。
// s01: add tool calling on top of s00 to form a minimal agent loop.

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

// 一个工具 = 给模型看的 schema（这里只放一个 bash）。
// A tool = the schema shown to the model (just bash here).
const bashTool = [{
  type: "function",
  function: {
    name: "bash",
    description: "Run a shell command.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
}];

// agent loop：问模型 → 有 tool_calls 就执行并把结果回灌 → 没有就返回答案。
// The agent loop: ask the model → run any tool_calls and feed results back → else return the answer.
export async function agentLoop(messages) {
  while (true) {
    const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
    const { message } = choice;

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const { command } = JSON.parse(call.function.arguments || "{}");
      const output =
        call.function.name === "bash"
          ? runBash(command)
          : `Unknown tool: ${call.function.name}`;

      console.log(`$ ${command}\n${output.slice(0, 500)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
}

async function main() {
  await runChatCli({
    promptLabel: "s01 >> ",
    onPrompt: ({ messages }) => agentLoop(messages),
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
