const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const bin = path.join("D:/Codex Harness Desktop", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const home = "D:/tmp-codex-turnprobe-" + Date.now();
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, "config.toml"), [
  `model = "gpt-5-codex"`, `model_provider = "harness-probe"`, ``,
  `[model_providers.harness-probe]`,
  `name = "harness-probe"`, `base_url = "http://127.0.0.1:1"`, `env_key = "K"`,
  `wire_api = "responses"`, `requires_openai_auth = false`,
  `request_max_retries = 10`, `stream_max_retries = 10`, `stream_idle_timeout_ms = 600000`,
].join("\n"));
const child = spawn(bin, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, CODEX_HOME: home } });
let nextId = 1; const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  const p = pending.get(m.id); if (!p) return;
  clearTimeout(p.t); pending.delete(m.id);
  m.error ? p.reject(new Error(JSON.stringify(m.error).slice(0, 300))) : p.resolve(m.result);
});
const req = (method, params, timeoutMs = 15000) => new Promise((res, rej) => {
  const id = nextId++; const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " timeout")); }, timeoutMs);
  pending.set(id, { resolve: res, reject: rej, t });
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
(async () => {
  const out = [];
  await req("initialize", { clientInfo: { name: "probe", title: "probe", version: "0.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  const check = async (label, fn) => {
    try { const r = await fn(); out.push("OK  " + label + " :: " + String(r).slice(0, 120)); }
    catch (e) { out.push("ERR " + label + " :: " + e.message.slice(0, 300)); }
  };
  let threadId = "";
  await check("thread/start(approvalPolicy+sandbox+policy)", async () => {
    const r = await req("thread/start", { cwd: "D:/", approvalPolicy: "never", sandbox: "danger-full-access", model: "gpt-5-codex", modelProvider: "harness-probe", sandboxPolicy: { mode: "danger-full-access" } });
    threadId = r.thread.id; return "threadId=" + threadId.slice(0, 8);
  });
  await check("thread/goal/set(objective)", async () => { const r = await req("thread/goal/set", { threadId, objective: "probe goal" }); return JSON.stringify(r).slice(0, 120) || "ok"; });
  await check("thread/goal/get", async () => JSON.stringify(await req("thread/goal/get", { threadId })).slice(0, 100));
  await check("turn/start(effort=ultra)", async () => {
    const r = await req("turn/start", { threadId, input: [{ type: "text", text: "hi", text_elements: [] }], effort: "ultra" });
    return "turn accepted id=" + String(r && r.turn ? r.turn.id : "?").slice(0, 8);
  });
  await new Promise((r) => setTimeout(r, 2500));
  await req("turn/interrupt", { threadId }).catch(() => {});
  await check("turn/start(collaborationMode=plan)", async () => {
    const r = await req("turn/start", { threadId, input: [{ type: "text", text: "plan me", text_elements: [] }], collaborationMode: { mode: "plan", settings: { model: "gpt-5-codex" } } });
    return "turn accepted id=" + String(r && r.turn ? r.turn.id : "?").slice(0, 8);
  });
  await new Promise((r) => setTimeout(r, 2500));
  await req("turn/interrupt", { threadId }).catch(() => {});
  console.log(out.join("\n"));
  child.kill();
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { console.log("! tmp left: " + home); }
  process.exit(0);
})();
