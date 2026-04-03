const path = require("path");
const {
  assert,
  assistantText,
  callChatModel,
  getProviderConfig,
  loadEnv,
  makeTextChoice,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

function getPrompt() {
  const args = process.argv.slice(2).filter((item) => item !== "--self-test");
  return args.join(" ").trim() || "Please explain what an agent loop is.";
}

async function run(prompt, options = {}) {
  const config = getProviderConfig(options.provider);

  const choice = await callChatModel({
    provider: options.provider,
    messages: [{ role: "user", content: prompt }],
    mockResponse() {
      return makeTextChoice("Agent loop is: ask, act, feed result back, repeat.");
    },
  });

  return {
    config,
    text: assistantText(choice),
  };
}

async function selfTest() {
  const result = await run("self test");
  assert(
    result.text.includes("ask") || result.text.includes("Agent loop"),
    "s00 self-test failed: mock reply is missing.",
  );
  console.log("[s00] self-test passed");
  console.log(result.text);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  const prompt = getPrompt();
  const result = await run(prompt);

  console.log(`provider: ${result.config.provider}`);
  console.log(`base_url: ${result.config.baseUrl}`);
  console.log(`model: ${result.config.model}`);
  console.log("");
  console.log(result.text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
