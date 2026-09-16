/** 协议桥端到端实证（09-16）：mock 一个「只支持 Chat Completions」的网关 + 真实 Codex 引擎。
 *
 *  被验证的命题：引擎（只会发 POST /v1/responses）经由本桥，能和一个纯 Chat 网关正常对话 ——
 *    ① 文本流式输出能到引擎（item/agentMessage/delta 里出现 mock 的文本）；
 *    ② 工具往返闭环：mock 下发 tool_calls → 引擎执行工具 → 下一跳请求里带回 role:"tool"
 *       与 tool_call_id（证明 function_call / function_call_output 双向转换都正确）；
 *    ③ 推理内容（chat 的 reasoning_content）转成 Responses 的 summary 事件后，引擎不报解析错；
 *    ④ auto 模式：上游对 /responses 返回 404 时，桥自动改走 chat 并把结论缓存。
 *
 *  用法：node scripts/probe-bridge.cjs             # chat 模式（上游只有 chat）
 *        PROBE_MODE=auto node scripts/probe-bridge.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");

const { ResponsesBridge } = require("../dist-electron/responses-bridge.js");

const root = path.resolve(__dirname, "..");
const mode = process.env.PROBE_MODE === "auto" ? "auto" : "chat";
const MODEL = "bridge-probe-model";
const TEXT_ONE = "BRIDGE_TEXT_OK";
const TEXT_TWO = "BRIDGE_TOOL_DONE";

const platform = `${process.platform}-${process.arch}`;
const target = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
}[platform];
const binary = path.join(
  path.dirname(require.resolve(`@openai/codex-${platform}/package.json`)),
  "vendor", target, "bin", process.platform === "win32" ? "codex.exe" : "codex",
);

const chatChunk = (delta, extra = {}) => `data: ${JSON.stringify({
  id: "chatcmpl-bridge", object: "chat.completion.chunk", created: 1, model: MODEL,
  choices: [{ index: 0, delta, finish_reason: null }], ...extra,
})}\n\n`;

const upstreamCalls = [];   // { path, body }
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = null;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* /models 之类 */ }
  upstreamCalls.push({ path: req.url, body });

  // 这个网关「只支持 Chat Completions」：responses 端点不存在
  if (!String(req.url).includes("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `unknown endpoint ${req.url}` } }));
  }

  const messages = body?.messages ?? [];
  const hasToolResult = messages.some((m) => m.role === "tool");
  const toolCallsSeen = upstreamCalls.filter((c) => String(c.path).includes("/chat/completions")
    && !(c.body?.messages ?? []).some((m) => m.role === "tool")).length;

  res.writeHead(200, { "content-type": "text/event-stream" });
  if (hasToolResult) {
    return res.end(chatChunk({ role: "assistant", content: "" }) + chatChunk({ content: TEXT_TWO })
      + chatChunk({}, { usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })
      + "data: [DONE]\n\n");
  }
  if (toolCallsSeen >= 2) {
    // 第二次对话轮：下发工具调用（引擎应当执行它并把结果带回来）
    return res.end(
      chatChunk({ role: "assistant", content: "" })
      + chatChunk({ tool_calls: [{ index: 0, id: "call_bridge_1", type: "function",
        function: { name: "exec_command", arguments: "" } }] })
      + chatChunk({ tool_calls: [{ index: 0, function: { arguments: '{"cmd":"echo bridge-ok"}' } }] })
      + chatChunk({}, { usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 } })
      + "data: [DONE]\n\n");
  }
  // 第一次对话轮：推理增量 + 文本增量
  res.end(
    chatChunk({ role: "assistant", content: "", reasoning_content: "先看一眼问题。" })
    + chatChunk({ content: TEXT_ONE.slice(0, 6) })
    + chatChunk({ content: TEXT_ONE.slice(6) })
    + chatChunk({}, { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })
    + "data: [DONE]\n\n",
  );
});
upstream.on("clientError", (_error, socket) => socket.destroy());

let child;
let bridge;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-probe-"));
const pending = new Map();
const completed = new Set();
const agentText = [];
let stderrText = "";
let seq = 0;

