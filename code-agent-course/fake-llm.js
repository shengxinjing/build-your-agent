import http from "node:http";
import { llmProviderConfigs } from "./helper.js";

// 起一个本地“假 LLM”服务，按 replies 顺序返回 OpenAI 格式的响应，并把所有
// provider 的 baseUrl 临时指向它。测试因此不依赖真实 LLM：确定性、离线、免费，
// 同时仍然走了真实的 fetch + 解析 + 循环逻辑。
// fn 会收到一个 requests 数组（每个收到的请求体），可用来断言发了什么。
// Spin up a local fake LLM that returns the given OpenAI-style choices in order,
// and point every provider's baseUrl at it. Deterministic, offline, free, yet still
// exercises the real fetch + parse + loop. `fn` receives a `requests` array (each
// captured request body) so tests can assert what was sent (model / messages / tools).
export async function withFakeLlm(replies, fn) {
  const queue = [...replies];
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(body || "{}"));
      const reply = queue.shift();
      // 测试可塞一个 { __error: { status, message } } 来模拟 API 报错（429/529/超长等）。
      // A reply of { __error: { status, message } } makes the server return that HTTP error.
      if (reply && reply.__error) {
        const { status = 500, ...rest } = reply.__error;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: rest }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [reply] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 临时把每个 provider 都指向假服务，结束后还原。
  // Temporarily repoint every provider at the fake server; restore afterwards.
  const saved = {};
  for (const name of Object.keys(llmProviderConfigs)) {
    saved[name] = { ...llmProviderConfigs[name] };
    llmProviderConfigs[name].baseUrl = baseUrl;
    llmProviderConfigs[name].token = "test-token";
  }

  try {
    return await fn(requests);
  } finally {
    for (const name of Object.keys(saved)) {
      Object.assign(llmProviderConfigs[name], saved[name]);
    }
    server.close();
  }
}
