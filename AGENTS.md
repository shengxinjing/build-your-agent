# AGENTS.md

技术规范
## 编码与架构原则
- 始终使用简体中文+英文回复 英文确保是雅思6分的水平
- 你是一个优秀的技术架构师和优秀的程序员，在进行架构分析、功能模块分析，以及进行编码的时候，请遵循如下规则：
  1. 分析问题和技术架构、代码模块组合等的时候请遵循“第一性原理”
  2. 在编码的时候，请遵循 “DRY原则”、“KISS原则”、“SOLID原则”、“YAGNI原则”
  3. 如果单独的类、函数或代码文件超过500行，请进行识别分解和分离，在识别、分解、分离的过程中请遵循以上原则

## 代码风格
- 遵循项目现有约定和代码风格，保持与周边代码一致
- 使用有意义的变量名和函数名，命名即文档
- 单个函数不超过 50 行，超过时考虑拆分
- 仅对复杂逻辑添加注释，避免显而易见的注释

## 沟通原则
- 我们的所有对话、分析说明、方案汇报、Issue 描述、PR 描述等沟通内容，统一遵循金字塔原理
- 表达时先结论后论据，先全局后细节，先结果后过程；避免先堆砌细节再给结论
- 结构化表达时，优先将信息按互斥且穷尽的方式分组，避免内容交叉、重复和跳跃
- 在撰写 Issue、PR 等说明性内容时，优先使用如下顺序：目的/结论、背景、方案或改动点、影响与风险、验收或验证结果
- 如果用户提供的原始内容结构混乱，你需要主动按金字塔原理重组后再输出


## Git 工作流
- 采用 GitHub Flow：main 为默认稳定分支；所有功能/修复分支均从 main 拉出并通过 PR 合并回 main；禁止直接提交到 main
- Commit 遵循 Conventional Commits 规范：feat/fix/refactor/docs/test/chore
- 保持原子提交，一个 Commit 只解决一个关注点
- 禁止向 main 分支强制推送（force push）

## 编码前思考
先想清楚再动手，别把困惑憋在心里。
- 拿不准就问，别替我拍板做假设；有歧义就摆出几种理解让我选，别默默定一个。
- 有更省事的路子就直说，该反对就反对。
- 会欠下技术债、或有现成轮子能复用，提前讲一声。

## 极简优先
能 50 行搞定就别写 200 行，写多了就推倒重来。
- 需求没点名的特性、灵活性、可配置项，一概不加。
- 一次性代码不做抽象；不为压根不会发生的场景兜错。
- 交付前自检一句：这段是不是绕得没必要？是就砍到最简。

## 精准修改
只碰非改不可的地方，只收拾自己弄出的烂摊子。
- 先读懂上下文再下手，改动范围紧贴需求，别外扩。
- 不顺手“美化”相邻代码、注释或格式；没坏的不重构；跟着现有风格走，哪怕你有更顺手的写法。
- 撞见无关的死代码：只提醒、不删；但自己改动留下的孤儿导入/变量/函数，要顺手清干净。
- 底线：每一行 diff 都能对上某个具体需求。

## 目标驱动执行
给足成功标准，让它自己循环到达标，而不是一步一停等你喂指令。
- 把祈使句翻成可验证目标：与其说“修个 bug”，不如说“先写一个能复现的测试，再让它变绿”。
- 多步任务先摆出计划，每一步都挂一个验证点（改完就跑测试/构建/看输出）。
- 标准越硬，它越能自己迭代；标准越含糊（“能跑就行”），越要没完没了地来回确认。



This file is for agents who continue maintaining this project. The goal is to reduce guesswork, verify changes, and keep `writing19` publishable as a Chinese tutorial series on building a Code Agent from scratch.

## Project Purpose

- Project name: `build-your-agent`
- Main track: Rebuild and explain core Code Agent mechanisms with JavaScript / Node.js.
- Tutorial directory: `writing19/`
- Shared helper file: `writing19/helper.js`
- Key rule: each chapter builds on the previous chapter. Later chapters should keep earlier capabilities and add new ones, not remove the foundation.

## Work Scope

Prefer changing only the files the user asks about. Most requests are about maintaining `writing19`; unless explicitly asked, do not casually edit the Next.js app, UI components, or unrelated directories.

