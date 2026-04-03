const fs = require("fs");
const path = require("path");
const {
  appendAssistantChoice,
  assistantText,
  assert,
  callChatModel,
  cleanRuntime,
  ensureDir,
  loadEnv,
  makeTextChoice,
  makeTool,
  makeToolCall,
  makeToolChoice,
  parseToolArgs,
  runShell,
  toolResultMessage,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("bash", "Run one shell command inside the agent workspace.", {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
  }),
];

function createSystem(workspaceDir) {
  return [
    "You are a tiny coding agent.",
    `Your workspace is ${workspaceDir}.`,
    "Use the bash tool when action is needed.",
    "When the task is finished, answer with one short sentence.",
  ].join("\n");
}

async function agentLoop({ prompt, workspaceDir, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const system = createSystem(workspaceDir);

  while (true) {
    const choice = await callChatModel({
      system,
      messages,
      tools: TOOLS,
      mockResponse,
    });

    appendAssistantChoice(messages, choice);

    if (choice.finish_reason !== "tool_calls") {
      return {
        messages,
        text: assistantText(choice),
      };
    }

    for (const toolCall of choice.message.tool_calls || []) {
      const args = parseToolArgs(toolCall);
      const output = runShell(args.command, { cwd: workspaceDir });
      messages.push(toolResultMessage(toolCall.id, output));
    }
  }
}

function createMockModel() {
  return ({ messages }) => {
    const toolMessages = messages.filter((message) => message.role === "tool");

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("bash", {
          command: "printf 'hello from s01\\n' > hello.txt",
        }),
      ]);
    }

    return makeTextChoice("Done. I created hello.txt.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s01");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));

  const result = await agentLoop({
    prompt: "Create hello.txt with one line in it.",
    workspaceDir,
    mockResponse: createMockModel(),
  });

  const helloPath = path.join(workspaceDir, "hello.txt");
  assert(fs.existsSync(helloPath), "s01 self-test failed: hello.txt was not created.");
  assert(
    fs.readFileSync(helloPath, "utf8").includes("hello from s01"),
    "s01 self-test failed: hello.txt has wrong content.",
  );
  assert(
    result.text.includes("Done"),
    "s01 self-test failed: final answer is missing.",
  );

  console.log("[s01] self-test passed");
  console.log(result.text);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  const prompt =
    process.argv
      .slice(2)
      .filter((item) => item !== "--self-test")
      .join(" ")
      .trim() || "List the files in this workspace.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s01-live"),
  );

  const result = await agentLoop({
    prompt,
    workspaceDir,
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
