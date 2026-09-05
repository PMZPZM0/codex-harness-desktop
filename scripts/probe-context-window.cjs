// 探针：0.153.4 引擎对顶层 model_context_window 与 catalog context_window 的实际采用优先级
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const bin = path.join(process.cwd(), "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const home = "D:/tmp-codex-ctxprobe-" + Date.now();
fs.mkdirSync(home, { recursive: true });
// 关键构造：顶层 model_context_window=1000000，catalog 里同模型 context_window=128000
// 引擎到底用哪个？（现场 BUG：用户设 1M 不生效，一直 128K）
fs.writeFileSync(path.join(home, "config.toml"), [
  'model = "probe-model"',
  'model_context_window = 1000000',
  'model_provider = "probe"',
  `[model_providers.probe]`,
  'name = "probe"',
  'base_url = "http://127.0.0.1:1"',
  'env_key = "K"',
  'wire_api = "responses"',
  'requires_openai_auth = false',
].join("\n"));
fs.writeFileSync(path.join(home, "model-catalog.json"), JSON.stringify({
  models: [{ slug: "probe-model", display_name: "probe", context_window: 128000, max_context_window: 128000, auto_compact_token_limit: null, default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "medium", description: "m" }], shell_type: "default", visibility: "list" }],
}));
const child = spawn(bin, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, CODEX_HOME: home } });
let nextId = 1; const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  const p = pending.get(m.id); if (!p) return;
  clearTimeout(p.t); pending.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error).slice(0, 400))) : p.resolve(m.result);
});
const req = (method, params, timeoutMs = 15000) => new Promise((res, rej) => {
  const id = nextId++; const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " timeout")); }, timeoutMs);
  pending.set(id, { resolve: res, reject: rej, t });
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
(async () => {
  await req("initialize", { clientInfo: { name: "probe", title: "probe", version: "0.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  // 反向构造 B：顶层 128000 + catalog 1000000
  // 场景 A：顶层 1M、catalog 128K → config/read 确认顶层值
  const cfg = await req("config/read", {});
  const src = cfg && typeof cfg === "object" ? (cfg.config ?? cfg) : null;
  console.log("A: config/read model_context_window =", src?.model_context_window);
  // model/list 拿引擎合并后的模型元数据（含 catalog 生效情况）
  let probeThreadId = "";
  try {
    const started = await req("thread/start", { cwd: "D:/", approvalPolicy: "never", sandbox: "read-only", model: "probe-model", modelProvider: "probe" });
    probeThreadId = started?.thread?.id ?? "";
    console.log("A: thread started", probeThreadId.slice(0, 8));
  } catch (e) { console.log("A: thread/start:", e.message.slice(0, 150)); }
  try {
    const list = await req("model/list", {});
    const arr = list?.models ?? list ?? [];
    for (const m of (Array.isArray(arr) ? arr : []).slice(0, 5)) console.log("A: model/list:", m.slug ?? m.id, "| ctx:", m.context_window, "| max:", m.max_context_window);
  } catch (e) { console.log("A: model/list:", e.message.slice(0, 120)); }
  // 场景 B：交换——顶层 128000、catalog 1000000，看 thread 的 contextWindow 用谁
  try {
    fs.writeFileSync(path.join(home, "config.toml"), [
      'model = "probe-model"',
      'model_context_window = 128000',
      'model_provider = "probe"',
      `[model_providers.probe]`,
      'name = "probe"',
      'base_url = "http://127.0.0.1:1"',
      'env_key = "K"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
    ].join("\n"));
    fs.writeFileSync(path.join(home, "model-catalog.json"), JSON.stringify({
      models: [{ slug: "probe-model", display_name: "probe", context_window: 1000000, max_context_window: 1000000, auto_compact_token_limit: null, default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "medium", description: "m" }], shell_type: "default", visibility: "list" }],
    }));
    const cfgB = await req("config/read", {});
    const srcB = cfgB && typeof cfgB === "object" ? (cfgB.config ?? cfgB) : null;
    console.log("B: config/read model_context_window =", srcB?.model_context_window);
  } catch (e) { console.log("B:", e.message.slice(0, 120)); }
  child.kill(); process.exit(0);
})().catch((e) => { console.error("FAIL", e.message); child.kill(); process.exit(1); });