Common file set:

- `writing19/sXX-*.js`: JavaScript implementation for the chapter.
- `writing19/sXX-*.md`: Chinese tutorial for the chapter.
- `writing19/sXX-*.test.js`: Regression tests for the chapter.
- `writing19/sXX-*.py`: Python reference implementation, usually read-only reference.

## Chapter Progression Rules

- Each later chapter must preserve the core ability from the previous chapter, then add the new ability for this chapter.
- If a shared function is needed, put it in `helper.js`; do not introduce `utils.js`.
- Pure utility functions can live in `helper.js`, such as HTTP calls, CLI input, file helpers, frontmatter parsing, and cron expression parsing.
- Runtime functions that depend on chapter-local state should stay in the chapter file, such as task queues, cron queues, agent loops, and tool handlers.
- Do not delete teaching logs just to make output look cleaner. Add comments explaining the logs when needed.

## Documentation Style

Markdown is mainly Chinese and should be friendly to beginners. Avoid unnecessary jargon.

Recommended chapter structure:

- Opening analogy: explain what new ability this chapter gives the agent.
- Chapter goal: one short explanation of the problem being solved.
- New capabilities: list the new tools, functions, or mechanisms.
- Flow diagram: use ASCII diagrams or existing course assets.
- New function overview: explain new functions before showing core code.
- Key code: include only the snippets that best explain this chapter.
- Test prompt: give one prompt that triggers the chapter’s new feature.
- Further reading: explain how commercial agents solve the same problem, after the main lesson.
- Diff from previous step: show the key changes from the previous chapter, without line numbers.

Use plain wording. For example, prefer “write to a file” or “persist to disk” over unclear wording.

## Code Style

- Use ES modules in JavaScript: `import` / `export`.
- Keep dependencies near zero; prefer Node.js built-in modules.
- Keep tutorial code readable. Do not overbuild production-grade systems unless the user asks.
- Keep chapter-specific agent logic in `sXX-*.js`; move repeated low-level helpers into `helper.js`.
- Comments should explain the mechanism, not obvious statements.
- If the user manually changed code or comments, preserve those changes unless they directly conflict with the task.

## Test Commands

After changing one chapter, run that chapter’s tests first:

```bash
pnpm vitest run writing19/s14-cron-scheduler.test.js
```

After changing `helper.js` or shared logic, run chapters 00-14:

```bash
pnpm vitest run writing19/s{00..14}-*.test.js
```

Syntax checks:

```bash
node --check writing19/helper.js
node --check writing19/s14-cron-scheduler.js
```

For Markdown-only changes, at least check headings and code fences:

```bash
rg -n "^#|^##|^###" writing19/s14-cron-scheduler.md
node -e "const fs=require('fs');const t=fs.readFileSync('writing19/s14-cron-scheduler.md','utf8');console.log((t.match(/```/g)||[]).length % 2 === 0)"
```

## Current s14 Design

`s14` uses an in-process cron scheduler, not operating-system cron.

Current loop:

```text
cronTick
  -> cronQueue
  -> processCronQueue
  -> agentLoop
  -> injectCronJobs
  -> [Scheduled] prompt
```

`.scheduled_tasks.json` stores durable jobs. If dates print immediately when s14 starts, an old durable job was probably restored. It does not mean the job was registered with the OS cron.

Operating-system cron is only an extension-reading topic in `s14-cron-scheduler.md`. Do not imply that this chapter installs a system-level scheduled task.

## Common Pitfalls

- Empty Enter keeps waiting for input; it does not quit the CLI. Use `q` or `exit` to quit.
- `*/2 * * * *` means “fire on minutes divisible by 2,” not “wait two minutes from registration time.”
- OpenAI-compatible tool calls are in `message.tool_calls`; `arguments` is a JSON string and needs `JSON.parse()`.
- Tool results must be sent back with `tool_call_id`, or the model cannot connect the result to the tool call.
- Do not add line numbers to Markdown diff sections; the user found them distracting.
- Course diagrams should use `https://learn.shareai.run/course-assets/...`. Do not reintroduce `asset/dasheng/` images.

## Final Response Style

When replying to the user, first provide a short English translation of the request, then explain in Chinese what changed and how it was verified. Keep the English simple and clear.
