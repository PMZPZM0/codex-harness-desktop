// 引擎 [model_providers.X] 重试配置探针：验证 request_max_retries /
// stream_max_retries / stream_idle_timeout_ms 三个键能否被 0.150.1 引擎解析。
//
// 背景：429 限流需要「10 次重试 + 重连时间放长」对所有模型强制生效。
// 二进制 strings 已扫到这三个键，但 strings ≠ 引擎接受该 TOML 写法
// （ModelProviderInfo 若 deny_unknown_fields 会直接让 config 解析失败、引擎起不来）。
// 本探针用独立 CODEX_HOME 起真实 app-server，看 initialize 握手 + config/read 回读。
//
// 跑法：node scripts/probe-provider-retries.cjs
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const CANDIDATES = {
  // 1) 生产现状基线：不带重试键（必须通过，作为对照）
  "baseline": [
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    "requires_openai_auth = false",
  ],
  // 2) 目标格式：三个重试键全部写入 provider 段
  "with-retries": [
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    "requires_openai_auth = false",
    "request_max_retries = 10",
    "stream_max_retries = 10",
    "stream_idle_timeout_ms = 600000",
  ],
  // 3) 只带单个键（定位哪个键出问题，若 2 失败则用）
  "only-request": [
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    "requires_openai_auth = false",
    "request_max_retries = 10",
  ],
};

function runScenario(label, providerLines) {
  const home = `D:/tmp-codex-retry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.mkdirSync(home, { recursive: true });
  const config = [
    `model = "gpt-5-codex"`,
    `model_provider = "harness-probe"`,
    "",
    `[model_providers.harness-probe]`,
    ...providerLines,
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), config);

  const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
  });

  let nextId = 1;
  const pending = new Map();
  let stderrBuf = "";
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  });
  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
  const request = (method, params, timeoutMs = 8000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return (async () => {
    let providerDump = null;
    try {
      await request("initialize", { clientInfo: { name: "codex_harness_desktop", title: "probe", version: "0.1.0" } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
      await sleep(600);
      // config/read 回读引擎解析后的 modelProviders，确认重试键真的被吃进去
      try {
        const v = await request("config/read", {}, 5000);
        const src = v && typeof v === "object" ? (v.config ?? v) : null;
        providerDump = src?.modelProviders ?? src?.model_providers ?? null;
      } catch (e) {
        providerDump = "ERR:" + e.message;
      }
      return { label, ok: true, result: "握手通过", providerDump, stderr: stderrBuf.slice(0, 400) };
    } catch (error) {
      return { label, ok: false, result: error.message, providerDump: null, stderr: stderrBuf.slice(0, 600) };
    } finally {
      child.kill();
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 引擎未完全退出 */ }
    }
  })();
}

(async () => {
  console.log("逐候选 [model_providers.X] 重试配置起 app-server，验证能否安全解析：\n");
  for (const [label, lines] of Object.entries(CANDIDATES)) {
    process.stdout.write(`  → ${label.padEnd(14)} …`);
    const result = await runScenario(label, lines);
    const tag = result.ok ? "✅ 通过" : "❌ 失败";
    console.log(` ${tag}  ${result.result}`);
    if (result.providerDump != null) {
      console.log(`        modelProviders: ${JSON.stringify(result.providerDump).slice(0, 500)}`);
    }
    if (result.stderr && !result.ok) {
      const keyLine = result.stderr.split(/\r?\n/).filter((l) => /error|invalid|unknown|cannot|toml/i.test(l)).slice(0, 3).join(" | ");
      if (keyLine) console.log(`        stderr: ${keyLine}`);
    }
  }
  process.exit(0);
})();
