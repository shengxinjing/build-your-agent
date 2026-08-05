import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("the MDX pipeline enables GitHub-Flavored Markdown tables", async () => {
  const config = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8")
  assert.match(config, /import remarkGfm from "remark-gfm"/)
  assert.match(config, /remarkPlugins:\s*\[remarkGfm,/)

  const [{ compile }, { default: remarkGfm }] = await Promise.all([
    import("@mdx-js/mdx"),
    import("remark-gfm"),
  ])
  const output = String(await compile([
    "| 配置 | 含义 |",
    "|---|---|",
    "| `model` | 默认模型名 |",
  ].join("\n"), { remarkPlugins: [remarkGfm] }))

  assert.match(output, /_components\.table/)
  assert.match(output, /_components\.th/)
  assert.match(output, /_components\.td/)
})

test("tutorial tables have readable responsive styles", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.match(css, /\.journal-prose table\s*{/)
  assert.match(css, /\.journal-prose th,/)
  assert.match(css, /\.journal-prose td\s*{/)
})
