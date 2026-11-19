import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  checkGeneratedHelperSource,
  checkHelperSource,
  checkRepoSecrets,
  findSecretsInText,
  isForbiddenEnvFile,
} from "./check-secrets.mjs"

const rootDir = fileURLToPath(new URL("../", import.meta.url))

test("isForbiddenEnvFile blocks local env files but allows templates", () => {
  assert.equal(isForbiddenEnvFile(".env"), true)
  assert.equal(isForbiddenEnvFile(".env.local"), true)
  assert.equal(isForbiddenEnvFile("code-agent-course/.env"), true)
  assert.equal(isForbiddenEnvFile("code-agent-course/.env.local"), true)
  assert.equal(isForbiddenEnvFile(".env.production.local"), true)

  assert.equal(isForbiddenEnvFile(".env.example"), false)
  assert.equal(isForbiddenEnvFile("code-agent-course/.env.local.example"), false)
  assert.equal(isForbiddenEnvFile("code-agent-course/helper.js"), false)
})

test("findSecretsInText detects real API tokens and ignores placeholders or task IDs", () => {
  const sampleSecret = ["sk", "1234567890abcdef1234567890"].join("-")
  const sampleAnthropic = ["sk", "ant", "api03", "abcdefghijklmnop123456"].join("-")
  const sampleGithub = ["ghp", "1234567890abcdefghij1234567890"].join("_")

  assert.equal(findSecretsInText(`token = "${sampleSecret}"`, "a.js").length, 1)
  assert.equal(findSecretsInText(`key = "${sampleAnthropic}"`, "b.js").length, 1)
  assert.equal(findSecretsInText(`pat = "${sampleGithub}"`, "c.js").length, 1)

  assert.equal(findSecretsInText('apiToken: "sk-demo"', "test.ts").length, 0)
  assert.equal(findSecretsInText('hint: "例如 sk-..."', "ui.tsx").length, 0)
  assert.equal(findSecretsInText("task-1234567890abcdefghijkl", "doc.md").length, 0)
})

test("checkHelperSource requires apiToken and provider tokens to have no hardcoded literals", () => {
  const safeSource = [
    'export const apiToken = process.env.LLM_API_TOKEN || localEnv.LLM_API_TOKEN || "";',
    "export const llmProviderConfigs = {",
    "  deepseek: { token: apiToken },",
    "};",
  ].join("\n")
  assert.deepEqual(checkHelperSource(safeSource), [])

  const hardcodedExport = [
    'export const apiToken = "not-empty-token";',
    "export const llmProviderConfigs = { deepseek: { token: apiToken } };",
  ].join("\n")
  assert.equal(checkHelperSource(hardcodedExport).length, 1)

  const hardcodedProvider = [
    'export const apiToken = "";',
    'export const llmProviderConfigs = { deepseek: { token: "secret" } };',
  ].join("\n")
  assert.equal(checkHelperSource(hardcodedProvider).length, 1)
})

test("checkGeneratedHelperSource ensures placeholders exist and local env loader is stripped", () => {
  const valid = 'export const apiToken = "__BUILD_YOUR_AGENT_API_TOKEN__";\n'
  assert.deepEqual(checkGeneratedHelperSource(valid), [])

  const leaked = [
    "// @local-env-start",
    "function loadLocalEnv() {}",
    'export const apiToken = "__BUILD_YOUR_AGENT_API_TOKEN__";',
  ].join("\n")
  assert.equal(checkGeneratedHelperSource(leaked).length, 1)

  assert.equal(checkGeneratedHelperSource('export const apiToken = "";').length, 1)
})

test("repository files pass secret checks with zero findings", () => {
  assert.deepEqual(checkRepoSecrets({ rootDir }), [])
})

test("helper.js loads local demo config from .env.local without modifying source", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-env-test-"))
  try {
    const helperTarget = path.join(tmpDir, "helper.js")
    fs.copyFileSync(
      path.join(rootDir, "code-agent-course/helper.js"),
      helperTarget,
    )
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      [
        "# local demo overrides",
        "LLM_PROVIDER=kimi",
        'LLM_API_TOKEN="local-demo-token"',
        "LLM_MODEL=kimi-custom # inline comment",
        "LLM_BASE_URL=https://example.invalid/v1",
      ].join("\n"),
    )

    const env = { ...process.env }
    delete env.LLM_PROVIDER
    delete env.LLM_API_TOKEN
    delete env.LLM_MODEL
    delete env.LLM_BASE_URL

    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import * as h from ${JSON.stringify(`file://${helperTarget}`)};
         console.log(JSON.stringify({
           llmProvider: h.llmProvider,
           apiToken: h.apiToken,
           kimi: h.llmProviderConfigs.kimi,
         }));`,
      ],
      { env, encoding: "utf8" },
    )

    const loaded = JSON.parse(output)
    assert.equal(loaded.llmProvider, "kimi")
    assert.equal(loaded.apiToken, "local-demo-token")
    assert.equal(loaded.kimi.token, "local-demo-token")
    assert.equal(loaded.kimi.model, "kimi-custom")
    assert.equal(loaded.kimi.baseUrl, "https://example.invalid/v1")
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("checkRepoSecrets --staged blocks staged secrets and .env files", () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "secret-hook-test-"))
  try {
    execFileSync("git", ["init", "-q"], { cwd: tmpRepo })
    const fakeSecret = ["sk", "1234567890abcdef1234567890"].join("-")
    fs.mkdirSync(path.join(tmpRepo, "code-agent-course"), { recursive: true })
    fs.writeFileSync(
      path.join(tmpRepo, "code-agent-course/helper.js"),
      `export const apiToken = "${fakeSecret}";\n`,
    )
    fs.writeFileSync(path.join(tmpRepo, ".env.local"), "LLM_API_TOKEN=demo\n")

    execFileSync(
      "git",
      ["add", "-f", "code-agent-course/helper.js", ".env.local"],
      { cwd: tmpRepo },
    )

    const findings = checkRepoSecrets({ rootDir: tmpRepo, staged: true })
    assert.ok(findings.some((f) => f.file === ".env.local"))
    assert.ok(
      findings.some(
        (f) => f.file === "code-agent-course/helper.js" && f.reason.includes("API key"),
      ),
    )
    assert.ok(
      findings.some(
        (f) => f.file === "code-agent-course/helper.js" && f.reason.includes("Hardcoded apiToken"),
      ),
    )
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true })
  }
})
