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
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const MAIN_TOOLS = [
  makeTool("delegate", "Send a subtask to a subagent with a clean context.", {
    type: "object",
    properties: {
      task: { type: "string" },
      agent: { type: "string" },
    },
    required: ["task", "agent"],
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

async function runSubagent({ agentName, task, mockResponse }) {
  const messages = [{ role: "user", content: task }];

  const choice = await callChatModel({
    system: `You are subagent ${agentName}. Return only the finished result for your task.`,
    messages,
    mockResponse,
  });

  return {
    agentName,
    task,
    messages,
    result: assistantText(choice),
  };
}

async function agentLoop({
  prompt,
  workspaceDir,
  mockMainResponse,
  mockSubagentResponse,
}) {
  const messages = [{ role: "user", content: prompt }];
  const subagentRuns = [];

  const handlers = {
    delegate: async ({ task, agent }) => {
      const run = await runSubagent({
        agentName: agent,
        task,
        mockResponse: mockSubagentResponse,
      });
      subagentRuns.push(run);
      return JSON.stringify({
        agent: run.agentName,
        task: run.task,
        result: run.result,
      });
    },
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  while (true) {
    const choice = await callChatModel({
      system: [
        "You are the lead coding agent.",
        "Break larger tasks into subtasks and delegate when helpful.",
        `Your workspace is ${workspaceDir}.`,
      ].join("\n"),
      messages,
      tools: MAIN_TOOLS,
      mockResponse: mockMainResponse,
    });

    appendAssistantChoice(messages, choice);

    if (choice.finish_reason !== "tool_calls") {
      return {
        messages,
        subagentRuns,
        text: assistantText(choice),
      };
    }

    for (const toolCall of choice.message.tool_calls || []) {
      const args = parseToolArgs(toolCall);
      const handler = handlers[toolCall.function.name];
      const result = handler ? await handler(args) : `Unknown tool: ${toolCall.function.name}`;
      messages.push(toolResultMessage(toolCall.id, result));
    }
  }
}

function createMockMainModel() {
  return ({ messages }) => {
    const toolMessages = messages.filter((message) => message.role === "tool");

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("delegate", {
          agent: "researcher",
          task: "Write two short lines for the intro.",
        }),
        makeToolCall("delegate", {
          agent: "researcher",
          task: "Write two short lines for the summary.",
        }),
      ]);
    }

    if (toolMessages.length === 2) {
      const intro = JSON.parse(toolMessages[0].content).result;
      const summary = JSON.parse(toolMessages[1].content).result;

      return makeToolChoice([
        makeToolCall("write_file", {
          path: "note.md",
          content: `# Demo Note\n\n## Intro\n${intro}\n\n## Summary\n${summary}\n`,
        }),
      ]);
    }

    return makeTextChoice("Done. I delegated the small parts and kept the main context clean.");
  };
}

function createMockSubagentModel() {
  return ({ messages }) => {
    const task = String(messages[messages.length - 1].content || "");

    if (task.includes("intro")) {
      return makeTextChoice("- Agent loop is the core.\n- Tools give the model hands.");
    }

    return makeTextChoice("- Subagents keep context clean.\n- The main agent only keeps the result.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s04");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));

  const result = await agentLoop({
    prompt: "Write a short note with intro and summary.",
    workspaceDir,
    mockMainResponse: createMockMainModel(),
    mockSubagentResponse: createMockSubagentModel(),
  });

  const notePath = path.join(workspaceDir, "note.md");
  assert(fs.existsSync(notePath), "s04 self-test failed: note.md was not created.");
  assert(
    result.subagentRuns.length === 2,
    "s04 self-test failed: expected two subagent runs.",
  );
  assert(
    result.subagentRuns.every((run) => run.messages.length === 1),
    "s04 self-test failed: subagent context is not isolated.",
  );
  assert(
    result.text.includes("delegated"),
    "s04 self-test failed: final answer is missing.",
  );

  console.log("[s04] self-test passed");
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
      .trim() || "Write a short note with intro and summary.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s04-live"),
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
