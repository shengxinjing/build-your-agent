"use client"

import { ChevronDown, ChevronUp, KeyRound } from "lucide-react"
import { useState } from "react"
import {
  LLM_PROVIDERS,
  type LlmProvider,
} from "@/lib/build-your-agent-llm"
import type { Locale } from "@/lib/i18n"
import { useLlmSettings } from "./use-llm-settings"

const copy = {
  cn: {
    provider: "模型供应商",
    token: "API Token",
    tokenHint: "例如 sk-... 或者 moonshot / deepseek token",
    configured: "已配置本地 Token",
    unconfigured: "未配置 API Key · 仅浏览可跳过",
    expand: "配置 API Key",
    collapse: "收起",
  },
  en: {
    provider: "LLM provider",
    token: "API token",
    tokenHint: "For example sk-... or a Moonshot / DeepSeek token",
    configured: "Local token configured",
    unconfigured: "No API key · optional for reading",
    expand: "Configure API Key",
    collapse: "Collapse",
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
  const [expanded, setExpanded] = useState(false)
  const text = copy[locale]
  const hasToken = hydrated && apiToken.trim().length > 0
  const activeProvider = hydrated ? llmProvider : "openai"

  return (
    <section className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-elevated)] text-[var(--text)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              hasToken
                ? "bg-[var(--accent-emerald)] shadow-[0_0_8px_var(--accent-emerald)]"
                : "bg-[var(--muted)] opacity-65"
            }`}
          />
          <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text)]">
            <KeyRound size={11} className="text-[var(--accent)]" />
            {activeProvider}
          </span>
          <span className="truncate text-xs text-[var(--muted)]">
            {hasToken ? text.configured : text.unconfigured}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <span>{expanded ? text.collapse : text.expand}</span>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-[var(--line)] px-3.5 py-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                {text.provider}
              </span>
              <select
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none transition focus:border-[var(--accent)]"
                onChange={(event) =>
                  setLlmProvider(
                    event.target.value as LlmProvider,
                  )
                }
                value={activeProvider}
              >
                {LLM_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
                {text.token}
              </span>
              <input
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
                onChange={(event) =>
                  setApiToken(event.target.value)
                }
                placeholder={text.tokenHint}
                spellCheck={false}
                type="password"
                value={hydrated ? apiToken : ""}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  )
}
