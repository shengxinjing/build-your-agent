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

class PlanBoard {
  constructor() {
    this.items = [];
  }

  update(items) {
    const inProgressCount = items.filter(
      (item) => item.status === "in_progress",
    ).length;

    if (inProgressCount > 1) {
      throw new Error("Only one plan item can be in_progress.");
    }

    this.items = items.map((item) => ({
      id: String(item.id),
      text: String(item.text),
      status: String(item.status),
    }));

    return this.render();
  }

  render() {
    return this.items
      .map((item) => `- [${item.status}] ${item.id} ${item.text}`)
      .join("\n");
  }
}

const TOOLS = [
  makeTool("update_plan", "Update the current task plan.", {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
            },
          },
          required: ["id", "text", "status"],
        },
      },
    },
    required: ["items"],
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
  const planBoard = new PlanBoard();

  const handlers = {
    update_plan: ({ items }) => planBoard.update(items),
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  while (true) {
    const choice = await callChatModel({
      system: [
        "You are a coding agent.",
        "For multi-step tasks, call update_plan before writing files.",
        `Your workspace is ${workspaceDir}.`,
      ].join("\n"),
      messages,
      tools: TOOLS,
      mockResponse,
    });

    appendAssistantChoice(messages, choice);

    if (choice.finish_reason !== "tool_calls") {
      return {
        messages,
        plan: planBoard.items,
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
        makeToolCall("update_plan", {
          items: [
            { id: "1", text: "列出执行步骤", status: "in_progress" },
            { id: "2", text: "写入 outline.md", status: "pending" },
            { id: "3", text: "收尾回答", status: "pending" },
          ],
        }),
      ]);
    }

    if (toolMessages.length === 1) {
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "outline.md",
          content: "# Outline\n\n1. 先计划\n2. 再写文件\n",
        }),
      ]);
    }

    if (toolMessages.length === 2) {
      return makeToolChoice([
        makeToolCall("update_plan", {
          items: [
            { id: "1", text: "列出执行步骤", status: "completed" },
            { id: "2", text: "写入 outline.md", status: "completed" },
            { id: "3", text: "收尾回答", status: "completed" },
          ],
        }),
      ]);
    }

    return makeTextChoice("Done. I planned the work first, then wrote outline.md.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s03");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));

  const result = await agentLoop({
    prompt: "Make a plan and save it to outline.md",
    workspaceDir,
    mockResponse: createMockModel(),
  });

  const outlinePath = path.join(workspaceDir, "outline.md");
  assert(fs.existsSync(outlinePath), "s03 self-test failed: outline.md was not created.");
  assert(
    result.plan.every((item) => item.status === "completed"),
    "s03 self-test failed: plan items are not completed.",
  );
  assert(
    result.text.includes("planned"),
    "s03 self-test failed: final answer is missing.",
  );

  console.log("[s03] self-test passed");
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
      .trim() || "Create a simple outline and keep a plan.";

  const workspaceDir = ensureDir(
    process.env.AGENT_WORKDIR || path.join(__dirname, ".runtime", "s03-live"),
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
