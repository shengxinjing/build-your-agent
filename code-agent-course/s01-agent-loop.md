# s01：Agent Loop —— 一个循环就够了

现在这个聪明新人已经能听懂你说话了，但他还容易“做一步就停下来汇报”。`s01` 要教他的第一条工作习惯是：遇到任务先自己循环推进，把工具结果看完再继续，直到真的完成再汇报。

参考：[shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 中的 `s01_agent_loop`。

参考教程的核心句子是：**一个工具 + 一个循环 = 一个 agent。**

我们的 JS 版延续这个思路：只给模型一个 `bash` 工具，然后写一个 `while (true)`，让模型可以持续行动。


## 问题

普通聊天里，模型只能输出文本。

比如你问：

```text
列出当前目录里的 JS 文件
```

模型也许会告诉你应该运行：

```bash
find . -name "*.js"
```

但它不会真的执行，也看不到执行结果。

你可以手动把命令复制到终端，再把结果粘回对话框。这个“复制、执行、粘贴”的过程，就是人工版 agent 循环。

`s01` 要做的事，就是把这个中间层自动化。

## 解决方案

给模型一个真实工具：`bash`。

![s01 Agent Loop 架构图](https://learn.shareai.run/course-assets/s01_agent_loop/agent-loop.svg)

Python 原版源码里把整个结构浓缩成了这个模式：

```text
while stop_reason == "tool_use":
    response = LLM(messages, tools)
    execute tools
    append results
```

放成完整结构图就是这样：

```text
+----------+      +-------+      +---------+
|   User   | ---> |  LLM  | ---> |  Tool   |
|  prompt  |      |       |      | execute |
+----------+      +---+---+      +----+----+
                     ^               |
                     |   tool_result |
                     +---------------+
                     (loop continues)
```

整个循环只看一个信号：

| 信号 | 含义 | 动作 |
|---|---|---|
| 有 `message.tool_calls` | 模型想调用工具 | 执行工具，结果回灌，继续 |
| 没有 `message.tool_calls` | 模型给最终回答 | 结束循环 |

## 新增函数速览

- `agentLoop(messages)`：本章核心函数，反复执行“调用模型 → 检查 tool_calls → 执行工具 → 回灌工具结果”，直到模型返回普通文本。
- `runBash(command)`：来自 `helper.js`，执行模型请求的 bash 命令，并把真实 stdout / stderr 作为工具结果返回。
- `main()`：命令行入口，把用户输入交给 `agentLoop()`，让这个最小 agent 可以在终端里跑起来。

## 工作原理

### 第 1 步：把工具描述给模型

```js
const bashTool = [{
  type: "function",
  function: {
    name: "bash",
    description: "Run a shell command.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
}];
```

这段不是工具实现，而是给模型看的 schema。

它告诉模型：

```text
你可以调用一个叫 bash 的工具，这个工具需要 command 参数。
```

### 第 2 步：带着 tools 调模型

```js
const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
const { message } = choice;
```

当请求里带上 `tools` 后，模型可以不直接回文本，而是返回 `tool_calls`。

一个带工具调用的响应长这样：

```json
{
  "choices": [
    {
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "bash",
              "arguments": "{\"command\":\"ls\"}"
            }
          }
        ]
      }
    }
  ]
}
```

这里有三个字段决定了 agent loop 为什么要这么写：

| 字段 | 含义 | 代码里怎么用 |
|---|---|---|
| `finish_reason: "tool_calls"` | 模型还没最终回答，它想先用工具 | 继续循环，不结束 |
| `function.arguments` | 工具参数，但它是 JSON 字符串 | 用 `JSON.parse(...)` 转成对象 |
| `id` | 这次工具调用的编号 | 回灌结果时写进 `tool_call_id` |

如果模型不需要工具，返回就会更像 s00：

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "当前目录有 12 个 JavaScript 文件。"
      }
    }
  ]
}
```

所以 s01 的核心判断不是“模型有没有说完一句话”，而是：

```text
有 tool_calls -> 执行工具，再问一次
没有 tool_calls -> 这就是最终答案
```

### 第 3 步：没有工具调用就结束

```js
if (!message.tool_calls?.length) {
  return message.content || "";
}
```

这就是循环的退出条件。

### 第 4 步：执行工具，结果回灌

```js
messages.push(message);

