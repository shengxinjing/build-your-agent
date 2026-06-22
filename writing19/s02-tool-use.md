# s02：工具使用 —— 新增工具，只加一个 handler

`s01` 已经有了最小 agent loop：模型返回 `tool_calls`，程序执行工具，再把结果喂回模型。

但 `s01` 只有一个 `bash`。如果后面每加一个工具，都在 loop 里写一段 `if/else`，主循环很快就会变成一锅粥。

`s02` 做一件事：**把工具执行从 loop 里拿出来，放进一张 handlers 分发表。**

## 这一节的核心变化

`s01` 的工具执行是写死的：

```js
const output =
  call.function.name === "bash"
    ? runBash(command)
    : `Unknown tool: ${call.function.name}`;
```

`s02` 改成查表：

```js
const handler = handlers[call.function.name];
const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;
```

这个变化很小，但很关键：**loop 不再关心具体有哪些工具，它只负责按名字分发。**

```mermaid
flowchart LR
  L[LLM 返回 tool_calls] --> N[读取工具名]
  N --> H[handlers[name]]
  H --> R[执行真实函数]
  R --> M[tool 消息回灌 messages]
  M --> L
```

从这一节开始，agent 的工具能力可以横向增长，而主循环保持稳定。

## 工具分成两层

一个工具其实有两层：

| 层 | 给谁看 | 作用 |
|---|---|---|
| `tools` | 给模型看 | 告诉模型有哪些工具、每个工具需要什么参数 |
| `handlers` | 给程序看 | 模型真的调用工具时，运行对应的 JavaScript 函数 |

模型只能看到 `tools` 里的 schema，它不会直接执行代码。
真正执行的是我们本地的 `handlers`。

所以新增工具时，要做两件事：

1. 在 `tools` 里加一份工具描述，让模型知道它能用。
2. 在 `handlers` 里加一个同名函数，让程序知道怎么执行。

## 对应代码

- 主文件：[s02-tool-use.js](./s02-tool-use.js)
- 共用底座：[helper.js](./helper.js)

### `tools`：给模型看的工具描述

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

这里的 `tool(...)` 是 [helper.js](./helper.js) 里的小函数，用来少写一点固定格式。

它返回的还是 OpenAI-compatible tool schema：

```js
{ type: "function", function: { name, description, parameters } }
```

### `handlers`：给运行时看的执行表

```js
const handlers = {
  bash: ({ command }) => runBash(command),
  read_file: ({ path, limit }) => readFile(path, limit),
  write_file: ({ path, content }) => writeFile(path, content),
  edit_file: ({ path, old_text, new_text }) => editFile(path, old_text, new_text),
  glob: ({ pattern }) => glob(pattern),
};
```

注意这里的 key 必须和 `tools` 里的工具名一致。

例如模型返回：

```json
{
  "function": {
    "name": "read_file",
    "arguments": "{\"path\":\"package.json\"}"
  }
}
```

程序就会执行：

```js
handlers["read_file"]({ path: "package.json" });
```

## agent loop 仍然很小

`s02` 的 loop 和 `s01` 几乎一样，只有工具执行部分从 `if/else` 变成了查表：

```js
export async function agentLoop(messages) {
  while (true) {
    const choice = await callLlm(messages, { system: SYSTEM, tools });
    const { message } = choice;

    if (!message.tool_calls?.length) {
      return message.content || "";
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      const handler = handlers[call.function.name];
      const args = JSON.parse(call.function.arguments || "{}");
      const output = handler ? handler(args) : `Unknown tool: ${call.function.name}`;

      messages.push({ role: "tool", tool_call_id: call.id, content: String(output) });
    }
  }
}
```

这就是这一节最重要的设计味道：

**工具可以越来越多，但 loop 不应该越来越乱。**

## 这一节新增的工具

| 工具 | 作用 |
|---|---|
| `bash` | 执行一条 shell 命令 |
| `read_file` | 读取文件内容，可选限制行数 |
| `write_file` | 写入文件，父目录不存在时自动创建 |
| `edit_file` | 把文件里第一处 `old_text` 替换成 `new_text` |
| `glob` | 按 glob 模式查找文件 |

这些工具的具体实现都在 [helper.js](./helper.js) 里。
主文件只保留 agent 逻辑：声明工具、分发工具、维护 loop。

## 为什么不直接把所有逻辑塞进 helper

因为这是教程。

`helper.js` 负责沉淀重复细节，比如 HTTP、CLI、文件读写、bash 执行。
但 `s02-tool-use.js` 仍然要让你看清楚本章重点：

**新增工具 = tools 里加 schema，handlers 里加函数，agent loop 不变。**

如果把整个分发表和 loop 都藏起来，这一节就看不见核心变化了。

## 怎么跑

```bash
node writing19/s02-tool-use.js
```

可以试着输入：

```text
读取 package.json，告诉我项目名字
```

模型可能会先调用 `read_file`，拿到文件内容后再回答你。

回归测试：

```bash
pnpm test:writing19
```

测试里会模拟模型连续调用 `write_file`、`edit_file`、`read_file`，验证新增工具只需要走 `handlers` 分发表，不需要改 loop。

## 一句话总结

`s02` 让工具扩展有了固定姿势：**工具描述放进 `tools`，工具实现放进 `handlers`，agent loop 只按名字分发。**
