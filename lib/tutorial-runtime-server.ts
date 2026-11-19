import { readFile } from "node:fs/promises"
import path from "node:path"

const ARTICLE_DIR = path.join(
  process.cwd(),
  "app/build-your-agent",
)
const GENERATED_MDX_PATH = path.join(
  ARTICLE_DIR,
  "content.generated.cn.mdx",
)

let cachedStepsPromise: Promise<string[]> | null = null

function stripFocusComments(code: string) {
  return code
    .split("\n")
    .filter(
      (line) =>
        line !== "// !focus(start)" &&
        line !== "// !focus(end)",
    )
    .join("\n")
}

async function resolveStepCode(rawBlock: string) {
  if (!rawBlock.startsWith("!from ")) {
    return stripFocusComments(rawBlock)
  }

  const relativePath = rawBlock.slice(6).trim()
  const targetPath = path.resolve(ARTICLE_DIR, relativePath)
  const fileContents = await readFile(targetPath, "utf8")
  return stripFocusComments(fileContents)
}

async function parseRuntimeSteps() {
  const mdx = await readFile(GENERATED_MDX_PATH, "utf8")
  const sections = mdx.split(/^## !!steps(?: |\r?\n)/m).slice(1)

  return Promise.all(
    sections.map(async (section, index) => {
      const match = section.match(
        /^```[^\n]*! agent\.js[^\n]*\n([\s\S]*?)\n```(?:\r?\n|$)/m,
      )

      if (!match) {
        throw new Error(
          `Missing agent.js block for tutorial step ${index}`,
        )
      }

      return resolveStepCode(match[1])
    }),
  )
}

export async function getTutorialRuntimeSteps() {
  if (process.env.NODE_ENV !== "production") {
    return parseRuntimeSteps()
  }

  if (!cachedStepsPromise) {
    cachedStepsPromise = parseRuntimeSteps().catch((error) => {
      cachedStepsPromise = null
      throw error
    })
  }

  return cachedStepsPromise
}

export async function getTutorialRuntimeStepCode(
  stepIndex: number,
) {
  const steps = await getTutorialRuntimeSteps()
  return steps[stepIndex] ?? null
}
