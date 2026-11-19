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
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif'

const LIGHT_THEME_VARS = {
  darkMode: false,
  background: "transparent",
  fontFamily: FONT_STACK,
  fontSize: "13px",
  primaryColor: "#fbf8f3",
  primaryTextColor: "#2d2925",
  primaryBorderColor: "#c5b9ac",
  lineColor: "#85786c",
  secondaryColor: "#f1ece5",
  tertiaryColor: "#f3ede5",
  clusterBkg: "#f4eee6",
  clusterBorder: "#d5cbc0",
  edgeLabelBackground: "#f6f1ea",
  actorBkg: "#fbf8f3",
  actorBorder: "#c5b9ac",
  actorTextColor: "#2d2925",
  actorLineColor: "#85786c",
  signalColor: "#2d2925",
  signalTextColor: "#2d2925",
  noteBkgColor: "#f1ece5",
  noteBorderColor: "#c5b9ac",
  noteTextColor: "#2d2925",
  labelBoxBkgColor: "#fbf8f3",
  labelBoxBorderColor: "#c5b9ac",
  labelTextColor: "#2d2925",
}

const DARK_THEME_VARS = {
  darkMode: true,
  background: "transparent",
  fontFamily: FONT_STACK,
  fontSize: "13px",
  primaryColor: "#25211e",
  primaryTextColor: "#e4dbd1",
  primaryBorderColor: "#524940",
  lineColor: "#9e9083",
  secondaryColor: "#2e2823",
  tertiaryColor: "#1d1a17",
  clusterBkg: "#1c1917",
  clusterBorder: "#413a33",
  edgeLabelBackground: "#1d1a17",
  actorBkg: "#25211e",
  actorBorder: "#524940",
  actorTextColor: "#e4dbd1",
  actorLineColor: "#9e9083",
  signalColor: "#e4dbd1",
  signalTextColor: "#e4dbd1",
  noteBkgColor: "#2e2823",
  noteBorderColor: "#524940",
  noteTextColor: "#e4dbd1",
  labelBoxBkgColor: "#25211e",
  labelBoxBorderColor: "#524940",
  labelTextColor: "#e4dbd1",
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
