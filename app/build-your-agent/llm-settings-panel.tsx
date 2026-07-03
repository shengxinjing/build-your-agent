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
      "这里保存你的模型供应商和 token。数据只保存在当前浏览器里，刷新后还会保留。",
    provider: "模型供应商",
    title: "先把 LLM 参数填好",
    token: "API Token",
    tokenHint: "例如 sk-... 或者 moonshot / deepseek token",
  },
  en: {
    description:
      "Save your provider and token here. The values stay in this browser and are still there after refresh.",
    provider: "LLM provider",
    title: "Set up your LLM first",
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
    <section className="mt-8 rounded-[28px] border border-slate-200/70 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#11151d]/80 dark:shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        LLM
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
        {text.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {text.description}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {text.provider}
          </span>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-[#0d1117] dark:text-slate-100 dark:focus:border-slate-500"
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
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {text.token}
          </span>
          <input
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-[#0d1117] dark:text-slate-100 dark:focus:border-slate-500"
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
