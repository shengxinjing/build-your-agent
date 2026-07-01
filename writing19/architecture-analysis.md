# Build Your Agent — 21 章完整架构分析

## 一、总体概览

课程通过 21 个章节（s00–s20）**渐进式**地构建一个生产级 AI Agent 系统。每一章只引入**一个核心机制**，最终在 s20 将所有机制汇聚到同一个 agent loop 中。

核心理念（s20 原话）：

> **"机制很多，循环一个"** —— 模型负责决策，harness 负责把工具、权限、记忆、任务等环境组织好。

### 架构分层

```
┌─────────────────────────────────────────────────────────┐
│  Layer 7: 综合集成 (s20)                                 │
│  所有机制统一到一个 agent loop                             │
├─────────────────────────────────────────────────────────┤
│  Layer 6: 高级集成 (s18–s19)                              │
│  Worktree 隔离 · MCP 插件                                 │
├─────────────────────────────────────────────────────────┤
│  Layer 5: 多智能体系统 (s15–s17)                          │
│  Agent 团队 · 团队协议 · 自主 Agent                        │
├─────────────────────────────────────────────────────────┤
│  Layer 4: 可靠性与任务系统 (s11–s14)                       │
│  错误恢复 · 任务系统 · 后台任务 · Cron 调度                 │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 上下文与记忆 (s08–s10)                          │
│  上下文压缩 · 持久记忆 · 系统提示词                         │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 工具生态 (s02–s07)                              │
│  工具调用 · 权限控制 · Hooks · Todo · Subagent · Skill     │
├─────────────────────────────────────────────────────────┤
│  Layer 1: 基础循环 (s00–s01)                              │
│  LLM HTTP API · Agent Loop                               │
└─────────────────────────────────────────────────────────┘
```

---

## 二、逐层详解

### Layer 1 — 基础循环

#### s00: LLM HTTP API

**核心机制：** 无状态 LLM 调用封装。

- 封装对 OpenAI-compatible API 的 HTTP 请求
- 输入 messages → 输出 text/function_call
- 纯函数式，无状态

**承上启下：** 构建 Agent 的第一块砖——让程序能"调用大脑"。

#### s01: Agent Loop

**核心机制：** `while True` 驱动 Agent 持续运行。

```
while True:
    response = llm.chat(messages)
    if response.has_tool_calls():
        results = execute_tools(response.tool_calls)
        messages.append(results)
    else:
        break / yield response
```

**关键设计决策：**
- 循环终点由模型决定（不再需要工具时自然结束）
- 消息历史全部在 messages 数组中累积
- 与后面的 compaction（s08）形成张力——无限增长 vs 有限窗口

**承上启下：** 这是**整个课程最核心的架构骨架**，后续 19 章都是在这个 loop 上挂载功能。

---

### Layer 2 — 工具生态

#### s02: Tool Use

**核心机制：** 工具注册表 + JSON Schema 函数调用。

- 工具定义为 `(name, description, parameters_schema, handler_fn)`
- 工具描述注入 system prompt / tools 参数
- 模型返回 `tool_calls` → harness 查表执行 → 结果注入对话
- 结果注入对话 → 模型据此继续推理

**架构意义：** 工具是 Agent 与外部世界交互的**唯一接口**，后续所有机制（权限、hooks、subagent、skill、MCP）都是对工具系统的扩展和包装。

#### s03: Permission

**核心机制：** Human-in-the-loop 工具审批。

```
execute_tools():
    for call in tool_calls:
        if requires_approval(call):
            approved = ask_user(call)
            if not approved: skip
        result = handler(call)
```

**架构意义：**
- 在工具执行路径上插入**同步阻断点**
- 将"安全策略"从工具逻辑中解耦
- 后续 hooks（s04）在此基础上泛化为更通用的拦截器模式

#### s04: Hooks

**核心机制：** 工具执行前后的拦截/通知机制。

