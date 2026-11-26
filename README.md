# Build Your Agent

从一次原生 LLM HTTP 请求开始，用 JavaScript 和 Node.js 逐步构建一个可以调用工具、管理上下文、拆分任务并连接 MCP 的 Code Agent。

**English:** Build a Code Agent step by step with runnable JavaScript, verified chapter tests, interactive code stages, and an in-browser live demo.

## 你会学到什么

本项目规划为三季（完整蓝图见 [`code-agent-course/ROADMAP.md`](code-agent-course/ROADMAP.md)）：

- **第一季（已上线）**：Code Agent 从 0 到 1（`s00`–`s18`，共 19 节连续演进，4 幕展开）。
- **第二季（打磨中）**：Production Lab（`p01`–`p05`，5 个独立生产化专题：流式打断、编辑诊断与回滚、JSONL 会话事件日志、真实 MCP stdio、微型 Eval 与熔断）。
- **第三季（规划已定）**：Personal AI Lab（`a01`–`a04`，4 个独立个人助理专题：消息网关、心跳与记忆整理、浏览器触手、防间接 Prompt Injection 安全防线）。

第一季已上线章节结构：

| 阶段 | 章节 | 核心能力 |
|---|---|---|
| 第一幕：最小闭环 | s00-s05 | LLM HTTP、Agent Loop、Tool Use、Permission、Hooks、Todo |
| 第二幕：长程续航 | s06-s11 | Subagent、Skill、Compaction、Memory、System Prompt、Error Recovery |
| 第三幕：异步与协作 | s12-s17 | Task、Background Task、Cron、Agent Teams、Team Protocol、MCP |
| 第四幕：底层视野 | s18 | KV Cache、Context Engineering、Sandbox、Observability 与 Eval 阅读地图 |

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

`pnpm test` 先验证 s00-s17 与第二季 Lab 的章节实现，再验证内容生成、前端体积约束、模型配置和教程文件处理。`pnpm build` 会先从 `code-agent-course` 重新生成交互式文章，再通过 Next.js 静态导出（`output: "export"`）生成纯静态目录 `out/`。

## 部署到 Cloudflare

在线地址：[https://blog.deepdrink.ai](https://blog.deepdrink.ai)

站点为纯静态导出（`out/`），零服务端运行时依赖；浏览器内 WebContainer 所需的 `COOP/COEP` 响应头以及步骤运行代码接口的 `JSON` 类型通过 [`public/_headers`](public/_headers) 下发，根路径跳转通过 [`public/_redirects`](public/_redirects) 在边缘节点处理。

- **Cloudflare Workers（Static Assets）**：[`wrangler.jsonc`](wrangler.jsonc) 已绑定自定义域名 `blog.deepdrink.ai` 并指向 `./out`。
- **自动部署（GitHub Actions）**：[`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) 会在每次推送到 `main` 分支时自动执行 `pnpm build` 与 `pnpm exec wrangler deploy`（需在仓库 Secrets 配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`）。
- **本地一键部署**：`pnpm run deploy:cf`（首次需先 `pnpm exec wrangler login`）。

本地预览静态产物（模拟 Cloudflare 响应头）：

```bash
pnpm build && pnpm start
```

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
