"use client"

import {
  LLM_PROVIDERS,
  type LlmProvider,
} from "@/lib/build-your-agent-llm"
import type { Locale } from "@/lib/i18n"
import { useLlmSettings } from "./use-llm-settings"

const copy = {
  cn: {
    description:
      "模型供应商和 Token 仅保存在当前浏览器，刷新后仍会保留。",
    provider: "模型供应商",
    token: "API Token",
    tokenHint: "例如 sk-... 或者 moonshot / deepseek token",
  },
  en: {
    description:
      "Your provider and token stay in this browser and remain after refresh.",
    provider: "LLM provider",
    token: "API token",
    tokenHint: "For example sk-... or a Moonshot / DeepSeek token",
  },
} as const

export function LlmSettingsPanel({
  locale,
}: {
  locale: Locale
}) {
  const {
    apiToken,
    hydrated,
    llmProvider,
    setApiToken,
    setLlmProvider,
  } = useLlmSettings()
  const text = copy[locale]

  return (
    <section className="mt-3 rounded-[22px] border border-[var(--line)] bg-[var(--surface-elevated)] p-4 text-[var(--text)] shadow-[0_24px_60px_rgba(67,48,36,0.08)] backdrop-blur dark:shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
      <p className="text-sm leading-5 text-[var(--muted)]">
        {text.description}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--text)]">
            {text.provider}
          </span>
          <select
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)]"
            onChange={(event) =>
              setLlmProvider(
                event.target.value as LlmProvider,
              )
            }
            value={hydrated ? llmProvider : "openai"}
          >
            {LLM_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--text)]">
            {text.token}
          </span>
          <input
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            onChange={(event) =>
              setApiToken(event.target.value)
            }
            placeholder={text.tokenHint}
            spellCheck={false}
            type="text"
            value={hydrated ? apiToken : ""}
          />
        </label>
      </div>
    </section>
  )
}
