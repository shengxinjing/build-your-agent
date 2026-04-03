# s10：队友之间要有统一的通信规则

s09 里，队友已经能互相发信了。

但如果邮件内容完全自由发挥，很快就会乱：

- 有人只回一句话
- 有人忘了带任务 ID
- 有人没有标明这是不是回复

所以 s10 要补上的不是新模型，而是：

**一套固定的 request-response 协议。**

## 为什么协议重要

没有协议时，系统靠“猜”。

有协议时，系统靠“解析”。

差别非常大。

一个简单协议至少要有：

- `kind`: request 或 response
- `request_id`: 同一轮通信的唯一 ID
- `task_id`: 这条消息服务哪个任务
- `from` / `to`
- `status`
- `body`

这样主 agent 才能稳定地把回应和请求对上。

## 这一节怎么做

我们把 `send_mail` 升级成 `send_request`。

发出去的是结构化对象。

队友回来的也必须是结构化对象。

如果格式不对，就不接受。

## 运行

```bash
node writing/s10-team-protocol.js "Ask for two protocol-based teammate updates"
```

自测：

```bash
node writing/s10-team-protocol.js --self-test
```

## 这一节学会什么

- 多 agent 系统最怕“语义差不多就行”
- 协议一旦稳定，路由、聚合、审计都会简单很多
- s10 是 s11 自组织协作的通信基础

## 下一节

下一节让队友自己去看任务板，不再等领导分活：

**scan the board, then claim the task.**
