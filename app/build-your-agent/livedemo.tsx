"use client"

import type {
  FileSystemTree,
  WebContainer,
  WebContainerProcess,
} from "@webcontainer/api"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import {
  ChevronRight,
  File,
  FileJson,
  FileText,
  Play,
  RefreshCw,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { IdeEditor } from "./ide-editor"
import { useDomThemeMode } from "@/components/theme-provider"
import type { Locale } from "@/lib/i18n"

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
}

type DemoFile = {
  code: string
  fileName: string
  lang: string
  meta: string
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
}: LiveDemoProps) {
  const domTheme = useDomThemeMode()
  const isDark = domTheme === "dark"
  const copy = liveDemoCopy[locale]
  const baseWorkspace = useMemo(
    () =>
      createWorkspaceFiles({
        activeFileName,
        entryFileName,
        files,
      }),
    [activeFileName, entryFileName, files],
  )
  const [drafts, setDrafts] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      baseWorkspace.allFiles.map((f) => [
        f.fileName,
        f.contents,
      ]),
    ),
  )
  const [editorFileName, setEditorFileName] =
    useState(activeFileName)
  const workspace = useMemo(() => {
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

  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [runNonce, setRunNonce] = useState(0)

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
  const workspaceRef = useRef(workspace)
  const closeWorkspaceRef =
    useRef<(() => void) | null>(null)
  const lastOpenThemeRef = useRef(domTheme)
  const scrollLockRef = useRef<{
    bodyOverflow: string
    bodyPaddingRight: string
    htmlOverflow: string
  } | null>(null)

  useEffect(() => {
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
    setEditorFileName(activeFileName)
  }, [activeFileName])

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

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

    const fitAddon = new FitAddon()
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 15,
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
    const currentWorkspace = workspaceRef.current

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
      const runtime = await ensureTerminal()

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
      }

      runtime.terminal.clear()
      runtime.terminal.writeln("Booting...")

      const instance = await getWebContainer()

      if (
        !mountedRef.current ||
        activeBootRef.current !== bootId
      ) {
        return
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

      await syncManagedFiles(instance, currentWorkspace)
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
    setOpen(true)
    setRunNonce((current) => current + 1)
  }

  const closeWorkspace = async () => {
    activeBootRef.current += 1
    workspaceMountedRef.current = false
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
        className="scrolly-icon-button"
        aria-label={`Open ${workspace.fileName} in WebContainer terminal`}
      >
        <Play size={14} />
      </button>

      {open ? (
        <div
          className="live-demo-overlay fixed inset-0 z-50 overflow-hidden overscroll-none p-5"
          role="dialog"
          aria-modal="true"
        >
          <div className="live-demo-shell mx-auto flex h-full max-w-[118rem] flex-col overflow-hidden rounded-[36px] p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
              <div className="min-w-0">
                <div className="text-sm font-semibold live-demo-heading">
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
                  className="live-demo-control inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition"
                >
                  <RefreshCw size={15} />
                  Remount
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void closeWorkspace()
                  }}
                  className="live-demo-control inline-flex items-center justify-center rounded-full p-2 transition"
                  aria-label="Close live demo"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 min-w-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] xl:grid-cols-[minmax(0,1.08fr)_minmax(26rem,0.92fr)]">
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-4">
                  <div className="live-demo-muted mt-1 text-sm leading-6">
                    {copy.editableHint}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 gap-3">
                  <FileTree
                    files={workspace.allFiles}
                    activeFileName={editorFileName}
                    onSelect={setEditorFileName}
                  />

                  <div className="min-h-0 min-w-0 flex-1">
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
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-4">
                  <div className="live-demo-muted mt-1 text-sm leading-6">
                    {copy.terminalHintPrefix}{" "}
                    <code className="live-demo-inline-code rounded-md px-1.5 py-0.5 text-[13px] font-medium">
                      {`node ${workspace.entryFileName}`}
                    </code>{" "}
                    {copy.terminalHintSuffix}
                  </div>
                  {error ? (
                    <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
                  <div className="live-demo-panel min-h-0 min-w-0 rounded-[28px] p-4 shadow-[0_30px_80px_rgba(148,163,184,0.15)]">
                    <div className="live-demo-terminal-shell h-full min-h-[18rem] w-full min-w-0 overflow-hidden rounded-[22px] lg:min-h-[20rem]">
                      <div
                        ref={terminalHostRef}
                        className="live-demo-terminal h-full w-full min-h-0 min-w-0 cursor-text"
                        onClick={focusTerminal}
                        onMouseDown={focusTerminal}
                      />
                    </div>
                  </div>

                  <div className="grid min-w-0 shrink-0 gap-3 sm:grid-cols-2">
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
        </div>
      ) : null}
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
      idle: "border-white/12 bg-white/6 text-[#d7d1cb]",
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
      className={`rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${className}`}
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
    <div className="live-demo-file-tree shrink-0 overflow-y-auto rounded-[20px] py-3">
      <div className="live-demo-file-tree__header px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
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
            className={`live-demo-file-tree__item flex w-full items-center gap-2 px-4 py-1.5 text-left text-[13px] transition ${
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
        size={14}
        className="shrink-0 opacity-60"
      />
    )
  }

  if (ext === "md") {
    return (
      <FileText
        size={14}
        className="shrink-0 opacity-60"
      />
    )
  }

  return (
    <File
      size={14}
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
      className="live-demo-command-card min-w-0 rounded-[22px] px-5 py-4 text-left transition hover:-translate-y-0.5"
    >
      <div className="live-demo-command-card__label text-sm font-semibold">
        {label}
      </div>
      <div className="live-demo-command-card__row mt-3 flex min-w-0 items-center gap-3 text-[15px] font-semibold">
        <ChevronRight size={18} className="live-demo-command-card__icon" />
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
      background: "#0d0f14",
      black: "#0d0f14",
      blue: "#7aa2f7",
      brightBlack: "#6b7280",
      brightBlue: "#93c5fd",
      brightCyan: "#67e8f9",
      brightGreen: "#6ee7b7",
      brightMagenta: "#f0abfc",
      brightRed: "#fca5a5",
      brightWhite: "#f8fafc",
      brightYellow: "#fde68a",
      cursor: "#d68f6f",
      cyan: "#22d3ee",
      foreground: "#e7ddd2",
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
      selectionBackground: "rgba(122, 162, 247, 0.26)",
      white: "#e7ddd2",
      yellow: "#f59e0b",
    }
  }

  return {
    background: "#ffffff",
    black: "#0f172a",
    blue: "#2563eb",
    brightBlack: "#64748b",
    brightBlue: "#2563eb",
    brightCyan: "#0ea5e9",
    brightGreen: "#16a34a",
    brightMagenta: "#d946ef",
    brightRed: "#ef4444",
    brightWhite: "#0f172a",
    brightYellow: "#ca8a04",
    cursor: "#d946ef",
    cyan: "#0891b2",
    foreground: "#334155",
    green: "#16a34a",
    magenta: "#d946ef",
    red: "#dc2626",
    overviewRulerBorder: "transparent",
    scrollbarSliderActiveBackground:
      "rgba(148, 163, 184, 0.28)",
    scrollbarSliderBackground:
      "rgba(148, 163, 184, 0.16)",
    scrollbarSliderHoverBackground:
      "rgba(148, 163, 184, 0.22)",
    selectionBackground: "#dbeafe",
    white: "#334155",
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

function getExtension(fileName: string) {
  const match = fileName.match(/\.([a-z0-9]+)$/i)
  return match?.[1].toLowerCase() || ""
}

function getEditorLanguage(fileName: string) {
  const extension = getExtension(fileName)

  if (extension === "js" || extension === "mjs") {
    return "javascript"
  }

  if (extension === "jsx") {
    return "javascript"
  }

  if (extension === "ts") {
    return "typescript"
  }

  if (extension === "tsx") {
    return "typescript"
  }

  if (extension === "json") {
    return "json"
  }

  if (extension === "sh") {
    return "shell"
  }

  if (extension === "md") {
    return "markdown"
  }

  return extension || "javascript"
}

function getErrorMessage(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message
  }

  return "Failed to start the WebContainer shell."
}

