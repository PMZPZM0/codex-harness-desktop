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

/**
 * 11-05：引擎的 apply_patch 是 **custom（freeform）工具**，而 chat / anthropic 上游只认
 * function 工具。桥必须双向翻译，否则工具被静默丢掉 ⇒ 模型只能拿 shell 写文件 ⇒
 * Windows 命令行超长 ⇒ 回合反复失败（用户现场「老是断断」）。
 * 这条测试跑真产物，同时钉住：① 下发给上游的是 {input: string} 的 function；
 * ② 回程 item 必须是 custom_tool_call（给成 function_call 引擎按名字找不到工具）；
 * ③ custom 工具不发 function_call_arguments.delta（那会把 JSON 片段当 patch 正文喂给引擎）。
 */
test("chat 上游：custom 工具（apply_patch）双向翻译", { skip: !enabled, timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const { ResponsesBridge } = require(compiled);
  const PATCH = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n";
  let seenTools = null;

  const upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { seenTools = JSON.parse(raw || "{}").tools ?? null; } catch { seenTools = null; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "apply_patch", arguments: "" } }] } }] });
      const args = JSON.stringify({ input: PATCH });
      for (let i = 0; i < args.length; i += 17) {
        chunk({ id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 17) } }] } }] });
      }
      chunk({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const bridge = new ResponsesBridge({ log: () => {} });
  const port = await bridge.start();
  bridge.register("test", { baseUrl: `http://127.0.0.1:${upstream.address().port}`, mode: "chat", label: "test" });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/p/test/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "m", stream: true, input: "hi", tool_choice: "auto",
        tools: [{ type: "custom", name: "apply_patch", description: "edit files", format: { type: "grammar", syntax: "lark", definition: "start: x" } }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    assert.equal(response.status, 200);

    // ① 下发给上游：function 化 + input 字符串参数
    const tool = (seenTools ?? []).find((t) => t.function?.name === "apply_patch");
    assert.ok(tool, "custom 工具没下发到 chat 上游");
    assert.equal(tool.type, "function");
    assert.equal(tool.function.parameters.properties.input.type, "string");

    // ② 回程：custom_tool_call + 原样 patch 文本
    const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    const completed = events.find((e) => e.type === "response.completed");
    assert.ok(completed, "没收到 response.completed");
    const item = (completed.response.output ?? []).find((i) => i.name === "apply_patch");
    assert.ok(item, "回程没有 apply_patch 调用");
    assert.equal(item.type, "custom_tool_call");
    assert.equal(item.input, PATCH);

    // ③ 不许出现 function_call_arguments.delta
    assert.equal(events.some((e) => e.type === "response.function_call_arguments.delta"), false);
  } finally {
    await bridge.stop();
    await new Promise((r) => upstream.close(r));
  }
});

test("anthropic 上游：custom 工具（apply_patch）双向翻译", { skip: !enabled, timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const { ResponsesBridge } = require(compiled);
  const PATCH = "*** Begin Patch\n*** Add File: b.txt\n+x\n*** End Patch\n";
  let seenTools = null;

  const upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { seenTools = JSON.parse(raw || "{}").tools ?? null; } catch { seenTools = null; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev("message_start", { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } } });
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "apply_patch", input: {} } });
      const json = JSON.stringify({ input: PATCH });
      for (let i = 0; i < json.length; i += 19) {
        ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 19) } });
      }
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } });
      ev("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const bridge = new ResponsesBridge({ log: () => {} });
  const port = await bridge.start();
  bridge.register("test", { baseUrl: `http://127.0.0.1:${upstream.address().port}`, mode: "anthropic", label: "test" });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/p/test/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "m", stream: true, input: "hi", tool_choice: "auto",
        tools: [{ type: "custom", name: "apply_patch", description: "edit files", format: { type: "grammar", syntax: "lark", definition: "start: x" } }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    assert.equal(response.status, 200);

    const tool = (seenTools ?? []).find((t) => t.name === "apply_patch");
    assert.ok(tool, "custom 工具没下发到 anthropic 上游");
    assert.equal(tool.input_schema.properties.input.type, "string");

    const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
    const completed = events.find((e) => e.type === "response.completed");
    assert.ok(completed, "没收到 response.completed");
    const item = (completed.response.output ?? []).find((i) => i.name === "apply_patch");
    assert.ok(item, "回程没有 apply_patch 调用");
    assert.equal(item.type, "custom_tool_call");
    assert.equal(item.input, PATCH);
    assert.equal(events.some((e) => e.type === "response.function_call_arguments.delta"), false);
  } finally {
    await bridge.stop();
    await new Promise((r) => upstream.close(r));
  }
});
