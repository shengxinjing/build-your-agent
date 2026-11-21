import {
  callLlm,
  runBash,
  runChatCli,
  isMainModule,
} from "./helper.js";

const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

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
