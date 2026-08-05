import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildAgentSnapshots, parseAgentSteps } from "./agent-steps.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const courseDir = path.join(root, "code-agent-course")
const articleDir = path.join(root, "app/build-your-agent")
const generatedContentPath = path.join(articleDir, "content.generated.cn.mdx")
const generatedHelperPath = path.join(articleDir, "snippets/code-agent-course-helper.js")

const excerptSections = ["问题", "解决方案", "新增函数速览", "适合本节测试的 prompt"]

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

  for (const file of files.filter((item) => /^s\d\d-.*\.md$/.test(item))) {
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
  const parts = [
    "## !intro 从 s00 到 s18：从 HTTP 调用到 Agent Runtime",
    "",
    "这份内容由 `code-agent-course/s00-s17` 的 JavaScript 主线和 `s18` 进阶阅读生成。",
    "",
    "左侧保留每章最关键的讲解，右侧始终把当前章节代码显示成同一个 `agent.js`，这样 CodeHike 可以在章节之间做逐行切换。点击运行按钮时，WebContainer 会挂载当前 `agent.js` 和公共 `helper.js`。",
    "",
  ]

  for (const chapter of chapters) {
    parts.push(await renderChapter(chapter))
  }

  parts.push(
    "## !outro",
    "",
    "这 19 节先把一个 Code Agent 从最小 HTTP 调用推进到 Agent Runtime 的工程地图。后续如果要继续做交互体验，可以把每章再拆成更细的 step，但内容源仍然应该继续来自 `code-agent-course`。",
    "",
  )

  return `${parts.join("\n")}\n`
}

async function renderChapter(chapter) {
  const markdown = await fs.readFile(path.join(courseDir, chapter.markdownFile), "utf8")
  const title = getTitle(markdown)
  const body = chapter.prefix === "s18"
    ? extractExtensionReading(markdown)
    : extractExcerpt(markdown)
  const agentSteps = parseAgentSteps(markdown)
  const note =
    chapter.prefix === "s18"
      ? "\n\n> s18 是进阶阅读章，没有独立 JS 文件；右侧继续展示 s17 的完整 Agent 作为可运行基线。"
      : ""

  if (agentSteps.length) {
    const [source, target] = await Promise.all([
      fs.readFile(path.join(courseDir, chapter.previousJsFile), "utf8"),
      fs.readFile(path.join(courseDir, chapter.jsFile), "utf8"),
    ])
    const snapshots = buildAgentSnapshots({
      source,
      target,
      steps: agentSteps,
      maxChangedLines: 40,
    })

    return snapshots.map((snapshot, index) => renderAgentStep({
      body: index === 0 ? body : "",
      chapter,
      index,
      note,
      snapshot,
      title,
    })).join("\n")
  }

  return [
    `## !!steps ${escapeMdxText(title)}`,
    "",
    `来源：\`${chapter.markdownFile}\`${note}`,
    "",
    body,
    "",
    "```js ! agent.js range=1:220",
    `!from ../../code-agent-course/${chapter.jsFile}`,
    "```",
    "",
  ].join("\n")
}

function renderAgentStep({ body, chapter, index, note, snapshot, title }) {
  const stepTitle = snapshot.title.replace(/^\d+\.\s*/, "")
  const explanation = [
    body,
    escapeMdxText(snapshot.description),
    `本次代码变化：${snapshot.changedLines} 行。`,
  ].filter(Boolean).join("\n\n")

  return [
    `## !!steps ${chapter.prefix}.${index + 1}：${escapeMdxText(stepTitle)}`,
    "",
    `来源：\`${chapter.markdownFile}\` · ${escapeMdxText(title)}${note}`,
    "",
    explanation,
    "",
    "```js ! agent.js range=1:220",
    addFocusAnnotations(snapshot.code.trimEnd(), snapshot.focusRanges),
    "```",
    "",
  ].join("\n")
}

function addFocusAnnotations(code, ranges) {
  const lines = code.split("\n")

  for (const { start, end } of [...ranges].reverse()) {
    lines.splice(end, 0, "// !focus(end)")
    lines.splice(start - 1, 0, "// !focus(start)")
  }

  return lines.join("\n")
}

function getTitle(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "未命名章节"
}

function extractExcerpt(markdown) {
  const withoutCode = stripCodeBlocks(markdown)
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

  return blocks.filter(Boolean).map(escapeMdxText).join("\n\n")
}

function extractExtensionReading(markdown) {
  return markdown
    .replace(/^#\s+.+\n?/, "")
    .trim()
    .replace(/^###\s+/gm, "#### ")
    .replace(/^##\s+/gm, "### ")
}

function stripCodeBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/!\[[^\]]*\]\([^)]+\)/g, "")
}

function findSection(markdown, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`))
  return match?.[1]?.trim() || ""
}

function limitText(text, maxLength) {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trim()}……`
}

function escapeMdxText(text) {
  return text.replaceAll("{", "&#123;").replaceAll("}", "&#125;").replaceAll("<", "&lt;")
}

async function renderSafeHelper() {
  const source = await fs.readFile(path.join(courseDir, "helper.js"), "utf8")
  const lines = source.split("\n")
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
