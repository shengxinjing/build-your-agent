# AGENTS.md

Project rules for coding agents. `CLAUDE.md` is a symlink to this file, so Claude Code and Codex read the same text. Edit only `AGENTS.md`.

General working rules (reply language, minimal changes, verification, no commits unless asked) live in the global `~/.agents/AGENTS.md` and are not repeated here.

Current goals, progress and open decisions live in `context.md`; read it before starting work on the course.

## Project Overview

An interactive tutorial site — "Build Your Own Code Agent, Step by Step." Built with Next.js 15 App Router + Code Hike + WebContainer API. The main feature is a scrollytelling tutorial where prose and code stay synced, with a live in-browser sandbox demo.

The repo has two halves:

- `code-agent-course/` — the course itself (Chinese articles, JavaScript chapter implementations, tests). This is the source of truth and where most work happens.
- The Next.js app (`app/`, `components/`, `lib/`, `scripts/`) — renders the course as an interactive page.

Most requests are about `code-agent-course`. Do not edit the Next.js app, UI components, or unrelated directories unless asked.

## Commands

All commands run from the project root. pnpm is pinned through `packageManager` in `package.json`.

```bash
pnpm dev          # Generate course content and start Next.js
pnpm dev:clean    # Clear .next, regenerate, and start Next.js
pnpm build        # Generate course content and build for production
pnpm lint         # ESLint (next/core-web-vitals)
pnpm typecheck    # tsc --noEmit
pnpm prod:watch   # File watcher that rebuilds and restarts on changes
pnpm run generate:build-your-agent   # Regenerate the article only
```

### Tests

`pnpm test` runs both suites: Vitest for course chapters, then Node.js's built-in test runner for the generator and app utilities.

```bash
pnpm test
pnpm vitest run code-agent-course/s08-context-compact.test.js   # single chapter
pnpm vitest run code-agent-course/                              # all chapters, after changing helper.js
node --test scripts/agent-steps.test.mjs                        # single app/script test file
node --check code-agent-course/s08-context-compact.js           # syntax check
```

After changing one chapter, run that chapter's tests first. For Markdown-only changes, regenerate the article (`pnpm run generate:build-your-agent`); it fails on broken agent steps.

The `node --test` files import `.ts` directly (Node type stripping), which is why `tsconfig.json` sets `allowImportingTsExtensions`.

### Running a chapter by hand

Chapters are interactive CLIs that call a real LLM. Copy `code-agent-course/.env.local.example` to `code-agent-course/.env.local` (gitignored) and set `LLM_PROVIDER` (`openai` / `deepseek` / `kimi`) and `LLM_API_TOKEN` (optionally `LLM_MODEL` / `LLM_BASE_URL`). `code-agent-course/helper.js` reads `process.env` and `code-agent-course/.env.local` at runtime; the generator strips that local loader when emitting the web snippet. Run from inside `code-agent-course/` (e.g. `cd code-agent-course && node s07-skill-loading.js`), because paths such as `skills/` resolve from `process.cwd()`. Never hardcode or commit a real token in `helper.js` (`pnpm run check:secrets` and the Git `pre-commit` hook enforce this).

## Content Pipeline

```text
code-agent-course/sXX-*.md + sXX-*.js + helper.js
        │  scripts/generate-build-your-agent-content.mjs
        ▼
app/build-your-agent/content.generated.cn.mdx
app/build-your-agent/snippets/code-agent-course-helper.js
```

- Both outputs are generated and committed. Never edit them by hand; edit the course files and regenerate. `pnpm dev` and `pnpm build` regenerate automatically.
- The generator takes each chapter's `sXX` Markdown, extracts selected sections (the `excerptSections` list in the generator, matched by Chinese heading name), and emits one or more Code Hike `## !!steps` blocks.
- `s18` has no JS file; its step shows `s17-mcp-plugin.js`. Extra reading files such as `s16-read-autonomous-agents.md` are not picked as a chapter's main article because they have no matching `.js`.
- The generated helper replaces the provider and API token with `__BUILD_YOUR_AGENT_*__` placeholders, which the page fills in at run time from the LLM settings panel. The real token must never appear in the code panel; `scripts/tutorial-client-bundle.test.mjs` enforces this and other client bundle constraints.
- There is only Chinese content. `/en/build-your-agent` renders the same `content.generated.cn.mdx`; only the site chrome is localized.

### Agent steps (per-chapter code evolution)

Every chapter with its own JS file (s00–s17) splits its code change into several frames under a `## 博客代码演进` section in its Markdown. `scripts/agent-steps.test.mjs` asserts the frame count of each chapter, so update the count there when adding or removing a frame. s18 has no JS file and stays a single step.

