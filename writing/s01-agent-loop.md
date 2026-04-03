# s01：一个循环 + 一个工具 = agent

这一节开始进入最核心的结构。

先别急着加很多工具，也别急着做任务系统。我们只做最小版：

- 一个 `bash` 工具
- 一个 `while` 循环
- 一条退出规则

这就是 agent loop。

## 最小心智模型

流程只有这几步：

1. 用户发来任务
2. 把 `messages + tools` 发给模型
3. 如果模型要调工具，就执行工具
4. 把工具结果作为新消息塞回去
5. 继续下一轮
6. 如果模型不再调工具，结束

重点不是“代码写得多复杂”，而是：

**模型决定什么时候调工具。代码只负责执行和回填。**

## 为什么第一步只给 bash

因为 `bash` 的表达能力很强。

- 可以创建文件
- 可以列目录
- 可以跑测试
- 可以调用别的程序

这也是很多 code agent 的第一个工具。不是因为它完美，而是因为它足够通用。

## 这节代码看哪里

`s01-agent-loop.js` 里最重要的是 `agentLoop()`：

- 收到模型回复
- 看 `finish_reason`
- 处理 `tool_calls`
- 把 `tool` 消息追加回 `messages`

如果你把这个函数真正看懂了，后面 90% 的章节都只是“在这个 loop 外面多加一点机制”。

## 运行

```bash
node writing/s01-agent-loop.js "Create hello.txt with one line in it"
```

自测：

```bash
node writing/s01-agent-loop.js --self-test
```

## 这一节学会什么

- agent 不神秘
- loop 才是核心
- tool call 不是另一个系统，它只是模型输出的一种特殊格式

## 下一节

下一节我们不改 loop。

只做一件事：**增加更多工具，并把它们注册到 dispatch map。**
