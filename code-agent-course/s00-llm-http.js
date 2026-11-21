import {
  callLlm,
  runChatCli,
  isMainModule,
} from "./helper.js";

export async function ask(messages) {
  const choice = await callLlm(messages);
  return choice.message.content || "";
}

async function main() {
  await runChatCli({
    promptLabel: "prompt >> ",
    onPrompt: ({ messages }) => ask(messages),
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
