const fs = require("fs");
const path = require("path");
const {
  MailboxStore,
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
  randomId,
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("send_request", "Send one protocol request to a teammate.", {
    type: "object",
    properties: {
      to: { type: "string" },
      task_id: { type: "string" },
      body: { type: "string" },
    },
    required: ["to", "task_id", "body"],
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

function buildRequest({ to, taskId, body }) {
  return {
    kind: "request",
    request_id: randomId("req"),
    task_id: taskId,
    from: "lead",
    to,
    status: "open",
    body,
  };
}

function buildResponse(request, from, body) {
  return {
    kind: "response",
    request_id: request.request_id,
    task_id: request.task_id,
    from,
    to: request.from,
    status: "done",
    body,
  };
}

function validateProtocolMessage(message) {
  return (
    message &&
    typeof message.kind === "string" &&
    typeof message.request_id === "string" &&
    typeof message.task_id === "string" &&
    typeof message.from === "string" &&
    typeof message.to === "string" &&
    typeof message.status === "string" &&
    typeof message.body === "string"
  );
}

function teammateProtocolReply(message) {
  if (message.to === "researcher") {
    return "Use small tools and clear task boundaries.";
  }
  return "Use tests and protocol validation to catch drift early.";
}

async function agentLoop({ prompt, workspaceDir, mailboxRoot, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const mailbox = new MailboxStore(mailboxRoot);
  const processedIds = new Set();
  const leadSeenIds = new Set();

  const handlers = {
    send_request: ({ to, task_id, body }) => {
      const request = buildRequest({
        to,
        taskId: task_id,
        body,
      });
      mailbox.send(request);
      return JSON.stringify(request);
    },
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  function pumpTeammates() {
    for (const teammate of ["researcher", "reviewer"]) {
      for (const message of mailbox.inbox(teammate)) {
        if (processedIds.has(message.id)) {
          continue;
        }
        processedIds.add(message.id);
        if (!validateProtocolMessage(message) || message.kind !== "request") {
          continue;
        }
        mailbox.send(
          buildResponse(message, teammate, teammateProtocolReply(message)),
        );
      }
    }

    for (const reply of mailbox.inbox("lead")) {
      if (leadSeenIds.has(reply.id)) {
        continue;
      }
      leadSeenIds.add(reply.id);
      if (!validateProtocolMessage(reply)) {
        continue;
      }
      messages.push({
        role: "user",
        content: JSON.stringify(reply),
      });
    }
  }

  while (true) {
    pumpTeammates();

    const choice = await callChatModel({
      system: [
        "You are the lead agent.",
        "All teammate communication must use the request-response protocol.",
        "Do not accept malformed messages.",
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
    const responseMessages = messages.filter((message) =>
      String(message.content).includes('"kind":"response"'),
    );

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("send_request", {
          to: "researcher",
          task_id: "task-101",
          body: "Need architecture guidance.",
        }),
        makeToolCall("send_request", {
          to: "reviewer",
          task_id: "task-102",
          body: "Need testing guidance.",
        }),
      ]);
    }

    if (responseMessages.length >= 2 && toolMessages.length === 2) {
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "protocol-report.json",
          content: JSON.stringify(responseMessages.map((message) => JSON.parse(message.content)), null, 2),
        }),
      ]);
    }

    if (toolMessages.length >= 3) {
      return makeTextChoice("Done. All teammate communication followed one protocol.");
    }

    return makeTextChoice("Waiting for protocol responses.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s10");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));
  const mailboxRoot = ensureDir(path.join(runtimeDir, "mailboxes"));

  const result = await agentLoop({
    prompt: "Ask for two protocol-based teammate updates.",
    workspaceDir,
    mailboxRoot,
    mockResponse: createMockModel(),
  });

  const reportPath = path.join(workspaceDir, "protocol-report.json");
  assert(fs.existsSync(reportPath), "s10 self-test failed: protocol report was not written.");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert(
    report.every(validateProtocolMessage),
    "s10 self-test failed: malformed protocol message reached the final report.",
  );
  assert(
    new Set(report.map((item) => item.request_id)).size === 2,
    "s10 self-test failed: request IDs were not preserved correctly.",
  );

  console.log("[s10] self-test passed");
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
      .trim() || "Ask for two protocol-based teammate updates.";

  const baseDir = path.join(__dirname, ".runtime", "s10-live");
  const workspaceDir = ensureDir(process.env.AGENT_WORKDIR || path.join(baseDir, "workspace"));
  const mailboxRoot = ensureDir(path.join(baseDir, "mailboxes"));

  const result = await agentLoop({
    prompt,
    workspaceDir,
    mailboxRoot,
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
