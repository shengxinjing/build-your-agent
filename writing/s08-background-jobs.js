const fs = require("fs");
const path = require("path");
const {
  BackgroundJobs,
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
  safeJoin,
  sleep,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("start_background_job", "Start one shell command in the background.", {
    type: "object",
    properties: {
      name: { type: "string" },
      command: { type: "string" },
    },
    required: ["name", "command"],
  }),
  makeTool("write_file", "Write one text file.", {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  }),
];

async function agentLoop({ prompt, workspaceDir, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const jobs = new BackgroundJobs();

  const handlers = {
    start_background_job: ({ name, command }) => {
      const job = jobs.start(name, command, { cwd: workspaceDir });
      return JSON.stringify({ id: job.id, status: job.status, name: job.name });
    },
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  while (true) {
    const notifications = jobs.notifications();
    for (const job of notifications) {
      messages.push({
        role: "user",
        content: `Background job ${job.name} finished with status ${job.status}. Output: ${job.stdout.trim()}`,
      });
    }

    const choice = await callChatModel({
      system: [
        "You are a coding agent.",
        "You can start slow work in the background and continue doing other tasks.",
        `Workspace: ${workspaceDir}`,
      ].join("\n"),
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
      const handler = handlers[toolCall.function.name];
      const result = handler ? handler(args) : `Unknown tool: ${toolCall.function.name}`;
      messages.push(toolResultMessage(toolCall.id, result));
    }

    await sleep(120);
  }
}

function createMockModel(command) {
  return ({ messages }) => {
    const toolMessages = messages.filter((message) => message.role === "tool");
    const sawBackgroundNotice = messages.some(
      (message) =>
        message.role === "user" &&
        String(message.content).includes("Background job slow-tests finished"),
    );

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("start_background_job", {
          name: "slow-tests",
          command,
        }),
      ]);
    }

    if (toolMessages.length === 1 && !sawBackgroundNotice) {
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "main-work.txt",
          content: "The agent kept working while tests ran.\n",
        }),
      ]);
    }

    if (sawBackgroundNotice) {
      return makeTextChoice("Done. I kept working and then handled the background result.");
    }

    return makeTextChoice("Waiting for the background job to finish.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s08");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));
  const command = `${process.execPath} -e "setTimeout(() => console.log('tests passed'), 180)"`;

  const result = await agentLoop({
    prompt: "Start a slow task and keep working.",
    workspaceDir,
    mockResponse: createMockModel(command),
  });

  assert(
    fs.existsSync(path.join(workspaceDir, "main-work.txt")),
    "s08 self-test failed: foreground work file is missing.",
  );
  assert(
    result.messages.some(
      (message) =>
        message.role === "user" &&
        String(message.content).includes("Background job slow-tests finished"),
    ),
    "s08 self-test failed: completion notice was never injected.",
  );
  assert(
    result.text.includes("background result"),
    "s08 self-test failed: final answer is missing.",
  );

  console.log("[s08] self-test passed");
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
      .trim() || "Start a slow task and keep working.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s08-live"),
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
