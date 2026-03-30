import test from "node:test"
import assert from "node:assert/strict"

import {
  getNextActiveFileName,
  mergeDisplayFiles,
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
    },
  )

  assert.deepEqual(
    parseCodeMeta("live utils.ts", "ts"),
    {
      fileName: "utils.ts",
      lang: "ts",
    },
  )
})

test("parseCodeMeta falls back to a default file name", () => {
  assert.deepEqual(parseCodeMeta("", "js"), {
    fileName: "snippet.js",
    lang: "js",
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
})

test("mergeDisplayFiles keeps the primary file first and skips duplicate shared file names", () => {
  const primary = {
    fileName: "agent.js",
    lang: "js",
    meta: "agent.js",
    displayValue: "console.log('agent')",
    runtimeValue: "console.log('agent')",
  }
  const shared = [
    {
      fileName: "utils.js",
      lang: "js",
      meta: "utils.js",
      displayValue: "exports.pick = () => 1",
      runtimeValue: "exports.pick = () => 1",
    },
    {
      fileName: "agent.js",
      lang: "js",
      meta: "agent.js",
      displayValue: "console.log('shared duplicate')",
      runtimeValue: "console.log('shared duplicate')",
    },
  ]

  assert.deepEqual(
    mergeDisplayFiles(primary, shared).map(
      (file) => file.fileName,
    ),
    ["agent.js", "utils.js"],
  )
})

test("getNextActiveFileName preserves the current tab when possible", () => {
  assert.equal(
    getNextActiveFileName("utils.js", [
      { fileName: "agent.js" },
      { fileName: "utils.js" },
    ]),
    "utils.js",
  )

  assert.equal(
    getNextActiveFileName("missing.js", [
      { fileName: "agent.js" },
      { fileName: "utils.js" },
    ]),
    "agent.js",
  )
})
