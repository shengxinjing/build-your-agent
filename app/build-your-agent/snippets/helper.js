// @comment-cn 当前页面选择的模型服务商会被注入到这里。
// @comment-en The provider selected on the page is injected here.
export const llmProvider = "__BUILD_YOUR_AGENT_LLM_PROVIDER__"
// @comment-cn 当前页面输入的 API token 会被注入到这里。
// @comment-en The API token entered on the page is injected here.
export const apiToken = "__BUILD_YOUR_AGENT_API_TOKEN__"
// @comment-cn 所有服务商的请求地址、模型名和 token 都集中放在这张表里。
// @comment-en This table keeps each provider's URL, model, and token in one place.
export const llmProviderConfigs = {
  openai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    token: apiToken,
  },
  anthropic: {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    token: apiToken,
  },
  deepseek: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    token: apiToken,
  },
  kimi: {
    provider: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2-0711-preview",
    token: apiToken,
  },
}

// @comment-cn 用 llmProvider 当 key，取出当前真正生效的模型配置。
// @comment-en Use llmProvider as the key to read the active model config.
export const activeLlm = llmProviderConfigs[llmProvider] || llmProviderConfigs.openai

// @comment-cn 从数组里随机取出一个元素。
// @comment-en Pick one random item from an array.
export function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)]
}

// @comment-cn 连续随机取两次，返回一个二元结果。
// @comment-en Pick twice and return the two results as a pair.
export function pickPair(items) {
  return [pickRandom(items), pickRandom(items)]
}

// @comment-cn 把标签和值格式化成适合打印的一行文本。
// @comment-en Format a label and value into one printable line.
export function formatOutcome(label, value) {
  return `${label}: ${value}`
}

// @comment-cn 把正文和后缀拼成一句短句。
// @comment-en Join a value and suffix into a short sentence.
export function formatSentence(value, suffix) {
  return `${value} ${suffix}`
}
