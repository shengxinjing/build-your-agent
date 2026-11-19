"use client"

import type { HighlightedCode } from "codehike/code"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { Code2, X } from "lucide-react"
import { useSelectedIndex } from "codehike/utils/selection"
import { tokenTransitions } from "../components/annotations/token-transitions"
import { ThemedPre } from "../components/themed-pre"
import { CopyButton } from "./button"
import { focus } from "./focus"
import { LiveDemo } from "./livedemo"
import { useLlmSettings } from "./use-llm-settings"
import type { Locale } from "@/lib/i18n"
import { extractHighlightedCodeText } from "@/lib/tutorial-files"
import { injectLlmSettingsIntoHelper } from "@/lib/build-your-agent-llm"

type CodeStageFile = {
  copyText?: string
  fileName: string
  lang: string
  meta: string
  runtimeCode?: string
}

type CodeStageStep = {
  file: CodeStageFile
  highlightedCode: HighlightedCode | null
}

const codeHandlers = [
  tokenTransitions,
  focus,
]

export function CodeStage({
  locale,
  sharedFiles,
  steps,
}: {
  locale: Locale
  sharedFiles: CodeStageFile[]
  steps: CodeStageStep[]
}) {
  const [selectedIndex] = useSelectedIndex()
  const { apiToken, llmProvider } = useLlmSettings()
  const resolvedSharedFiles = useMemo(
    () =>
      sharedFiles.map((file) => {
        if (file.fileName !== "helper.js") {
          return file
        }

        const settings = { apiToken, llmProvider }

        return {
          ...file,
          // 代码面板只显示占位符，真 token 只进运行时代码。
          // The panel shows a placeholder; the real token only goes into runtime code.
          copyText: injectLlmSettingsIntoHelper(file.copyText || "", {
            ...settings,
            apiToken: apiToken ? "YOUR_API_TOKEN" : "",
          }),
          runtimeCode: injectLlmSettingsIntoHelper(
            file.runtimeCode || "",
            settings,
          ),
        }
      }),
    [apiToken, llmProvider, sharedFiles],
  )
  const currentStep = steps[selectedIndex] || steps[0]
  const files = useMemo(
    () =>
      currentStep
        ? [
          currentStep.file,
          ...resolvedSharedFiles.filter(
            (file) => file.fileName !== currentStep.file.fileName,
          ),
        ]
        : [],
    [currentStep, resolvedSharedFiles],
  )
  const [activeFileName, setActiveFileName] = useState<string | null>(null)
  const activeIndex = Math.max(
    0,
    files.findIndex((file) => file.fileName === activeFileName),
  )
  const activeFile = files[activeIndex] || null
  // 只有本章主文件有高亮 tokens；helper.js 走轻量的本地高亮。
  // Only the chapter file has highlighted tokens; helper.js uses the light local highlighter.
  const highlightedCode =
    activeIndex === 0 ? currentStep?.highlightedCode ?? null : null
  const activeCopyText =
    activeFile?.copyText ?? extractHighlightedCodeText(highlightedCode)
  const activeRender = highlightedCode
    ? (
      <ThemedPre
        code={highlightedCode}
        handlers={codeHandlers}
        className="h-full bg-transparent"
      />
    )
    : activeFile
      ? <DynamicCodeBlock code={activeCopyText} />
      : null

  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!mobileOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false)
      }
    }

    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [mobileOpen])

  if (!currentStep || !activeFile) {
    return null
  }

  const mobileLabel = locale === "cn" ? "查看代码" : "View code"
  const closeLabel = locale === "cn" ? "关闭代码" : "Close code"

  return (
    <div className="scrolly-stage-ui">
      <button
        type="button"
        className="scrolly-mobile-trigger"
        aria-label={mobileLabel}
        onClick={() => setMobileOpen(true)}
      >
        <Code2 aria-hidden="true" size={18} />
        <span>{locale === "cn" ? "代码" : "Code"}</span>
      </button>
      <div
        className={`scrolly-mobile-backdrop${
          mobileOpen ? " scrolly-mobile-backdrop--open" : ""
        }`}
        aria-hidden="true"
        onClick={() => setMobileOpen(false)}
      />
      <div
        className={`scrolly-mobile-panel${
          mobileOpen ? " scrolly-mobile-panel--open" : ""
        }`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? "true" : undefined}
        aria-label={mobileOpen ? mobileLabel : undefined}
      >
        <div className="scrolly-mobile-header">
          <button
            type="button"
            className="scrolly-mobile-close"
            aria-label={closeLabel}
            onClick={() => setMobileOpen(false)}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="scrolly-stage__body">
          {files.length > 1 ? (
            <div className="scrolly-tabs" role="tablist">
              {files.map((file) => {
                const isActive =
                  file.fileName === activeFile.fileName

                return (
                  <button
                    key={file.fileName}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`scrolly-tab${
                      isActive ? " scrolly-tab--active" : ""
                    }`}
                    onClick={() => {
                      setActiveFileName(file.fileName)
                    }}
                  >
                    {file.fileName}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="scrolly-code">
            <div className="scrolly-code__toolbar">
              <div className="scrolly-code__meta">
                {activeFile.fileName}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LiveDemo
                  activeFileName={activeFile.fileName}
                  entryFileName={currentStep.file.fileName}
                  files={files.map((file) => ({
                    code: file.runtimeCode ?? "",
                    fileName: file.fileName,
                    lang: file.lang,
                    meta: file.meta,
                    needsRuntimeFetch: file.runtimeCode === undefined,
                  }))}
                  locale={locale}
                  stepIndex={selectedIndex}
                />
                <CopyButton text={activeCopyText} />
              </div>
            </div>
            <div
              key={activeFile.fileName}
              role="tabpanel"
              aria-label={activeFile.fileName}
              className="scrolly-stage__scroll"
            >
              {activeRender}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DynamicCodeBlock({
  code,
}: {
  code: string
}) {
  return (
    <pre className="bg-transparent px-4 py-3 text-[12px] leading-[19px] text-[var(--text)]">
      <code>{highlightJavaScript(code)}</code>
    </pre>
  )
}

const javascriptTokenPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|const|else|export|for|from|function|if|import|let|new|null|return|throw|true|false|try|catch|while)\b|\b\d+(?:\.\d+)?\b)/g

function highlightJavaScript(code: string) {
  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of code.matchAll(javascriptTokenPattern)) {
    const index = match.index

    if (index > cursor) {
      parts.push(code.slice(cursor, index))
    }

    parts.push(
      <span
        key={`${index}-${match[0]}`}
        className={`syntax-token syntax-token--${getTokenKind(match[0])}`}
      >
        {match[0]}
      </span>,
    )
    cursor = index + match[0].length
  }

  parts.push(code.slice(cursor))
  return parts
}

function getTokenKind(token: string) {
  if (token.startsWith("//") || token.startsWith("/*")) {
    return "comment"
  }

  if (/^["'`]/.test(token)) {
    return "string"
  }

  if (/^\d/.test(token)) {
    return "number"
  }

  return "keyword"
}
