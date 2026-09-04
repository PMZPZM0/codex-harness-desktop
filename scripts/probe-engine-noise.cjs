// Codex 引擎噪音探针：用独立 CODEX_HOME 起 app-server，量「每秒日志」能不能被关掉。
//
// 背景：$CODEX_HOME/logs_*.sqlite 会被写爆（实测 4 小时 1.4 万条、85MB），其中约 95% 是
// codex_login::auth::manager 的 "Reloading auth" + remote_control websocket 重试，每秒各一轮。
// 要关就得证明哪个开关真的有效，别靠猜。
//
// 两个坑（都踩过）：
//   1) 必须完成 initialize + initialized 握手，否则引擎不进入 session loop，
//      日志只有启动时那 119KB 固定内容，测出来全是 0。
//   2) 计数必须按字节数而不是查 SQL：日志绝大部分还躺在 -wal 里没 checkpoint，
//      而且进程是被 kill 的，只读连接恢复不了脏 -shm，SQL 查询读得到表却查不到行。
//
// 跑法：node scripts/probe-engine-noise.cjs [--seconds 8] [--keep]
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const argv = process.argv.slice(2);
const seconds = Number(argv[argv.indexOf("--seconds") + 1]) || 8;
const keep = argv.includes("--keep");
// 空 CODEX_HOME 复现不出噪音（引擎不启动 remote control 轮询），
// 用真实 config.toml 做种子才能还原现场。
const seed = argv.includes("--seed-config") ? process.env.APPDATA + "\\Codex Harness Desktop\\codex-home\\config.toml" : "";

const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

const countNeedle = (home, needle) => {
  let total = 0;
  for (const file of fs.readdirSync(home).filter((f) => f.startsWith("logs"))) {
    try { total += (fs.readFileSync(path.join(home, file)).toString("latin1").match(new RegExp(needle, "g")) || []).length; }
    catch { /* 文件被占用时跳过 */ }
  }
  return total;
};

function runScenario(label, extraEnv) {
  const home = `D:/tmp-codex-noise-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.mkdirSync(home, { recursive: true });
  if (seed && fs.existsSync(seed)) {
    let cfg = fs.readFileSync(seed, "utf8");
    // 追加 otel 全关：OtelExporterKind 支持 none，可停掉 feedback 日志 span 的写出
    if (!cfg.includes("[otel]")) cfg += "\n[otel]\nexporter = \"none\"\n";
    fs.writeFileSync(path.join(home, "config.toml"), cfg);
  }
  const child = spawn(bin, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, CODEX_HOME: home, ...extraEnv },
  });

  let nextId = 1;
  const pending = new Map();
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
    await request("initialize", { clientInfo: { name: "codex_harness_desktop", title: "probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    await sleep(seconds * 1000);
    child.kill();
    await sleep(600);
    const result = { label, auth: countNeedle(home, "Reloading auth"), remote: countNeedle(home, "remote control") };
    if (keep) result.home = home; else { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 引擎未完全退出 */ } }
    return result;
  })().catch((error) => ({ label, auth: -1, remote: -1, error: error.message }));
}

(async () => {
  const scenarios = [
    ["基线（无开关）", {}],
    ["REMOTE_CONTROL_DISABLED=1", { CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" }],
    ["RUST_LOG=off", { RUST_LOG: "off" }],
    ["DISABLED + RUST_LOG=off", { CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1", RUST_LOG: "off" }],
  ];
  console.log(`每个场景采样 ${seconds} 秒\n`);
  const results = [];
  for (const [label, env] of scenarios) {
    process.stdout.write(`  → ${label} …`);
    const result = await runScenario(label, env);
    results.push(result);
    console.log(result.error ? ` 出错：${result.error}` : ` auth reload ${result.auth} 次（${(result.auth / seconds).toFixed(1)}/秒），remote control ${result.remote} 条`);
  }
  const baseline = results[0].auth;
  console.log("\n=== 对比（相对基线）===");
  for (const r of results) {
    if (r.auth < 0) { console.log(`  ${r.label.padEnd(30)} 失败`); continue; }
    const drop = r.label.startsWith("基线") ? "" : `（${((r.auth - baseline) / Math.max(baseline, 1) * 100).toFixed(0)}%）`;
    console.log(`  ${r.label.padEnd(30)} ${String(r.auth).padStart(5)} 次  ${drop}`);
  }
  process.exit(0);
})();
