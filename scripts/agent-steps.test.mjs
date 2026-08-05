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

test("s01 evolves from s00 in three focused verified steps", async () => {
  const [markdown, source, target] = await Promise.all([
    readFile(new URL("../code-agent-course/s01-agent-loop.md", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s00-llm-http.js", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s01-agent-loop.js", import.meta.url), "utf8"),
  ])
  const steps = parseAgentSteps(markdown)

  assert.equal(steps.length, 3)
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

test("the course generator emits three incremental s01 CodeHike steps", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./generate-build-your-agent-content.mjs", import.meta.url)),
  ], { cwd: root })

  const [content, target] = await Promise.all([
    readFile(new URL("../app/build-your-agent/content.generated.cn.mdx", import.meta.url), "utf8"),
    readFile(new URL("../code-agent-course/s01-agent-loop.js", import.meta.url), "utf8"),
  ])
  const section = content.match(
    /## !!steps s01[\s\S]*?(?=\n## !!steps s02)/,
  )?.[0] || ""
  const headings = section.match(/^## !!steps s01\.\d+/gm) || []
  const snapshots = [...section.matchAll(
    /```js ! agent\.js range=1:220\n([\s\S]*?)\n```/g,
  )]

  assert.equal(headings.length, 3)
  assert.equal(snapshots.length, 3)
  assert.doesNotMatch(section, /^## !!steps s01\.\d+：\d+\./m)
  assert.ok(snapshots.every((snapshot) => snapshot[1].includes("// !focus(start)")))
  const finalCode = snapshots.at(-1)[1]
    .replace(/^\/\/ !focus\((?:start|end)\)\n?/gm, "")
    .trimEnd()
  assert.equal(finalCode, target.trimEnd())

  for (const chapter of Array.from({ length: 17 }, (_, index) => index + 2)) {
    const prefix = `s${String(chapter).padStart(2, "0")}`
    const chapterSteps = content.match(new RegExp(`^## !!steps ${prefix}(?:\\.|：)`, "gm")) || []
    assert.equal(chapterSteps.length, 1, `${prefix} should remain a single step`)
  }
  assert.doesNotMatch(content, /^## !!steps s19/m)
  assert.match(content, /### 2\. Context Engineering：让模型只看当前真正需要的信息/)
  assert.match(content, /右侧继续展示 s17 的完整 Agent/)
})
