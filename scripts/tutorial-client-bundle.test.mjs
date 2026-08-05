import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const codeStagePath = new URL(
  "../app/build-your-agent/code-stage.tsx",
  import.meta.url,
)
const articlePagePath = new URL(
  "../app/build-your-agent/article-page.tsx",
  import.meta.url,
)
const liveDemoPath = new URL(
  "../app/build-your-agent/livedemo.tsx",
  import.meta.url,
)
const articleLoadingPath = new URL(
  "../app/[locale]/build-your-agent/loading.tsx",
  import.meta.url,
)
const postListPath = new URL(
  "../components/post-list.tsx",
  import.meta.url,
)

test("the tutorial client does not bundle the CodeHike highlighter", async () => {
  const source = await readFile(codeStagePath, "utf8")

  assert.doesNotMatch(source, /import\(["']codehike\/code["']\)/)
})

test("the tutorial server sends token data instead of rendered code trees", async () => {
  const source = await readFile(articlePagePath, "utf8")

  assert.doesNotMatch(source, /<ThemedPre/)
})

test("the tutorial serializes shared helper files only once", async () => {
  const source = await readFile(articlePagePath, "utf8")

  assert.doesNotMatch(source, /mergeDisplayFiles/)
  assert.match(source, /sharedFiles=\{preparedSharedFiles\}/)
})

test("the live demo defers editor and terminal code until it opens", async () => {
  const source = await readFile(liveDemoPath, "utf8")

  assert.doesNotMatch(source, /^import \{ FitAddon \}/m)
  assert.doesNotMatch(source, /^import \{ Terminal \}/m)
  assert.doesNotMatch(source, /^import \{ IdeEditor \}/m)
  assert.match(source, /import\("@xterm\/addon-fit"\)/)
  assert.match(source, /import\("@xterm\/xterm"\)/)
  assert.match(source, /import\("\.\/ide-editor"\)/)
})

test("homepage articles use native navigation", async () => {
  const source = await readFile(postListPath, "utf8")

  assert.doesNotMatch(source, /from ["']next\/link["']/)
  assert.match(source, /<a\s/)
})

test("article navigation provides immediate loading feedback", async () => {
  const source = await readFile(articleLoadingPath, "utf8").catch(
    () => "",
  )

  assert.match(source, /role="status"/)
})
