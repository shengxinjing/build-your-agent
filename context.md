# 项目上下文（交接用）

给接手本项目的工具 / Agent 读：这里记录**当前目标、已完成进度、生成器抽取机制与下一步待办**。项目长期规则、命令、代码与文章约定请先读 `AGENTS.md`（`CLAUDE.md` 是指向 `AGENTS.md` 的软链接，只改 `AGENTS.md`）。

最后更新：2026-11-19，当前功能分支 `feat/scrolly-course`（从 `main` 切出），已完成本地密钥防泄漏机制与阶段性整理提交（`pnpm run check:secrets`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过）。

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

- `s00`–`s17` 全部拆分为 **130 个可运行演进帧**（`s00` 4 帧、`s01` 6 帧、`s02`–`s17` 120 帧），`s18` 无独立 JS 保持单步；整页共 `1 intro + 131 steps + 1 outro`。
- `s00`–`s17` 的章节 `.js` 文件已去除行内注释（解释统一放进 `.md` 正文与帧说明，`helper.js`、`fake-llm.js`、`*.test.js` 保留注释）；`s08-context-compact.test.js` 补充了 `prepareHistoryForSummary` 保留首尾上下文的单测。

| 章 | 帧数 | 章 | 帧数 | 章 | 帧数 |
|---|---|---|---|---|---|
| s00 HTTP 调用 | 4 | s06 子代理 | 5 | s12 任务系统 | 6 |
| s01 循环 | 6 | s07 技能 | 5 | s13 后台任务 | 8 |
| s02 工具 | 5 | s08 压缩 | 9 | s14 定时调度 | 10 |
| s03 权限 | 5 | s09 记忆 | 14 | s15 团队 | 9 |
| s04 hooks | 7 | s10 系统提示词 | 7 | s16 团队协议 | 9 |
| s05 todo | 5 | s11 错误恢复 | 8 | s17 MCP | 8 |

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

### 3. 外链架构图全部转为 Mermaid 字符化并接入渲染（100% 完成，2026-11-17）

- `code-agent-course/` 内全部 **27 张**外链课程 SVG（主线 `s01`–`s17` 共 26 张 + 补充阅读 `s16-read-autonomous-agents.md` 1 张）已重写为 ```` ```mermaid ```` 代码块（含 `flowchart`、`sequenceDiagram`、`stateDiagram-v2`），与各章 JS 的工具名、函数名对齐，全仓外链已清零。
- `scripts/generate-build-your-agent-content.mjs` 采用围栏安全的 `stripNonMermaidCodeBlocks` 与不截断代码围栏的 `limitText`，确保主线 26 个 Mermaid 块完整输出至 `content.generated.cn.mdx`（`scripts/agent-steps.test.mjs` 断言数量精确等于 `26`）。
- 新增客户端组件 `app/components/mermaid-diagram.tsx`，在 `app/components/code.tsx` 中按 `lang === "mermaid"` 分流：动态 `import("mermaid")` 懒加载、视口优先串行队列 + 内存缓存、贴合暖色纸面与深色模式的两套 `themeVariables`（并在 `app/globals.css` 补充 `.mermaid-diagram` 样式与暗色滤镜清理）。Playwright 实测亮/暗双主题全部正常渲染、零报错。

### 4. 专栏文风打磨与生成器首尾抽取升级（已完成 5/21 篇）

- **生成器抽取机制（润色后续章节前必读）**：
  - `escapeMdxText` 会跳过代码围栏与行内反引号，避免转义破坏代码和图表。
  - **每章首帧导读（`extractIntroExcerpt`）**按以下顺序抽取拼接：
    1. `#` 标题之后、第一个 `##` 之前的开篇导语（散文上限 `900` 字符）；
    2. 按固定列表顺序查找 `##` 小节：`问题` → `本章目标` → `解决方案` → `新增能力` → `为什么这一步重要` → `参考实现提醒` → `教学版边界` → `新增函数速览`（每节剥离非 `mermaid` 代码围栏，散文上限 `1100` 字符，保留其中的 `mermaid` 块且不计入字符上限）；
    3. `## 流程图` 小节（原样保留其中的 `mermaid` 或 `text` 围栏）。
    - 注：不在上述列表里的 `##` 小节（如 `工作原理`、`关键代码`、`试一下` 等）只留在源 `.md` 中，不会出现在博客首帧。
  - **每章各帧主体**：取自 `## 博客代码演进` 下各 `### N. 标题` 的正文说明。
  - **每章末帧收尾（`extractClosingExcerpt`）**：在最后一帧说明后自动追加 `## 适合本节测试的 prompt` / `## 测试 Prompt` 与 `## 扩展阅读...`（散文上限 `1100` 字符）。
  - `s18.md` 走 `extractExtensionReading`，全文标题降一级后作为单步内容输出。
- **各篇润色状态（5 篇已定版，16 篇待润色）**：
  - **已定版（5 篇）**：`intro.md`、`s00-llm-http.md`、`s01-agent-loop.md`、`s02-tool-use.md`、`s03-permission.md`（统一工位陪跑带教口吻、正文零 `—` 破折号、小节对齐生成器抽取列表、`s00`–`s03` 最后一帧末尾均附有承上启下的 `> **本章思考题**`）。
  - **待润色（16 篇）**：主线 `s04-hooks.md` 至 `s17-mcp-plugin.md`（14 章）、收官篇 `s18.md`（1 篇）、补充阅读 `s16-read-autonomous-agents.md`（1 篇）。这些文件目前仍是初稿句式（偏碎、正文带 `—` 破折号、缺章末 `> **本章思考题**`、`s05`–`s17` 缺独立的 `## 问题` / `## 解决方案` 铺垫、部分演进帧说明偏简略）。

