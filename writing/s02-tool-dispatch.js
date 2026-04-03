const fs = require("fs");
const path = require("path");
const {
  appendAssistantChoice,
  assistantText,
  assert,
  callChatModel,
  cleanRuntime,
  ensureDir,
  listFiles,
  loadEnv,
  makeTextChoice,
  makeTool,
  makeToolCall,
  makeToolChoice,
  parseToolArgs,
  readText,
  replaceTextInFile,
  runShell,
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("bash", "Run one shell command inside the workspace.", {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
  }),
  makeTool("read_file", "Read one text file.", {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  }),
  makeTool("write_file", "Write one text file.", {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  }),
  makeTool("edit_file", "Replace one exact string in a file.", {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  }),
];

function createToolHandlers(workspaceDir) {
  return {
    bash: ({ command }) => runShell(command, { cwd: workspaceDir }),
    read_file: ({ path: filePath }) => readText(safeJoin(workspaceDir, filePath)),
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
    edit_file: ({ path: filePath, old_text, new_text }) => {
      replaceTextInFile(safeJoin(workspaceDir, filePath), old_text, new_text);
      return `Edited ${filePath}`;
    },
  };
}

async function agentLoop({ prompt, workspaceDir, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const handlers = createToolHandlers(workspaceDir);

  while (true) {
    const choice = await callChatModel({
      system: `You are a coding agent working in ${workspaceDir}. Use tools instead of guessing file state.`,
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
  }
}

function createMockModel() {
  return ({ messages }) => {
    const toolMessages = messages.filter((message) => message.role === "tool");

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "notes/plan.txt",
          content: "draft 1\n",
        }),
      ]);
    }

    if (toolMessages.length === 1) {
      return makeToolChoice([
        makeToolCall("edit_file", {
          path: "notes/plan.txt",
          old_text: "draft 1",
          new_text: "draft 2",
        }),
      ]);
    }

    if (toolMessages.length === 2) {
      return makeToolChoice([
        makeToolCall("read_file", {
          path: "notes/plan.txt",
        }),
      ]);
    }

    return makeTextChoice("Done. The plan file is ready and readable.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s02");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));

  const result = await agentLoop({
    prompt: "Write a plan file and read it back.",
    workspaceDir,
    mockResponse: createMockModel(),
  });

  const filePath = path.join(workspaceDir, "notes", "plan.txt");
  assert(fs.existsSync(filePath), "s02 self-test failed: plan file was not created.");
  assert(
    readText(filePath).includes("draft 2"),
    "s02 self-test failed: edit_file did not change the file.",
  );
  assert(
    listFiles(workspaceDir).includes(path.join("notes", "plan.txt")),
    "s02 self-test failed: listFiles helper did not see the file.",
  );
  assert(
    result.text.includes("Done"),
    "s02 self-test failed: final answer is missing.",
  );

  console.log("[s02] self-test passed");
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
      .trim() || "Write notes/hello.txt and then read it back.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s02-live"),
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
