import test from "node:test"
import assert from "node:assert/strict"

import {
  API_TOKEN_MARKER,
  DEFAULT_LLM_SETTINGS,
  injectLlmSettingsIntoHelper,
  LLM_PROVIDER_CONFIGS,
  LLM_PROVIDER_MARKER,
  localizeCodeComments,
  normalizeLlmSettings,
  parseLlmSettings,
  serializeLlmSettings,
} from "./build-your-agent-llm.ts"

test("normalizeLlmSettings falls back to defaults", () => {
  assert.deepEqual(normalizeLlmSettings(null), DEFAULT_LLM_SETTINGS)
  assert.deepEqual(
    normalizeLlmSettings({
      llmProvider: "invalid" as never,
      apiToken: 123 as never,
    }),
    DEFAULT_LLM_SETTINGS,
  )
})

test("parse and serialize keep provider and token stable", () => {
  const serialized = serializeLlmSettings({
    llmProvider: "deepseek",
    apiToken: "sk-demo",
  })

  assert.deepEqual(parseLlmSettings(serialized), {
    llmProvider: "deepseek",
    apiToken: "sk-demo",
  })
})

test("provider config map keeps model and baseUrl by provider key", () => {
  assert.equal(
    LLM_PROVIDER_CONFIGS.kimi.baseUrl,
    "https://api.moonshot.cn/v1",
  )
  assert.equal(
    LLM_PROVIDER_CONFIGS.anthropic.model,
    "claude-sonnet-4-5",
  )
})

test("injectLlmSettingsIntoHelper replaces both placeholders", () => {
  const source = [
    `export const llmProvider = ${JSON.stringify(LLM_PROVIDER_MARKER)}`,
    `export const apiToken = ${JSON.stringify(API_TOKEN_MARKER)}`,
  ].join("\n")

  assert.equal(
    injectLlmSettingsIntoHelper(source, {
      llmProvider: "kimi",
      apiToken: "secret-token",
    }),
    [
      'export const llmProvider = "kimi"',
      'export const apiToken = "secret-token"',
    ].join("\n"),
  )
})

test("localizeCodeComments keeps only the active language comments", () => {
  const source = [
    "// @comment-cn 从数组里随机取出一个元素。",
    "// @comment-en Pick one random item from an array.",
    "export function pickRandom(items) {",
    "  return items[0]",
    "}",
  ].join("\n")

  assert.equal(
    localizeCodeComments(source, "cn"),
    [
      "// 从数组里随机取出一个元素。",
      "export function pickRandom(items) {",
      "  return items[0]",
      "}",
    ].join("\n"),
  )

  assert.equal(
    localizeCodeComments(source, "en"),
    [
      "// Pick one random item from an array.",
      "export function pickRandom(items) {",
      "  return items[0]",
      "}",
    ].join("\n"),
  )
})
