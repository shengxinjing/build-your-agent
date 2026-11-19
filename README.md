# Build Your Agent

从一次原生 LLM HTTP 请求开始，用 JavaScript 和 Node.js 逐步构建一个可以调用工具、管理上下文、拆分任务并连接 MCP 的 Code Agent。

**English:** Build a Code Agent step by step with runnable JavaScript, verified chapter tests, interactive code stages, and an in-browser live demo.

在线阅读：[Build Your Agent 中文交互教程](https://learn-ai-agent.vercel.app/cn/build-your-agent)

## 你会学到什么

课程共 19 节：

| 阶段 | 章节 | 核心能力 |
|---|---|---|
| 最小闭环 | s00-s04 | LLM HTTP、Agent Loop、Tool Use、Permission、Hooks |
| 上下文能力 | s05-s11 | Todo、Subagent、Skill、Compaction、Memory、System Prompt、Error Recovery |
| 长任务协作 | s12-s17 | Task、Background Task、Cron、Agent Teams、Team Protocol、MCP |
| 继续深挖 | s18 | KV Cache、Context Engineering、Sandbox、Observability 与 Eval 阅读地图 |

每个可运行章节都包含：

- 中文原理文章；
- 逐章演进的 JavaScript 实现；
- 自动化回归测试；
- 测试 Prompt 与商业 Agent 对照阅读；
- 网页中的代码切换与 WebContainer Live Demo。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000/cn/build-your-agent](http://localhost:3000/cn/build-your-agent)。

手机端阅读时，可以使用右下角的“代码”按钮查看当前步骤的 `agent.js` 和 `helper.js`；桌面端代码面板会跟随当前章节更新。

网页中的 API Token 只用于浏览器内的 Live Demo。代码面板会显示 `YOUR_API_TOKEN`，不会直接展示你输入的真实 Token。不要把真实 Token 写进仓库；已经提交过的 Token 应立即吊销并轮换。

## 测试与构建

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` 先验证 s00-s17 的章节实现，再验证内容生成、前端体积约束、模型配置和教程文件处理。`pnpm build` 会先从 `code-agent-course` 重新生成交互式文章，再执行 Next.js 生产构建。

## 内容如何发布到网页

```text
code-agent-course/sXX-*.md
        +
code-agent-course/sXX-*.js
        |
        v
scripts/generate-build-your-agent-content.mjs
        |
        v
app/build-your-agent/content.generated.cn.mdx
        |
        v
CodeHike article + WebContainer live demo
```

`code-agent-course` 是内容真源，`content.generated.cn.mdx` 是生成产物。修改课程后运行：

```bash
pnpm run generate:build-your-agent
```

## 教学边界

本项目刻意保持小而清楚，用来解释 Agent 的核心机制。它不是生产级 Agent 平台，也没有实现 OS 级 Sandbox、Durable Event Runtime、完整 Trace/Metrics、在线 Eval 或多租户权限系统。完成课程后，可以继续对照 Pi、OpenCode、Kimi Code、DeepSeek Harness 和 Codex 学习这些商业化能力。
