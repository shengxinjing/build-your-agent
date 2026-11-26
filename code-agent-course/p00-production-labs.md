# 第二季：Code Agent 生产化专题 Lab（`p01`–`p05`）

> 完整三季规划见 [`ROADMAP.md`](ROADMAP.md)：第一季（`s00`–`s18`）搭骨架 -> **第二季（`p01`–`p05`）打磨生产级能力** -> 第三季（`a01`–`a04`）进化成 Personal AI。

第一季 `s00`–`s17` 从 0 到 1 搭出了完整的单机 Code Agent 核心骨架，但单文件也随着能力叠加长到了 1500 多行。如果把流式中断、回滚诊断、会话日志、真实 MCP 传输和评测观测继续往同一份文件里堆，代码很快会超过 2500 行，学习重点也会被大量旧代码淹没。

因此，第二季改用 **独立生产专题 Lab** 的结构：每个 Lab 都回到约 50–60 行的最小工具循环基座，把整份源码控制在 230–420 行左右（含命令行交互或内置评测夹具），**一节只聚焦打透一个从“能跑通”走向“真好用、可上线”的工程问题**，彼此零耦合，随时可单独运行和单测。

## 5 个专题一览

| Lab | 主题 | 解决的核心生产痛点 | 源码 | 离线单测 |
|---|---|---|---|---|
| `p01` | Streaming & Abort | SSE 流式吐字、分片拼接 `tool_calls`、`Ctrl+C` 中断后自愈（孤立 `tool_call_id` + 轮次合法）、`/steer` 纠偏 | `p01-streaming-abort.js` | `p01-streaming-abort.test.js` |
| `p02` | Checkpoint & Diagnostics | `edit_file` 与 `write_file` 覆写前鲜度/唯一性校验、写后自动语法诊断（LSP 闭环思想）、单步与跨轮 `/rewind` 一键回滚 | `p02-checkpoint-diagnostics.js` | `p02-checkpoint-diagnostics.test.js` |
| `p03` | Session Event Log | Append-only JSONL 会话落盘、断电坏行与中断自愈、`--resume` 续跑、`/fork` 分叉、对齐工具边界的增量无损 `/compact` | `p03-session-persistence.js` | `p03-session-persistence.test.js` |
| `p04` | Real MCP stdio | 零依赖真实 JSON-RPC 2.0 stdio 客户端 + 独立 demo Server、`destructiveHint` 权限闸门、超时/崩溃降级与 `-- <cmd>` 外部 Server 直连 | `p04-mcp-stdio.js` + `p04-mcp-demo-server.js` | `p04-mcp-stdio.test.js` |
| `p05` | Mini Eval & Trace | 隔离沙箱确定性 Verifier 打分、Prompt Cache 命中率与成本统计、键序无关 Doom-Loop 熔断、`--case` / `--json` 输出 | `p05-mini-eval.js` | `p05-mini-eval.test.js` |

## 离线一键验证全部第二季 Lab

```bash
pnpm vitest run code-agent-course/p0*.test.js
```

> **当前阶段说明**：`p01`–`p05` 目前为“已打磨的可运行代码 + 核心流程文档 + 离线单测”形态，暂未拆分为交互式博客的 `diff agent-step` 演进帧，也暂未接入第一季 `s00`–`s18` 的静态生成器。确认体验与边界满意后，再按章节拆帧并接入网站第二季入口。