- Each `### N. 标题` is one frame containing a ` ```diff agent-step ` block. `@@` separates hunks; space = context, `-` = removed, `+` = added. No line numbers.
- `scripts/agent-steps.mjs` applies the frames in order, starting from the previous chapter's JS (empty source for s00). Rules it enforces:
  - each hunk's context + removed lines must match exactly once in the current code;
  - at most 40 changed lines per frame;
  - a frame normally adds lines (added lines become the focus highlight); a frame that only removes code is allowed and highlights the line right after the removed block;
  - after the last frame the code must equal the chapter's real JS file byte for byte, or generation fails.
- Do not normalize trailing newlines in `applyAgentPatch`; the trailing empty element from `split("\n")` carries the file's final newline.
- Every frame should leave runnable code, because each frame can be run in the live demo: valid syntax and no reference to something a later frame defines.
- Logs come last. Functional frames leave out added or changed `console.*` / `colorLog` lines, and one final frame per chapter (titled like "补上教学日志") switches all of them at once, together with helpers that exist only for logging. Exceptions: a log that is the feature itself (the s04 demo hooks, the s05 task list), or one that would break if left behind (it references a variable the frame removes), goes in its functional frame.
- Use as many frames as the learning pace needs (currently 5–14 per chapter). One idea per frame; when a tool is added, put its implementation, schema, and `handlers` entry in the same frame so the frame is usable. Do not pad.
- The generator widens a focus range that would start or end inside a multi-line template literal, because the `// !focus` marker is a comment and would otherwise become part of the string.

## Course Conventions (`code-agent-course/`)

### Code

- Each chapter is `sXX-name.js` + `.md` + `.test.js`. A later chapter keeps everything from the previous one and adds one capability.
- Shared low-level helpers go in `helper.js` (never a `utils.js`): HTTP calls, CLI input, file helpers, frontmatter parsing, cron expression parsing. It is a single latest version shared by all chapters, not evolved per chapter.
- Logic that depends on chapter-local state stays in the chapter file: task queues, cron queues, agent loops, tool handlers.
- ES modules, near-zero dependencies, Node.js built-ins preferred. Keep it readable; this is teaching code, not a production system.
- Do not delete teaching logs to make output look cleaner.
- Chapter JS files (`sXX-*.js`) contain no comments. Explanations belong in the chapter Markdown (frame descriptions and prose), so the code panel shows only code. Exceptions: tool directives such as `eslint-disable`. `helper.js`, `fake-llm.js`, and test files may keep comments.
- If the owner manually changed code or comments, keep those changes unless they conflict with the task.
- Chapter tests run against `fake-llm.js`, so they need no API key.

### Articles

Markdown is Chinese, friendly to beginners, in plain wording (prefer "write to a file" over vaguer terms). Recommended chapter structure:

1. Opening analogy: what new ability this chapter gives the agent.
2. Chapter goal: the problem being solved, in one short explanation.
3. New capabilities: the new tools, functions, or mechanisms.
4. Flow diagram: Mermaid (` ```mermaid `) or ASCII (` ```text `).
5. New function overview, before the core code.
6. Key code: only the snippets that best explain the chapter.
7. Test prompt: one prompt that triggers the new feature.
8. Further reading: how commercial agents solve the same problem.
9. Diff from the previous step: key changes, without line numbers.

Course diagrams use inline ` ```mermaid ` blocks rendered client-side by `app/components/mermaid-diagram.tsx`. Do not reintroduce external SVG image links or `asset/dasheng/` images.

### Facts that are easy to get wrong

- Empty Enter keeps waiting for input; it does not quit the CLI. Use `q` or `exit`.
- OpenAI-compatible tool calls are in `message.tool_calls`; `arguments` is a JSON string and needs `JSON.parse()`. Tool results must be sent back with `tool_call_id`.
- s14 uses an in-process cron scheduler (`cronTick → cronQueue → processCronQueue → agentLoop → injectCronJobs → [Scheduled] prompt`), not operating-system cron. OS cron is only a further-reading topic; do not imply the chapter installs a system task.
- `.scheduled_tasks.json` stores durable jobs. Dates printed right when s14 starts mean an old durable job was restored.
- `*/2 * * * *` fires on minutes divisible by 2; it does not wait two minutes from registration.

## App Architecture

- **Routing**: `app/[locale]/` handles `en` and `cn`; `/` redirects to `/cn`. Locale helpers are in `lib/i18n.ts`, UI strings in `lib/site-copy.ts`.
- **Article page**: `app/build-your-agent/article-page.tsx` is the server component. It parses the MDX with Code Hike's `parseRoot`, highlights code server-side for light and dark themes, and passes token data to the client.
- **Code Stage** (`code-stage.tsx`, client): shows the step's `agent.js` plus the shared `helper.js`, synced to scroll position through Code Hike's selection context. `lib/tutorial-files.ts` parses code-block metadata such as `range=`; `lib/tutorial-files-server.ts` loads the shared helper.
- **Live Demo** (`livedemo.tsx`, client): WebContainer sandbox with a Monaco editor and xterm terminal, loaded lazily when opened. The WebContainer instance is cached on `window` to survive re-renders. It needs the COEP/COOP headers set in `next.config.mjs`.
- **Theme**: class-based dark mode through `ThemeProvider` and localStorage, with an inline script (`lib/theme-script.ts`) to prevent flashing.

## Code Style

- Prettier: no semicolons, trailing commas; Markdown and MDX use a 42-character print width. Course JS files in `code-agent-course/` use semicolons — follow the surrounding file.
- Path alias: `@/*` maps to the project root.
- Size limits: split a file over 500 lines or a function over 50 lines when you are already changing it.

## Git

- GitHub Flow: branch from `main`, merge back through a PR; no direct commits or force pushes to `main`.
- Conventional Commits (`feat` / `fix` / `refactor` / `docs` / `test` / `chore`), one concern per commit.
- Issue and PR descriptions go conclusion first: purpose, background, changes, impact and risk, verification.
