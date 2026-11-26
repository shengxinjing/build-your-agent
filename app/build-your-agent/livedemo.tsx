"use client"

import type {
  FileSystemTree,
  WebContainer,
  WebContainerProcess,
} from "@webcontainer/api"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"
import {
  ChevronRight,
  File,
  FileJson,
  FileText,
  Play,
  RefreshCw,
  X,
} from "lucide-react"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useDomThemeMode } from "@/components/theme-provider"
import type { Locale } from "@/lib/i18n"
import {
  getEditorLanguage,
  getExtension,
} from "@/lib/tutorial-files"
import { loadStepRuntimeCode } from "@/lib/tutorial-runtime-client"

const IdeEditor = dynamic(
  () => import("./ide-editor").then((module) => module.IdeEditor),
  {
    loading: () => (
      <div className="live-demo-panel flex h-full items-center justify-center rounded-[10px] text-xs">
        Loading editor...
      </div>
    ),
    ssr: false,
  },
)

declare global {
  var __scrollycodingWebContainerPromise:
    | Promise<WebContainer>
    | undefined
  var __scrollycodingShellProcess:
    | WebContainerProcess
    | undefined
  var __scrollycodingManagedFiles:
    | string[]
    | undefined
}

type LiveDemoProps = {
  activeFileName: string
  entryFileName: string
  files: DemoFile[]
  locale: Locale
  stepIndex: number
}

type DemoFile = {
  code: string
  fileName: string
  lang: string
  meta: string
  needsRuntimeFetch?: boolean
}

type Status =
  | "idle"
  | "booting"
  | "syncing"
  | "starting"
  | "ready"
  | "error"

type TerminalRuntime = {
  fitAddon: FitAddon
  inputCleanup?: () => void
  inputWriter?: WritableStreamDefaultWriter<string>
  terminal: Terminal
}

type WorkspaceFileEntry = {
  contents: string
  fileName: string
}

type WorkspaceFiles = {
  allFiles: WorkspaceFileEntry[]
  entryFileName: string
  fileName: string
  managedPaths: string[]
  suggestedCommands: CommandAction[]
  tree: FileSystemTree
}

type CommandAction = {
  command: string
  label: string
}