```
# 在工具执行路径上挂载生命周期钩子
on_before_tool(tool_name, args)   # 日志、校验、修改参数
on_after_tool(tool_name, args, result)  # 日志、审计、副作用处理
```

**架构意义：**
- 将横切关注点（日志、监控、审计）从核心循环中剥离
- 与 permission（s03）协同：permission 是特殊的 `on_before_tool` 阻断钩子
- 为后续任务系统（s12）的执行追踪打下基础

#### s05: Todo Write

**核心机制：** Agent 自己维护待办列表。

```
# todo_write 是一个特殊的工具
# Agent 用它来规划、追踪、更新自己的任务进度
tools.todo_write = {
    create_todos([{content, status}])
    update_todo(id, status)
}
```

**架构意义：**
- **Agent 获得自我规划能力**——不是被动响应，而是主动规划
- Todo 状态在 messages 中持久化，跨 turn 存在
- 与 subagent（s06）配合：父 agent 用 todo 规划 → 派发子任务 → 子 agent 返回结果
- 与 compaction（s08）配合：todo 信息在压缩时需保留

#### s06: Subagent

**核心机制：** 派生子 Agent 处理复杂子任务。

```
subagent_task(description):
    # 启动一个新的 agent loop，专注一个子任务
    # 父 agent 只拿到最终结果
    return result
```

**架构意义：**
- **分治与封装**——子任务上下文隔离，不让父 agent 的 context window 被细节淹没
- 子 agent 是"微缩版"的主 agent：有自己的 loop、tools、permission
- 与 task 系统（s12）的区别：subagent 是同步调用，task 是异步派发

#### s07: Skill Loading

**核心机制：** 动态加载预定义技能。

```
skills = {
    "grilling": load_skill("grilling")
    # 技能 = 一套专用 system prompt + 专用工具
}
```

**架构意义：**
- **提示词即能力**——通过注入不同 system prompt 改变 Agent 行为模式
- 技能是"可组合的 Agent 配置片段"
- 与 system prompt（s10）呼应：技能是对 system prompt 的模块化扩展
- 与 MCP（s19）的对比：skill 是纯 prompt 方案，MCP 是协议方案

---

### Layer 3 — 上下文与记忆

#### s08: Context Compact

**核心机制：** 上下文过长时自动压缩。

```
if token_count(messages) > threshold:
    summary = llm.chat("总结以上对话", messages[:-N])
    messages = [system_prompt, summary] + messages[-N:]
```

**架构意义：**
- 解决 agent loop 的**根本矛盾**：循环越多消息越长 vs 模型上下文窗口有限
- 压缩策略选择很关键——保留最近的交互（高相关性），总结过往（保留关键信息）
- Todo（s05）和 Memory（s09）信息在压缩时需特殊处理

#### s09: Memory

**核心机制：** 跨会话持久记忆。

```
# 文件级别的记忆存储
memories = load_memories()  # 从 .md 文件读取
# Agent 可以 save_memory(key, content)
# 每次启动时自动注入相关记忆
```

**架构意义：**
- **突破单次会话的生命周期**——Agent 能"记住"用户偏好、历史决策
- 记忆以 Markdown 文件存储，人类可读可编辑
- 与 system prompt（s10）集成：记忆注入 system prompt
- 与 compaction（s08）互补：compact 管短期，memory 管长期

#### s10: System Prompt

**核心机制：** 结构化系统提示词组装。

```
system_prompt = assemble(
    base_instructions,      # 基础行为指令
    tool_descriptions,      # 工具列表和用法
    memory_context,         # 相关记忆
    skill_prompts,          # 已加载的技能提示
    todo_state,             # 当前 todo 状态
    permissions_policy,     # 权限规则
)
```

**架构意义：**
- System prompt 是**所有上下文信息的汇合点**
- 将分散的配置（工具、记忆、技能、权限策略）统一注入
- 模型通过 system prompt "感知"整个系统状态

---

### Layer 4 — 可靠性与任务系统

#### s11: Error Recovery

