const fs = require("fs");
const path = require("path");
const {
  appendAssistantChoice,
  assistantText,
  assert,
  callChatModel,
  cleanRuntime,
  compactConversation,
  ensureDir,
  loadEnv,
  makeTextChoice,
  makeTool,
  makeToolCall,
  makeToolChoice,
  parseToolArgs,
  readText,
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("write_file", "Write one text file.", {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  }),
  makeTool("read_file", "Read one text file.", {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  }),
];

async function agentLoop({ prompt, workspaceDir, mockResponse }) {
  let messages = [{ role: "user", content: prompt }];
  let memorySummary = "";
  let compactionCount = 0;

  const handlers = {
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
    read_file: ({ path: filePath }) => readText(safeJoin(workspaceDir, filePath)),
  };

  while (true) {
    const system = [
      "You are a coding agent.",
      `Workspace: ${workspaceDir}`,
      memorySummary ? `Previous summary:\n${memorySummary}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

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
        memorySummary,
        compactionCount,
        text: assistantText(choice),
      };
    }

    for (const toolCall of choice.message.tool_calls || []) {
      const args = parseToolArgs(toolCall);
      const handler = handlers[toolCall.function.name];
      const result = handler ? handler(args) : `Unknown tool: ${toolCall.function.name}`;
      messages.push(toolResultMessage(toolCall.id, result));
    }

    if (messages.length > 6) {
      const compacted = compactConversation(messages, 4);
      memorySummary = [memorySummary, compacted.summary].filter(Boolean).join("\n");
      messages = compacted.recentMessages;
      compactionCount += 1;
    }
  }
}

function createMockModel() {
  let round = 0;

  return () => {
    round += 1;

    if (round === 1) {
      return makeToolChoice([
        makeToolCall("write_file", { path: "a.txt", content: "alpha\n" }),
      ]);
    }

    if (round === 2) {
      return makeToolChoice([
        makeToolCall("write_file", { path: "b.txt", content: "beta\n" }),
      ]);
    }

    if (round === 3) {
      return makeToolChoice([
        makeToolCall("read_file", { path: "a.txt" }),
      ]);
    }

    if (round === 4) {
      return makeToolChoice([
        makeToolCall("read_file", { path: "b.txt" }),
      ]);
    }

    return makeTextChoice("Done. I compacted older context and kept moving.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s06");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));

  const result = await agentLoop({
    prompt: "Create two files and summarize what you did.",
    workspaceDir,
    mockResponse: createMockModel(),
  });

  assert(fs.existsSync(path.join(workspaceDir, "a.txt")), "s06 self-test failed: a.txt missing.");
  assert(fs.existsSync(path.join(workspaceDir, "b.txt")), "s06 self-test failed: b.txt missing.");
  assert(
    result.compactionCount >= 1,
    "s06 self-test failed: context compaction never happened.",
  );
  assert(
    result.memorySummary.includes("user ->") || result.memorySummary.includes("tool ->"),
    "s06 self-test failed: memory summary was not built.",
  );

  console.log("[s06] self-test passed");
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
      .trim() || "Create two files and summarize what you did.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s06-live"),
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