async function main() {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstream.address().port;

  bridge = new ResponsesBridge({ preferredPort: 0, log: (line) => console.log("  " + line) });
  const bridgePort = await bridge.start();
  bridge.register("probe", { baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, mode, label: "mock-chat-gateway" });

  fs.writeFileSync(path.join(home, "config.toml"), [
    `model = "${MODEL}"`, 'model_provider = "probe"',
    "[model_providers.probe]", 'name = "Mock Chat Gateway"',
    `base_url = "http://127.0.0.1:${bridgePort}/p/probe"`,
    'wire_api = "responses"', 'env_key = "HARNESS_TEST_KEY"', 'requires_openai_auth = false',
  ].join("\n"));

  child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: "bridge-probe-key",
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => { stderrText += d.toString(); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
    if (message.method === "turn/completed") completed.add(message.params.turn.id);
    if (message.method === "item/agentMessage/delta") agentText.push(message.params.delta);
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  const runTurn = async (text) => {
    completed.clear();
    agentText.length = 0;
    const { turn } = await request("turn/start", { threadId: threadId, model: MODEL,
      input: [{ type: "text", text, text_elements: [] }] });
    const deadline = Date.now() + 30000;
    while (!completed.has(turn.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(completed.has(turn.id), `turn 必须完成（${text}）`);
    return agentText.join("");
  };

  await request("initialize", { clientInfo: { name: "bridge_probe", version: "1.0.0" },
    capabilities: { experimentalApi: true } });
  const { thread } = await request("thread/start", { cwd: home, model: MODEL,
    approvalPolicy: "never", sandbox: "read-only" });
  const threadId = thread.id;

  console.log(`\n=== 协议桥端到端实证（mode=${mode}）===`);
  console.log(`  桥端口 ${bridgePort} → 上游 mock chat 网关 :${upstreamPort}/v1`);

  // ── 第一轮：文本 + 推理 ──
  const first = await runTurn("第一问");
  console.log(`  第一轮引擎收到的助手文本: ${JSON.stringify(first)}`);
  assert.ok(first.includes(TEXT_ONE), "文本增量必须穿过桥到达引擎");
  const firstChat = upstreamCalls.find((c) => String(c.path).includes("/chat/completions"));
  assert.ok(firstChat, "桥必须把 responses 请求转成 /chat/completions 发出");
  const roles = (firstChat.body.messages ?? []).map((m) => m.role);
  console.log(`  上游收到的 messages 角色序列: ${JSON.stringify(roles)}`);
  assert.ok(roles.includes("system"), "instructions 必须转成 system 消息");
  assert.ok(roles.includes("user"), "input 里的用户消息必须保留");
  assert.ok(Array.isArray(firstChat.body.tools) && firstChat.body.tools[0]?.function?.name === "exec_command",
    "工具必须以 chat 的嵌套形状下发");
  assert.ok(!(firstChat.body.tools ?? []).some((t) => !t.function), "非 function 类型工具必须剔除");
  assert.equal(firstChat.body.reasoning_effort, undefined, "未指定 effort 时不下发该字段");
  console.log(`  上游收到的工具名（前 3）: ${JSON.stringify((firstChat.body.tools ?? []).slice(0, 3).map((t) => t.function.name))}`);

  // ── 第二轮：工具调用往返 ──
  const second = await runTurn("第二问");
  console.log(`  第二轮引擎收到的助手文本: ${JSON.stringify(second)}`);
  const toolCarry = upstreamCalls.filter((c) => String(c.path).includes("/chat/completions")
    && (c.body?.messages ?? []).some((m) => m.role === "tool"));
  assert.ok(toolCarry.length >= 1, "引擎必须执行工具并把结果回传（role:\"tool\"）");
  const toolMsg = toolCarry[0].body.messages.find((m) => m.role === "tool");
  assert.equal(toolMsg.tool_call_id, "call_bridge_1", "tool 结果必须对回原始 call_id");
  assert.ok(typeof toolMsg.content === "string" && toolMsg.content.length > 0, "tool 结果必须有内容");
  const assistantCall = toolCarry[0].body.messages.find((m) => m.role === "assistant" && m.tool_calls);
  assert.ok(assistantCall, "助手回合必须以 tool_calls 形状回传历史");
  assert.equal(assistantCall.tool_calls[0].function.name, "exec_command");
  console.log(`  工具回传消息: tool_call_id=${toolMsg.tool_call_id} · assistant.tool_calls 名=${assistantCall.tool_calls[0].function.name}`);

  // ── 推理内容宽容度 ──
  const parseErrors = stderrText.split("\n").filter((l) => /unknown variant|failed to parse|serde|invalid type/i.test(l));
  console.log(`  引擎解析错误行（应为空）: ${JSON.stringify(parseErrors.slice(0, 3))}`);
  assert.equal(parseErrors.length, 0, "推理 summary 事件不得让引擎解析失败");

  if (mode === "auto") {
    const paths = upstreamCalls.map((c) => c.path);
    assert.ok(paths.some((p) => p.includes("/responses")), "auto 模式必须先按 responses 试一次");
    assert.ok(paths.some((p) => p.includes("/chat/completions")), "auto 模式必须回落到 chat");
    console.log(`  上游被访问的路径序列: ${JSON.stringify([...new Set(paths)])}`);
  }

  const status = bridge.status();
  console.log(`  桥统计: ${JSON.stringify(status)}`);

  // 推理内容到底有没有被引擎接受：查它自己写的 rollout（sessions/*.jsonl）里有没有 reasoning 项
  let rollout = "";
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) rollout += fs.readFileSync(full, "utf8");
    }
  };
  try { walk(path.join(home, "sessions")); } catch { /* 目录结构随版本变化，读不到不影响结论 */ }
  const reasoningCount = (rollout.match(/"reasoning"/g) ?? []).length;
  const reasoningTextSeen = rollout.includes("先看一眼问题");
  console.log(`  rollout 中 reasoning 项出现次数: ${reasoningCount} · 推理原文是否落地: ${reasoningTextSeen}`);
  assert.ok(rollout.length > 0, "引擎必须写下 rollout（否则本项检查无效）");
  assert.ok(status.converted >= 2, "转换计数必须增长（证明确实走了转换路径）");
  if (mode === "auto") assert.equal(bridge.modeOf("probe"), "chat", "auto 模式必须把结论缓存为 chat");
  console.log("PASS: 协议桥端到端（文本 / 工具往返 / 推理 / 路由）全部通过");
}

main().catch((error) => { console.error("FAIL: " + (error?.stack ?? error)); process.exitCode = 1; })
  .finally(async () => {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    try { await bridge?.stop(); } catch {}
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
