# s00：先把 LLM 的 HTTP 调用打通

这一节不讲 agent，只做一件最小的事：**把一句话通过 HTTP 发给大模型，再拿回它的回答**。
这条链路一旦通了，后面的 agent loop、工具、记忆、任务、MCP，本质上都只是围着它往上叠层。

## 什么是 LLM provider

provider 就是**提供大模型 API 服务的厂商**。本教程用三家：

- **OpenAI**（GPT 系列）
- **DeepSeek**（深度求索）
- **Kimi / Moonshot**（月之暗面）

关键点：这三家都提供 **OpenAI 兼容的 `/chat/completions` 接口**——请求和响应格式完全一样，区别只有三处：`baseUrl`、模型名、`apiKey`。

| provider | baseUrl | 申请 API Key 地址 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | https://platform.openai.com/api-keys |
| DeepSeek | `https://api.deepseek.com/v1` | https://platform.deepseek.com/api_keys |
| Kimi | `https://api.moonshot.cn/v1` | https://platform.moonshot.cn/console/api-keys |

所以"切换 provider" = 换 `baseUrl` + `model` + `apiKey` 这三个值，主逻辑一行都不用动。

## 一次 LLM 调用长什么样（伪代码）

去掉语言细节，调用模型就是一个普通的 HTTP POST：

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "{model}",
  "messages": [
    { "role": "user", "content": "用一句话解释什么是 agent" }
  ]
}
```

模型回你一个 JSON，答案在 `choices[0].message.content` 里：

```
{
  "choices": [
    { "message": { "role": "assistant", "content": "agent 就是……" } }
  ]
}
```

记住这个结构：**你发 `messages`（角色 + 内容的数组），它回一条 assistant 消息**。后面每一章都是在这个结构上做文章。

## 对应代码

- 主文件：[s00-llm-http.js](./s00-llm-http.js)
- 共用底座：[helper.js](./helper.js)

### helper 里的 `callLlm` —— 把上面的伪代码写成真代码

```js
export async function callLlm(messages, { system, tools, model, provider = llmProvider } = {}) {
  const config = llmProviderConfigs[provider] || llmProviderConfigs.openai;
  if (!config.token) throw new Error("Missing API token.");

  const body = {
    model: model || config.model,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
  };
  if (tools?.length) { body.tools = tools; body.tool_choice = "auto"; }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data.error || data)}`);
  return data.choices[0]; // 返回模型的回复（choice）
}
```

和伪代码一一对应：取配置 → 拼 body → `fetch` POST → 返回 `choices[0]`。`system` / `tools` 这一节用不到，留给 s01。（实际文件里还多包了一层网络错误处理。）

### s00 主文件 —— 一个最小的多轮对话

```js
import { callLlm, runChatCli, isMainModule } from "./helper.js";

// 问模型，返回纯文本回答
export async function ask(messages) {
  const choice = await callLlm(messages);
  return choice.message.content || "";
}

if (isMainModule(import.meta.url)) {
  runChatCli({ promptLabel: "prompt >> ", onPrompt: ({ messages }) => ask(messages) });
}
```

## helper 函数语义化解释

| 名字 | 是什么 |
|---|---|
| `llmProviderConfigs` | 三家 provider 的 `baseUrl` + `model` 配置总表 |
| `llmProvider` / `apiToken` | **当前用哪家** + **用哪个 key**；默认值写在 helper 里，换一家只改这两个 |
| `callLlm(messages, opts)` | 整套教程**唯一的"调用大模型"函数**：发一个 HTTP 请求，返回模型的 `choice` |
| `runChatCli({ promptLabel, onPrompt })` | 命令行多轮对话外壳：只管读输入 / 打印输出 / 维护 `messages`，真正"拿这轮 messages 干嘛"交给你传入的 `onPrompt` |

这种拆分的意义：**主文件只关心"问模型"这件事，HTTP 和命令行的脏活都沉进 helper**——后面每一节的主文件都能保持这么干净。

## 怎么跑

先在 [helper.js](./helper.js) 里把 `apiToken` 填成你申请到的 key、`llmProvider` 设成对应那家，然后：

```bash
node writing19/s00-llm-http.js      # 进入多轮对话；输入问题回车，q 退出
```

回归测试（不需要真 key，用本地假服务）：

```bash
pnpm test:writing19
```

## 一句话总结

`s00` 不是 agent，它是在给后面所有 agent 章节打通**唯一的网络入口**：发 `messages`，收 `choice`。
