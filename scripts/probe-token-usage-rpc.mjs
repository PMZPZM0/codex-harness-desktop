// 探针：确认压缩后拉取最新 tokenUsage 的 RPC 形态
// 跑法：node --experimental-strip-types scripts/probe-token-usage-rpc.mjs（或 node 直接跑）
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require.resolve("@openai/codex-win32-x64/package.json");
const bin = path.join(path.dirname(pkg), "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const home = "D:/tmp-codex-usage-probe";
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, "config.toml"), [
  'model = "gpt-5-codex"',
  'model_provider = "harness-probe"',
  "",
  "[model_providers.harness-probe]",
  'name = "harness-probe"',
  'base_url = "http://127.0.0.1:1"',
  'env_key = "CODEX_HARNESS_API_KEY"',
  'wire_api = "responses"',
  "requires_openai_auth = false",
].join("\n"));

const child = spawn(bin, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, CODEX_HOME: home } });
let nextId = 1;
const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const e = pending.get(msg.id);
  if (!e) return;
  pending.delete(msg.id);
  msg.error ? e.reject(new Error(JSON.stringify(msg.error))) : e.resolve(msg.result);
});
const request = (method, params, timeoutMs = 8000) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, timeoutMs);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await request("initialize", { clientInfo: { name: "codex_harness_desktop", title: "probe", version: "0.1.0" } });
child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
await sleep(500);
const started = await request("thread/start", { model: "gpt-5-codex", cwd: home, approvalPolicy: "never", sandbox: "read-only", modelProvider: "harness-probe" });
const tid = started.thread.id;
console.log("thread started:", tid);
for (const method of ["thread/tokenUsage/get", "thread/get", "thread/usage"]) {
  try {
    const v = await request(method, { threadId: tid }, 5000);
    console.log(method, "=> OK:", JSON.stringify(v).slice(0, 300));
  } catch (e) {
    console.log(method, "=> ERR:", e.message.slice(0, 200));
  }
}
const resumed = await request("thread/resume", { threadId: tid, excludeTurns: false }, 8000);
console.log("resume thread keys:", Object.keys(resumed.thread ?? {}).join(", "));
child.kill();
setTimeout(() => { fs.rmSync(home, { recursive: true, force: true }); process.exit(0); }, 400);
