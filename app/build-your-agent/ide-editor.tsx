"use client"

import Editor from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"
import { useDomThemeMode } from "@/components/theme-provider"
import { useEffect, useRef } from "react"

type IdeEditorProps = {
  fileName: string
  language: string
  onChange: (value: string) => void
  readOnly?: boolean
  value: string
}

export function IdeEditor({
  fileName,
  language,
  onChange,
  readOnly = false,
  value,
}: IdeEditorProps) {
  const domTheme = useDomThemeMode()
  const isDark = domTheme === "dark"
  const monacoRef = useRef<typeof Monaco | null>(null)
  const themeName = isDark ? "vs-dark" : "vs"

  useEffect(() => {
    if (!monacoRef.current) {
      return
    }

    monacoRef.current.editor.setTheme(themeName)
  }, [themeName])

  return (
    <div
      className="live-demo-panel flex h-full min-h-0 flex-col overflow-hidden overscroll-contain rounded-[28px] shadow-[0_30px_80px_rgba(15,23,42,0.16)] dark:shadow-[0_30px_80px_rgba(0,0,0,0.34)]"
    >
      <div className="live-demo-panel__header flex items-center justify-between border-b px-5 py-4">
        <div className="w-16" />
        <div className="live-demo-panel__title text-[15px] font-semibold">
          {fileName}
        </div>
        <div className="live-demo-panel__meta w-16 text-right text-[11px] uppercase tracking-[0.16em]">
          {readOnly ? "Read-only" : "Editable"}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden overscroll-contain">
        <Editor
          defaultLanguage={language}
          language={language}
          loading={
            <div className="live-demo-panel__loading flex h-full items-center justify-center text-sm">
              Loading editor...
            </div>
          }
          onMount={(_, monaco) => {
            monacoRef.current = monaco
            monaco.editor.setTheme(themeName)
          }}
          onChange={(nextValue) => {
            onChange(nextValue ?? "")
          }}
          options={{
            automaticLayout: true,
            cursorBlinking: readOnly ? "solid" : "smooth",
            readOnly,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontLigatures: true,
            fontSize: 14,
            glyphMargin: false,
            lineHeight: 26,
            lineNumbersMinChars: 2.6,
            minimap: { enabled: false },
            overviewRulerBorder: false,
            padding: {
              top: 18,
              bottom: 18,
            },
            renderLineHighlight: "none",
            roundedSelection: true,
            scrollBeyondLastLine: false,
            scrollbar: {
              alwaysConsumeMouseWheel: true,
              horizontalScrollbarSize: 8,
              verticalScrollbarSize: 8,
            },
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: "off",
          }}
          theme={themeName}
          value={value}
        />
      </div>
    </div>
  )
}