**核心机制：** 工具执行失败的自动恢复。

```
try:
    result = tool_handler(args)
except Exception as e:
    # 策略1: 将错误信息注入 messages，让模型自行修正
    messages.append({"role": "tool", "content": f"Error: {e}"})
    # 策略2: 重试 with backoff
    # 策略3: 降级到备选工具
```

**架构意义：**
- **不中断 loop**——错误转化为消息，让模型自主决定下一步
- 与 permission（s03）互补：permission 管"允许与否"，error recovery 管"失败了怎么办"
- 体现了 Agent 架构的核心哲学：**让模型成为控制流的主导者**

#### s12: Task System

**核心机制：** 结构化任务管理与派发。

```
tasks = TaskManager()
task = tasks.create(description, priority, dependencies)
# 异步派发、状态追踪、依赖管理
```

**架构意义：**
- 与 subagent（s06）的区分：task 是**异步**的，subagent 是同步的
- 与 todo（s05）的关系：todo 是 Agent 内部规划，task 是系统级任务调度
- 任务有状态机：pending → running → completed/failed
- 为后台任务（s13）和 cron（s14）提供基础设施

#### s13: Background Tasks

**核心机制：** 异步后台任务处理。

```
# Agent 不阻塞等待结果
background_task = task_manager.dispatch_async(task)
# 结果通过回调或轮询获取
```

**架构意义：**
- 解开 agent loop 和任务执行的**时序耦合**
- Agent 可以"发射后不管"，继续处理其他事情
- 与 cron（s14）协同构成时间维度的完整能力

#### s14: Cron Scheduler

**核心机制：** 定时任务调度。

```
scheduler.add("0 9 * * *", daily_summary_task)
scheduler.add("*/5 * * * *", health_check_task)
```

**架构意义：**
- **从被动到主动**——Agent 不只在用户触发时才工作
- 定时任务内部调用 agent loop，形成"定时启动 → loop 执行 → 结束"
- 与 background tasks（s13）共享同一套任务基础设施

---

### Layer 5 — 多智能体系统

#### s15: Agent Teams

**核心机制：** 多个 Agent 协作。

```
team = AgentTeam([
    Agent("planner",   system_prompt="你负责规划..."),
    Agent("executor",  system_prompt="你负责执行..."),
    Agent("reviewer",  system_prompt="你负责审核..."),
])
result = team.run(task)
```

**架构意义：**
- 将 subagent（s06）的"临时子任务"模式升级为**固定角色协作**
- 每个 Agent 有独立 system prompt（s10）和工具集（s02）
- 通信由 harness 协调，Agent 之间不直接通信

#### s16: Team Protocols

**核心机制：** Agent 间的通信协议。

```
# 定义 Agent 间的消息格式和路由规则
protocols = {
    "handoff": AgentA → AgentB,  # 任务移交
    "consult": AgentA → AgentB,  # 咨询意见
    "broadcast": AgentA → all,   # 广播
}
```

**架构意义：**
- 解决多 Agent 协作的**通信复杂度**
- 协议层抽象让 Agent 不需要知道其他 Agent 的存在细节
- 与 permission（s03）配合：跨 Agent 调用也需要权限控制

#### s17: Autonomous Agents

**核心机制：** 长期自主运行的 Agent。

```
autonomous_agent = Agent(
    loop_mode="continuous",  # 不等待用户输入
    trigger_on=["new_data", "time_elapsed", "event"],
    idle_behavior="sleep_or_monitor"
)
```

**架构意义：**
- Agent 从"对话式"变为**"监控式"**
- 与 cron (s14)的区别：cron 按时间触发，autonomous agent 可以按事件触发
- 需要更强的 compaction (s08)和 memory (s9)支持，因为运行时间更长

---

### Layer 6 — 高级集成

#### s18: Worktree Isolation

**核心机制：** 使用 Git worktree 隔离 Agent 工作空间。

