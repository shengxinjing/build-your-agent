"use client"

import type {
  AnnotationHandler,
  HighlightedCode,
} from "codehike/code"
import type { ReactNode } from "react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSelectedIndex } from "codehike/utils/selection"
import { tokenTransitions } from "../components/annotations/token-transitions"
import { callout } from "../components/annotations/callout"
import { ThemedPre } from "../components/themed-pre"
import { CopyButton } from "./button"
import { focus } from "./focus"
import { LiveDemo } from "./livedemo"
import { mark } from "./mark"
import { useLlmSettings } from "./use-llm-settings"
import type { Locale } from "@/lib/i18n"
import { getNextActiveFileName } from "@/lib/tutorial-files"
import {
  injectLlmSettingsIntoHelper,
  localizeCodeComments,
} from "@/lib/build-your-agent-llm"

type CodeStageFile = {
  copyText: string
  fileName: string
  lang: string
  meta: string
  runtimeCode: string
}

type CodeStageStep = {
  entryFileName: string
  files: CodeStageFile[]
}

type HighlightedCodePair = {
  light: HighlightedCode
  dark: HighlightedCode
} | null

const borderHandler: AnnotationHandler = {
  name: "border",
  Block: ({ annotation, children }) => {
    const borderColor = annotation.query || "red"
    return <div style={{ border: "1px solid", borderColor }}>{children}</div>
  },
}

const bgHandler: AnnotationHandler = {
  name: "bg",
  Inline: ({ annotation, children }) => {
    const background = annotation.query || "#2d26"
    return <span style={{ background }}>{children}</span>
  },
}

const codeHandlers = [
  tokenTransitions,
  mark,
  focus,
  borderHandler,
  bgHandler,
  callout,
]

export function CodeStage({
  locale,
  highlightedCodes,
  sharedFiles,
  steps,
}: {
  locale: Locale
  highlightedCodes: HighlightedCodePair[][]
  sharedFiles: CodeStageFile[]
  steps: CodeStageStep[]
}) {
  const [selectedIndex] = useSelectedIndex()
  const {
    apiToken,
    llmProvider,
  } = useLlmSettings()
  const scrollRef = useRef<HTMLDivElement>(null)
  const resolvedSharedFiles = useMemo(
    () =>
      sharedFiles.map((file) => {
        if (file.fileName !== "helper.js") {
          return file
        }

        const localizedDisplayCode = localizeCodeComments(
          file.copyText,
          locale,
        )
        const localizedRuntimeCode = localizeCodeComments(
          file.runtimeCode,
          locale,
        )
        const settings = {
          apiToken,
          llmProvider,
        }
        const displayCode = injectLlmSettingsIntoHelper(
          localizedDisplayCode,
          settings,
        )
        const runtimeCode = injectLlmSettingsIntoHelper(
          localizedRuntimeCode,
          settings,
        )

        return {
          ...file,
          copyText: displayCode,
          runtimeCode,
        }
      }),
    [apiToken, llmProvider, locale, sharedFiles],
  )
  const selectedStep = steps[selectedIndex] || steps[0]
  const currentStep = useMemo(() => {
    if (!selectedStep) {
      return undefined
    }

    return {
      ...selectedStep,
      files: [
        ...selectedStep.files,
        ...resolvedSharedFiles.filter(
          (sharedFile) =>
            !selectedStep.files.some(
              (file) => file.fileName === sharedFile.fileName,
            ),
        ),
      ],
    }
  }, [resolvedSharedFiles, selectedStep])
  const currentHighlightedCodes =
    highlightedCodes[selectedIndex] ||
    highlightedCodes[0] ||
    []
  const [activeFileName, setActiveFileName] = useState<
    string | null
  >(
    getNextActiveFileName(
      null,
      currentStep?.files || [],
    ),
  )

  useEffect(() => {
    setActiveFileName((previousFileName) =>
      getNextActiveFileName(
        previousFileName,
        currentStep?.files || [],
      ),
    )
  }, [currentStep])

  const activeFileIndex = useMemo(() => {
    if (!currentStep) {
      return -1
    }

    return currentStep.files.findIndex(
      (file) => file.fileName === activeFileName,
    )
  }, [activeFileName, currentStep])

  const resolvedIndex =
    activeFileIndex >= 0 ? activeFileIndex : 0
  const activeFile =
    currentStep?.files[resolvedIndex] || null
  const highlightedCode =
    currentHighlightedCodes[resolvedIndex] || null
  const activeRender =
    activeFile?.fileName === "helper.js"
      ? (
        <DynamicCodeBlock
          code={activeFile.copyText}
        />
      )
      : highlightedCode
        ? (
          <ThemedPre
            light={highlightedCode.light}
            dark={highlightedCode.dark}
            handlers={codeHandlers}
            className="h-full bg-transparent pt-10"
          />
        )
        : null

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    })
  }, [activeFileName, selectedIndex])

  if (!currentStep || !activeFile) {
    return null
  }

  return (
    <div ref={scrollRef} className="scrolly-stage__scroll">
      {currentStep.files.length > 1 ? (
        <div className="scrolly-tabs" role="tablist">
          {currentStep.files.map((file) => {
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
        <div className="scrolly-code__meta">
          {activeFile.meta}
        </div>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
          <LiveDemo
            activeFileName={activeFile.fileName}
            entryFileName={currentStep.entryFileName}
            files={currentStep.files.map((file) => ({
              code: file.runtimeCode,
              fileName: file.fileName,
              lang: file.lang,
              meta: file.meta,
            }))}
            locale={locale}
          />
          <CopyButton text={activeFile.copyText} />
        </div>
        <div
          key={activeFile.fileName}
          role="tabpanel"
          aria-label={activeFile.fileName}
        >
          {activeRender}
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
    <pre className="overflow-x-auto bg-transparent px-6 pt-10 text-[13px] leading-6 text-[var(--text)]">
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
