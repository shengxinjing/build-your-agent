#!/usr/bin/env node

import { statSync, watch } from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

const root = process.cwd()
const port = process.env.PORT || "3001"

const watchTargets = [
  "app",
  "components",
  "lib",
  "public",
  "mdx-components.tsx",
  "next.config.mjs",
  "postcss.config.js",
  "tailwind.config.ts",
  "tsconfig.json",
  "package.json",
]

const ignoredSegments = new Set([
  ".git",
  ".next",
  "node_modules",
])

let startProcess = null
let isBuilding = false
let pendingReason = null
let debounceTimer = null
let buildQuietUntil = 0

function shouldIgnore(filePath = "") {
  const normalized = filePath.replaceAll("\\", "/")
  if (!normalized) return false
  if (normalized.endsWith(".log")) return true
  if (normalized.endsWith(".tsbuildinfo")) return true
  return normalized
    .split("/")
    .some((segment) => ignoredSegments.has(segment))
}

function normalizeReasonPath(target, filename, isDirectory) {
  if (!filename) return target
  const value = filename.toString()
  return isDirectory ? path.join(target, value) : target
}

function log(message) {
  const stamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
  })
  console.log(`[prod-watch ${stamp}] ${message}`)
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    })

    child.on("exit", (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
      })
    })
  })
}

async function buildProject(reason) {
  if (isBuilding) {
    pendingReason = reason
    return
  }

  isBuilding = true
  log(`building (${reason})`)
  const result = await runCommand("npm", ["run", "build"])
  isBuilding = false

  if (result.code === 0) {
    buildQuietUntil = Date.now() + 1500
    await restartServer()
  } else {
    log("build failed, keeping previous server")
  }

  if (pendingReason) {
    const nextReason = pendingReason
    pendingReason = null
    await buildProject(nextReason)
  }
}

async function restartServer() {
  if (startProcess) {
    log("restarting next start")
    const old = startProcess
    startProcess = null
    old.kill("SIGTERM")
    await new Promise((resolve) => {
      old.once("exit", () => resolve())
      setTimeout(resolve, 3000)
    })
  } else {
    log("starting next start")
  }

  startProcess = spawn(
    "npm",
    ["run", "start", "--", "--port", String(port)],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  )

  startProcess.on("exit", (code, signal) => {
    const exited = startProcess
    if (exited) {
      log(
        `next start exited (${signal ?? code ?? "unknown"})`,
      )
    }
    startProcess = null
  })
}

function scheduleBuild(reason) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    buildProject(reason)
  }, 250)
}

function registerWatcher(target) {
  const fullPath = path.join(root, target)

  try {
    const stats = statSync(fullPath)
    const watcher = watch(
      fullPath,
      { recursive: stats.isDirectory() },
      (eventType, filename) => {
        const relative = normalizeReasonPath(
          target,
          filename,
          stats.isDirectory(),
        )
        if (shouldIgnore(relative)) return
        if (Date.now() < buildQuietUntil) return
        scheduleBuild(`${eventType}: ${relative}`)
      },
    )

    watcher.on("error", (error) => {
      log(`watch error on ${target}: ${error.message}`)
    })

    return watcher
  } catch (error) {
    log(`skip watch target ${target}: ${error.message}`)
    return null
  }
}

const watchers = watchTargets
  .map(registerWatcher)
  .filter(Boolean)

function shutdown(signal) {
  log(`received ${signal}, shutting down`)
  for (const watcher of watchers) {
    watcher.close()
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  if (startProcess) {
    startProcess.kill("SIGTERM")
  }
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

await buildProject("initial startup")
