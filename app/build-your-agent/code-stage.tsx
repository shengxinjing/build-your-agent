"use client"

import type { ReactNode } from "react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSelectedIndex } from "codehike/utils/selection"
import { CopyButton } from "./button"
import { LiveDemo } from "./livedemo"
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

export function CodeStage({
  locale,
  animatedRenders,
  staticRenders,
  steps,
}: {
  locale: Locale
  animatedRenders: ReactNode[][]
  staticRenders: ReactNode[][]
  steps: CodeStageStep[]
}) {
  const [selectedIndex] = useSelectedIndex()
  const {
    apiToken,
    llmProvider,
  } = useLlmSettings()
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousSelectedIndexRef = useRef(selectedIndex)
  const resolvedSteps = useMemo(
    () =>
      steps.map((step) => ({
        ...step,
        files: step.files.map((file) => {
          if (file.fileName !== "helper.js") {
            return file
          }

          const localizedCode = localizeCodeComments(
            file.runtimeCode,
            locale,
          )
          const code = injectLlmSettingsIntoHelper(
            localizedCode,
            {
              apiToken,
              llmProvider,
            },
          )

          return {
            ...file,
            copyText: code,
            runtimeCode: code,
          }
        }),
      })),
    [apiToken, llmProvider, locale, steps],
  )
  const currentStep =
    resolvedSteps[selectedIndex] || resolvedSteps[0]
  const currentAnimatedRenders =
    animatedRenders[selectedIndex] ||
    animatedRenders[0] ||
    []
  const currentStaticRenders =
    staticRenders[selectedIndex] ||
    staticRenders[0] ||
    []
  const [activeFileName, setActiveFileName] = useState<
    string | null
  >(
    getNextActiveFileName(
      null,
      currentStep?.files || [],
    ),
  )
  const [renderMode, setRenderMode] = useState<
    "animated" | "static"
  >("animated")

  useEffect(() => {
    setActiveFileName((previousFileName) =>
      getNextActiveFileName(
        previousFileName,
        currentStep?.files || [],
      ),
    )
  }, [currentStep])

  useEffect(() => {
    if (previousSelectedIndexRef.current !== selectedIndex) {
      setRenderMode("animated")
      previousSelectedIndexRef.current = selectedIndex
    }
  }, [selectedIndex])

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
  const activeRender =
    activeFile?.fileName === "helper.js"
      ? (
        <DynamicCodeBlock code={activeFile.copyText} />
      )
      : renderMode === "static"
      ? currentStaticRenders[resolvedIndex] || null
      : currentAnimatedRenders[resolvedIndex] || null

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
                  setRenderMode("static")
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
    <pre className="overflow-x-auto bg-transparent px-6 pt-10 text-[13px] leading-6 text-slate-800 dark:text-[#ddd6cf]">
      <code>{code}</code>
    </pre>
  )
}
