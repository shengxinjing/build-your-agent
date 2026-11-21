import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const HELPER_PATH = "code-agent-course/helper.js"
export const GENERATED_HELPER_PATH =
  "app/build-your-agent/snippets/code-agent-course-helper.js"

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
])

const SECRET_PATTERNS = [
  {
    name: "API key (sk-*)",
    regex: /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-api\d+-|or-v1-)?[A-Za-z0-9_-]{16,}/,
  },
  {
    name: "GitHub token",
    regex: /(?<![A-Za-z0-9_-])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  },
  {
    name: "GitHub fine-grained PAT",
    regex: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{20,}/,
  },
  {
    name: "AWS access key ID",
    regex: /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
]

const NON_EMPTY_STRING_LITERAL = /(["'`])(?:\\.|(?!\1).)+\1/

export function isForbiddenEnvFile(filePath) {
  const normalized = filePath.replaceAll("\\", "/")
  const base = path.posix.basename(normalized)
  return base.startsWith(".env") && !/\.(example|sample|template)$/i.test(base)
}

function stripInlineComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") {
        i += 1
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i)
    }
  }
  return line
}

export function findSecretsInText(text, filePath) {
  if (text.includes("\0")) return []
  const findings = []
  const lines = text.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file: filePath,
          line: index + 1,
          reason: pattern.name,
        })
      }
    }
  }

  return findings
}

export function checkHelperSource(source, filePath = HELPER_PATH) {
  const findings = []
  const lines = source.split(/\r?\n/)
  let foundApiTokenExport = false

  for (const [index, rawLine] of lines.entries()) {
    const code = stripInlineComment(rawLine).trim()
    const apiTokenMatch = code.match(/^export\s+const\s+apiToken\s*=\s*(.+?);?$/)
    if (apiTokenMatch) {
      foundApiTokenExport = true
      if (NON_EMPTY_STRING_LITERAL.test(apiTokenMatch[1])) {
        findings.push({
          file: filePath,
          line: index + 1,
          reason: "Hardcoded apiToken in helper.js (use code-agent-course/.env.local instead)",
        })
      }
    }

    if (/\btoken\s*:\s*(["'`])(?:\\.|(?!\1).)+\1/.test(code)) {
      findings.push({
        file: filePath,
        line: index + 1,
        reason: "Hardcoded provider token in helper.js (use apiToken instead)",
      })
    }
  }

  if (!foundApiTokenExport) {
    findings.push({
      file: filePath,
      line: 1,
      reason: "Missing export const apiToken declaration in helper.js",
    })
  }

  return findings
}

export function checkGeneratedHelperSource(
  source,
  filePath = GENERATED_HELPER_PATH,
) {
  const findings = []

  if (!source.includes('export const apiToken = "__BUILD_YOUR_AGENT_API_TOKEN__";')) {
    findings.push({
      file: filePath,
      line: 1,
      reason: "Generated helper is missing __BUILD_YOUR_AGENT_API_TOKEN__ placeholder",
    })
  }

  if (source.includes("@local-env-start") || source.includes("loadLocalEnv")) {
    findings.push({
      file: filePath,
      line: 1,
      reason: "Local .env.local loader leaked into generated web helper",
    })
  }

  return findings
}

function listFilesToCheck({ rootDir, staged }) {
  const gitArgs = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]

  const output = execFileSync("git", gitArgs, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })

  return output.split("\0").filter(Boolean)
}

function readCandidateFile({ rootDir, filePath, staged }) {
  try {
    const buffer = staged
      ? execFileSync("git", ["show", `:${filePath}`], {
          cwd: rootDir,
          maxBuffer: 20 * 1024 * 1024,
        })
      : fs.readFileSync(path.join(rootDir, filePath))

    if (buffer.includes(0)) return null
    return buffer.toString("utf8")
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      return null
    }
    throw error
  }
}

export function checkRepoSecrets({ rootDir, staged = false }) {
  const findings = []
  const files = listFilesToCheck({ rootDir, staged })

  for (const filePath of files) {
    if (isForbiddenEnvFile(filePath)) {
      findings.push({
        file: filePath,
        line: 1,
        reason: "Local .env file must not be committed",
      })
      continue
    }

    const ext = path.extname(filePath).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext)) continue

    const text = readCandidateFile({ rootDir, filePath, staged })
    if (text === null) continue

    findings.push(...findSecretsInText(text, filePath))

    if (filePath === HELPER_PATH) {
      findings.push(...checkHelperSource(text, filePath))
    } else if (filePath === GENERATED_HELPER_PATH) {
      findings.push(...checkGeneratedHelperSource(text, filePath))
    }
  }

  return findings
}

function runCli() {
  const staged = process.argv.includes("--staged")
  const rootDir = fileURLToPath(new URL("../", import.meta.url))
  const findings = checkRepoSecrets({ rootDir, staged })

  if (findings.length > 0) {
    console.error("Secret check failed:")
    for (const finding of findings) {
      console.error(`  - ${finding.file}:${finding.line} ${finding.reason}`)
    }
    console.error(
      "\nPut local demo credentials in code-agent-course/.env.local instead of tracked files.",
    )
    process.exit(1)
  }

  const scope = staged ? "staged files" : "repository files"
  console.log(`Secret check passed (${scope}).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
