import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildAgentSnapshots, parseAgentSteps } from "./agent-steps.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const courseDir = path.join(root, "code-agent-course")
const introPath = path.join(courseDir, "intro.md")
const articleDir = path.join(root, "app/build-your-agent")
const generatedContentPath = path.join(articleDir, "content.generated.cn.mdx")
const generatedHelperPath = path.join(articleDir, "snippets/code-agent-course-helper.js")

const excerptSections = [
  "问题",
  "本章目标",
  "解决方案",
  "新增能力",
  "为什么这一步重要",
  "参考实现提醒",
  "教学版边界",
  "新增函数速览",
]
const testPromptSectionNames = ["适合本节测试的 prompt", "测试 Prompt"]

async function main() {
  const files = await fs.readdir(courseDir)
  const chapters = buildChapters(files)

  await fs.writeFile(generatedContentPath, await renderMdx(chapters), "utf8")
  await fs.writeFile(generatedHelperPath, await renderSafeHelper(), "utf8")

  console.log(`Generated ${path.relative(root, generatedContentPath)}`)
  console.log(`Generated ${path.relative(root, generatedHelperPath)}`)
}

function buildChapters(files) {
  const markdownByPrefix = new Map()
  const jsFiles = new Set(files.filter((file) => /^s\d\d-.*\.js$/.test(file)))

  for (const file of files.filter((item) => /^s\d\d(?:-.*)?\.md$/.test(item))) {
    const prefix = file.slice(0, 3)
    const list = markdownByPrefix.get(prefix) || []
    list.push(file)
    markdownByPrefix.set(prefix, list)
  }

  const chapters = [...markdownByPrefix.entries()]
    .filter(([prefix]) => Number(prefix.slice(1)) <= 18)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, markdownFiles]) => {
      const markdownFile = pickMainMarkdown(markdownFiles, jsFiles)
      const ownJsFile = markdownFile.replace(/\.md$/, ".js")
      return {
        prefix,
        markdownFile,
        jsFile: jsFiles.has(ownJsFile) ? ownJsFile : "s17-mcp-plugin.js",
      }
    })

  return chapters.map((chapter, index) => ({
    ...chapter,
    previousJsFile: chapters[index - 1]?.jsFile,
  }))
}

function pickMainMarkdown(markdownFiles, jsFiles) {
  return [...markdownFiles].sort().find((file) => jsFiles.has(file.replace(/\.md$/, ".js"))) || markdownFiles.sort()[0]
}

async function renderMdx(chapters) {
  const parts = [await renderIntro()]

  for (const chapter of chapters) {
    parts.push(await renderChapter(chapter))
  }

  parts.push(
    "## !outro",
    "",
    "这 19 节已经把一个 Code Agent 从最小 HTTP 调用推进到可理解的 Agent Runtime：模型负责决策，Loop 维持闭环，工具连接真实环境，Context 与 Memory 管理有限注意力，Task 与 Team 负责长任务协作，MCP 提供外部扩展。",
    "",
    "这仍然是教学实现，不是生产平台。真正上线还需要 OS 级 Sandbox、持久化事件日志、并发与崩溃恢复、权限审计、Trace、Metrics、Eval 和成本控制。带着这条边界去读 Pi、OpenCode、Kimi Code 或 DeepSeek Harness，才不会只看到更多工具，而能看到完整系统。",
    "",
  )

  return `${parts.join("\n")}\n`
}

async function renderIntro() {
  const markdown = await fs.readFile(introPath, "utf8")
  const title = getTitle(markdown)
  const body = extractExtensionReading(markdown)

  return [
    `## !intro ${escapeMdxText(title)}`,
    "",
    body,
  ].join("\n")
}

async function renderChapter(chapter) {
  const markdown = await fs.readFile(path.join(courseDir, chapter.markdownFile), "utf8")
  const title = getTitle(markdown)
  const introExcerpt =
    chapter.prefix === "s18"
      ? extractExtensionReading(markdown)
      : extractIntroExcerpt(markdown)
  const closingExcerpt =
    chapter.prefix === "s18"
      ? ""
      : extractClosingExcerpt(markdown)
  const agentSteps = parseAgentSteps(markdown)

  if (agentSteps.length) {
    const source = chapter.previousJsFile
      ? await fs.readFile(path.join(courseDir, chapter.previousJsFile), "utf8")
      : ""
    const target = await fs.readFile(path.join(courseDir, chapter.jsFile), "utf8")
    const snapshots = buildAgentSnapshots({
      source,
      target,
      steps: agentSteps,
      maxChangedLines: 40,
    })

    return snapshots.map((snapshot, index) => renderAgentStep({
      introBody: index === 0 ? introExcerpt : "",
      closingBody: index === snapshots.length - 1 ? closingExcerpt : "",
      index,
      snapshot,
      title,
    })).join("\n")
  }

  return [
    `## !!steps ${escapeMdxText(title)}`,
    introExcerpt,
    "",
    "```js ! agent.js",
    `!from ../../code-agent-course/${chapter.jsFile}`,
    "```",
    "",
  ].join("\n")
}

