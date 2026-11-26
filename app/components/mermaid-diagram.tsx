"use client"

import { useEffect, useRef, useState } from "react"
import { type ThemeMode, useTheme } from "@/components/theme-provider"

type QueueTask = {
  id: number
  priority: boolean
  run: () => Promise<void>
}

const svgCache = new Map<string, string>()
const pendingQueue: QueueTask[] = []
let isProcessingQueue = false
let activeTheme: ThemeMode | null = null
let renderCounter = 0
let taskIdCounter = 0
let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null

const FONT_STACK =
  '"Manrope", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif'

const LIGHT_THEME_VARS = {
  darkMode: false,
  background: "transparent",
  fontFamily: FONT_STACK,
  fontSize: "13px",
  primaryColor: "#ffffff",
  primaryTextColor: "#0f172a",
  primaryBorderColor: "#cbd5e1",
  lineColor: "#2563eb",
  secondaryColor: "#f1f5f9",
  tertiaryColor: "#f8fafc",
  clusterBkg: "#f8fafc",
  clusterBorder: "#cbd5e1",
  edgeLabelBackground: "#f8fafc",
  actorBkg: "#ffffff",
  actorBorder: "#cbd5e1",
  actorTextColor: "#0f172a",
  actorLineColor: "#2563eb",
  signalColor: "#2563eb",
  signalTextColor: "#0f172a",
  noteBkgColor: "#eff6ff",
  noteBorderColor: "#93c5fd",
  noteTextColor: "#0f172a",
  labelBoxBkgColor: "#ffffff",
  labelBoxBorderColor: "#cbd5e1",
  labelTextColor: "#0f172a",
}

const DARK_THEME_VARS = {
  darkMode: true,
  background: "transparent",
  fontFamily: FONT_STACK,
  fontSize: "13px",
  primaryColor: "#111b2e",
  primaryTextColor: "#e2e8f0",
  primaryBorderColor: "#334155",
  lineColor: "#38bdf8",
  secondaryColor: "#0f172a",
  tertiaryColor: "#0b101b",
  clusterBkg: "#0d1526",
  clusterBorder: "#1e293b",
  edgeLabelBackground: "#0b101b",
  actorBkg: "#111b2e",
  actorBorder: "#334155",
  actorTextColor: "#e2e8f0",
  actorLineColor: "#38bdf8",
  signalColor: "#38bdf8",
  signalTextColor: "#e2e8f0",
  noteBkgColor: "#172554",
  noteBorderColor: "#1d4ed8",
  noteTextColor: "#e2e8f0",
  labelBoxBkgColor: "#111b2e",
  labelBoxBorderColor: "#334155",
  labelTextColor: "#e2e8f0",
}

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((mod) => mod.default)
  }
  return mermaidLoader
}

function ensureConfigured(
  mermaid: typeof import("mermaid")["default"],
  theme: ThemeMode,
) {
  if (activeTheme === theme) {
    return
  }

  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: theme === "dark" ? DARK_THEME_VARS : LIGHT_THEME_VARS,
    flowchart: {
      curve: "basis",
      htmlLabels: true,
      nodeSpacing: 28,
      padding: 12,
      rankSpacing: 34,
      useMaxWidth: true,
      wrappingWidth: 260,
    },
    sequence: {
      actorMargin: 36,
      messageMargin: 28,
      useMaxWidth: true,
    },
  })
  activeTheme = theme
}

async function drainQueue() {
  if (isProcessingQueue) {
    return
  }
  isProcessingQueue = true

  while (pendingQueue.length > 0) {
    const priorityIndex = pendingQueue.findIndex((item) => item.priority)
    const [task] = pendingQueue.splice(
      priorityIndex >= 0 ? priorityIndex : 0,
      1,
    )
    if (task) {
      await task.run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  isProcessingQueue = false
}

function enqueueMermaidRender(
  chart: string,
  theme: ThemeMode,
  priority: boolean,
) {
  const cacheKey = `${theme}\0${chart}`
  const taskId = ++taskIdCounter

  const promise = new Promise<string>((resolve, reject) => {
    pendingQueue.push({
      id: taskId,
      priority,
      run: async () => {
        const hit = svgCache.get(cacheKey)
        if (hit) {
          resolve(hit)
          return
        }
        try {
          const mermaid = await loadMermaid()
          ensureConfigured(mermaid, theme)
          renderCounter += 1
          const { svg } = await mermaid.render(
            `mermaid-diagram-${renderCounter}`,
            chart,
          )
          svgCache.set(cacheKey, svg)
          resolve(svg)
        } catch (error) {
          reject(error)
        }
      },
    })
    void drainQueue()
  })

  return {
    boost: () => {
      const queued = pendingQueue.find((item) => item.id === taskId)
      if (queued) {
        queued.priority = true
      }
    },
    promise,
  }
}

function observeNearViewport(
  el: HTMLElement | null,
  enabled: boolean,
  onVisible: () => void,
) {
  if (!el || !enabled || typeof IntersectionObserver === "undefined") {
    return null
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onVisible()
        observer.disconnect()
      }
    },
    { rootMargin: "900px 0px" },
  )
  observer.observe(el)
  return observer
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const trimmed = chart.trim()
  const { resolvedTheme } = useTheme()
  const figureRef = useRef<HTMLElement | null>(null)
  const [svg, setSvg] = useState("")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cached = svgCache.get(`${resolvedTheme}\0${trimmed}`)
    if (cached) {
      setSvg(cached)
      setFailed(false)
      return
    }

    setFailed(false)
    const rect = figureRef.current?.getBoundingClientRect()
    const near = rect
      ? rect.top < window.innerHeight + 900 && rect.bottom > -900
      : false
    const { boost, promise } = enqueueMermaidRender(trimmed, resolvedTheme, near)
    const observer = observeNearViewport(figureRef.current, !near, boost)

    promise
      .then((rendered) => !cancelled && setSvg(rendered))
      .catch(() => !cancelled && setFailed(true))

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [resolvedTheme, trimmed])

  if (failed) {
    return (
      <pre className="mermaid-diagram mermaid-diagram--fallback">
        <code>{trimmed}</code>
      </pre>
    )
  }

  return (
    <figure
      ref={figureRef}
      className="mermaid-diagram"
      data-ready={svg ? "true" : "false"}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
}
