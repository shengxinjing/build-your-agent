export type TutorialSharedFileConfig = {
  path: string
  range?: string
  fileName?: string
}

export type TutorialDisplayFile = {
  fileName: string
  lang: string
  meta: string
  displayValue: string
  runtimeValue: string
}

export function parseCodeMeta(meta: string, lang: string) {
  const tokens = meta
    .split(/\s+/)
    .map((token) => token.trim())

  const fromMeta = tokens
    .find((token) => /\.[a-z0-9]+$/i.test(token))
  const range = tokens
    .find((token) => token.startsWith("range="))
    ?.replace(/^range=/, "")

  return {
    fileName: fromMeta
      ? sanitizeFileName(fromMeta)
      : getFallbackFileName(lang),
    lang: normalizeLangFromFileName(
      fromMeta || getFallbackFileName(lang),
      lang,
    ),
    range,
  }
}

export function parseLineRange(range?: string) {
  if (!range) {
    return null
  }

  const match = range.trim().match(/^(\d+)(?::(\d+))?$/)

  if (!match) {
    return null
  }

  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : start

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return null
  }

  if (start < 1 || end < start) {
    return null
  }

  return { start, end }
}

export function sliceCodeByRange(
  contents: string,
  range?: string,
) {
  const parsedRange = parseLineRange(range)

  if (!parsedRange) {
    return contents
  }

  const lines = contents
    .split("\n")
    .slice(parsedRange.start - 1, parsedRange.end)

  return collapseUnfocusedGaps(lines).join("\n")
}

function collapseUnfocusedGaps(
  lines: string[],
  contextLines = 6,
) {
  const maxGap = contextLines * 2 + 1
  const result: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    result.push(line)

    if (line === "// !focus(end)") {
      let nextFocusStart = index + 1
      while (
        nextFocusStart < lines.length &&
        lines[nextFocusStart] !== "// !focus(start)"
      ) {
        nextFocusStart += 1
      }

      if (nextFocusStart < lines.length) {
        const gap = lines.slice(index + 1, nextFocusStart)
        if (gap.length > maxGap) {
          result.push(
            ...gap.slice(0, contextLines),
            "// ...",
            ...gap.slice(-contextLines),
          )
        } else {
          result.push(...gap)
        }
        index = nextFocusStart
        continue
      }
    }

    index += 1
  }

  return result
}

export function getExtension(fileName: string) {
  const match = fileName.match(/\.([a-z0-9]+)$/i)
  return match?.[1].toLowerCase() || ""
}

export function getEditorLanguage(fileName: string) {
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

function getFallbackFileName(lang: string) {
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

export function normalizeLangFromFileName(
  fileName: string,
  fallbackLang = "javascript",
) {
  const extension = getExtension(fileName)
  return extension || fallbackLang
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._/-]/g, "-")
}

type HighlightedToken = string | readonly [string, ...unknown[]]

export function extractHighlightedCodeText(
  highlightedCode:
    | {
      code?: string
      tokens?: readonly HighlightedToken[]
    }
    | null
    | undefined,
) {
  if (!highlightedCode) {
    return ""
  }

  if (highlightedCode.code) {
    return highlightedCode.code
  }

  if (!highlightedCode.tokens) {
    return ""
  }

  return highlightedCode.tokens
    .map((token) => (typeof token === "string" ? token : token[0]))
    .join("")
}
