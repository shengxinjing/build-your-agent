import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  applyAgentPatch,
  buildAgentSnapshots,
  parseAgentSteps,
} from "./agent-steps.mjs"
import { getTutorialRuntimeSteps } from "../lib/tutorial-runtime-server.ts"

test("applyAgentPatch applies one exact mini diff", () => {
  const source = "const answer = 1;\nconsole.log(answer);\n"
  const patch = [
    "@@",
    "-const answer = 1;",
    "+const answer = 2;",
    " console.log(answer);",
  ].join("\n")

  assert.deepEqual(applyAgentPatch(source, patch), {
    code: "const answer = 2;\nconsole.log(answer);\n",
    changedLines: 2,
    focusRanges: [{ start: 1, end: 1 }],
  })
})

test("applyAgentPatch rejects a transition over ten changed lines", () => {
  const source = Array.from({ length: 6 }, (_, index) => `old ${index}`).join("\n")
  const patch = [
    "@@",
    ...Array.from({ length: 6 }, (_, index) => `-old ${index}`),
    ...Array.from({ length: 5 }, (_, index) => `+new ${index}`),
  ].join("\n")

  assert.throws(
    () => applyAgentPatch(source, patch),
    /11 changed lines; the limit is 10/,
  )
})

test("parseAgentSteps reads titles, explanations, and patches", () => {
  const markdown = [
    "# Demo",
    "",
    "## 博客代码演进",
    "",
    "### 接入工具",
    "",
    "先让程序知道工具存在。",
    "",
    "```diff agent-step",
    "@@",
    "-const tool = null;",
    "+const tool = bash;",
    "```",
    "",
    "## 下一节",
  ].join("\n")

  assert.deepEqual(parseAgentSteps(markdown), [{
    title: "接入工具",
    description: "先让程序知道工具存在。",
    patch: "@@\n-const tool = null;\n+const tool = bash;",
  }])
})

test("applyAgentPatch builds a file from an empty source", () => {
  const patch = [
    "@@",
    "+import { callLlm } from \"./helper.js\";",
  ].join("\n")

  assert.deepEqual(applyAgentPatch("", patch), {
    code: "import { callLlm } from \"./helper.js\";\n",
    changedLines: 1,
    focusRanges: [{ start: 1, end: 1 }],
  })
})

test("applyAgentPatch focuses the line after removed code when a frame only removes", () => {
  const source = "const a = 1;\nconst debug = true;\nconst b = 2;\n"
  const patch = ["@@", " const a = 1;", "-const debug = true;", " const b = 2;"].join("\n")

  assert.deepEqual(applyAgentPatch(source, patch), {
    code: "const a = 1;\nconst b = 2;\n",
    changedLines: 1,
    focusRanges: [{ start: 2, end: 2 }],
  })
})

test("applyAgentPatch rejects a context-free patch on a non-empty source", () => {
  assert.throws(
    () => applyAgentPatch("const value = 1;\n", "@@\n+const value = 2;"),
    /needs at least one context or removed line/,
  )
})

test("buildAgentSnapshots applies steps in order and reaches the target", () => {
  const steps = [
    {
      title: "修改数字",
      description: "",
      patch: "@@\n-const value = 1;\n+const value = 2;",
    },
    {
      title: "打印数字",
      description: "",
      patch: "@@\n const value = 2;\n+console.log(value);",
    },
  ]

  const snapshots = buildAgentSnapshots({
    source: "const value = 1;\n",
    target: "const value = 2;\nconsole.log(value);\n",
    steps,
  })

  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0].changedLines, 2)
  assert.equal(snapshots[1].changedLines, 1)
  assert.equal(snapshots.at(-1).code, "const value = 2;\nconsole.log(value);\n")
})

test("buildAgentSnapshots rejects a sequence that misses the target", () => {
  assert.throws(
    () => buildAgentSnapshots({
      source: "const value = 1;\n",
      target: "const value = 3;\n",
      steps: [{
        title: "只改到二",
        description: "",
        patch: "@@\n-const value = 1;\n+const value = 2;",
      }],
    }),
    /does not match the chapter source/,
  )
})

