# 项目上下文（交接用）

给接手本项目的工具 / Agent 读：这里记录**当前目标、已完成进度、生成器抽取机制与下一步待办**。项目长期规则、命令、代码与文章约定请先读 `AGENTS.md`（`CLAUDE.md` 是指向 `AGENTS.md` 的软链接，只改 `AGENTS.md`）。

最后更新：2026-11-24，当前分支 `main`，全套 21/21 篇课程文稿（`intro.md`、`s00`–`s18`、`s16-read-autonomous-agents.md`）已完成精简定版、双轴 Code Review 复核与 MDX 重新生成（`pnpm run check:secrets`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全部通过）。

## 项目是什么

交互式教程站 **"Build Your Own Code Agent, Step by Step"**：共 19 章（`s00`–`s18`），源数据位于 `code-agent-course/`（每章 `sXX-*.md` 中文文章 + `sXX-*.js` 教学实现 + `sXX-*.test.js` 基于 `fake-llm.js` 的离线单测，外加导读 `intro.md`、补充阅读 `s16-read-autonomous-agents.md` 与共享底层 `helper.js`）。

构建时由 `scripts/generate-build-your-agent-content.mjs` 生成 `app/build-your-agent/content.generated.cn.mdx` 与脱敏后的 `app/build-your-agent/snippets/code-agent-course-helper.js`，前端使用 Next.js 15 App Router + Code Hike 实现左文右码滚动同步演进，并内置 WebContainer 浏览器沙盒（`LiveDemo`）。

## 用户目标（原话）

> 把 code agent 这 19 个步骤的代码，逐步严谨的，每两步之间分成三四步，逐行切换的 blog 丝滑一些（diff 忽略 console），然后完成整篇 blog，同时有简单干净的 UI。

> 1. console 可以忽略，完整切换到下一步的时候，可以整体切换一次 console 的 diff，就是每一章的最后
> 2. 不一定非要三四帧，按照你的理解把文章写好，逐步介绍 code agent 是如何构建的，符合学习习惯，多少切换步骤都可以，可以详细一些，十几步也可以，只要学习节奏丝滑就可以

---

## 已完成进度

### 1. 代码演进拆帧与课程代码清理（100% 完成）

- `s00`–`s17` 全部拆分为 **128 个可运行演进帧**（`s00` 4 帧、`s01` 6 帧、`s02`–`s17` 118 帧），`s18` 无独立 JS 保持单步；整页共 `1 intro + 129 steps + 1 outro`。
- `s00`–`s17` 的章节 `.js` 文件已去除行内注释（解释统一放进 `.md` 正文与帧说明，`helper.js`、`fake-llm.js`、`*.test.js` 保留注释）；`s08-context-compact.test.js` 补充了 `prepareHistoryForSummary` 保留首尾上下文的单测。

| 章 | 帧数 | 章 | 帧数 | 章 | 帧数 |
|---|---|---|---|---|---|
| s00 HTTP 调用 | 4 | s06 子代理 | 5 | s12 任务系统 | 6 |
| s01 循环 | 6 | s07 技能 | 5 | s13 后台任务 | 8 |
| s02 工具 | 5 | s08 压缩 | 9 | s14 定时调度 | 10 |
| s03 权限 | 5 | s09 记忆 | 13 | s15 团队 | 9 |
| s04 hooks | 7 | s10 系统提示词 | 7 | s16 团队协议 | 9 |
| s05 todo | 4 | s11 错误恢复 | 8 | s17 MCP | 8 |

拆帧硬约束（详见 `AGENTS.md` "Agent steps"）：
- 每章 `.md` 的 `## 博客代码演进` 下，`### N. 标题` 为一帧，配一个 ```` ```diff agent-step ```` 补丁（`@@` 分 hunk，空格上下文、`-` 删除、`+` 新增，无行号；空上下文行必须留单个空格）。
- `scripts/agent-steps.mjs` 强制校验：上下文在上一帧中恰好匹配一次、每帧变更 `<= 40` 行、每帧至少新增 1 行、末帧结果与章节 `.js` 逐字节相等。
- 每帧快照都必须语法合法且可运行；生成器的 `addFocusAnnotations` 会自动拓宽落在多行模板字符串内部的 `// !focus` 范围，避免注释污染字符串内容。
- **日志放最后**：功能帧不穿插 `console.*` / `colorLog` 变更，统一放到每章最后一帧切换（仅日志即功能的章节如 `s04`/`s05`、删旧变量导致旧日志报错如 `s02.3`、以及单行日志 `s01` 例外）。
- `scripts/agent-steps.test.mjs` 中的 `expectedSteps` 逐章锁死帧数，增删帧时必须同步更新。

### 2. 页面性能、滚动代码舞台与 UI 排版优化（100% 完成）