function renderAgentStep({ introBody, closingBody, index, snapshot, title }) {
  const annotatedCode = addFocusAnnotations(snapshot.code.trimEnd(), snapshot.focusRanges)
  const displayRange = getFocusDisplayRange(annotatedCode)
  const thinkingMatch = snapshot.description.match(/\n\n(> \*\*本章思考题\*\*[\s\S]*)$/)
  const mainDescription = thinkingMatch
    ? snapshot.description.slice(0, thinkingMatch.index).trimEnd()
    : snapshot.description
  const thinkingBlock = thinkingMatch ? thinkingMatch[1].trim() : ""
  const heading = index === 0 ? `## !!steps ${escapeMdxText(title)}` : "## !!steps"
  const explanation = [
    introBody,
    introBody && mainDescription ? "---" : "",
    mainDescription ? escapeMdxText(mainDescription) : "",
    `本次代码变化：${snapshot.changedLines} 行。`,
    closingBody,
    thinkingBlock ? escapeMdxText(thinkingBlock) : "",
  ].filter(Boolean).join("\n\n")

  return [
    heading,
    explanation,
    "",
    `\`\`\`js ! agent.js range=${displayRange}`,
    annotatedCode,
    "```",
    "",
  ].join("\n")
}

function getFocusDisplayRange(code, contextLines = 8) {
  const lines = code.split("\n")
  const firstFocus = lines.findIndex((line) => line === "// !focus(start)")
  const lastFocus = lines.findLastIndex((line) => line === "// !focus(end)")

  if (firstFocus < 0 || lastFocus < firstFocus) {
    throw new Error("Agent step needs a complete focus range")
  }

  const start = Math.max(1, firstFocus + 1 - contextLines)
  const end = Math.min(lines.length, lastFocus + 1 + contextLines)
  return `${start}:${end}`
}

function addFocusAnnotations(code, ranges) {
  const lines = code.split("\n")
  const insideTemplate = getTemplateLineStates(code)

  // A marker is a comment line, so it must not land inside a multi-line
  // template literal. Widen such ranges to the literal's first and last line.
  const safeRanges = []
  for (const range of ranges) {
    let { start, end } = range
    while (start > 1 && insideTemplate[start - 1]) start -= 1
    while (end < lines.length && insideTemplate[end]) end += 1
    const previous = safeRanges.at(-1)
    if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end)
    else safeRanges.push({ start, end })
  }

  for (const { start, end } of safeRanges.reverse()) {
    lines.splice(end, 0, "// !focus(end)")
    lines.splice(start - 1, 0, "// !focus(start)")
  }

  return lines.join("\n")
}

// For each line, report whether it starts inside a template literal.
function getTemplateLineStates(code) {
  const states = [false]
  const stack = [] // "`" = template text, "{" = code inside ${...} or a block
  let quote = ""
  let comment = ""

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]
    const next = code[index + 1]
    const inTemplateText = stack.at(-1) === "`"

    if (char === "\n") {
      if (comment === "line") comment = ""
      quote = ""
      states.push(inTemplateText)
    } else if (comment) {
      if (comment === "block" && char === "*" && next === "/") {
        comment = ""
        index += 1
      }
    } else if (char === "\\") {
      index += 1
    } else if (quote) {
      if (char === quote) quote = ""
    } else if (inTemplateText) {
      if (char === "`") stack.pop()
      else if (char === "$" && next === "{") {
        stack.push("{")
        index += 1
      }
    } else if (char === "/" && next === "/") comment = "line"
    else if (char === "/" && next === "*") comment = "block"
    else if (char === "\"" || char === "'") quote = char
    else if (char === "`" || char === "{") stack.push(char)
    else if (char === "}") stack.pop()
  }

  return states
}

function getTitle(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "未命名章节"
}

