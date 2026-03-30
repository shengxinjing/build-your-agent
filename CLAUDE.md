# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A bilingual (English/Chinese) interactive tutorial site — "Build Your Own Code Agent, Step by Step." Built with Next.js 15 App Router + Code Hike + WebContainer API. The main feature is a scrollytelling tutorial where prose and code stay synced, with a live in-browser sandbox demo.

## Commands

All commands run from the `web/` directory:

```bash
npm run dev          # Start Next.js dev server
npm run dev:clean    # Dev with .next/ cache cleared
npm run build        # Production build
npm run lint         # ESLint (next/core-web-vitals)
npm run prod:watch   # File watcher that rebuilds + restarts on changes
```

### Tests

Uses Node.js built-in test runner (no Jest/Vitest). Run from `web/`:

```bash
npx tsx --test lib/**/*.test.ts       # Run all tests
npx tsx --test lib/tutorial-files.test.ts  # Run a single test file
```

## Architecture

### Routing & Localization

- `app/[locale]/` — dynamic locale routing (`en`, `cn`). Root `/` redirects to `/cn`.
- `lib/i18n.ts` — locale detection, routing helpers, UI string maps in `lib/site-copy.ts`.

### Tutorial System (the core feature)

The tutorial at `/build-your-agent` has three layers:

1. **MDX Content** (`content.en.mdx`, `content.cn.mdx`) — prose with Code Hike annotations (mark, focus, callout). Parsed server-side via `@mdx-js/loader` + Code Hike's `remarkPlugins`/`recmaPlugins` in `next.config.mjs`.

2. **Code Stage** (`code-stage.tsx`, client) — displays tabbed code panels synced to scroll position via Code Hike's `useSelectedIndex`. Files come from `snippets/` directory (01-agent.js through 07-agent.js, utils.js). `lib/tutorial-files.ts` handles parsing code block metadata, line-range slicing, and merging display files. `lib/tutorial-files-server.ts` loads snippet files from disk.

3. **Live Demo** (`livedemo.tsx`, client) — WebContainer sandbox with Monaco editor (`ide-editor.tsx`) and xterm terminal. WebContainer instance is cached on `window` to survive re-renders.

### Key Conventions

- **Client/Server split**: `article-page.tsx` is the server component that orchestrates data loading and highlighting. `code-stage.tsx` and `livedemo.tsx` are client components.
- **Theme**: class-based dark mode via `ThemeProvider` context + localStorage persistence. Early flash prevention via inline script (`lib/theme-script.ts`).
- **Code highlighting**: Done server-side for both light and dark themes simultaneously, passed to client.

### Code Style

- Prettier: no semicolons, trailing commas. MDX/MD files use 42-char print width.
- Path alias: `@/*` maps to `web/` root (e.g., `@/lib/utils`, `@/components/`).
- Cross-origin headers configured in `next.config.mjs` for WebContainer API (COEP/COOP).
