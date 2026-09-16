/** wire_api 探针：复核「新版引擎对 wire_api = "chat" 硬拒载」这条结论是否仍成立。
 *
 *  背景（09-16 用户报）：设置页「API 格式」选了 Chat Completions，保存后总被改回 Responses。
 *  主进程 electron/main.ts 的 normalizeProvider() / applyCustomModel() 无条件把 wireApi 归一化成
 *  "responses"，注释理由是「新版引擎对 wire_api = "chat" 是硬拒载（整份 config.toml 加载失败）」
 *  （09-14 结论）。本探针要实证：
 *    A. wire_api = "responses" → 基线，initialize + turn 应正常。
 *    B. wire_api = "chat"      → 引擎到底①能否加载 config？②能否跑通 turn？③请求打到哪个端点？
 *  手段：独立 CODEX_HOME + mock 模型 API（同时实现 /v1/responses 与 /v1/chat/completions）
 *       + 真实 app-server；记录每个请求的 URL 路径与格式，读引擎 stderr。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const root = path.resolve(__dirname, "..");
const MODEL = "probe-wire-model";

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

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of events) res.write(e);
  res.end();
}

async function scenario(label, wireApi) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wire-probe-"));
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = req.url || "";
    hits.push(`${req.method} ${url}`);

    if (url.includes("/chat/completions")) {
      // OpenAI Chat Completions SSE
      const chunk = (delta, finish) => `data: ${JSON.stringify({
        id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: MODEL,
        choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      })}\n\n`;
      return sse(res, [
        chunk({ role: "assistant", content: "" }),
        chunk({ content: "OK" }),
        chunk({}, "stop"),
        `data: ${JSON.stringify({ id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: MODEL, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    }

    // OpenAI Responses SSE（基线，与 probe-context-window.cjs 一致）
    const item = { id: "msg-1", type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "OK", annotations: [] }] };
    const response = { id: "resp-1", object: "response", status: "completed", output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    sse(res, [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...response, status: "in_progress", output: [] } })}\n\n`,
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
    ]);
  });

  let child;
  let stderrText = "";
  const pending = new Map();
  const completed = new Set();
  let seq = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });

  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const cfg = [
      `model = "${MODEL}"`,
      'model_provider = "probe"',
      "[model_providers.probe]", 'name = "Probe"',
      `base_url = "http://127.0.0.1:${port}/v1"`,
      `wire_api = "${wireApi}"`,
      'env_key = "HARNESS_TEST_KEY"',
      'requires_openai_auth = false',
    ];
    fs.writeFileSync(path.join(home, "config.toml"), cfg.join("\n"));

    child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: "local-test-only",
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
    });

    console.log(`\n=== [${label}] config.toml: wire_api = "${wireApi}" ===`);
    try {
      await request("initialize", { clientInfo: { name: "wire_probe", version: "1.0.0" },
        capabilities: { experimentalApi: true } });
      console.log(`  initialize        : OK（配置被引擎接受）`);
    } catch (e) {
      console.log(`  initialize        : ✗ ${String(e.message).slice(0, 300)}`);
      console.log(`  引擎 stderr       : ${stderrText.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 400)}`);
      return;
    }

    try {
      const { thread } = await request("thread/start", { cwd: home, model: MODEL, approvalPolicy: "never", sandbox: "read-only" });
      const { turn } = await request("turn/start", { threadId: thread.id, model: MODEL,
        input: [{ type: "text", text: "Reply OK.", text_elements: [] }] });
      const deadline = Date.now() + 20000;
      while (!completed.has(turn.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
      console.log(`  turn              : ${completed.has(turn.id) ? "完成 ✓" : "未完成（超时）"}`);
    } catch (e) {
      console.log(`  turn              : ✗ ${String(e.message).slice(0, 300)}`);
    }
    console.log(`  实际上游请求      : ${hits.length ? hits.join(" , ") : "(无请求)"}`);
  } catch (e) {
    console.log(`[${label}] 探针异常: ` + String(e.message).slice(0, 300));
  } finally {
    try { child?.kill(); } catch {}
    try { server.close(); } catch {}
  }
}

(async () => {
  console.log("引擎 binary: " + binary);
  await scenario("基线", "responses");
  await scenario("用户诉求", "chat");
  console.log("\n--- 探针结束 ---");
})();
