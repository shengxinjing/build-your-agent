import test from "node:test"
import assert from "node:assert/strict"

import {
  extractHighlightedCodeText,
  parseCodeMeta,
  parseLineRange,
  sliceCodeByRange,
} from "./tutorial-files.ts"

test("parseCodeMeta extracts file names from code meta", () => {
  assert.deepEqual(
    parseCodeMeta("! agent.js", "js"),
    {
      fileName: "agent.js",
      lang: "js",
      range: undefined,
    },
  )

  assert.deepEqual(
    parseCodeMeta("live utils.ts", "ts"),
    {
      fileName: "utils.ts",
      lang: "ts",
      range: undefined,
    },
  )
})

test("parseCodeMeta falls back to a default file name", () => {
  assert.deepEqual(parseCodeMeta("", "js"), {
    fileName: "snippet.js",
    lang: "js",
    range: undefined,
  })
})

test("parseCodeMeta supports display-only line ranges", () => {
  assert.deepEqual(parseCodeMeta("! agent.js range=12:36", "js"), {
    fileName: "agent.js",
    lang: "js",
    range: "12:36",
  })
})

test("parseLineRange and sliceCodeByRange support 1-based inclusive ranges", () => {
  assert.deepEqual(parseLineRange("2:4"), {
    start: 2,
    end: 4,
  })

  assert.equal(
    sliceCodeByRange(
      ["one", "two", "three", "four"].join("\n"),
      "2:3",
    ),
    ["two", "three"].join("\n"),
  )

  const longGappedSource = [
    "// !focus(start)",
    "import { a } from './helper.js'",
    "// !focus(end)",
    ...Array.from({ length: 20 }, (_, i) => `const line${i} = ${i}`),
    "// !focus(start)",
    "export function run() {}",
    "// !focus(end)",
  ].join("\n")
  const collapsed = sliceCodeByRange(longGappedSource, "1:26")
  assert.ok(collapsed.includes("// ..."))
  assert.ok(collapsed.split("\n").length < 20)
})

test("extractHighlightedCodeText reconstructs text from compact tokens or falls back to code", () => {
  assert.equal(
    extractHighlightedCodeText({
      code: "",
      tokens: [
        ["const", "var(--ch-7)"],
        " ",
        ["x", "var(--ch-2)"],
        " ",
        ["=", "var(--ch-7)"],
        " ",
        ["1", "var(--ch-2)"],
        ";\n",
      ],
    }),
    "const x = 1;\n",
  )

  assert.equal(
    extractHighlightedCodeText({
      code: "existing code",
      tokens: [["ignored", "var(--ch-1)"]],
    }),
    "existing code",
  )

  assert.equal(extractHighlightedCodeText(null), "")
})