function extractIntroExcerpt(markdown) {
  const withoutCode = stripNonMermaidCodeBlocks(markdown)
  const opening = withoutCode
    .replace(/^#\s+.+\n?/, "")
    .split(/^##\s+/m)[0]
    .trim()
  const blocks = [limitText(opening, 900)]

  for (const sectionName of excerptSections) {
    const section = findSection(withoutCode, sectionName)
    if (section) {
      blocks.push(`### ${sectionName}\n\n${limitText(section, 1100)}`)
    }
  }

  const flowSection = findSection(markdown, "流程图")
  if (flowSection) {
    blocks.push(`### 流程图\n\n${flowSection}`)
  }

  return blocks.filter(Boolean).map(escapeMdxText).join("\n\n")
}

function extractClosingExcerpt(markdown) {
  const blocks = []
  const promptSection = findFirstSection(markdown, testPromptSectionNames)
  if (promptSection) {
    blocks.push(`### ${promptSection.name}\n\n${promptSection.content}`)
  }

  const withoutCode = stripNonMermaidCodeBlocks(markdown)
  const extensionMatch = withoutCode.match(
    /(?:^|\n)##\s+(扩展阅读[^\n]*)\n([\s\S]*?)(?=\n##\s+|$)/,
  )
  if (extensionMatch) {
    const heading = extensionMatch[1].trim()
    const content = extensionMatch[2].trim()
    if (content) {
      blocks.push(`### ${heading}\n\n${limitText(content, 1100)}`)
    }
  }

  return blocks.filter(Boolean).map(escapeMdxText).join("\n\n")
}

function extractExtensionReading(markdown) {
  return markdown
    .replace(/^#\s+.+\n?/, "")
    .trim()
    .replace(/^###\s+/gm, "#### ")
    .replace(/^##\s+/gm, "### ")
}

function stripNonMermaidCodeBlocks(markdown) {
  return markdown.replace(/```([^\n]*)\n[\s\S]*?```/g, (block, info) =>
    info.trim() === "mermaid" ? block : "",
  )
}

function findSection(markdown, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`))
  return match?.[1]?.trim() || ""
}

function findFirstSection(markdown, sectionNames) {
  for (const name of sectionNames) {
    const content = findSection(markdown, name)
    if (content) return { content, name }
  }

  return null
}

function limitText(text, maxLength) {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim()
  const fencePattern = /```[\s\S]*?```/g
  let proseCount = 0
  let result = ""
  let lastIndex = 0

  for (const match of normalized.matchAll(fencePattern)) {
    const index = match.index ?? 0
    const prose = normalized.slice(lastIndex, index)
    if (proseCount + prose.length > maxLength) {
      const remaining = Math.max(0, maxLength - proseCount)
      return `${(result + prose.slice(0, remaining)).trim()}……`
    }
    proseCount += prose.length
    result += prose + match[0]
    lastIndex = index + match[0].length
  }

  const tail = normalized.slice(lastIndex)
  if (proseCount + tail.length <= maxLength) return normalized
  const remaining = Math.max(0, maxLength - proseCount)
  return `${(result + tail.slice(0, remaining)).trim()}……`
}

function escapePlainMdxSegment(segment) {
  return segment
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("<", "&lt;")
}

function escapeMdxText(text) {
  const codePattern = /```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*?`+/g
  let result = ""
  let lastIndex = 0

  for (const match of text.matchAll(codePattern)) {
    const index = match.index ?? 0
    result += escapePlainMdxSegment(text.slice(lastIndex, index))
    result += match[0]
    lastIndex = index + match[0].length
  }

  result += escapePlainMdxSegment(text.slice(lastIndex))
  return result
}

function stripLocalEnvBlocks(source) {
  const lines = source.split("\n")
  const kept = []
  let skipping = false

  for (const line of lines) {
    if (line.trim() === "// @local-env-start") {
      skipping = true
      continue
    }
    if (line.trim() === "// @local-env-end") {
      skipping = false
      continue
    }
    if (!skipping) {
      kept.push(line)
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n")
}

async function renderSafeHelper() {
  const source = await fs.readFile(path.join(courseDir, "helper.js"), "utf8")
  const stripped = stripLocalEnvBlocks(source)
  const lines = stripped.split("\n")
  const sanitized = lines.flatMap((line) => {
    if (line.startsWith("export const llmProvider =")) {
      return [
        "// 当前页面选择的模型服务商会被注入到这里。",
        "export const llmProvider = \"__BUILD_YOUR_AGENT_LLM_PROVIDER__\";",
      ]
    }
    if (line.startsWith("export const apiToken =")) {
      return [
        "// 当前页面输入的 API token 会被注入到这里。",
        "export const apiToken = \"__BUILD_YOUR_AGENT_API_TOKEN__\";",
      ]
    }
    return line
  }).join("\n")

  if (sanitized.includes("sk-")) {
    throw new Error("Sanitized helper still contains an API token-looking string")
  }

  return sanitized
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
