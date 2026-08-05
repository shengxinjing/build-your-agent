# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A bilingual (English/Chinese) interactive tutorial site — "Build Your Own Code Agent, Step by Step." Built with Next.js 15 App Router + Code Hike + WebContainer API. The main feature is a scrollytelling tutorial where prose and code stay synced, with a live in-browser sandbox demo.

## Commands

All commands run from the project root:

```bash
pnpm dev          # Generate course content and start Next.js
pnpm dev:clean    # Clear .next, regenerate, and start Next.js
pnpm build        # Generate course content and build for production
pnpm lint         # ESLint (next/core-web-vitals)
pnpm prod:watch   # File watcher that rebuilds and restarts on changes
```

### Tests

Course chapters use Vitest; application utilities use Node.js's built-in test runner:

```bash
pnpm test
node --test lib/*.test.ts scripts/*.test.mjs
```

## Architecture

### Routing & Localization

- `app/[locale]/` — dynamic locale routing (`en`, `cn`). Root `/` redirects to `/cn`.
- `lib/i18n.ts` — locale detection, routing helpers, UI string maps in `lib/site-copy.ts`.

### Tutorial System (the core feature)

The tutorial at `/build-your-agent` has three layers:

1. **Generated MDX** (`content.generated.cn.mdx`) — built from `code-agent-course/s00-s18` by `scripts/generate-build-your-agent-content.mjs`. Parsed server-side via `@mdx-js/loader` and Code Hike plugins in `next.config.mjs`.

2. **Code Stage** (`code-stage.tsx`, client) — displays chapter snapshots synced to scroll position via Code Hike's `useSelectedIndex`. `lib/tutorial-files.ts` parses code metadata and `lib/tutorial-files-server.ts` loads the generated shared `helper.js`.

3. **Live Demo** (`livedemo.tsx`, client) — WebContainer sandbox with Monaco editor (`ide-editor.tsx`) and xterm terminal. WebContainer instance is cached on `window` to survive re-renders.

### Key Conventions

- **Client/Server split**: `article-page.tsx` is the server component that orchestrates data loading and highlighting. `code-stage.tsx` and `livedemo.tsx` are client components.
- **Theme**: class-based dark mode via `ThemeProvider` context + localStorage persistence. Early flash prevention via inline script (`lib/theme-script.ts`).
- **Code highlighting**: Done server-side for both light and dark themes simultaneously, passed to client.

### Code Style

- Prettier: no semicolons, trailing commas. MDX/MD files use 42-char print width.
- Path alias: `@/*` maps to project root (e.g., `@/lib/utils`, `@/components/`).
- Cross-origin headers configured in `next.config.mjs` for WebContainer API (COEP/COOP).
