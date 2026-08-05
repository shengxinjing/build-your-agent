# s02：Tool Use —— 多加一个工具，只加一个 handler

新人会跑命令以后，领导又让他去读文件、写文件、查列表。`s02` 的故事就是给他发一套工具箱：每新增一种工具，只要告诉他“工具叫什么、参数是什么、真正执行时找谁处理”。

参考：[shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 中的 `s02_tool_use`。

参考教程的核心是：**循环不用变复杂，新工具注册进 dispatch map 就行。**

我们的 JS 版沿用同一个设计：`tools` 给模型看，`handlers` 给程序执行。


## 问题

`s01` 只有一个 `bash`。

这当然能做很多事，但模型每次都要把真实意图翻译成 shell：

| 模型真正想做 | 只能通过 bash 表达 |
|---|---|
| 读文件 | `cat file` |
| 写文件 | `echo ... > file` |
| 改文件 | `sed ...` |
| 找文件 | `find ...` |

这会浪费 token，也容易让模型拼错命令。

更大的问题是：如果每新增一个工具，都在 loop 里加一段 `if/else`，主循环很快会变乱。

## 解决方案

把工具分成两张表：

![s02 工具分发架构图](https://learn.shareai.run/course-assets/s02_tool_use/tool-dispatch.svg)

![s02 工具并发对比图](https://learn.shareai.run/course-assets/s02_tool_use/concurrency-comparison.svg)

```text
tools    -> 给模型看的工具描述
handlers -> 给程序用的执行函数
```

```mermaid
flowchart LR
  L[LLM 返回 tool_calls] --> N[读取工具名]
  N --> H[handlers[name]]
  H --> E[执行真实函数]
  E --> M[tool 结果回灌 messages]
  M --> L
```

新增工具只做两件事：

1. 在 `tools` 里增加 schema。
2. 在 `handlers` 里增加同名函数。

agent loop 仍然只负责查表分发。

## 从 1 个工具到 5 个工具

`s01` 只有：

```js
bash
```

`s02` 增加到 5 个：

| 工具 | 作用 |
|---|---|
| `bash` | 执行 shell 命令 |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `edit_file` | 替换文件里的文本 |
| `glob` | 按模式找文件 |

这些工具让模型可以直接表达意图，而不是绕一层 shell。

## 新增函数速览

- `agentLoop(messages)`：循环结构基本沿用 s01，但工具执行不再写死判断，而是通过 `handlers` 分发表找到对应实现。
- `tool(name, description, parameters)`：来自 `helper.js`，用一行代码生成 OpenAI-compatible 的 function tool schema。
- `readFile()` / `writeFile()` / `editFile()` / `glob()`：来自 `helper.js`，分别提供读文件、写文件、替换文本和查找文件能力。

## 工作原理

### `tools`：告诉模型能用什么

```js
const tools = [
  tool("bash", "Run a shell command.", {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  }),
  tool("read_file", "Read a file (optional line limit).", {
    type: "object",
    properties: { path: { type: "string" }, limit: { type: "integer" } },
    required: ["path"],
  }),
  tool("write_file", "Write content to a file.", {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  }),
];
```

`tool(...)` 是 [helper.js](./helper.js) 里的小函数，只是帮我们少写一点固定格式。

完整工具列表还包括 `edit_file` 和 `glob`。

### `handlers`：真正执行工具

```js
const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
};
```

这里的 key 必须和 `tools` 里的工具名一致。

模型返回：

```json
{ "name": "read_file", "arguments": "{\"path\":\"package.json\"}" }
```

程序就会执行：

```js
handlers.read_file({ path: "package.json" });
```

## loop 只改工具执行那一行

`s01` 里是硬编码：

```js
call.function.name === "bash" ? runBash(command) : ...
```

`s02` 改成查表：

```js
const handler = handlers[call.function.name];
const args = JSON.parse(call.function.arguments || "{}");
const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;
```

完整 loop 结构没有变：

```js
while (true) {
  const { message } = await callLlm(messages, { system: SYSTEM, tools });
  if (!message.tool_calls?.length) return message.content || "";

  messages.push(message);
  for (const call of message.tool_calls) {
    const handler = handlers[call.function.name];
    const args = JSON.parse(call.function.arguments || "{}");
    const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;
    messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
  }
}
```

这就是参考教程里说的“加一个工具，只加一个 handler”。

## 对应代码

- 主文件：[s02-tool-use.js](./s02-tool-use.js)
- 测试文件：[s02-tool-use.test.js](./s02-tool-use.test.js)

本章核心代码在 `tools`、`handlers` 和 `agentLoop` 的分发表执行逻辑里。

## 相对 s01 的变更

| 组件 | s01 | s02 |
|---|---|---|
| 工具数量 | 1 个 `bash` | 5 个工具 |
| 工具执行 | 写死 `bash` 分支 | `handlers[name]` 查表 |
| loop 形状 | agent loop | 基本不变 |
| 可读性 | 模型绕 shell | 模型直接调用专用工具 |

## 试一下

```bash
node code-agent-course/s02-tool-use.js
```

可以输入：

```text
读取 package.json，告诉我项目名字
```

再试：

```text
创建一个 tmp-note.txt，写入 hello，然后读回来
```

观察重点：模型什么时候调用 `read_file`，什么时候调用 `write_file`，多个工具调用是否按顺序回灌。

## 测试

测试会模拟模型连续调用：

```text
write_file -> edit_file -> read_file
```

用来确认 loop 没有为每个工具写特殊逻辑，而是统一走 `handlers` 分发表。

```bash
pnpm test
```

## 接下来

现在 agent 有多个工具了。

但工具越多，风险越大。file tools 有路径保护，bash 仍然可能执行危险命令。

`s03` 会参考原教程的 Permission：在工具执行前加一道权限门。

## 一句话总结

`s02` 让 agent 的工具能力可以横向增长：**工具描述放进 `tools`，工具实现放进 `handlers`，主循环只按名字分发。**

## 参考实现提醒

参考实现里还有两个细节值得保留在脑子里：

- `tools` 是给模型看的 schema，`handlers` 才是本地真正执行的函数，二者只通过工具名对齐。
- 模型一次可能返回多个 `tool_calls`，循环要逐个执行、逐个回灌，不要只处理第一个。
- 教程版先串行执行所有工具；后面真做并发时，要先判断工具是否安全并发。

## 测试 Prompt

```text
创建 s02-tmp-note.txt，写入 hello s02，然后读出来确认内容。
```

观察重点：模型应该按顺序调用 `write_file` 和 `read_file`，主循环仍然只走统一分发表。

## 扩展阅读：商业级 Agent 怎么做工具扩展

真实产品不会把每个工具都写进主循环里，而是把工具变成一张可注册、可描述、可调度的表：

- Claude Code：工具生态里有文件工具、Bash、Web、Agent、Skill、MCP 等，`tools.ts` / `Tool.ts` 更像工具控制面，loop 只负责执行模型选中的工具。
- Codex：Tool Registry 把 shell、patch、MCP、图片/上下文工具等统一到 core session 下面；新增工具时扩 registry，而不是扩 turn loop。
- opencode：Canonical Tool Registry 区分 built-in tools、application tools、plugin hooks，还把大工具输出放进 Managed Tool Output File。

这就是本章 “Adding a tool means adding one handler” 的商业版：工具能力增长，主循环不应该跟着膨胀。


## 和上一步的关键代码 diff（不含 helper.js）

下面只对比当前步骤文件和上一步步骤文件：`s02-tool-use.js` 相对 `s01-agent-loop.js` 的变化。

这里展示的是最能说明本章新增机制的关键变化；完整差异以相邻 JS 文件为准。

```diff
--- s01-agent-loop.js
+++ s02-tool-use.js
-import { callLlm, runBash, runChatCli, isMainModule } from "./helper.js";
+import {
+  callLlm,
+  runBash,
+  readFile,
+  writeFile,
+  editFile,
+  glob,
+  tool,
+  runChatCli,
+  isMainModule,
+} from "./helper.js";

-// s01：在 s00 基础上加“工具调用”，形成最小 agent loop。
-// s01: add tool calling on top of s00 to form a minimal agent loop.
+// s02：把工具从“写死在 loop 里”改成“挂进分发表”——新增工具不改 loop 的形状。
+// s02: move tools out of the loop into a dispatch table — adding a tool never reshapes the loop.

-const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
+const SYSTEM = `You are a coding agent at ${process.cwd()}. Use tools to solve tasks. Act, don't explain.`;

-const bashTool = [{
-  type: "function",
-  function: {
-    name: "bash",
-    description: "Run a shell command.",
-    parameters: {
-      type: "object",
-      properties: { command: { type: "string" } },
-      required: ["command"],
+const tools = [
+  tool("bash", "Run a shell command.", {
+    type: "object",
+    properties: { command: { type: "string" } },
+    required: ["command"],
+  }),
+  tool("read_file", "Read a file (optional line limit).", {
+    type: "object",
+    properties: { path: { type: "string" }, limit: { type: "integer" } },
+    required: ["path"],
+  }),
+  tool("write_file", "Write content to a file.", {
+    type: "object",
+    properties: { path: { type: "string" }, content: { type: "string" } },
+    required: ["path", "content"],
+  }),
+  tool("edit_file", "Replace exact text in a file once.", {
+    type: "object",
+    properties: {
+      path: { type: "string" },
+      old_text: { type: "string" },
+      new_text: { type: "string" },
     },
-  },
-}];
+    required: ["path", "old_text", "new_text"],
+  }),
+  tool("glob", "Find files by glob pattern.", {
+    type: "object",
+    properties: { pattern: { type: "string" } },
+    required: ["pattern"],
+  }),
+];

+const handlers = {
+  bash: ({ command }) => runBash(command),
+  read_file: ({ path, limit }) => readFile(path, limit),
+  write_file: ({ path, content }) => writeFile(path, content),
+  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
+  glob: ({ pattern }) => glob(pattern),
+};
+
 export async function agentLoop(messages) {
   while (true) {
-    const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
+    const choice = await callLlm(messages, { system: SYSTEM, tools });
     const { message } = choice;

     if (!message.tool_calls?.length) {
     messages.push(message);
     for (const call of message.tool_calls) {
-      const { command } = JSON.parse(call.function.arguments || "{}");
-      const output =
-        call.function.name === "bash"
-          ? runBash(command)
-          : `Unknown tool: ${call.function.name}`;
+      const handler = handlers[call.function.name];
+      const args = JSON.parse(call.function.arguments || "{}");
+      const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;

-      console.log(`$ ${command}\n${output.slice(0, 500)}`);
-      messages.push({ role: "tool", tool_call_id: call.id, content: output });
+      console.log(`> ${call.function.name}: ${String(output).slice(0, 200)}`);
+      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
     }
   }
 }

 async function main() {
   await runChatCli({
-    promptLabel: "s01 >> ",
+    promptLabel: "s02 >> ",
     onPrompt: ({ messages }) => agentLoop(messages),
   });
 }
```
