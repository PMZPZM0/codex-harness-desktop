/** 上下文窗口探针：判定「引擎实际使用的上下文上限」由谁决定。
 *  背景（09-16 用户报「致命 bug」）：config.toml 顶层的 model_context_window 是全局单值，
 *  只写「当时生效模型」的值 → 切到别的模型后不跟随（用户实测同一模型在同一会话里
 *  上下文值从 1000000 变成 128000，与他配的 1000000 不符）。
 *
 *  本探针要回答的问题（决定修法）：
 *    A. 顶层存在时，catalog 里每个模型各自的 context_window 会被引擎采用吗？（还是被顶层统一覆盖）
 *    B. 去掉顶层后，引擎是否按「当前模型」取 catalog 里的 context_window？
 *  手段：独立 CODEX_HOME + mock 模型 API + 真实 app-server；跑真实 turn，
 *       再读引擎自己写的 rollout 里上报的 model_context_window（= UI 显示的那个值）。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const ts = require("typescript");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const root = path.resolve(__dirname, "..");
const M1 = "probe-model-a";
const M2 = "probe-model-b";
const CTX1 = 128000;
const CTX2 = 1000000;

// 复用 electron/main.ts 的真实 catalog 生成器，保证格式与生产一致
const source = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
const s0 = source.indexOf("function buildModelCatalog(");
const s1 = source.indexOf("\n/**", s0);
const buildModelCatalog = vm.runInNewContext(
  ts.transpile(source.slice(s0, s1)) + "\nbuildModelCatalog",
  { normalizeProvider: (value) => value },
);

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

/** 读引擎写的 rollout，抽出 (记录类型, model, model_context_window) */
function readRollout(home) {
  const base = path.join(home, "sessions");
  const out = [];
  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) {
        let model = null;
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
          if (!line.trim()) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          const p2 = j.payload || j;
          if (p2 && p2.model) model = p2.model;
          const m = line.match(/"model_context_window"\s*:\s*(\d+)/);
          if (m) out.push({ rec: j.type ?? "?", model: p2?.model ?? model, ctx: Number(m[1]) });
        }
      }
    }
  };
  walk(base);
  return out;
}

async function scenario(label, topLevelContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-probe-"));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const item = { id: `msg-${requests.length}`, type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "OK", annotations: [] }] };
    const response = { id: `resp-${requests.length}`, object: "response", status: "completed",
      output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "OK" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });

  let child;
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
    const catalog = buildModelCatalog({ name: "Probe", model: M1, contextWindow: CTX1, models: [
      { id: M1, contextWindow: CTX1 },
      { id: M2, contextWindow: CTX2 },
    ] });
    fs.writeFileSync(path.join(home, "catalog.json"), JSON.stringify(catalog));
    const cfg = [`model = "${M1}"`];
    if (topLevelContext) cfg.push(`model_context_window = ${topLevelContext}`);
    cfg.push(
      'model_provider = "probe"',
      `model_catalog_json = ${JSON.stringify(path.join(home, "catalog.json"))}`,
      "[model_providers.probe]", 'name = "Probe"',
      `base_url = "http://127.0.0.1:${port}/v1"`,
      'wire_api = "responses"', 'env_key = "HARNESS_TEST_KEY"', 'requires_openai_auth = false',
    );
    fs.writeFileSync(path.join(home, "config.toml"), cfg.join("\n"));

    child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: home, HARNESS_TEST_KEY: "local-test-only",
        HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost",
        CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer); pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
      }
      if (message.method === "turn/completed") completed.add(message.params.turn.id);
    });

    await request("initialize", { clientInfo: { name: "ctx_probe", version: "1.0.0" },
      capabilities: { experimentalApi: true } });

    // ① model/list：引擎认识的每个模型的元数据
    const list = await request("model/list", { includeHidden: true });
    const rows = (list.data || []).filter((m) => [M1, M2].includes(m.model ?? m.slug ?? m.id))
      .map((m) => ({ id: m.model ?? m.slug ?? m.id, ctx: m.contextWindow ?? m.context_window ?? null, max: m.maxContextWindow ?? null }));
    console.log(`[${label}] model/list → ` + JSON.stringify(rows));

    const { thread } = await request("thread/start", { cwd: home, model: M1, approvalPolicy: "never", sandbox: "read-only" });

    const runTurn = async (model) => {
      const { turn } = await request("turn/start", { threadId: thread.id, model,
        input: [{ type: "text", text: "Reply OK.", text_elements: [] }] });
      const deadline = Date.now() + 20000;
      while (!completed.has(turn.id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
      completed.delete(turn.id);
    };

    await runTurn(M1);
    await runTurn(M2);

    const rows2 = readRollout(home);
    const byModel = new Map();
    for (const r of rows2) {
      const k = `${r.model} → ${r.ctx}`;
      byModel.set(k, (byModel.get(k) || 0) + 1);
    }
    console.log(`[${label}] rollout 上报 → ` + JSON.stringify([...byModel].map(([k, v]) => `${k} ×${v}`)));
  } catch (e) {
    console.log(`[${label}] 失败: ` + String(e.message).slice(0, 200));
  } finally {
    try { child?.kill(); } catch {}
    try { server.close(); } catch {}
  }
}

(async () => {
  console.log("模型配置： " + M1 + "=" + CTX1 + " | " + M2 + "=" + CTX2);
  console.log();
  await scenario("场景A 顶层=128000", 128000);
  console.log();
  await scenario("场景B 无顶层", 0);
})();
