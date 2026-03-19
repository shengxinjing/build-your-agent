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
  code: string
  lang: string
  meta?: string
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

type WorkspaceFiles = {
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
  code,
  lang,
  meta = "",
}: LiveDemoProps) {
  const [editorValue, setEditorValue] = useState(code)
  const workspace = useMemo(
    () =>
      createWorkspaceFiles({
        code: editorValue,
        lang,
        meta,
      }),
    [editorValue, lang, meta],
  )

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
  const scrollLockRef = useRef<{
    bodyOverflow: string
    bodyPaddingRight: string
    htmlOverflow: string
  } | null>(null)

  useEffect(() => {
    setEditorValue(code)
  }, [code, lang, meta])

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

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
      theme: {
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
      },
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
  }, [fitTerminal])

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
      scrollLockRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !workspaceMountedRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void writeWorkspaceFile(
        workspace.fileName,
        editorValue,
      )
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [editorValue, open, workspace.fileName])

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
        className="inline-flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
        aria-label={`Open ${workspace.fileName} in WebContainer terminal`}
      >
        <Play size={14} />
        Terminal
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 overflow-hidden overscroll-none bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.95),_rgba(239,246,255,0.9)_32%,_rgba(248,250,252,0.92)_68%,_rgba(255,255,255,0.98))] p-5 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto flex h-full max-w-[118rem] flex-col overflow-hidden rounded-[36px] border border-slate-200/90 bg-white/70 p-6 shadow-[0_30px_120px_rgba(148,163,184,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700">
                  Live demo
                </div>
                <div className="truncate text-xs text-slate-500">
                  {workspace.fileName}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={status} />

                <button
                  type="button"
                  onClick={() =>
                    setRunNonce((current) => current + 1)
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  <RefreshCw size={15} />
                  Remount
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void closeWorkspace()
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-700 transition hover:bg-slate-50"
                  aria-label="Close live demo"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 min-w-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] xl:grid-cols-[minmax(0,1.08fr)_minmax(26rem,0.92fr)]">
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-4">
                  <div className="text-sm font-semibold text-slate-700">
                    Source
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">
                    左侧代码可编辑，右侧终端可直接执行命令。
                  </div>
                </div>

                <div className="min-h-0 min-w-0 flex-1">
                  <IdeEditor
                    fileName={workspace.fileName}
                    language={getEditorLanguage(
                      workspace.fileName,
                    )}
                    onChange={setEditorValue}
                    value={editorValue}
                  />
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="pb-4">
                  <div className="text-sm font-semibold text-slate-700">
                    Terminal
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">
                    推荐先运行{" "}
                    <code className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[13px] font-medium text-slate-700">
                      {`node ${workspace.fileName}`}
                    </code>{" "}
                    或者直接点下面的快捷命令。
                  </div>
                  {error ? (
                    <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                      {error}
                    </p>
                  ) : null}
                </div>

                <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
                  <div className="min-h-0 min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_30px_80px_rgba(148,163,184,0.15)]">
                    <div
                      ref={terminalHostRef}
                      className="live-demo-terminal h-full min-h-[18rem] w-full min-w-0 cursor-text overflow-hidden rounded-[22px] border border-slate-200 bg-white px-3 py-3 lg:min-h-[20rem]"
                      onClick={focusTerminal}
                      onMouseDown={focusTerminal}
                    />
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

function StatusBadge({ status }: { status: Status }) {
  const label = {
    idle: "Idle",
    booting: "Booting",
    syncing: "Syncing files",
    starting: "Starting shell",
    ready: "Ready",
    error: "Error",
  }[status]

  const className = {
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
      className="min-w-0 rounded-[22px] border border-slate-200 bg-white px-5 py-4 text-left shadow-[0_18px_50px_rgba(148,163,184,0.12)] transition hover:-translate-y-0.5 hover:border-fuchsia-200 hover:shadow-[0_24px_60px_rgba(148,163,184,0.16)]"
    >
      <div className="text-sm font-semibold text-slate-600">
        {label}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-3 text-[15px] font-semibold text-slate-700">
        <ChevronRight
          size={18}
          className="text-fuchsia-500"
        />
        <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-50 px-1.5 py-0.5 text-slate-700">
          {command}
        </code>
      </div>
    </button>
  )
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
  code,
  lang,
  meta,
}: {
  code: string
  lang: string
  meta: string
}): WorkspaceFiles {
  const fileName = getFileName(meta, lang)

  return {
    fileName,
    managedPaths: ["README.md", "package.json", fileName],
    suggestedCommands: getSuggestedCommands(fileName),
    tree: {
      [fileName]: {
        file: {
          contents: code,
        },
      },
      "README.md": {
        file: {
          contents: [
            "# Scrollycoding Demo",
            "",
            `Mounted file: ${fileName}`,
            "",
            "Useful commands:",
            ...getSuggestedCommands(fileName).map(
              ({ command }) => `- ${command}`,
            ),
          ].join("\n"),
        },
      },
      "package.json": {
        file: {
          contents: JSON.stringify(
            {
              name: "scrollycoding-live-demo",
              private: true,
            },
            null,
            2,
          ),
        },
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

function getFileName(meta: string, lang: string) {
  const fromMeta = meta
    .split(/\s+/)
    .map((token) => token.trim())
    .find((token) => /\.[a-z0-9]+$/i.test(token))

  if (fromMeta) {
    return sanitizeFileName(fromMeta)
  }

  const normalizedLang = lang.toLowerCase()

  if (normalizedLang === "mjs") {
    return "snippet.mjs"
  }

  if (normalizedLang === "ts") {
    return "snippet.ts"
  }

  if (normalizedLang === "html") {
    return "snippet.html"
  }

  if (normalizedLang === "css") {
    return "snippet.css"
  }

  return "snippet.js"
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

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function getErrorMessage(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message
  }

  return "Failed to start the WebContainer shell."
}