```
# 每个 subagent 或 task 获得独立 worktree
worktree = git.worktree_add(branch="task-123", path="/tmp/agent-123")
agent.run(workdir=worktree.path)
# 完成后：合并 / 丢弃 / 人工审核
```

**架构意义：**
- **文件系统级别的隔离**——解决多个 Agent/任务并发时的文件冲突
- 利用 Git 的版本控制能力：可追溯、可回滚、可并行的变更
- 对 subagent（s06）和 agent teams（s15）的增强——任务有独立工作区

#### s19: MCP Plugin

**核心机制：** Model Context Protocol 插件系统。

```
# MCP Server 提供标准化工具接口
mcp_tools = connect_mcp_server("filesystem-mcp")
tools.register(mcp_tools)
```

**架构意义：**
- **工具来源的外部化**——工具不再只能由代码定义，可以从外部服务获取
- MCP 是 Anthropic 提出的开放协议，意味着生态兼容
- 与 skill（s07）的对比：
  - Skill = 纯 prompt 注入，改变 Agent 行为
  - MCP = 工具协议，扩展 Agent 能力
- 与 tool use（s02）的关系：MCP 工具和内置工具在 loop 中**统一处理**

---

### Layer 7 — 综合集成

#### s20: Comprehensive

**核心机制：** 所有机制的统一。

最终 agent loop 伪代码：

```
async def agent_loop(user_input):
    # 1. 组装上下文
    memories = memory_manager.get_relevant(user_input)
    skills = skill_loader.get_active()
    system_prompt = assemble(memories, skills, tools, permissions)

    messages = [system_prompt, user_input]

    while True:
        # 2. 上下文检查
        if needs_compact(messages):
            messages = compact(messages)

        # 3. 调用 LLM
        response = await llm.chat(messages)
        messages.append(response)

        # 4. 处理工具调用
        if response.has_tool_calls():
            for call in response.tool_calls:
                # 4a. Hooks
                hook_result = hooks.on_before(call)

                # 4b. 权限
                if not permissions.check(call):
                    continue

                # 4c. 错误恢复
                try:
                    result = execute_tool(call)
                    hooks.on_after(call, result)
                except Exception as e:
                    result = error_recovery.handle(call, e)

                messages.append(result)

                # 4d. 后台任务
                if call.is_async:
                    bg_tasks.dispatch(call, result)

        # 5. 无工具调用 → 结束
        else:
            break

    # 6. 保存记忆
    memory_manager.save(messages)

    return response.content
```

**不再是一个一个的特性，而是一个有机整体：**

| 机制 | 在 loop 中的位置 | 职责 |
|------|-----------------|------|
| System Prompt | 循环前组装 | 统一注入上下文 |
| Tool Use | 循环内 | 能力扩展 |
| Permission | 工具执行前 | 安全阻断 |
| Hooks | 工具执行前后 | 横切关注点 |
| Todo | 作为特殊工具 | 自我规划 |
| Subagent | 作为工具调用 | 子任务分治 |
| Skill | System Prompt 组装 | 行为模式注入 |
| Compact | 循环内检查 | 上下文管理 |
| Memory | 循环前后 | 跨会话持久化 |
| Error Recovery | 工具执行包裹 | 容错 |
| Background Tasks | 工具执行后 | 异步派发 |
| Cron | 循环外部 | 定时触发 |
| Agent Teams | Subagent 扩展 | 多角色协作 |
| Worktree | 工具执行环境 | 文件隔离 |
| MCP | 工具注册来源 | 外部工具协议 |

---

## 三、关键设计原则

### 1. "机制很多，循环一个"

所有 21 章的特性最终都收敛到**同一个 while True loop** 中。新功能的加入方式是**在 loop 的特定位置挂载钩子**，而非重写 loop。

### 2. 模型主导控制流

Agent 不是"if-else 自动机"——**模型决定**何时调用工具、调用哪个工具、何时结束。Harness 的职责是**环境准备和约束执行**，不是流程编排。

### 3. 渐进式复杂度