test("s01 evolves from s00 in six focused verified steps", async () => {
  const [markdown, source, target] = await Promise.all([
    readFile(new URL("../code-agent-course/s01-agent-loop.md", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s00-llm-http.js", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s01-agent-loop.js", import.meta.url), "utf8"),
  ])
  const steps = parseAgentSteps(markdown)

  assert.equal(steps.length, 6)
  assert.match(markdown, /## 和上一步的关键代码 diff（不含 helper\.js）/)
  assert.match(markdown, /--- s00-llm-http\.js\n\+\+\+ s01-agent-loop\.js/)

  const snapshots = buildAgentSnapshots({
    source,
    target,
    steps,
    maxChangedLines: 40,
  })
  assert.ok(snapshots.every((snapshot) => snapshot.changedLines <= 40))
  assert.ok(snapshots.every((snapshot) => snapshot.focusRanges.length > 0))
  assert.equal(snapshots.at(-1).code, target)
})

test("s00 builds from an empty source in four verified steps", async () => {
  const [markdown, target] = await Promise.all([
    readFile(new URL("../code-agent-course/s00-llm-http.md", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s00-llm-http.js", import.meta.url), "utf8"),
  ])
  const steps = parseAgentSteps(markdown)

  assert.equal(steps.length, 4)

  const snapshots = buildAgentSnapshots({
    source: "",
    target,
    steps,
    maxChangedLines: 40,
  })
  assert.ok(snapshots.every((snapshot) => snapshot.changedLines <= 40))
  assert.ok(snapshots.every((snapshot) => snapshot.focusRanges.length > 0))
  assert.equal(snapshots.at(-1).code, target)
})

const EXPECTED_STEPS = {
  s02: 5, s03: 5, s04: 7, s05: 4, s06: 5, s07: 5, s08: 9, s09: 13,
  s10: 7, s11: 8, s12: 6, s13: 8, s14: 10, s15: 9, s16: 9, s17: 8,
}

let generatedContentPromise

function loadGeneratedContent() {
  if (!generatedContentPromise) {
    const root = fileURLToPath(new URL("../", import.meta.url))
    execFileSync(process.execPath, [
      fileURLToPath(new URL("./generate-build-your-agent-content.mjs", import.meta.url)),
    ], { cwd: root })
    generatedContentPromise = readFile(
      new URL("../app/build-your-agent/content.generated.cn.mdx", import.meta.url),
      "utf8",
    )
  }
  return generatedContentPromise
}

function extractChapterSection(content, prefix, nextPrefix) {
  return content.match(
    new RegExp(`## !!steps ${prefix}：[\\s\\S]*?(?=\\n## !!steps ${nextPrefix}：)`),
  )?.[0] || ""
}

test("the course generator emits focus-aware s01 CodeHike steps", async () => {
  const [content, target] = await Promise.all([
    loadGeneratedContent(),
    readFile(new URL("../code-agent-course/s01-agent-loop.js", import.meta.url), "utf8"),
  ])
  const section = extractChapterSection(content, "s01", "s02")
  const headings = section.match(/^## !!steps(?:\s|$)/gm) || []
  const titledHeadings = section.match(/^## !!steps \S+/gm) || []
  const snapshots = [...section.matchAll(
    /```js ! agent\.js range=(\d+):(\d+)\n([\s\S]*?)\n```/g,
  )]

  assert.equal(headings.length, 6)
  assert.equal(titledHeadings.length, 1)
  assert.equal(snapshots.length, 6)
  for (const snapshot of snapshots) {
    const start = Number(snapshot[1])
    const end = Number(snapshot[2])
    const lines = snapshot[3].split("\n")
    const firstFocus = lines.indexOf("// !focus(start)") + 1
    const lastFocus = lines.lastIndexOf("// !focus(end)") + 1

    assert.ok(firstFocus > 0)
    assert.ok(lastFocus >= firstFocus)
    assert.ok(start <= firstFocus)
    assert.ok(end >= lastFocus)
    assert.ok(end <= lines.length)
  }
  assert.ok(new Set(snapshots.map((snapshot) => `${snapshot[1]}:${snapshot[2]}`)).size > 1)
  const finalCode = snapshots.at(-1)[3]
    .replace(/^\/\/ !focus\((?:start|end)\)\n?/gm, "")
    .trimEnd()
  assert.equal(finalCode, target.trimEnd())
  assert.match(section, /### 扩展阅读：商业级 Agent 怎么做主循环/)

  const s01LastStep = section.split(/^## !!steps(?:\s|$)/m).at(-1) || ""
  assert.match(s01LastStep, /### 测试 Prompt/)
})

test("the course generator emits expected step counts and safe focus markers", async () => {
  const content = await loadGeneratedContent()
  assert.doesNotMatch(content, /^## !!steps s\d\d\.\d+/m)
  assert.doesNotMatch(content, /range=1:220/)

  const s00Headings = extractChapterSection(content, "s00", "s01").match(/^## !!steps(?:\s|$)/gm) || []
  assert.equal(s00Headings.length, 4)

  const prefixes = Object.keys(EXPECTED_STEPS)
  for (const [index, prefix] of prefixes.entries()) {
    const chapterSection = extractChapterSection(content, prefix, prefixes[index + 1] || "s18")
    const chapterSteps = chapterSection.match(/^## !!steps(?:\s|$)/gm) || []
    const chapterTitles = chapterSection.match(/^## !!steps \S+/gm) || []
    assert.equal(chapterSteps.length, EXPECTED_STEPS[prefix], `${prefix} should have ${EXPECTED_STEPS[prefix]} steps`)
    assert.equal(chapterTitles.length, 1, `${prefix} should only emit a heading on its first step`)
  }

  // A focus marker is a comment, so it must never sit inside a multi-line template literal.
  for (const block of content.matchAll(/```js ! agent\.js range=[\d:]+\n([\s\S]*?)\n```/g)) {
    let insideTemplate = false
    for (const line of block[1].split("\n")) {
      if (/^\/\/ !focus\((?:start|end)\)$/.test(line)) assert.equal(insideTemplate, false)
      const backticks = (line.replace(/\\`/g, "").match(/`/g) || []).length
      if (backticks % 2) insideTemplate = !insideTemplate
    }
  }

  const s18Steps = content.match(/^## !!steps s18(?:\.|：)/gm) || []
  assert.equal(s18Steps.length, 1, "s18 should remain a single step")
  assert.doesNotMatch(content, /^## !!steps s19/m)
  assert.match(content, /## !!steps s18：扩展阅读路线图/)
  assert.match(content, /#### 2\. Attention 在做什么/)
  assert.match(content, /右侧继续展示 `s17` 的完整 Agent/)
  assert.doesNotMatch(content, /s18-kv-cache\.md/)

  const runtimeSteps = await getTutorialRuntimeSteps()
  const totalExpectedSteps = 4 + 6 + Object.values(EXPECTED_STEPS).reduce((sum, count) => sum + count, 0) + 1
  assert.equal(runtimeSteps.length, totalExpectedSteps)
})

test("the course generator emits intro sections, mermaid diagrams, and clean MDX", async () => {
  const content = await loadGeneratedContent()
  const s05Section = extractChapterSection(content, "s05", "s06")
  assert.match(s05Section, /### 问题/)
  assert.match(s05Section, /### 解决方案/)
  assert.match(s05Section, /### 测试 Prompt/)
  assert.match(s05Section, /```text[\s\S]*todo_write/)

  const mermaidBlocks = content.match(/^```mermaid$/gm) || []
  assert.equal(mermaidBlocks.length, 27, "all 27 main-chapter diagrams should be emitted as mermaid blocks")
  for (const [prefix, nextPrefix] of [
    ["s00", "s01"], ["s01", "s02"], ["s02", "s03"], ["s03", "s04"],
    ["s04", "s05"], ["s05", "s06"], ["s06", "s07"],
  ]) {
    assert.match(
      extractChapterSection(content, prefix, nextPrefix),
      /^```mermaid$/m,
      `${prefix} should include a mermaid diagram`,
    )
  }

  assert.doesNotMatch(content, /learn\.shareai\.run/)
  assert.doesNotMatch(content, /\+&lt;---/)
  assert.doesNotMatch(content, /`[^`\n]*&#123;/)
})
