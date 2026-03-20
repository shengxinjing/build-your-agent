"use client"

import Editor from "@monaco-editor/react"
import type * as Monaco from "monaco-editor"

type IdeEditorProps = {
  fileName: string
  language: string
  onChange: (value: string) => void
  value: string
}

export function IdeEditor({
  fileName,
  language,
  onChange,
  value,
}: IdeEditorProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden overscroll-contain rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(148,163,184,0.18)]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="w-16" />
        <div className="text-[15px] font-semibold text-slate-500">
          {fileName}
        </div>
        <div className="w-16 text-right text-[11px] uppercase tracking-[0.16em] text-slate-400">
          Editable
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden overscroll-contain">
        <Editor
          beforeMount={defineEditorTheme}
          defaultLanguage={language}
          language={language}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Loading editor...
            </div>
          }
          onChange={(nextValue) => {
            onChange(nextValue ?? "")
          }}
          options={{
            automaticLayout: true,
            cursorBlinking: "smooth",
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
          theme="webcontainers-home"
          value={value}
        />
      </div>
    </div>
  )
}

function defineEditorTheme(monaco: typeof Monaco) {
  monaco.editor.defineTheme("webcontainers-home", {
    base: "vs",
    inherit: true,
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#0F172A",
      "editor.lineHighlightBackground": "#FFFFFF",
      "editorLineNumber.foreground": "#4F8FBF",
      "editorLineNumber.activeForeground": "#2563EB",
      "editor.selectionBackground": "#DBEAFE",
      "editor.inactiveSelectionBackground": "#E2E8F0",
      "editorCursor.foreground": "#9333EA",
      "editorWhitespace.foreground": "#E2E8F0",
    },
    rules: [
      { token: "comment", foreground: "16A34A" },
      { token: "keyword", foreground: "C026D3" },
      { token: "string", foreground: "DC2626" },
      { token: "number", foreground: "2563EB" },
      { token: "identifier", foreground: "1D4ED8" },
      { token: "delimiter", foreground: "1E3A8A" },
      { token: "type", foreground: "7C3AED" },
      { token: "tag", foreground: "0F766E" },
    ],
  })
}