- **载荷瘦身**：
  - 新增 `lib/tutorial-runtime-server.ts` 与静态路由 `app/api/build-your-agent/runtime/[step]/route.ts`，打开 `LiveDemo` 时按需拉取完整 `runtimeCode` 并缓存；
  - 改为单套 `"github-from-css"` Token 树（`app/globals.css` 定义明暗两套 `--ch-0`..`--ch-26`），`app/components/themed-pre.tsx` 只渲染单个 `<Pre>` 并从 `tokens` 还原复制文本；
  - `lib/tutorial-files.ts` 将两个焦点区块间超过 13 行的未改动代码自动折叠为 `// ...`；`xterm` 样式拆至 `app/build-your-agent/xterm-styles.ts` 按需加载。
- **滚动同步与舞台体验**：
  - `app/build-your-agent/code-stage.tsx` 固定顶部文件标签与操作栏，仅内部 `.scrolly-stage__scroll` 滚动；`app/build-your-agent/focus.client.tsx` 用 `offsetTop` 平滑滚至聚焦行；
  - `app/components/annotations/token-transitions.client.tsx` 改为 `fill: "backwards"` 并过滤未变色的 `color` 关键帧，修复滚动后切换明暗主题锁色问题；
  - 代码行高设为整数 `19px` 消除亚像素横线；移除 `.scrolly-step` 的 `content-visibility: auto` 消除滚动高度跳动；新增 `app/build-your-agent/image-lightbox.tsx` 支持正文图片点击放大。
- **字体与弹窗布局**：
  - `.journal-prose` 换用现代中英文无衬线栈，正文字号 `0.94rem`、行高 `1.66`；`LiveDemo`（`livedemo.tsx` + `ide-editor.tsx`）改为 `createPortal` 挂载，调整为宽代码窄终端分栏、字号 `12px`。

### 3. 外链架构图全部转为 Mermaid 字符化并接入渲染（100% 完成，2026-11-17；`s00` 补充于 2026-11-23）

- `code-agent-course/` 内全部 **28 张**课程架构图（主线 `s00`–`s17` 共 **27** 张 + 补充阅读 `s16-read-autonomous-agents.md` 1 张）已全部使用 ```` ```mermaid ```` 代码块（含 `flowchart`、`sequenceDiagram`、`stateDiagram-v2`），与各章 JS 的工具名、函数名对齐，全仓外链已清零。
- `scripts/generate-build-your-agent-content.mjs` 采用围栏安全的 `stripNonMermaidCodeBlocks` 与不截断代码围栏的 `limitText`，确保主线 **27 个** Mermaid 块完整输出至 `content.generated.cn.mdx`（`scripts/agent-steps.test.mjs` 断言总数精确等于 `27`，并逐章断言 `s00`–`s06` 均含 Mermaid 图）。
- 新增客户端组件 `app/components/mermaid-diagram.tsx`，在 `app/components/code.tsx` 中按 `lang === "mermaid"` 分流：动态 `import("mermaid")` 懒加载、视口优先串行队列 + 内存缓存、贴合暖色纸面与深色模式的两套 `themeVariables`（并在 `app/globals.css` 补充 `.mermaid-diagram` 样式与暗色滤镜清理）。亮/暗双主题均已完成浏览器实测，无 fallback、无溢出、无起点倒置。

### 4. 专栏文风打磨与生成器首尾抽取升级（100% 完成，21/21 篇，2026-11-24）

- **生成器抽取机制（维护章节时需注意）**：
  - `escapeMdxText` 会跳过代码围栏与行内反引号，避免转义破坏代码和图表。
  - **每章首帧导读（`extractIntroExcerpt`）**按以下顺序抽取拼接：
    1. `#` 标题之后、第一个 `##` 之前的开篇导语（散文上限 `900` 字符）；
    2. 按固定列表顺序查找 `##` 小节：`问题` → `本章目标` → `解决方案` → `新增能力` → `为什么这一步重要` → `参考实现提醒` → `教学版边界` → `新增函数速览`（每节剥离非 `mermaid` 代码围栏，散文上限 `1100` 字符，保留其中的 `mermaid` 块且不计入字符上限）；
    3. `## 流程图` 小节（原样保留其中的 `mermaid` 或 `text` 围栏）。
    - 注：不在上述列表里的 `##` 小节（如 `本地运行与测试`、`和上一步的关键代码 diff` 等）只留在源 `.md` 中，不会出现在博客首帧。
  - **每章各帧主体**：取自 `## 博客代码演进` 下各 `### N. 标题` 的正文说明。
  - **每章末帧收尾（`extractClosingExcerpt`）**：在最后一帧说明后自动追加 `## 适合本节测试的 prompt` / `## 测试 Prompt`（不截断）与 `## 扩展阅读...`（仅扩展阅读受散文上限 `1100` 字符限制）。
  - `s18.md` 走 `extractExtensionReading`，全文标题降一级后作为单步内容输出（正文不要在代码围栏外使用裸 `<`、`{`、`}`）。
