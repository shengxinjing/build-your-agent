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
  const fromMeta = meta
    .split(/\s+/)
    .map((token) => token.trim())
    .find((token) => /\.[a-z0-9]+$/i.test(token))

  return {
    fileName: fromMeta
      ? sanitizeFileName(fromMeta)
      : getFallbackFileName(lang),
    lang: normalizeLangFromFileName(
      fromMeta || getFallbackFileName(lang),
      lang,
    ),
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

  const lines = contents.split("\n")

  return lines
    .slice(parsedRange.start - 1, parsedRange.end)
    .join("\n")
}

export function mergeDisplayFiles(
  primary: TutorialDisplayFile,
  shared: TutorialDisplayFile[],
) {
  const merged: TutorialDisplayFile[] = [primary]
  const seen = new Set([primary.fileName])

  for (const sharedFile of shared) {
    if (seen.has(sharedFile.fileName)) {
      continue
    }

    merged.push(sharedFile)
    seen.add(sharedFile.fileName)
  }

  return merged
}

export function getNextActiveFileName(
  previousFileName: string | null,
  files: Pick<TutorialDisplayFile, "fileName">[],
) {
  if (files.length === 0) {
    return null
  }

  if (
    previousFileName &&
    files.some(
      (file) => file.fileName === previousFileName,
    )
  ) {
    return previousFileName
  }

  return files[0].fileName
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
