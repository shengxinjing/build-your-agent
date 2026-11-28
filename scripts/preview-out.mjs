#!/usr/bin/env node

import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const outDir = path.resolve(process.cwd(), "out")
const args = process.argv.slice(2)
const portFlag = args.indexOf("--port")
const port = Number(
  (portFlag !== -1 ? args[portFlag + 1] : null) ||
    process.env.PORT ||
    3000,
)

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
}

function resolveFile(urlPathname) {
  const cleanPath = decodeURIComponent(urlPathname).replace(/^\/+/, "")
  const baseTarget = path.resolve(outDir, cleanPath)
  if (baseTarget !== outDir && !baseTarget.startsWith(outDir + path.sep)) {
    return null
  }

  const candidates = cleanPath
    ? [baseTarget, `${baseTarget}.html`, path.join(baseTarget, "index.html")]
    : [path.join(outDir, "index.html")]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function getContentType(filePath, urlPathname) {
  if (urlPathname.startsWith("/api/build-your-agent/runtime/")) {
    return "application/json; charset=utf-8"
  }
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || "application/octet-stream"
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  const filePath = resolveFile(url.pathname)

  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")

  if (!filePath) {
    const notFoundFile = path.join(outDir, "404.html")
    if (fs.existsSync(notFoundFile)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" })
      fs.createReadStream(notFoundFile).pipe(res)
      return
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Not Found")
    return
  }

  res.writeHead(200, { "Content-Type": getContentType(filePath, url.pathname) })
  fs.createReadStream(filePath).pipe(res)
})

if (!fs.existsSync(outDir)) {
  console.error("Missing ./out directory. Run `pnpm build` first.")
  process.exit(1)
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Static preview server listening on http://127.0.0.1:${port} (serving ./out)`)
})
