# s04：大任务拆小，子任务给干净上下文

这一节开始出现第一个很像“真正 code agent”的能力：

**主 agent 可以派 subagent 去做子任务。**

## 为什么要拆

如果所有事情都塞进同一个 `messages`，上下文会很快变脏。

比如一个任务里同时有：

- 写方案
- 查资料
- 改代码
- 跑测试

这些过程全混在一起，模型后面很容易抓错重点。

所以更好的做法是：

- 主 agent 只保留主线
- 子任务开新上下文
- 子 agent 做完后，只把结果带回来

## 这一节最重要的点

subagent 的关键不是“多线程”。

关键是：

**它有自己的独立 `messages[]`。**

也就是说：

- 主上下文是干净的
- 子上下文是局部的
- 主 agent 拿到的是“结果”，不是“全部过程噪音”

## 这节代码怎么设计

我们增加一个 `delegate` 工具：

- 主 agent 调 `delegate`
- `delegate` 内部启动一个 subagent loop
- subagent 用独立消息列表处理任务
- 最后只返回一段结果文本

## 运行

```bash
node writing/s04-subagents.js "Write a short note with intro and summary"
```

自测：

```bash
node writing/s04-subagents.js --self-test
```

## 这一节学会什么

- subagent 最重要的是上下文隔离
- delegate 不是魔法，本质上就是“在工具里再跑一个 loop”
- 这一步是后面多 agent 的前身

## 下一节

下一节不加更多 agent。

我们先解决另一件现实问题：

**知识不要一开始全塞进 prompt，要按需加载。**
