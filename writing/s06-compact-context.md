# s06：上下文会满，必须学会压缩

只要 agent 持续工作，`messages` 就一定会越来越长。

如果你什么都不做，迟早会遇到三个问题：

- token 越来越贵
- 模型越来越慢
- 早期消息把后面真正重要的内容挤掉

所以 s06 做的事很直接：

**把旧消息压成摘要，只保留最近最重要的原文。**

## 一个够用的三层思路

这里先用最简单、最实用的三层结构：

1. **最近消息**：原样保留
2. **旧消息摘要**：压成短文本
3. **关键产物**：文件、任务、知识片段继续放在外部系统里

注意，真正能撑住长会话的，不是“把所有历史都塞给模型”，而是：

**把重要状态放到消息外。**

## 这一节代码怎么做

我们没有加新工具。

变化发生在 loop 外围：

- 如果消息太长
- 就调用 `compactConversation`
- 把旧内容变成 summary
- 然后只保留最近几条消息继续跑

下一次请求模型时，summary 会重新拼进 system prompt。

## 运行

```bash
node writing/s06-compact-context.js "Create two files and summarize what you did"
```

自测：

```bash
node writing/s06-compact-context.js --self-test
```

## 这一节学会什么

- 无限会话不靠“无限 messages”
- 旧过程应该压缩，关键状态应该外置
- loop 本身依然没变，变的是 memory strategy

## 下一节

下一节把“内存计划”升级成“磁盘任务图”：

**任务不该只活在当前会话里。**
