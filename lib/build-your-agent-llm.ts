export const LLM_SETTINGS_STORAGE_KEY =
  "build-your-agent:llm-settings"

export const LLM_SETTINGS_EVENT_NAME =
  "build-your-agent:llm-settings-changed"

export const LLM_PROVIDER_MARKER =
  "__BUILD_YOUR_AGENT_LLM_PROVIDER__"

export const API_TOKEN_MARKER =
  "__BUILD_YOUR_AGENT_API_TOKEN__"

export const LLM_PROVIDER_CONFIGS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2-0711-preview",
  },
} as const

export type LlmProvider =
  keyof typeof LLM_PROVIDER_CONFIGS

export const LLM_PROVIDERS =
  Object.keys(LLM_PROVIDER_CONFIGS) as LlmProvider[]

export type LlmSettings = {
  llmProvider: LlmProvider
  apiToken: string
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  llmProvider: "openai",
  apiToken: "",
}

function isLlmProvider(
  value: unknown,
): value is LlmProvider {
  return LLM_PROVIDERS.includes(value as LlmProvider)
}

export function normalizeLlmSettings(
  value: Partial<LlmSettings> | null | undefined,
): LlmSettings {
  return {
    llmProvider: isLlmProvider(value?.llmProvider)
      ? value.llmProvider
      : DEFAULT_LLM_SETTINGS.llmProvider,
    apiToken:
      typeof value?.apiToken === "string"
        ? value.apiToken
        : DEFAULT_LLM_SETTINGS.apiToken,
  }
}

export function parseLlmSettings(
  value: string | null | undefined,
) {
  if (!value) {
    return DEFAULT_LLM_SETTINGS
  }

  try {
    return normalizeLlmSettings(JSON.parse(value))
  } catch {
    return DEFAULT_LLM_SETTINGS
  }
}

export function serializeLlmSettings(
  value: Partial<LlmSettings> | null | undefined,
) {
  return JSON.stringify(normalizeLlmSettings(value))
}

export function injectLlmSettingsIntoHelper(
  source: string,
  settings: Partial<LlmSettings> | null | undefined,
) {
  const normalized = normalizeLlmSettings(settings)

  return source
    .replaceAll(
      JSON.stringify(LLM_PROVIDER_MARKER),
      JSON.stringify(normalized.llmProvider),
    )
    .replaceAll(
      JSON.stringify(API_TOKEN_MARKER),
      JSON.stringify(normalized.apiToken),
    )
}

export function localizeCodeComments(
  source: string,
  locale: "cn" | "en",
) {
  const activeLocale = locale === "en" ? "en" : "cn"

  return source
    .split("\n")
    .map((line) => {
      const match = line.match(
        /^(\s*)\/\/\s*@comment-(cn|en)\s?(.*)$/,
      )

      if (!match) {
        return line
      }

      if (match[2] !== activeLocale) {
        return null
      }

      return `${match[1]}// ${match[3]}`
    })
    .filter((line): line is string => line !== null)
    .join("\n")
}