- **全套定版状态（21/21 篇全部定版）**：
  - **导读与主线（19 篇）**：`intro.md`、`s00-llm-http.md` 至 `s17-mcp-plugin.md` 全部统一为工位陪跑口吻、正文零 `—` 破折号、统一 `## 问题` / `## 解决方案`（内嵌 Mermaid 图）/ `## 测试 Prompt` / `## 扩展阅读：...` / `## 本地运行与测试` / `## 博客代码演进` / `## 和上一步的关键代码 diff（不含 helper.js）` 结构（其中 `s00` 为首章，不含 `## 扩展阅读` 与上一步 diff；`s16` 提供两组测试 Prompt 覆盖计划审批与关机协议），零 MDX 截断（`……`），每章最后一帧末尾均附有承上启下的 `> **本章思考题**`。
  - **收官与补充阅读（2 篇）**：`s18.md` 已校准与 `s00`–`s17` 衔接的时间线并补齐 `> **收官思考题**`；`s16-read-autonomous-agents.md` 已统一结构与口吻并保留 Mermaid 状态机图。

---

## 后续可选演进方向

1. **视觉验收微调（按需）**
   - 本地预览 `http://localhost:3000/cn/build-your-agent` 时，如对个别 Mermaid 图布局、字号或移动端排版有新想法，直接修改源 `.md` 或样式后重新生成即可。

2. **未来内容扩展（可选）**
   - 将 `s18.md` 中列出的进阶主题（如 Prompt Cache、Sandbox、Eval、Worktree 等）按需逐篇展开；或把 `s16-read-autonomous-agents.md` 的设计草图实现为可运行章节与单测。

3. **分批润色全套课程文稿（已完成，21/21 篇）**
   - 第一批：`intro.md`、`s00`–`s06`（已合并至 `main`，PR #2）；
   - 第二批：`s07`–`s11`（已提交至 `main`，`d9c486f`）；
   - 第三批：`s12`–`s17`、`s18.md`、`s16-read-autonomous-agents.md`（已完成定版与双轴 Review 修正并收官）。

3. **`s14`–`s17` 的 `loadTask` 空值检查修复（已完成）**
   - 已在 `s14-cron-scheduler.js` 至 `s17-mcp-plugin.js` 补回 `if (!existsSync(taskPath(id))) return null;` 及 `canStart` / `claimTask` / `completeTask` / `runGetTask` 的安全空值判断，同步移除 `s14-cron-scheduler.md` 第 1 帧中删掉该检查的旧补丁，并在 `s14-cron-scheduler.test.js` 补充不存在任务 ID 的回归单测。

4. **本地演示密钥管理与防泄漏机制（已完成）**
   - `code-agent-course/helper.js` 默认从 `process.env` 或 gitignored 的 `code-agent-course/.env.local` 读取 `LLM_PROVIDER` / `LLM_API_TOKEN`（及可选 `LLM_MODEL` / `LLM_BASE_URL`），模板见 `code-agent-course/.env.local.example`；生成器 `renderSafeHelper()` 剥离 `@local-env` 区块以保持网页版代码面板干净。
   - 新增 `scripts/check-secrets.mjs`（`pnpm run check:secrets`）、`scripts/check-secrets.test.mjs` 与本地 `.git/hooks/pre-commit`，提交前拦截 `.env*`、`helper.js` 硬编码 token 及真实密钥串。

---

## 常用校验命令与硬约束速查

```bash
pnpm run generate:build-your-agent   # 修改课程 .md / .js 后重新生成 MDX（会自动校验全部 128 个演进帧）
pnpm run check:secrets               # 检查仓库内是否存在误填的真实密钥或 .env 文件
pnpm typecheck && pnpm lint          # TypeScript 类型检查 + ESLint
pnpm test                            # Vitest 跑 18 个章节单测 (90 项) + Node test 跑生成器、安全与前端约束测试 (42 项)
```

- 默认只改 `code-agent-course/` 下的源文件（除非用户明确要求改前端或脚本）；**绝不手改** `app/build-your-agent/content.generated.cn.mdx` 与 `app/build-your-agent/snippets/code-agent-course-helper.js`。
- `code-agent-course/helper.js` 中的 `apiToken` 严禁硬编码真实值，本地演示统一配置在 `code-agent-course/.env.local`；`scripts/check-secrets.test.mjs`、`scripts/tutorial-client-bundle.test.mjs` 与 `.git/hooks/pre-commit` 会双重拦截。
- 如果本地正在运行 `next dev`，不要直接跑 `pnpm build`（两者争抢 `.next/` 会触发 `PageNotFoundError: /_document`）；日常校验用上面的 `generate` + `typecheck` + `lint` + `test` 即可。
