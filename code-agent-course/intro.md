# 从 0 开始手写一个 Code Agent

你好，我是大圣。这篇交互式教程借鉴了两个我很喜欢的开源项目：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 把复杂的 Agent 拆成了循序渐进的关卡；[Build your own React](https://pomb.us/build-your-own-react/) 则用“左文右码、随滚动逐行演进”的交互，让你不用在长源码里迷路。

很多人觉得 Code Agent 很神秘，其实把窗户纸捅破，**它核心就是一个 `while` 循环加上几把趁手的工具。** 我们用纯 JavaScript 从 `s00` 到 `s18` 拆成 19 节、一百多个小步，像打怪升级一样，左边聊思路，右边只聚焦当前改动的那几行代码，一步步带你把完整的 Agent 搭出来。

为了让新手零门槛上手，你不需要在本地配任何环境。直接在下方填好模型供应商和 API Token（仅保存在浏览器本地，不上传服务器），读到任意一步，点右侧代码框右上角的运行按钮，就能在浏览器终端里直接练习。我们直接从 `s00` 开始。
