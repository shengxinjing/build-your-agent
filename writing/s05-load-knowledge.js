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
  readText,
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("load_knowledge", "Load one knowledge note by topic name.", {
    type: "object",
    properties: {
      topic: { type: "string" },
    },
    required: ["topic"],
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

function knowledgePath(knowledgeDir, topic) {
  return safeJoin(knowledgeDir, `${topic}.md`);
}

async function agentLoop({ prompt, workspaceDir, knowledgeDir, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];

  const handlers = {
    load_knowledge: ({ topic }) => {
      return readText(knowledgePath(knowledgeDir, topic));
    },
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  while (true) {
    const choice = await callChatModel({
      system: [
        "You are a coding agent.",
        "Do not preload all knowledge.",
        "If the task needs a document, call load_knowledge first.",
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
  }
}

function createMockModel() {
  return ({ messages }) => {
    const toolMessages = messages.filter((message) => message.role === "tool");

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("load_knowledge", {
          topic: "release-rule",
        }),
      ]);
    }

    if (toolMessages.length === 1) {
      const knowledge = toolMessages[0].content;
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "release-checklist.md",
          content: `# Release Checklist\n\n${knowledge}\n`,
        }),
      ]);
    }

    return makeTextChoice("Done. I loaded the rule only when I needed it.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s05");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));
  const knowledgeDir = ensureDir(path.join(runtimeDir, "knowledge"));

  writeText(
    path.join(knowledgeDir, "release-rule.md"),
    "- Run tests before release\n- Tag the version after green build\n",
  );

  const result = await agentLoop({
    prompt: "Read the release rule and write a checklist.",
    workspaceDir,
    knowledgeDir,
    mockResponse: createMockModel(),
  });

  const checklistPath = path.join(workspaceDir, "release-checklist.md");
  assert(
    fs.existsSync(checklistPath),
    "s05 self-test failed: checklist file was not created.",
  );
  assert(
    readText(checklistPath).includes("Run tests before release"),
    "s05 self-test failed: loaded knowledge did not reach the output file.",
  );
  assert(
    result.text.includes("loaded"),
    "s05 self-test failed: final answer is missing.",
  );

  console.log("[s05] self-test passed");
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
      .trim() || "Read the release rule and write a short checklist.";

  const baseDir = path.join(__dirname, ".runtime", "s05-live");
  const workspaceDir = ensureDir(process.env.AGENT_WORKDIR || path.join(baseDir, "workspace"));
  const knowledgeDir = ensureDir(path.join(baseDir, "knowledge"));

  if (!fs.existsSync(path.join(knowledgeDir, "release-rule.md"))) {
    writeText(
      path.join(knowledgeDir, "release-rule.md"),
      "- Run tests before release\n- Tag the version after green build\n",
    );
  }

  const result = await agentLoop({
    prompt,
    workspaceDir,
    knowledgeDir,
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
