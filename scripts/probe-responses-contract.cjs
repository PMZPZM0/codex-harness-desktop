/** 录制探针：把 Codex 引擎发给 responses 上游的**真实请求**记录下来。
 *
 *  目的（09-16 协议桥前置实证）：实现「Responses → Chat Completions」本地转换桥之前，
 *  必须先知道引擎到底发什么、以及它消费哪些响应事件。本探针不猜、只录：
 *    · 引擎请求的 URL 路径与全部请求头（授权头叫什么、带不带 stream 等）；
 *    · 请求体结构：input 数组的元素形状、tools 的工具名与 schema 形状；
 *    · 引擎对「最小事件集」的反应（response.created / output_item.added /
 *      output_text.delta / output_item.done / response.completed）。
 *  输出：一次性打印录制结果，供桥实现照抄契约。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const MODEL = "contract-probe-model";
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

const home = fs.mkdtempSync(path.join(os.tmpdir(), "responses-contract-"));
const recorded = [];
const dumpFile = path.join(root, "contract-bodies.json");

/** 第二轮改成工具调用：验证「引擎收到 function_call → 自行执行 → 回传 function_call_output」。 */
function emit(res, index) {
  const withCall = process.env.PROBE_TOOL_CALL === "1" && index === 1;
  if (withCall) {
    const callId = `call_probe_${index}`;
    const callItem = { id: `fc-${index}`, type: "function_call", status: "completed",
      name: "exec_command", arguments: JSON.stringify({ cmd: "echo bridge-ok" }), call_id: callId };
    const response = { id: `resp-${index}`, object: "response", status: "completed",
      output: [callItem], usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...callItem, arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", item_id: callItem.id, output_index: 0, delta: callItem.arguments },
      { type: "response.output_item.done", output_index: 0, item: callItem },
      { type: "response.completed", response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    return res.end();
  }
  const item = { id: `msg-${index}`, type: "message", role: "assistant",
    status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
  const response = { id: `resp-${index}`, object: "response", status: "completed",
    output: [item], usage: { input_tokens: 11, output_tokens: 22, total_tokens: 33 } };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try { body = JSON.parse(raw); } catch { /* 非 JSON 请求（如 /models）原样留 raw */ }
  recorded.push({ method: req.method, url: req.url, headers: req.headers, body, rawLength: raw.length });
  fs.writeFileSync(dumpFile, JSON.stringify(recorded, null, 2));
  emit(res, recorded.length);
});

let child;
const pending = new Map();
const completed = new Set();
const notifications = [];
let seq = 0;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  fs.writeFileSync(path.join(home, "config.toml"), [
    `model = "${MODEL}"`, 'model_provider = "probe"',
    "[model_providers.probe]", 'name = "Probe"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'wire_api = "responses"', 'env_key = "HARNESS_TEST_KEY"', 'requires_openai_auth = false',
  ].join("\n"));

  let stderrText = "";
  child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: "probe-key-123",
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => { stderrText += d.toString(); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.method) notifications.push(message.method);
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
    if (message.method === "turn/completed") completed.add(message.params.turn.id);
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });

  await request("initialize", { clientInfo: { name: "contract_probe", version: "1.0.0" },
    capabilities: { experimentalApi: true } });
  const { thread } = await request("thread/start", { cwd: home, model: MODEL,
    approvalPolicy: "never", sandbox: "read-only" });
  const { turn } = await request("turn/start", { threadId: thread.id, model: MODEL,
    input: [{ type: "text", text: "Reply OK.", text_elements: [] }] });
  const deadline = Date.now() + 40000;
  while (!completed.has(turn.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));

  console.log("========== 录制结果 ==========");
  console.log(`turn 完成: ${completed.has(turn.id)}`);
  recorded.forEach((entry, index) => {
    console.log(`\n--- 请求 ${index + 1}: ${entry.method} ${entry.url} ---`);
    console.log("headers: " + JSON.stringify(Object.fromEntries(
      Object.entries(entry.headers).filter(([k]) => !["host", "content-length", "connection"].includes(k)))));
    if (entry.body) {
      console.log("body keys: " + JSON.stringify(Object.keys(entry.body)));
      console.log("model: " + JSON.stringify(entry.body.model) + "  stream: " + JSON.stringify(entry.body.stream));
      console.log("tools 名称: " + JSON.stringify((entry.body.tools || []).map((t) => t.name ?? t.type)));
      console.log("tools[0] parameters: " + JSON.stringify((entry.body.tools || [])[0]?.parameters || null));
      console.log("tool_choice: " + JSON.stringify(entry.body.tool_choice) + "  reasoning: " + JSON.stringify(entry.body.reasoning)
        + "  store: " + JSON.stringify(entry.body.store) + "  include: " + JSON.stringify(entry.body.include)
        + "  instructions 长度: " + String(entry.body.instructions ?? "").length
        + "  input 元素数: " + (entry.body.input || []).length + "  prompt_cache_key: " + JSON.stringify(entry.body.prompt_cache_key));
      console.log("input 元素 type 序列: " + JSON.stringify((entry.body.input || []).map((i) => i.type ?? i.role)));
      console.log("input 全文: " + JSON.stringify(entry.body.input).slice(0, 1500));
    } else {
      console.log("raw: " + entry.rawLength + " bytes");
    }
  });
  console.log("\n--- 引擎通知（前 20）---");
  console.log([...new Set(notifications)].slice(0, 20).join(", "));
  const stderrLines = stderrText.split("\n").filter((l) => /error|warn|fail/i.test(l));
  console.log("\n--- 引擎 stderr 关键行 ---");
  console.log(stderrLines.slice(-6).join("\n") || "(无)");
})().catch((error) => { console.error("探针异常: " + error.message); process.exitCode = 1; })
  .finally(async () => {
    try { child?.kill(); } catch {}
    try { await once(child, "exit"); } catch {}
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
