# s00：先直接用 HTTP 调 LLM

这一节先不讲 agent。

我们只做一件事：用最原始的 HTTP 请求，把一句话发给模型，再把回答打印出来。只要这一步通了，后面的 loop、tools、subagent 才有地基。

## 先定一个最小目标

我们要让同一份 JavaScript 代码同时支持两类接口：

- OpenAI
- Kimi

为了把教程保持简单，这个系列先统一走 **OpenAI 兼容的 `chat/completions` 接口**。这样一来：

- OpenAI 可以直接跑
- Kimi 也可以直接跑
- 后面做 tool calling 时，消息格式也基本一致

说明一下：OpenAI 官方现在更推荐新项目逐步用 Responses API。但这个教程的重点是“从 0 理解 agent loop”，不是先学两套接口。所以我们先用更容易跨厂商复用的这一套。

## 准备环境变量

你可以在项目根目录放一个 `.env` 文件：

```bash
# 选 openai 或 kimi
LLM_PROVIDER=openai

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

# Kimi
# LLM_PROVIDER=kimi
# KIMI_API_KEY=sk-...
# KIMI_MODEL=kimi-k2-0711-preview
```

如果你想自定义地址，也可以加：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
KIMI_BASE_URL=https://api.moonshot.cn/v1
```

## 这节代码做了什么

`s00-llm-http.js` 做了四步：

1. 读 `.env`
2. 根据 `LLM_PROVIDER` 选择 OpenAI 或 Kimi
3. 组装一个标准的 `POST /chat/completions`
4. 打印模型回复

它还带了一个 `--self-test`。没有真实 API key 时，我也能先把代码跑通。

## 运行

正常调用：

```bash
node writing/s00-llm-http.js "请用一句话解释什么是 agent loop"
```

自测：

```bash
node writing/s00-llm-http.js --self-test
```

## 你现在应该理解的事

- LLM API 本质就是一个 HTTP 接口
- `messages` 是最重要的数据结构
- 后面的 agent，不是“换一种神秘玩法”
- 它只是“反复调用这个接口，再把工具结果塞回 messages”

## 下一节

下一节开始进入真正的 agent 核心：

**一个 loop，加一个工具，就已经是 agent。**
