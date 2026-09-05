// 引擎 marketplace 本地化探针：验证 ponytail 插件能否脱离 git 拉取、用本地目录离线加载。
//
// 背景：新机器装完 0.0.5 后「钩子空 / 插件 0」——config.toml 里
//   [marketplaces.ponytail] source_type = "git" source = "https://github.com/..."
//   引擎首次启动要 git clone，拉不到就插件/钩子全空。
// 方案：把插件 4.9.0 内容打进安装包 resources/tools/，config 指向本地目录。
// 本探针实证引擎认哪种本地写法（source_type="local" / 裸 source / file://），
// 以及 plugin/list + hooks/list 能否真的列出插件与钩子。
//
// 跑法：node scripts/probe-marketplace-local.cjs
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const SRC_PLUGIN = "C:/Users/Administrator/AppData/Roaming/Codex Harness Desktop/codex-home/plugins/cache/ponytail/ponytail/4.9.0";

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".git") continue; // 本地 marketplace 不需要 git 元数据
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runScenario(label, marketplaceToml) {
  const home = `D:/tmp-mkpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const localDir = `${home}/ponytail-local`;
  fs.mkdirSync(home, { recursive: true });
  copyDir(SRC_PLUGIN, localDir);

  const base = [
    `model = "gpt-5-codex"`,
    `model_provider = "harness-probe"`,
    "",
    `[model_providers.harness-probe]`,
    `name = "harness-probe"`,
    `base_url = "http://127.0.0.1:1"`,
    `env_key = "CODEX_HARNESS_API_KEY"`,
    `wire_api = "responses"`,
    "requires_openai_auth = false",
    "",
    marketplaceToml.replaceAll("__DIR__", localDir),
    "",
    `[plugins."ponytail@ponytail"]`,
    `enabled = true`,
    "",
    // 钩子信任：新机器首启 harness 需写入，否则 SessionStart 钩子不加载
    `[hooks.state."ponytail@ponytail:hooks/claude-codex-hooks.json:session_start:0:0"]`,
    `trusted_hash = "sha256:5f81d38f47448a1581c08ec877e044d9e04dd6f814dce3f2671f7a8edadd719b"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), base);

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
  const request = (method, params, timeoutMs = 15000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return (async () => {
    const out = { label, ok: false, handshake: false, marketplaces: null, plugins: null, hooks: null, stderr: "" };
    try {
      await request("initialize", { clientInfo: { name: "probe", title: "probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
      await sleep(500);
      out.handshake = true;

      try { out.marketplaces = await request("marketplace/list", {}, 8000); }
      catch (e) { out.marketplaces = "ERR:" + e.message; }

      try { out.plugins = await request("plugin/list", {}, 15000); }
      catch (e) { out.plugins = "ERR:" + e.message; }

      // 尝试安装插件（本地 marketplace 可能不会像 git 一样自动装）
      for (const [method, params] of [
        ["plugin/install", { pluginName: "ponytail@ponytail" }],
        ["plugin/install", { pluginName: "ponytail" }],
        ["plugin/update", { pluginName: "ponytail@ponytail", force: true }],
      ]) {
        try {
          const r = await request(method, params, 30000);
          out.installResult = { method: `${method} ${JSON.stringify(params)}`, ok: true, data: r };
          break;
        } catch (e) {
          out.installResult = { method: `${method} ${JSON.stringify(params)}`, ok: false, data: "ERR:" + e.message };
          if (!/unknown variant|missing field|not found/i.test(e.message)) break;
        }
      }

      try { out.hooks = await request("hooks/list", { cwds: ["D:/Codex Harness Desktop"] }, 10000); }
      catch (e) { out.hooks = "ERR:" + e.message; }

      out.ok = true;
      return out;
    } catch (error) {
      out.stderr = stderrBuf.slice(0, 500);
      return { ...out, error: error.message };
    } finally {
      child.kill();
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { }
    }
  })();
}

function summarize(label, r) {
  console.log(`\n━━━ ${label} ${r.handshake ? "✅握手" : "❌握手失败"} ${r.error ? "| " + r.error : ""}`);
  if (r.marketplaces) {
    const m = Array.isArray(r.marketplaces) ? r.marketplaces : (r.marketplaces?.marketplaces ?? r.marketplaces?.data);
    console.log(`  marketplace/list: ${m ? m.map((x) => x.name ?? x.id ?? JSON.stringify(x).slice(0, 40)).join(", ") : JSON.stringify(r.marketplaces).slice(0, 150)}`);
  }
  if (r.plugins) {
    const plist = (r.plugins?.marketplaces ?? r.plugins?.data ?? r.plugins);
    const text = typeof plist === "string" ? plist : JSON.stringify(plist);
    const hasPonytail = /ponytail/i.test(text);
    const inst = (typeof text === "string" && /"installed":\s*true/i.test(text)) ? "installed=true" : (typeof text === "string" && /"installed":\s*false/i.test(text) ? "installed=false" : "");
    console.log(`  plugin/list: ${hasPonytail ? "✅ 含 ponytail" : "❌ 无 ponytail"} ${inst} → ${text.slice(0, 200)}`);
  }
  if (r.installResult) {
    console.log(`  install: ${r.installResult.method} ${r.installResult.ok ? "✅" : "❌"} ${typeof r.installResult.data === "string" ? r.installResult.data.slice(0, 120) : JSON.stringify(r.installResult.data).slice(0, 160)}`);
  }
  if (r.hooks) {
    const h = Array.isArray(r.hooks) ? r.hooks : (r.hooks?.data ?? r.hooks);
    const text = typeof h === "string" ? h : JSON.stringify(h);
    const hookCount = Array.isArray(h) ? h.reduce((n, e) => n + (e.hooks?.length ?? 0), 0) : -1;
    console.log(`  hooks/list: ${typeof text === "string" ? text.slice(0, 160) : `hooks=${hookCount}`}`);
  }
  if (r.stderr) console.log(`  stderr: ${r.stderr.split(/\r?\n/).slice(0, 4).join(" | ")}`);
}

(async () => {
  console.log(`复制源插件: ${SRC_PLUGIN}`);
  const CANDIDATES = {
    "source_type=local": '[marketplaces.ponytail]\nsource_type = "local"\nsource = "__DIR__"',
    "裸 source=路径": '[marketplaces.ponytail]\nsource = "__DIR__"',
    "source_type=git+file://": '[marketplaces.ponytail]\nsource_type = "git"\nsource = "file:///__DIR__"',
  };
  for (const [label, toml] of Object.entries(CANDIDATES)) {
    const r = await runScenario(label, toml);
    summarize(label, r);
  }
  process.exit(0);
})();