export function LiveDemo({
  activeFileName,
  entryFileName,
  files,
  locale,
  stepIndex,
}: LiveDemoProps) {
  const domTheme = useDomThemeMode()
  const isDark = domTheme === "dark"
  const copy = liveDemoCopy[locale]
  const [loadedRuntime, setLoadedRuntime] = useState<{
    code: string
    stepIndex: number
  } | null>(null)
  const needsRuntimeFetch = files.some(
    (file) => file.needsRuntimeFetch,
  )
  const runtimeReady =
    !needsRuntimeFetch ||
    loadedRuntime?.stepIndex === stepIndex
  const resolvedFiles = useMemo(() => {
    const runtimeCode =
      loadedRuntime?.stepIndex === stepIndex
        ? loadedRuntime.code
        : null

    if (runtimeCode === null) {
      return files
    }

    return files.map((file) =>
      file.needsRuntimeFetch
        ? { ...file, code: runtimeCode, needsRuntimeFetch: false }
        : file,
    )
  }, [files, loadedRuntime, stepIndex])
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [runNonce, setRunNonce] = useState(0)

  const baseWorkspace = useMemo(
    () =>
      open
        ? createWorkspaceFiles({
            activeFileName,
            entryFileName,
            files: resolvedFiles,
          })
        : null,
    [activeFileName, entryFileName, open, resolvedFiles],
  )
  const [drafts, setDrafts] = useState<
    Record<string, string>
  >({})
  const [editorFileName, setEditorFileName] =
    useState(activeFileName)
  const workspace = useMemo(() => {
    if (!baseWorkspace) {
      return null
    }

    const tree = { ...baseWorkspace.tree }

    for (const entry of baseWorkspace.allFiles) {
      const draft = drafts[entry.fileName]

      if (draft !== undefined) {
        tree[entry.fileName] = {
          file: { contents: draft },
        }
      }
    }

    return { ...baseWorkspace, tree }
  }, [baseWorkspace, drafts])
  const editorValue = drafts[editorFileName] ?? ""

  const mountedRef = useRef(true)
  const activeBootRef = useRef(0)
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRuntimeRef =
    useRef<TerminalRuntime | null>(null)
  const resizeObserverRef =
    useRef<ResizeObserver | null>(null)
  const webcontainerErrorCleanupRef =
    useRef<(() => void) | null>(null)
  const workspaceMountedRef = useRef(false)
  const workspaceRef = useRef<WorkspaceFiles | null>(workspace)
  const filesRef = useRef(files)
  const activeFileNameRef = useRef(activeFileName)
  const entryFileNameRef = useRef(entryFileName)
  const stepIndexRef = useRef(stepIndex)
  const loadedRuntimeStepRef = useRef<number | null>(null)
  const closeWorkspaceRef =
    useRef<(() => void) | null>(null)
  const lastOpenThemeRef = useRef(domTheme)
  const scrollLockRef = useRef<{
    bodyOverflow: string
    bodyPaddingRight: string
    htmlOverflow: string
  } | null>(null)

  useEffect(() => {
    if (!baseWorkspace) {
      return
    }

    setDrafts(
      Object.fromEntries(
        baseWorkspace.allFiles.map((f) => [
          f.fileName,
          f.contents,
        ]),
      ),
    )
  }, [baseWorkspace])

  useEffect(() => {
    if (!open) {
      return
    }

    setEditorFileName(activeFileName)
  }, [activeFileName, open])

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    filesRef.current = files
    activeFileNameRef.current = activeFileName
    entryFileNameRef.current = entryFileName
    stepIndexRef.current = stepIndex
  }, [activeFileName, entryFileName, files, stepIndex])

  const terminalTheme = useMemo(
    () => getTerminalTheme(domTheme),
    [domTheme],
  )

  const fitTerminal = useCallback(() => {
    const runtime = terminalRuntimeRef.current

    if (!runtime) {
      return
    }

    runtime.fitAddon.fit()

    globalThis.__scrollycodingShellProcess?.resize({
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows,
    })
  }, [])

  const focusTerminal = useCallback(() => {
    terminalRuntimeRef.current?.terminal.focus()
  }, [])

  const disposeTerminal = useCallback(() => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null

    const runtime = terminalRuntimeRef.current

    resetRuntimeIO(runtime)
    runtime?.terminal.dispose()
    terminalRuntimeRef.current = null
  }, [])

  const stopShell = useCallback(async () => {
    const shellProcess =
      globalThis.__scrollycodingShellProcess

    resetRuntimeIO(terminalRuntimeRef.current)

    if (!shellProcess) {
      return
    }

    shellProcess.kill()

    try {
      await shellProcess.exit
    } catch {
      // ignore exit errors triggered by kill()
    } finally {
      globalThis.__scrollycodingShellProcess = undefined
    }
  }, [])

  const ensureTerminal = useCallback(async () => {
    if (terminalRuntimeRef.current) {
      return terminalRuntimeRef.current
    }

    const host = terminalHostRef.current

    if (!host) {
      throw new Error(
        "Terminal host is not ready yet. Please try again.",
      )
    }

    const [{ FitAddon }, { Terminal }] = await Promise.all([
      import("@xterm/addon-fit"),
      import("@xterm/xterm"),
      import("./xterm-styles"),
    ])
    const fitAddon = new FitAddon()
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'var(--font-mono), "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      overviewRuler: {
        showBottomBorder: false,
        showTopBorder: false,
        width: 6,
      },
      theme: terminalTheme,
    })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeWorkspaceRef.current?.()
        return false
      }

      return true
    })

    terminal.loadAddon(fitAddon)
    terminal.open(host)

    const runtime = {
      fitAddon,
      terminal,
    } satisfies TerminalRuntime

    terminalRuntimeRef.current = runtime

    resizeObserverRef.current = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitTerminal()
      })
    })

    resizeObserverRef.current.observe(host)

    requestAnimationFrame(() => {
      fitTerminal()
      terminal.focus()
    })

    return runtime
  }, [fitTerminal, terminalTheme])

  useEffect(() => {
    const runtime = terminalRuntimeRef.current

    if (!runtime) {
      return
    }

    runtime.terminal.options.theme = terminalTheme
    runtime.terminal.refresh(
      0,
      Math.max(runtime.terminal.rows - 1, 0),
    )

    requestAnimationFrame(() => {
      fitTerminal()
    })
  }, [fitTerminal, terminalTheme])

  const bootWorkspace = useCallback(async () => {
    const bootId = activeBootRef.current + 1
    activeBootRef.current = bootId

    setStatus("booting")
    setError(null)

    if (!window.crossOriginIsolated) {
      setStatus("error")
      setError(
        "当前页面还没有开启 cross-origin isolation。请重启 Next 开发服务器后再刷新页面。",
      )
      return
    }

    try {
      const step = stepIndexRef.current
      const currentFiles = filesRef.current
      const needsFetch =
        currentFiles.some((file) => file.needsRuntimeFetch) &&
        loadedRuntimeStepRef.current !== step

      const runtime = await ensureTerminal()

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
      }

      runtime.terminal.clear()
      runtime.terminal.writeln("Booting...")

      const [instance, fetchedCode] = await Promise.all([
        getWebContainer(),
        needsFetch
          ? loadStepRuntimeCode(step)
          : Promise.resolve(null),
      ])

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
      }

      const targetWorkspace =
        fetchedCode !== null
          ? createWorkspaceFiles({
              activeFileName: activeFileNameRef.current,
              entryFileName: entryFileNameRef.current,
              files: currentFiles.map((file) =>
                file.needsRuntimeFetch
                  ? {
                      ...file,
                      code: fetchedCode,
                      needsRuntimeFetch: false,
                    }
                  : file,
              ),
            })
          : workspaceRef.current ??
            createWorkspaceFiles({
              activeFileName: activeFileNameRef.current,
              entryFileName: entryFileNameRef.current,
              files: currentFiles,
            })

      if (fetchedCode !== null) {
        loadedRuntimeStepRef.current = step
        setLoadedRuntime({ stepIndex: step, code: fetchedCode })
      }

      webcontainerErrorCleanupRef.current?.()
      webcontainerErrorCleanupRef.current = instance.on(
        "error",
        ({ message }) => {
          runtime.terminal.writeln(`\r\n[error] ${message}`)
        },
      )

      setStatus("syncing")
      workspaceMountedRef.current = false

      await syncManagedFiles(instance, targetWorkspace)
      workspaceMountedRef.current = true

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
      }

      setStatus("starting")

      await startShell(instance, runtime)

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
      }

      requestAnimationFrame(() => {
        fitTerminal()
        runtime.terminal.focus()
      })

      setStatus("ready")
    } catch (cause) {
      setStatus("error")
      setError(getErrorMessage(cause))
    }
  }, [ensureTerminal, fitTerminal])

  useEffect(() => {
    if (
      !open ||
      !needsRuntimeFetch ||
      loadedRuntime?.stepIndex === stepIndex
    ) {
      return
    }

    let cancelled = false

    void loadStepRuntimeCode(stepIndex)
      .then((code) => {
        if (cancelled) {
          return
        }

        loadedRuntimeStepRef.current = stepIndex
        setLoadedRuntime({ stepIndex, code })
      })
      .catch((cause) => {
        if (cancelled) {
          return
        }

        setError(getErrorMessage(cause))
      })

    return () => {
      cancelled = true
    }
  }, [
    loadedRuntime?.stepIndex,
    needsRuntimeFetch,
    open,
    stepIndex,
  ])

  useEffect(() => {
    if (!open) {
      lastOpenThemeRef.current = domTheme
      return
    }

    if (lastOpenThemeRef.current === domTheme) {
      return
    }

    lastOpenThemeRef.current = domTheme

    let cancelled = false

    void (async () => {
      activeBootRef.current += 1
      workspaceMountedRef.current = false
      webcontainerErrorCleanupRef.current?.()
      webcontainerErrorCleanupRef.current = null
      await stopShell()
      disposeTerminal()

      if (cancelled) {
        return
      }

      void bootWorkspace()
    })()

    return () => {
      cancelled = true
    }
  }, [
    bootWorkspace,
    disposeTerminal,
    domTheme,
    open,
    stopShell,
  ])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      workspaceMountedRef.current = false
      webcontainerErrorCleanupRef.current?.()
      webcontainerErrorCleanupRef.current = null
      void stopShell()
      disposeTerminal()
    }
  }, [disposeTerminal, stopShell])

  useEffect(() => {
    if (!open || runNonce === 0) {
      return
    }

    void bootWorkspace()
  }, [bootWorkspace, open, runNonce])

  useEffect(() => {
    if (!open) {
      return
    }

    requestAnimationFrame(() => {
      fitTerminal()
    })
  }, [fitTerminal, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void closeWorkspace()
      }
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      )
    }
    // closeWorkspace intentionally stays outside deps here to preserve
    // the original modal behavior while keeping the reverted article code path stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const body = document.body
    const html = document.documentElement
    const scrollbarWidth =
      window.innerWidth - html.clientWidth

    scrollLockRef.current = {
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverflow: html.style.overflow,
    }

    body.style.overflow = "hidden"
    html.style.overflow = "hidden"
    html.dataset.liveDemoOpen = "true"

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      const previous = scrollLockRef.current

      if (!previous) {
        return
      }

      body.style.overflow = previous.bodyOverflow
      body.style.paddingRight =
        previous.bodyPaddingRight
      html.style.overflow = previous.htmlOverflow
      delete html.dataset.liveDemoOpen
      scrollLockRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !workspaceMountedRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void writeWorkspaceFile(
        editorFileName,
        editorValue,
      )
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [editorFileName, editorValue, open])

  const openWorkspace = () => {
    setEditorFileName(activeFileName)
    setOpen(true)
    setRunNonce((current) => current + 1)
  }

  const closeWorkspace = async () => {
    activeBootRef.current += 1
    workspaceMountedRef.current = false
    loadedRuntimeStepRef.current = null
    setLoadedRuntime(null)
    setOpen(false)
    setStatus("idle")
    setError(null)
    webcontainerErrorCleanupRef.current?.()
    webcontainerErrorCleanupRef.current = null
    await stopShell()
    disposeTerminal()
  }

  useEffect(() => {
    closeWorkspaceRef.current = () => {
      void closeWorkspace()
    }

    return () => {
      closeWorkspaceRef.current = null
    }
  })

  return (
    <>
      <button
        type="button"
        onClick={openWorkspace}
        className="scrolly-run-button"
        aria-label={`Open ${activeFileName} in WebContainer terminal`}
      >
        <Play size={12} />
        <span>{locale === "cn" ? "运行" : "Run"}</span>
      </button>

      {open && workspace && typeof document !== "undefined"
        ? createPortal(
          <div
            className="live-demo-overlay fixed inset-0 z-50 overflow-hidden overscroll-none p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
          >
          <div className="live-demo-shell mx-auto flex h-full max-w-[118rem] flex-col overflow-hidden rounded-[14px] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold live-demo-heading">
                  Playground
                </div>

              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={status}
                  isDark={isDark}
                />

                <button
                  type="button"
                  onClick={() =>
                    setRunNonce((current) => current + 1)
                  }
                  className="live-demo-control inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition"
                >
                  <RefreshCw size={13} />
                  Remount
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void closeWorkspace()
                  }}
                  className="live-demo-control inline-flex items-center justify-center rounded-full p-1.5 transition"
                  aria-label="Close live demo"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)] xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.72fr)]">
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-2.5">
                  <div className="live-demo-muted mt-0.5 text-xs leading-5">
                    {copy.editableHint}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 gap-2.5">
                  <FileTree
                    files={workspace.allFiles}
                    activeFileName={editorFileName}
                    onSelect={setEditorFileName}
                  />

                  <div className="min-h-0 min-w-0 flex-1">
                    {runtimeReady ? (
                      <IdeEditor
                        key={editorFileName}
                        fileName={editorFileName}
                        language={getEditorLanguage(
                          editorFileName,
                        )}
                        onChange={(value) => {
                          setDrafts((current) => ({
                            ...current,
                            [editorFileName]: value,
                          }))
                        }}
                        value={editorValue}
                      />
                    ) : (
                      <div className="live-demo-panel flex h-full items-center justify-center rounded-[10px] text-xs">
                        Loading editor...
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-2.5">
                  <div className="live-demo-muted mt-0.5 text-xs leading-5">
                    {copy.terminalHintPrefix}{" "}
                    <code className="live-demo-inline-code rounded-md px-1.5 py-0.5 text-[11px] font-medium">
                      {`node ${workspace.entryFileName}`}
                    </code>{" "}
                    {copy.terminalHintSuffix}
                  </div>
                  {error ? (
                    <p className="mt-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden">
                  <div className="live-demo-panel min-h-0 min-w-0 rounded-[10px] p-3 shadow-[0_30px_80px_rgba(15,23,42,0.12)]">
                    <div className="live-demo-terminal-shell h-full min-h-[16rem] w-full min-w-0 overflow-hidden rounded-[8px] lg:min-h-[18rem]">
                      <div
                        ref={terminalHostRef}
                        className="live-demo-terminal h-full w-full min-h-0 min-w-0 cursor-text"
                        onClick={focusTerminal}
                        onMouseDown={focusTerminal}
                      />
                    </div>
                  </div>

                  <div className="grid min-w-0 shrink-0 gap-2.5 sm:grid-cols-2">
                    {workspace.suggestedCommands.map(
                      ({ command, label }) => (
                        <QuickActionCard
                          key={command}
                          command={command}
                          label={label}
                          onClick={() => {
                            void runTerminalCommand(
                              terminalRuntimeRef.current,
                              command,
                            )
                          }}
                        />
                      ),
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>,
          document.body,
        )
        : null}
    </>
  )
}

const liveDemoCopy: Record<
  Locale,
  {
    editableHint: string
    terminalHintPrefix: string
    terminalHintSuffix: string
  }
> = {
  en: {
    editableHint:
      "The code on the left is editable, and you can run commands directly in the terminal on the right.",
    terminalHintPrefix: "We recommend running",
    terminalHintSuffix:
      "first, or using one of the quick commands below.",
  },
  cn: {
    editableHint:
      "左侧代码可编辑，右侧终端可直接执行命令。",
    terminalHintPrefix: "推荐先运行",
    terminalHintSuffix:
      "或者直接点下面的快捷命令。",
  },
}

function StatusBadge({
  status,
  isDark,
}: {
  status: Status
  isDark: boolean
}) {
  const label = {
    idle: "Idle",
    booting: "Booting",
    syncing: "Syncing files",
    starting: "Starting shell",
    ready: "Ready",
    error: "Error",
  }[status]

  const className = isDark
    ? {
      idle: "border-white/12 bg-white/6 text-[#e2e8f0]",
      booting: "border-amber-500/30 bg-amber-500/12 text-amber-200",
      syncing: "border-sky-500/30 bg-sky-500/12 text-sky-200",
      starting: "border-sky-500/30 bg-sky-500/12 text-sky-200",
      ready: "border-emerald-500/30 bg-emerald-500/12 text-emerald-200",
      error: "border-rose-500/30 bg-rose-500/12 text-rose-200",
    }[status]
    : {
      idle: "border-slate-200 bg-white text-slate-600",
      booting: "border-amber-200 bg-amber-50 text-amber-700",
      syncing: "border-sky-200 bg-sky-50 text-sky-700",
      starting: "border-sky-200 bg-sky-50 text-sky-700",
      ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
      error: "border-rose-200 bg-rose-50 text-rose-700",
    }[status]

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-sm ${className}`}
    >
      {label}
    </span>
  )
}

function FileTree({
  files,
  activeFileName,
  onSelect,
}: {
  files: WorkspaceFileEntry[]
  activeFileName: string
  onSelect: (fileName: string) => void
}) {
  return (
    <div className="live-demo-file-tree shrink-0 overflow-y-auto rounded-[10px] py-2.5">
      <div className="live-demo-file-tree__header px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
        Files
      </div>
      {files.map((file) => {
        const isActive =
          file.fileName === activeFileName

        return (
          <button
            key={file.fileName}
            type="button"
            onClick={() => onSelect(file.fileName)}
            className={`live-demo-file-tree__item flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs transition ${
              isActive
                ? "live-demo-file-tree__item--active"
                : ""
            }`}
          >
            <FileIcon fileName={file.fileName} />
            <span className="min-w-0 truncate">
              {file.fileName}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FileIcon({
  fileName,
}: {
  fileName: string
}) {
  const ext = getExtension(fileName)

  if (fileName === "package.json" || ext === "json") {
    return (
      <FileJson
        size={13}
        className="shrink-0 opacity-60"
      />
    )
  }

  if (ext === "md") {
    return (
      <FileText
        size={13}
        className="shrink-0 opacity-60"
      />
    )
  }

  return (
    <File
      size={13}
      className="shrink-0 opacity-60"
    />
  )
}

function QuickActionCard({
  command,
  label,
  onClick,
}: CommandAction & {
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="live-demo-command-card min-w-0 rounded-[10px] px-3.5 py-2.5 text-left transition hover:-translate-y-0.5"
    >
      <div className="live-demo-command-card__label text-xs font-semibold">
        {label}
      </div>
      <div className="live-demo-command-card__row mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-semibold">
        <ChevronRight size={14} className="live-demo-command-card__icon shrink-0" />
        <code className="live-demo-command-card__code min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-1.5 py-0.5">
          {command}
        </code>
      </div>
    </button>
  )
}

function getTerminalTheme(theme: "light" | "dark") {
  if (theme === "dark") {
    return {
      background: "#0b101b",
      black: "#0b101b",
      blue: "#60a5fa",
      brightBlack: "#64748b",
      brightBlue: "#93c5fd",
      brightCyan: "#7dd3fc",
      brightGreen: "#6ee7b7",
      brightMagenta: "#f0abfc",
      brightRed: "#fca5a5",
      brightWhite: "#f8fafc",
      brightYellow: "#fde68a",
      cursor: "#38bdf8",
      cyan: "#38bdf8",
      foreground: "#e2e8f0",
      green: "#34d399",
      magenta: "#e879f9",
      red: "#f87171",
      overviewRulerBorder: "transparent",
      scrollbarSliderActiveBackground:
        "rgba(148, 163, 184, 0.28)",
      scrollbarSliderBackground:
        "rgba(148, 163, 184, 0.16)",
      scrollbarSliderHoverBackground:
        "rgba(148, 163, 184, 0.22)",
      selectionBackground: "rgba(56, 189, 248, 0.25)",
      white: "#e2e8f0",
      yellow: "#fbbf24",
    }
  }

  return {
    background: "#f8fafc",
    black: "#0f172a",
    blue: "#2563eb",
    brightBlack: "#64748b",
    brightBlue: "#3b82f6",
    brightCyan: "#0ea5e9",
    brightGreen: "#059669",
    brightMagenta: "#c026d3",
    brightRed: "#dc2626",
    brightWhite: "#0f172a",
    brightYellow: "#ca8a04",
    cursor: "#2563eb",
    cyan: "#0284c7",
    foreground: "#0f172a",
    green: "#059669",
    magenta: "#c026d3",
    red: "#dc2626",
    overviewRulerBorder: "transparent",
    scrollbarSliderActiveBackground:
      "rgba(148, 163, 184, 0.28)",
    scrollbarSliderBackground:
      "rgba(148, 163, 184, 0.16)",
    scrollbarSliderHoverBackground:
      "rgba(148, 163, 184, 0.22)",
    selectionBackground: "#dbeafe",
    white: "#0f172a",
    yellow: "#ca8a04",
  }
}

async function getWebContainer() {
  if (!globalThis.__scrollycodingWebContainerPromise) {
    globalThis.__scrollycodingWebContainerPromise = import(
      "@webcontainer/api"
    )
      .then(({ WebContainer }) =>
        WebContainer.boot({
          coep: "credentialless",
          workdirName: "scrollycoding-demo",
        }),
      )
      .catch((cause) => {
        globalThis.__scrollycodingWebContainerPromise =
          undefined
        throw cause
      })
  }

  return globalThis.__scrollycodingWebContainerPromise
}

async function startShell(
  instance: WebContainer,
  runtime: TerminalRuntime | null,
) {
  if (!runtime) {
    return
  }

  resetRuntimeIO(runtime)

  const previousShell =
    globalThis.__scrollycodingShellProcess

  if (previousShell) {
    previousShell.kill()

    try {
      await previousShell.exit
    } catch {
      // ignore exit errors triggered by kill()
    }
  }

  const shellProcess = await instance.spawn("jsh", {
    terminal: {
      cols: runtime.terminal.cols,
      rows: runtime.terminal.rows,
    },
  })

  globalThis.__scrollycodingShellProcess = shellProcess

  shellProcess.output
    .pipeTo(
      new WritableStream({
        write(data) {
          runtime.terminal.write(data)
        },
      }),
    )
    .catch(() => {
      // stream ends when shell is killed
    })

  const inputWriter = shellProcess.input.getWriter()
  runtime.inputWriter = inputWriter
  const dataSubscription = runtime.terminal.onData(
    (data) => {
      void inputWriter.write(data)
    },
  )

  runtime.inputCleanup = () => {
    dataSubscription.dispose()
  }
}

function resetRuntimeIO(runtime: TerminalRuntime | null) {
  runtime?.inputCleanup?.()
  if (runtime?.inputWriter) {
    runtime.inputWriter.releaseLock()
  }

  if (runtime) {
    runtime.inputCleanup = undefined
    runtime.inputWriter = undefined
  }
}

async function syncManagedFiles(
  instance: WebContainer,
  workspace: WorkspaceFiles,
) {
  const previousFiles =
    globalThis.__scrollycodingManagedFiles || []

  await Promise.all(
    previousFiles.map((path) =>
      instance.fs
        .rm(path, {
          force: true,
          recursive: true,
        })
        .catch(() => undefined),
    ),
  )

  await instance.mount(workspace.tree)
  globalThis.__scrollycodingManagedFiles =
    workspace.managedPaths
}

function createWorkspaceFiles({
  activeFileName,
  entryFileName,
  files,
}: {
  activeFileName: string
  entryFileName: string
  files: DemoFile[]
}): WorkspaceFiles {
  const fileName = activeFileName

  const readmeContents = [
    "# Scrollycoding Demo",
    "",
    `Entry file: ${entryFileName}`,
    "",
    "Useful commands:",
    ...getSuggestedCommands(entryFileName).map(
      ({ command }) => `- ${command}`,
    ),
  ].join("\n")

  const packageJsonContents = JSON.stringify(
    {
      name: "scrollycoding-live-demo",
      private: true,
      type: "module",
    },
    null,
    2,
  )

  const allFiles: WorkspaceFileEntry[] = [
    ...files.map((file) => ({
      contents: file.code,
      fileName: file.fileName,
    })),
    {
      contents: packageJsonContents,
      fileName: "package.json",
    },
    {
      contents: readmeContents,
      fileName: "README.md",
    },
  ]

  return {
    allFiles,
    entryFileName,
    fileName,
    managedPaths: [
      "README.md",
      "package.json",
      ...files.map((file) => file.fileName),
    ],
    suggestedCommands: getSuggestedCommands(entryFileName),
    tree: {
      ...Object.fromEntries(
        files.map((file) => [
          file.fileName,
          {
            file: {
              contents: file.code,
            },
          },
        ]),
      ),
      "README.md": {
        file: { contents: readmeContents },
      },
      "package.json": {
        file: { contents: packageJsonContents },
      },
    },
  }
}

function getSuggestedCommands(fileName: string) {
  const extension = getExtension(fileName)

  if (extension === "js" || extension === "mjs") {
    return [
      {
        command: `node ${fileName}`,
        label: `Run ${fileName}`,
      },
      {
        command: "ls",
        label: "List files",
      },
    ]
  }

  return [
    {
      command: `cat ${fileName}`,
      label: `Show ${fileName}`,
    },
    {
      command: "ls",
      label: "List files",
    },
  ]
}

async function runTerminalCommand(
  runtime: TerminalRuntime | null,
  command: string,
) {
  const writer = runtime?.inputWriter

  if (!writer) {
    return
  }

  await writer.write(`${command}\r`)
  runtime?.terminal.focus()
}

async function writeWorkspaceFile(
  fileName: string,
  contents: string,
) {
  const instance = await getWebContainer()
  await instance.fs.writeFile(fileName, contents)
}

function getErrorMessage(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message
  }

  return "Failed to start the WebContainer shell."
}
