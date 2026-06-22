import { callLlm, runChatCli, isMainModule } from "./helper.js";

// s00：最小的“调用大模型”示例 —— 一个 HTTP 请求换一句回答。
// s00: the smallest "call an LLM" example — one HTTP request, one reply.

// 问模型，返回纯文本回答。
// Ask the model and return its plain-text reply.
export async function ask(messages) {
  const choice = await callLlm(messages);
  return choice.message.content || "";
}

async function main() {
  // runChatCli 只管命令行输入输出；真正的 LLM 调用放在 onPrompt 里。
  await runChatCli({
    promptLabel: "prompt >> ",
    onPrompt: ({ messages }) => ask(messages),
  });
}

// 只有直接运行才启动命令行；被测试 import 时不会启动。
// Only start the CLI when run directly; importing (e.g. in tests) won't start it.
if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