---

## 下一步待办与待决策（按优先级）

1. **【当前主线】分批润色剩余章节 `s04`–`s18`（及 `s16-read-autonomous-agents.md`）**
   - 直接参照已定版的 `s01-agent-loop.md`、`s02-tool-use.md`、`s03-permission.md` 逐批改写：
     - **口吻与标点**：面向初学者的工位陪跑口吻、大白话解释清楚机制；正文禁用中文破折号 `—`（`U+2014`），改用冒号、括号、逗号或拆句。
     - **小节与字数**：对齐生成器抽取的小节名（`问题`、`本章目标`、`解决方案`、`流程图`、`新增能力`、`新增函数速览`、`参考实现提醒`、`测试 Prompt`、`扩展阅读：...`）；开篇控制在 900 字内、单节散文控制在 1100 字内，避免生成 MDX 时被截断出 `……`。
     - **保留 Mermaid 图表**：切勿删除现有的 ```` ```mermaid ```` 块！确保 `s04`–`s17` 的 Mermaid 块留在被生成器抽取的小节内（如 `解决方案` 或 `流程图`），使生成的 `content.generated.cn.mdx` 保持精确 **26 个** `mermaid` 块（`scripts/agent-steps.test.mjs` 有硬断言）。
     - **帧说明与思考题**：把 `## 博客代码演进` 中每帧的说明润色顺畅（只改帧说明文字、不碰 `diff agent-step` 补丁即可保持快照 100% 匹配；若确实调整了帧数，同步改 `scripts/agent-steps.test.mjs` 的 `expectedSteps`），并在每章最后一帧末尾补上引出下一章痛点的 `> **本章思考题**`。
     - **事实与命令约定**：手动运行命令统一写 `cd code-agent-course && node sXX-...js`；`s14` 务必写清是进程内定时调度器而非 OS crontab（见 `AGENTS.md` "Facts that are easy to get wrong"）。
   - 每完成一批后执行：`pnpm run generate:build-your-agent && pnpm test`。

2. **用户实机视觉验收反馈跟进**
   - 用户如在本地 `http://localhost:3000/cn/build-your-agent` 预览中提出样式、排版或个别 Mermaid 图布局调整意见，按需微调。

3. **【待用户确认】`s14`–`s17` 的 `loadTask` 空值检查疑似退步**
   - `s14-cron-scheduler.js` 至 `s17-mcp-plugin.js` 的 `loadTask(id)` 相比 `s12`/`s13` 少了 `if (!existsSync(taskPath(id))) return null;`，对不存在的任务 ID 调用 `claim_task` / `complete_task` / `canStart` 可能直接抛异常。目前遵循不擅改车主代码的原则未动源码，待用户拍板是否补回（若修改 `.js`，需同步更新对应章节的 `diff agent-step` 补丁）。

4. **本地演示密钥管理与防泄漏机制（已完成）**
   - `code-agent-course/helper.js` 默认从 `process.env` 或 gitignored 的 `code-agent-course/.env.local` 读取 `LLM_PROVIDER` / `LLM_API_TOKEN`（及可选 `LLM_MODEL` / `LLM_BASE_URL`），模板见 `code-agent-course/.env.local.example`；生成器 `renderSafeHelper()` 剥离 `@local-env` 区块以保持网页版代码面板干净。
   - 新增 `scripts/check-secrets.mjs`（`pnpm run check:secrets`）、`scripts/check-secrets.test.mjs` 与本地 `.git/hooks/pre-commit`，提交前拦截 `.env*`、`helper.js` 硬编码 token 及真实密钥串。

---

## 常用校验命令与硬约束速查

```bash
pnpm run generate:build-your-agent   # 修改课程 .md / .js 后重新生成 MDX（会自动校验全部 130 个演进帧）
pnpm run check:secrets               # 检查仓库内是否存在误填的真实密钥或 .env 文件
pnpm typecheck && pnpm lint          # TypeScript 类型检查 + ESLint
pnpm test                            # Vitest 跑 18 个章节单测 (89 项) + Node test 跑生成器、安全与前端约束测试 (39 项)
```

- 默认只改 `code-agent-course/` 下的源文件（除非用户明确要求改前端或脚本）；**绝不手改** `app/build-your-agent/content.generated.cn.mdx` 与 `app/build-your-agent/snippets/code-agent-course-helper.js`。
- `code-agent-course/helper.js` 中的 `apiToken` 严禁硬编码真实值，本地演示统一配置在 `code-agent-course/.env.local`；`scripts/check-secrets.test.mjs`、`scripts/tutorial-client-bundle.test.mjs` 与 `.git/hooks/pre-commit` 会双重拦截。
- 如果本地正在运行 `next dev`，不要直接跑 `pnpm build`（两者争抢 `.next/` 会触发 `PageNotFoundError: /_document`）；日常校验用上面的 `generate` + `typecheck` + `lint` + `test` 即可。
