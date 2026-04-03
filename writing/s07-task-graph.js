const fs = require("fs");
const path = require("path");
const {
  TaskBoard,
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
  toolResultMessage,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("task_create", "Create one persistent task.", {
    type: "object",
    properties: {
      title: { type: "string" },
      blocked_by: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title"],
  }),
  makeTool("task_update", "Update one task status.", {
    type: "object",
    properties: {
      task_id: { type: "string" },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed"],
      },
    },
    required: ["task_id", "status"],
  }),
  makeTool("task_list", "List all tasks.", {
    type: "object",
    properties: {},
  }),
];

async function agentLoop({ prompt, boardDir, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const board = new TaskBoard(boardDir);

  const handlers = {
    task_create: ({ title, blocked_by }) => {
      const task = board.create(title, {
        blockedBy: blocked_by || [],
      });
      return JSON.stringify(task);
    },
    task_update: ({ task_id, status }) => JSON.stringify(board.update(task_id, { status })),
    task_list: () => board.render(),
  };

  while (true) {
    const choice = await callChatModel({
      system: [
        "You are a coding agent with a persistent task graph.",
        "Use task_create to persist tasks to disk.",
        "Use blocked_by to model dependencies.",
      ].join("\n"),
      messages,
      tools: TOOLS,
      mockResponse,
    });

    appendAssistantChoice(messages, choice);

    if (choice.finish_reason !== "tool_calls") {
      return {
        messages,
        board,
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
        makeToolCall("task_create", { title: "Parse input" }),
        makeToolCall("task_create", {
          title: "Transform data",
          blocked_by: ["task-001"],
        }),
        makeToolCall("task_create", {
          title: "Run tests",
          blocked_by: ["task-002"],
        }),
      ]);
    }

    if (toolMessages.length === 3) {
      return makeToolChoice([
        makeToolCall("task_list", {}),
      ]);
    }

    if (toolMessages.length === 4) {
      return makeToolChoice([
        makeToolCall("task_update", {
          task_id: "task-001",
          status: "completed",
        }),
      ]);
    }

    if (toolMessages.length === 5) {
      return makeToolChoice([
        makeToolCall("task_list", {}),
      ]);
    }

    return makeTextChoice("Done. The task graph is on disk, and dependencies can unlock.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s07");
  const boardDir = ensureDir(path.join(runtimeDir, "tasks"));

  const result = await agentLoop({
    prompt: "Create a small dependency graph.",
    boardDir,
    mockResponse: createMockModel(),
  });

  const board = result.board;
  const tasks = board.list();

  assert(tasks.length === 3, "s07 self-test failed: expected three persisted tasks.");
  assert(
    fs.existsSync(path.join(boardDir, "task-001.json")),
    "s07 self-test failed: task file was not written to disk.",
  );
  assert(
    board.get("task-002").blockedBy.length === 0,
    "s07 self-test failed: dependent task did not unlock after completion.",
  );

  console.log("[s07] self-test passed");
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
      .trim() || "Create a small dependency graph.";

  const boardDir = ensureDir(
    process.env.AGENT_TASK_DIR || path.join(__dirname, ".runtime", "s07-live", "tasks"),
  );

  const result = await agentLoop({
    prompt,
    boardDir,
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