for (const call of message.tool_calls) {
  const { command } = JSON.parse(call.function.arguments || "{}");
  const output = call.function.name === "bash"
    ? runBash(command)
    : `Unknown tool: ${call.function.name}`;

  messages.push({ role: "tool", tool_call_id: call.id, content: output });
}
```

这里有两个细节很重要：

1. 模型那条带 `tool_calls` 的 assistant message 要先放进历史。
2. 工具结果必须用同一个 `tool_call_id` 回灌，模型才知道这是哪次调用的结果。

为什么必须先 `messages.push(message)`？

因为模型下一轮需要看到完整上下文：

```text
assistant: 我想调用 bash，id 是 call_abc123
tool: call_abc123 的执行结果是 ...
```

如果只放工具结果，不放前面的 assistant 工具调用意图，模型就不知道这个工具结果是在回答哪一次调用。

## 为什么必须是循环

一次工具调用通常不够。

模型可能先调用 `ls` 看目录，再调用 `cat package.json` 读文件，最后才知道怎么回答。每次工具结果都会带来新信息，所以 agent loop 必须一直重复：

```text
调用 LLM -> 发现 tool_calls -> 执行工具 -> 回灌结果 -> 再调用 LLM
```

直到模型返回普通文本，不再返回 `tool_calls`。

## 对应代码

- 主文件：[s01-agent-loop.js](./s01-agent-loop.js)
- 共用底座：[helper.js](./helper.js)

核心就是这个循环：

```js
export async function agentLoop(messages) {
  while (true) {
    const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
    const { message } = choice;

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const { command } = JSON.parse(call.function.arguments || "{}");
      const output = call.function.name === "bash"
        ? runBash(command)
        : `Unknown tool: ${call.function.name}`;

      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
}
```

这就是最小 agent loop：模型负责决定要不要调用工具，程序负责执行，并把真实结果放回 `messages`。

## 相对 s00 的变更

| 组件 | s00 | s01 |
|---|---|---|
| 模型调用 | 一次请求，一次回答 | 可能多轮循环 |
| 工具 | 无 | 一个 `bash` |
| 返回格式 | 读 `message.content` | 先看 `message.tool_calls` |
| 关键能力 | 能聊天 | 能行动 |

## 试一下

```bash
node code-agent-course/s01-agent-loop.js
```

可以输入：

```text
列出当前目录下所有 .js 文件
```

观察重点：模型什么时候返回 `tool_calls`，什么时候返回最终答案。

## 测试

测试里会模拟两次模型回复：

1. 第一次返回 `tool_calls`，要求执行 `bash`。
2. 第二次返回最终答案。

```bash
pnpm test
```

这样可以确认“工具调用 -> 回灌 -> 再调用”的闭环没有坏。

## 接下来

现在 agent 只有 `bash` 一个工具。

读文件要靠 `cat`，写文件要靠 shell 重定向，找文件要靠 `find`。这些都能做，但不够清晰，也容易出错。

`s02` 会参考原教程的 Tool Use：给模型增加专用工具，让新增工具只需要新增 handler，而不是改 loop。

## 一句话总结

`s01` 让模型第一次连上真实世界：**只要模型返回 `tool_calls`，程序就执行工具、回灌结果、继续循环。**

## 参考实现提醒

参考 Python 版时，最容易漏掉的不是 `while`，而是这三个不变式：

- 先保存模型那条带 `tool_calls` 的 assistant message，再保存工具结果。
- 每个工具结果都要带回同一个 `tool_call_id`，否则模型不知道结果对应哪次调用。
- 退出条件不是“跑了一轮”，而是模型不再请求工具，返回普通文本。

## 测试 Prompt

```text
列出当前目录下所有 JavaScript 文件，并告诉我一共有多少个
```

观察重点：模型应该先调用 `bash`，拿到真实命令结果后，再基于工具结果回答。

## 扩展阅读：商业级 Agent 怎么做主循环

公开资料和本地架构分析里，三家都把 agent loop 当成系统中枢，而不是一段临时代码：

- Claude Code：核心是 query、streaming response 和 tool-call loop。模型输出 tool call 后，工具结果回到同一轮循环，直到没有工具调用才结束。
- Codex：Rust core 里有 Session / Turn Loop，Provider Request Builder 负责组装请求，Tool Registry 负责执行工具，ThreadStore 负责保存会话轨迹。
- opencode：Session Runner 把 Prompt Admission、Provider Turn、Tool Registry、Session History 串起来；loop 外面还有 durable events，方便 UI 和 API 观察状态。

所以本章的一句话不是“while 循环很简单”，而是：真实 agent 的所有能力，最后都要回到“模型输出意图 → 工具执行 → 结果回灌模型”这条闭环。

## 博客代码演进

下面 3 个 patch 专门用于博客右侧的代码切换。第一步基于 `s00-llm-http.js`，后面的每一步都继续修改上一帧，最后必须得到完整的 `s01-agent-loop.js`。

这套语法只维护增量：`###` 是一帧，`@@` 可以让同一帧修改多个位置，`+` 行会自动成为右侧代码的聚焦区域。Markdown 不需要复制完整源码，也不需要维护容易失效的行号。

### 1. 声明 Bash 工具

先把普通聊天程序变成 coding agent，并用 `bashTool` 告诉模型：现在有一个名为 `bash` 的函数，它接收一个必填的 `command` 字符串。

```diff agent-step
@@
 import {
   callLlm,
+  runBash,
   runChatCli,
   isMainModule,
 } from "./helper.js";
+
@@
-// 问模型，返回纯文本回答。
-// Ask the model and return its plain-text reply.
+const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
+
+// 一个工具 = 给模型看的 schema（这里只放一个 bash）。
+// A tool = the schema shown to the model (just bash here).
+const bashTool = [{
+  type: "function",
+  function: {
+    name: "bash",
+    description: "Run a shell command.",
+    parameters: {
+      type: "object",
+      properties: { command: { type: "string" } },
+      required: ["command"],
+    },
+  },
+}];
+
```

### 2. 完成 Agent 闭环

把原来只请求一次的 `ask` 改成 `agentLoop`：模型请求工具时执行 Bash，把结果按同一个 `tool_call_id` 放回 `messages`，然后继续下一轮；模型不再请求工具时才返回答案。

```diff agent-step
@@
-export async function ask(messages) {
-  const choice = await callLlm(messages);
-  return choice.message.content || "";
+// agent loop：问模型 → 有 tool_calls 就执行并把结果回灌 → 没有就返回答案。
+// The agent loop: ask the model → run any tool_calls and feed results back → else return the answer.
+export async function agentLoop(messages) {
+  while (true) {
+    const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
+    const { message } = choice;
+
+    if (!message.tool_calls?.length) {
+      return message.content || "";
+    }
+
+    messages.push(message);
+    for (const call of message.tool_calls) {
+      const { command } = JSON.parse(call.function.arguments || "{}");
+      const output =
+        call.function.name === "bash"
+          ? runBash(command)
+          : `Unknown tool: ${call.function.name}`;
+
+      console.log(`$ ${command}\n${output.slice(0, 500)}`);
+      messages.push({ role: "tool", tool_call_id: call.id, content: output });
+    }
+  }
 }
@@
-    onPrompt: ({ messages }) => ask(messages),
+    onPrompt: ({ messages }) => agentLoop(messages),
```

### 3. 完成 s01 命令行入口

最后更新章节身份和命令行提示，并移除 s00 中只适用于普通问答的说明。到这里，生成的代码与本章真实 JS 文件逐字一致。

```diff agent-step
@@
-// s00：最小的“调用大模型”示例 —— 一个 HTTP 请求换一句回答。
-// s00: the smallest "call an LLM" example — one HTTP request, one reply.
+// s01：在 s00 基础上加“工具调用”，形成最小 agent loop。
+// s01: add tool calling on top of s00 to form a minimal agent loop.
@@
 async function main() {
-  // runChatCli 只管命令行输入输出；真正的 LLM 调用放在 onPrompt 里。
   await runChatCli({
-    promptLabel: "prompt >> ",
+    promptLabel: "s01 >> ",
     onPrompt: ({ messages }) => agentLoop(messages),
   });
 }
@@
-// 只有直接运行才启动命令行；被测试 import 时不会启动。
-// Only start the CLI when run directly; importing (e.g. in tests) won't start it.
 if (isMainModule(import.meta.url)) {
```


## 和上一步的关键代码 diff（不含 helper.js）

下面只对比当前步骤文件和上一步步骤文件：`s01-agent-loop.js` 相对 `s00-llm-http.js` 的变化。

这里展示的是最能说明本章新增机制的关键变化；完整差异以相邻 JS 文件为准。

```diff
--- s00-llm-http.js
+++ s01-agent-loop.js
 import {
   callLlm,
+  runBash,
   runChatCli,
   isMainModule,
 } from "./helper.js";
+

-// s00：最小的“调用大模型”示例 —— 一个 HTTP 请求换一句回答。
-// s00: the smallest "call an LLM" example — one HTTP request, one reply.
+// s01：在 s00 基础上加“工具调用”，形成最小 agent loop。
+// s01: add tool calling on top of s00 to form a minimal agent loop.

-// 问模型，返回纯文本回答。
-// Ask the model and return its plain-text reply.
-export async function ask(messages) {
-  const choice = await callLlm(messages);
-  return choice.message.content || "";
+const SYSTEM = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
+
+const bashTool = [{
+  type: "function",
+  function: {
+    name: "bash",
+    description: "Run a shell command.",
+    parameters: {
+      type: "object",
+      properties: { command: { type: "string" } },
+      required: ["command"],
+    },
+  },
+}];
+
+export async function agentLoop(messages) {
+  while (true) {
+    const choice = await callLlm(messages, { system: SYSTEM, tools: bashTool });
+    const { message } = choice;
+
+    if (!message.tool_calls?.length) {
+      return message.content || "";
+    }
+
+    messages.push(message);
+    for (const call of message.tool_calls) {
+      const { command } = JSON.parse(call.function.arguments || "{}");
+      const output =
+        call.function.name === "bash"
+          ? runBash(command)
+          : `Unknown tool: ${call.function.name}`;
+
+      console.log(`$ ${command}\n${output.slice(0, 500)}`);
+      messages.push({ role: "tool", tool_call_id: call.id, content: output });
+    }
+  }
 }

 async function main() {
-  // runChatCli 只管命令行输入输出；真正的 LLM 调用放在 onPrompt 里。
   await runChatCli({
-    promptLabel: "prompt >> ",
-    onPrompt: ({ messages }) => ask(messages),
+    promptLabel: "s01 >> ",
+    onPrompt: ({ messages }) => agentLoop(messages),
   });
 }
```
