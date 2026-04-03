# s09：任务太大时，要能分给队友

subagent 解决了“上下文隔离”。

但它还是临时工。

s09 开始，我们往前走一步：**持久化队友 + 异步邮箱。**

## 为什么不能只靠函数调用

因为真正的团队协作有两个特点：

1. 队友是持续存在的
2. 任务结果不是立刻同步返回的

也就是说，主 agent 把活发出去以后，应该允许：

- 队友稍后再回
- 主 agent 先做别的事
- 回信到了再处理

这就是邮箱模型的价值。

## 这一节怎么做

我们增加一个 `send_mail` 工具。

每封邮件都会落到磁盘目录里：

```text
mailboxes/
  lead/
  researcher/
  reviewer/
```

主 agent 发信给队友。

队友处理后，再回信给 `lead`。

消息是异步的，所以主 agent 不需要卡住等待。

## 运行

```bash
node writing/s09-teammates.js "Ask teammates for research and review"
```

自测：

```bash
node writing/s09-teammates.js --self-test
```

## 这一节学会什么

- 多 agent 协作最基础的不是“很多 prompt”
- 而是稳定的身份和可持久化的通信渠道
- 邮箱是一个很简单但很强的抽象

## 下一节

下一节继续做团队协作，但要补上规则：

**队友之间不能乱说，通信格式要统一。**