每一章只增加一个概念，且尽可能**最小可运行**。读者可以在任意章节停下来，拥有一个功能完整的 Agent。

### 4. 关注点分离

- **工具 = 能力**（what agent can do）
- **System Prompt = 行为**（how agent behaves）
- **Memory = 知识**（what agent remembers）
- **Hooks/Permission = 约束**（what agent is allowed to do）
- **Task/Cron = 触发**（when agent acts）

### 5. 内外双层扩展

- **内部扩展**：Skill（s07）→ 通过 prompt 改变行为
- **外部扩展**：MCP（s19）→ 通过协议扩展工具
- 两者互补，不互相替代

---

## 四、章节依赖关系图

```
s00 (LLM API)
 │
 └─► s01 (Agent Loop)
      │
      ├─► s02 (Tool Use)
      │    │
      │    ├─► s03 (Permission)
      │    ├─► s04 (Hooks)
      │    ├─► s05 (Todo Write)
      │    ├─► s06 (Subagent)
      │    │    │
      │    │    └─► s15 (Agent Teams)
      │    │         │
      │    │         └─► s16 (Team Protocols)
      │    │              │
      │    │              └─► s17 (Autonomous Agents)
      │    │
      │    └─► s07 (Skill Loading)
      │
      ├─► s08 (Context Compact)
      ├─► s09 (Memory)
      │    │
      │    └─► s10 (System Prompt)
      │
      ├─► s11 (Error Recovery)
      │
      ├─► s12 (Task System)
      │    │
      │    ├─► s13 (Background Tasks)
      │    └─► s14 (Cron Scheduler)
      │
      ├─► s18 (Worktree Isolation)
      ├─► s19 (MCP Plugin)
      │
      └─► s20 (Comprehensive Integration)
```

---

## 五、从零到一的演进逻辑

### Phase 1: 让 Agent 能动（s00–s02）

**目标：** 一个能调用工具的对话 Agent。  
**产出：** LLM API → Loop → 工具调用 → 结果反馈。最小闭环。

### Phase 2: 让 Agent 可靠（s03–s04, s11）

**目标：** 安全性 + 可观测性 + 容错。  
**产出：** 权限阻断、Hook 拦截、错误恢复。Agent 不再是"裸奔"的。

### Phase 3: 让 Agent 聪明（s05–s10）

**目标：** 自我规划 + 长记忆 + 行为定制。  
**产出：** Todo 规划、上下文压缩、持久记忆、结构化 System Prompt。

### Phase 4: 让 Agent 并行（s12–s14）

**目标：** 任务系统 + 异步 + 定时。  
**产出：** 任务管理、后台任务、Cron 调度。从"一问一答"到"持续运转"。

### Phase 5: 让 Agent 协作（s15–s17）

**目标：** 多 Agent 分工 + 通信协议 + 自主运行。  
**产出：** Agent 团队、团队协议、自主 Agent。

### Phase 6: 让 Agent 可扩展（s18–s19）

**目标：** 工作区隔离 + 外部协议。  
**产出：** Worktree、MCP 插件。Agent 从"单体"变成"平台"。

### Phase 7: 收束（s20）

**目标：** 所有机制统一。  
**产出：** 一个 loop，所有特性协同工作。

---

## 六、总结

`build-your-agent` 的架构设计遵循一条清晰的演进路径：

1. **从最简单开始**（s00: 一个 HTTP 请求）
2. **加上循环**（s01: while True）
3. **逐步挂载能力**（s02–s19: 每次加一个机制）
4. **最终收敛**（s20: 全部在一起）

其核心洞察是：**Agent 的复杂度不在于 loop 本身，而在于 loop 周围的环境组织。** Loop 始终保持简洁——模型决策、harness 执行——但 harness 背后的基础设施（工具注册、权限策略、记忆管理、任务调度、多 Agent 协调、工作区隔离、外部协议）逐步丰富，最终形成一个完整的 Agent 平台。
