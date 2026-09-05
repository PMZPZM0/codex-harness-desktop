// 端到端验证：ensurePonytailPlugin 种子后，真实引擎能列出 ponytail 钩子。
// 用临时 CODEX_HOME，模拟「新机器首启」。
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const { ensurePonytailPlugin } = require("../dist-electron/ponytail-plugin.js");

const home = "D:/tmp-e2e-" + Date.now();
const bundled = "D:/Codex Harness Desktop/resources/tools/ponytail-plugin";

(async () => {
  fs.mkdirSync(home, { recursive: true });
  // 首启无 config.toml、无 plugins/cache → 种子
  await ensurePonytailPlugin(home, bundled);

  const cacheDir = path.join(home, "plugins/cache/ponytail/ponytail/4.9.0");
  const cacheOk = fs.existsSync(path.join(cacheDir, "plugin.yaml"));
  const configText = fs.readFileSync(path.join(home, "config.toml"), "utf8");
  console.log("=== 种子结果 ===");
  console.log("cache 种子:", cacheOk, "| config 含 marketplaces.ponytail:", configText.includes("[marketplaces.ponytail]"));
  console.log("config 含 plugins 启用:", configText.includes('[plugins."ponytail@ponytail"]'));
  console.log("config 含 trusted_hash:", configText.includes("trusted_hash = \"sha256:5f81d38f"));

  // 起真实引擎
  const child = spawn(bin, ["app-server", "--listen", "stdio://"], { stdio: ["pipe","pipe","pipe"], windowsHide: true, env: { ...process.env, CODEX_HOME: home, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" } });
  let nextId = 1; const pending = new Map();
  readline.createInterface({ input: child.stdout }).on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; } if (m.id===undefined) return; const e = pending.get(m.id); if (!e) return; clearTimeout(e.t); pending.delete(m.id); m.error ? e.rej(new Error(JSON.stringify(m.error))) : e.res(m.result); });
  const req = (method, params, t=15000) => { const id = nextId++; return new Promise((res, rej) => { const timer = setTimeout(() => { pending.delete(id); rej(new Error(method+" timeout")); }, t); pending.set(id, {res, rej, t: timer}); child.stdin.write(JSON.stringify({id, method, params})+"\n"); }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await req("initialize", { clientInfo: { name: "probe", title: "probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    await sleep(800);
    const pl = await req("plugin/list", {}, 15000);
    const mp = (pl?.marketplaces ?? [])[0];
    const p = mp?.plugins?.[0];
    console.log("=== 引擎视角 ===");
    console.log("plugin/list:", mp ? `marketplace=${mp.name} installed=${p?.installed}` : "（marketplace 未列出，但见下 hooks）");
    const h = await req("hooks/list", { cwds: ["D:/Codex Harness Desktop"] }, 10000);
    const hooks = h?.data?.[0]?.hooks ?? [];
    console.log("hooks/list:", hooks.length, "个");
    hooks.forEach(x => console.log("   -", x.key, "|", x.trustStatus, "|", x.command.split("/").slice(-2).join("/")));
  } catch (e) { console.log("ERR:", e.message); }
  finally { child.kill(); try { fs.rmSync(home, { recursive: true, force: true }); } catch { } process.exit(0); }
})();
