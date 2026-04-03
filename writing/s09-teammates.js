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
  safeJoin,
  toolResultMessage,
  writeText,
} = require("./util.js");

loadEnv(path.join(process.cwd(), ".env"));

const TOOLS = [
  makeTool("send_mail", "Send one mail to a teammate.", {
    type: "object",
    properties: {
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["to", "subject", "body"],
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

function teammateReply(mail) {
  if (mail.to === "researcher") {
    return "Research note: agent loop stays small when tools stay focused.";
  }

  return "Review note: add self-tests early so each step can fail in isolation.";
}

async function agentLoop({ prompt, workspaceDir, mailboxRoot, mockResponse }) {
  const messages = [{ role: "user", content: prompt }];
  const mailbox = new MailboxStore(mailboxRoot);
  const processedMailIds = new Set();
  const leadSeenIds = new Set();

  const handlers = {
    send_mail: ({ to, subject, body }) => {
      const sent = mailbox.send({
        from: "lead",
        to,
        subject,
        body,
      });
      return JSON.stringify(sent);
    },
    write_file: ({ path: filePath, content }) => {
      writeText(safeJoin(workspaceDir, filePath), content);
      return `Wrote ${filePath}`;
    },
  };

  function pumpTeammates() {
    for (const teammate of ["researcher", "reviewer"]) {
      for (const mail of mailbox.inbox(teammate)) {
        if (processedMailIds.has(mail.id)) {
          continue;
        }
        processedMailIds.add(mail.id);
        mailbox.send({
          from: teammate,
          to: "lead",
          subject: `reply:${mail.subject}`,
          body: teammateReply(mail),
        });
      }
    }

    for (const reply of mailbox.inbox("lead")) {
      if (leadSeenIds.has(reply.id)) {
        continue;
      }
      leadSeenIds.add(reply.id);
      messages.push({
        role: "user",
        content: `Mail from ${reply.from}: ${reply.body}`,
      });
    }
  }

  while (true) {
    pumpTeammates();

    const choice = await callChatModel({
      system: [
        "You are the lead agent.",
        "Use send_mail to delegate work to teammates.",
        "Wait for replies in the lead mailbox, then combine them.",
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
    const sawResearch = messages.some((message) =>
      String(message.content).includes("Mail from researcher"),
    );
    const sawReview = messages.some((message) =>
      String(message.content).includes("Mail from reviewer"),
    );

    if (toolMessages.length === 0) {
      return makeToolChoice([
        makeToolCall("send_mail", {
          to: "researcher",
          subject: "Need research",
          body: "Please explain the value of a small agent loop.",
        }),
        makeToolCall("send_mail", {
          to: "reviewer",
          subject: "Need review",
          body: "Please review the tutorial flow.",
        }),
      ]);
    }

    if (sawResearch && sawReview && toolMessages.length === 2) {
      return makeToolChoice([
        makeToolCall("write_file", {
          path: "team-summary.md",
          content: "# Team Summary\n\n- Research arrived\n- Review arrived\n",
        }),
      ]);
    }

    if (toolMessages.length >= 3) {
      return makeTextChoice("Done. I sent work to teammates and merged their replies.");
    }

    return makeTextChoice("Waiting for teammate replies.");
  };
}

async function selfTest() {
  const runtimeDir = cleanRuntime("s09");
  const workspaceDir = ensureDir(path.join(runtimeDir, "workspace"));
  const mailboxRoot = ensureDir(path.join(runtimeDir, "mailboxes"));

  const result = await agentLoop({
    prompt: "Ask teammates for research and review.",
    workspaceDir,
    mailboxRoot,
    mockResponse: createMockModel(),
  });

  assert(
    fs.existsSync(path.join(workspaceDir, "team-summary.md")),
    "s09 self-test failed: summary file is missing.",
  );
  assert(
    mailboxRoot && fs.existsSync(path.join(mailboxRoot, "researcher")),
    "s09 self-test failed: researcher mailbox is missing.",
  );
  assert(
    result.messages.some((message) =>
      String(message.content).includes("Mail from reviewer"),
    ),
    "s09 self-test failed: reviewer reply never reached the lead agent.",
  );

  console.log("[s09] self-test passed");
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
      .trim() || "Ask teammates for research and review.";

  const baseDir = path.join(__dirname, ".runtime", "s09-live");
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
