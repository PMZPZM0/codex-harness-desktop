import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * 10-21 实测：grok-4.7 在供应商 /models 列表里，但 /responses 200 后 30s 零字节。
 * 协议桥 auto 模式必须等第一段数据；等不到就改走 chat，不能把「200 + 空流」当成功。
 * ⛔ 这条测试跑编译产物；`npm test` 前需先 `npm run build:electron`（没有产物则跳过）。
 */
const compiled = join(process.cwd(), "dist-electron", "responses-bridge.js");
const enabled = existsSync(compiled);
test("bridge auto 探活超时后回落 chat", { skip: !enabled, timeout: 30_000 }, async () => {
  process.env.HARNESS_BRIDGE_PROBE_IDLE_MS = "5000";
  const require = createRequire(import.meta.url);
  const { ResponsesBridge } = require(compiled);

  const upstream = http.createServer((req, res) => {
    if (req.url.includes("/responses")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(""); // headers only, no event, never end
      return;
    }
    if (req.url.includes("/chat/completions")) {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "mock", object: "chat.completion", model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "ok-from-chat" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = upstream.address().port;

  const bridge = new ResponsesBridge({ log: () => {} });
  const port = await bridge.start();
  bridge.register("test", { baseUrl: `http://127.0.0.1:${upstreamPort}`, mode: "auto", label: "test" });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/p/test/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", input: "hi", stream: true }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /ok-from-chat/);
    assert.equal(bridge.status().converted, 1);
  } finally {
    await bridge.stop();
    await new Promise((r) => upstream.close(r));
  }
});

test("bridge auto 上游连响应头都不回时也回落 chat", { skip: !enabled, timeout: 30_000 }, async () => {
  process.env.HARNESS_BRIDGE_PROBE_IDLE_MS = "5000";
  const require = createRequire(import.meta.url);
  const { ResponsesBridge } = require(compiled);

  const upstream = http.createServer((req, res) => {
    if (req.url.includes("/responses")) {
      req.resume();
      return; // 10-21 grok-4.7 实测：连状态行/响应头都没有
    }
    if (req.url.includes("/chat/completions")) {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "mock", object: "chat.completion", model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "ok-no-headers" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = upstream.address().port;

  const bridge = new ResponsesBridge({ log: () => {} });
  const port = await bridge.start();
  bridge.register("test", { baseUrl: `http://127.0.0.1:${upstreamPort}`, mode: "auto", label: "test" });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/p/test/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", input: "hi", stream: true }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /ok-no-headers/);
    assert.equal(bridge.status().converted, 1);
  } finally {
    await bridge.stop();
    await new Promise((r) => upstream.close(r));
  }
});
