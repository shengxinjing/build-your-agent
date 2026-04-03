# s02：加工具，不加复杂度

第二节只讲一句话：

**加一个工具，本质上就是加一个 handler。**

loop 本身不应该跟着一起膨胀。

## 这一节解决什么问题

s01 只有 `bash`。

这当然能干活，但有两个问题：

1. 太粗
2. 太不稳定

比如“读一个文件”这件事，用 `cat` 可以做，但模型要自己拼命令；一旦路径有空格，或者输出太长，就容易乱。

所以 s02 开始，我们把常见动作拆成更清楚的工具：

- `read_file`
- `write_file`
- `edit_file`
- `bash`

## 真正重要的不是工具数量

重要的是：**所有工具都走同一个 dispatch map。**

也就是：

```js
const TOOL_HANDLERS = {
  bash: ...,
  read_file: ...,
  write_file: ...,
  edit_file: ...,
}
```

agent loop 不需要知道每个工具怎么实现。它只做两件事：

- 找到对应 handler
- 执行并回填结果

这就是可扩展的关键。

## 运行

```bash
node writing/s02-tool-dispatch.js "Write plan.txt and then read it back"
```

自测：

```bash
node writing/s02-tool-dispatch.js --self-test
```

## 这一节学会什么

- loop 尽量别改
- 新能力应该通过注册工具增加
- dispatch map 是工具层最简单、最好用的组织方式

## 下一节

下一节开始补第一层“像样的 agent 行为”：

**先列计划，再动手。**
