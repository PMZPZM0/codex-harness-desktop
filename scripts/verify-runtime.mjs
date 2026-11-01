/**
 * 运行时验收（10-31 白屏事故后新增，**收尾必跑**）：拉起应用 → 真连 CDP → 抓运行时报错 + 检查 DOM。
 *
 * ⛔⛔ 为什么存在这一步（用户原话：「这都报错，你咋验收的」）：
 *    `scripts/check-app-dist.mjs` 只验「index.html 的 script/link 指到当前 dist」——
 *    它证明的是**产物被加载**，不是**界面能跑**。10-31 我在 `renderThreadRow`（普通函数，
 *    由侧栏 map 调用）里调了 `useSyncExternalStore` ⇒ 每渲染一行就往调用方组件的 hook 链上插一个
 *    ⇒ 行数一变 hook 数量就变 ⇒ React #310，整个界面被 ErrorBoundary 兜成「界面发生错误」。
 *    那次 build 绿、守卫绿、启动校验 PASS，用户一开就白屏 ⇒ 缺的就是这条判据。
 *
 * 判据（任一为真即失败）：
 *   ① 控制台 error / 未捕获异常里出现 React 报错（#310 / #300 / Minified React error）；
 *   ② DOM 里出现 ErrorBoundary 的「界面发生错误」遮罩；
 *   ③ 主界面骨架没出现（#root 空 / 没有 .app-shell）。
 * 报告（不判失败，但必须打印）：侧栏笔名徽标数量、会话行数量、首屏文本片段 ——
 *    这三样是「新功能到底跑没跑」的肉眼凭证。
 *
 * 用法：node scripts/verify-runtime.mjs [端口] [等待毫秒]     默认 9391 / 10000
 * ⛔ profile 用项目盘内的 `.workbuddy/tmp/verifyprof`（放 os.tmpdir() 时首启会因 tools 目录 watch
 *    失败而拉不起页面，10-31 实测），每次跑前清空。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const port = Number(process.argv[2] || 9391);
const settleMs = Number(process.argv[3] || 10000);

const profile = path.resolve(".workbuddy/tmp/verifyprof");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const env = { ...process.env, APPDATA: profile, CODEX_HARNESS_DEBUG_PORT: String(port) };
for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) delete env[key];

const child = spawn(electronPath, ["."], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
child.stdout.on("data", (d) => { appLog += d.toString(); });
child.stderr.on("data", (d) => { appLog += d.toString(); });

const getJson = (p) => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 1500 }, (res) => {
    let buf = "";
    res.on("data", (c) => { buf += c; });
    res.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
  });
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
});

const waitPage = async (limitMs = 60000) => {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    const list = await getJson("/json/list");
    const page = Array.isArray(list) ? list.find((t) => t.type === "page" && t.webSocketDebuggerUrl) : null;
    if (page) return page;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
};

const page = await waitPage();
if (!page) {
  console.log("FAIL — 等不到可调试页面（应用没起来）");
  console.log(appLog.split("\n").filter((l) => l && !/gpu|cache|DevTools/i.test(l)).slice(-12).join("\n"));
  child.kill();
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const errors = [];
const consoleErrors = [];
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

await new Promise((resolve) => { ws.onopen = resolve; });
ws.onmessage = (event) => {
  let msg;
  try { msg = JSON.parse(String(event.data)); } catch { return; }
  if (msg.method === "Runtime.exceptionThrown") {
    const detail = msg.params?.exceptionDetails;
    errors.push(String(detail?.exception?.description ?? detail?.text ?? "unknown"));
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => String(a.description ?? a.value ?? "")).join(" "));
  }
};
send("Runtime.enable");
send("Log.enable");

await new Promise((r) => setTimeout(r, settleMs));

const evaluate = (expression) => new Promise((resolve) => {
  const callId = ++id;
  const onMessage = (event) => {
    let msg;
    try { msg = JSON.parse(String(event.data)); } catch { return; }
    if (msg.id !== callId) return;
    ws.removeEventListener("message", onMessage);
    resolve(msg.result?.result?.value ?? null);
  };
  ws.addEventListener("message", onMessage);
  ws.send(JSON.stringify({ id: callId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});

const probe = await evaluate(`(() => ({
  boundary: Boolean(document.querySelector('.app-error-boundary, [class*="error-boundary"]')) || document.body.innerText.includes('界面发生错误'),
  shell: Boolean(document.querySelector('.app-shell')),
  rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  aliasBadges: document.querySelectorAll('.thread-alias-badge').length,
  threadRows: document.querySelectorAll('[data-thread-row], .thread-row').length,
  bodyText: (document.body.innerText || '').slice(0, 160).replace(/\\n+/g, ' | '),
}))()`);

const reactNoise = [...errors, ...consoleErrors].filter((line) => /React|Minified React error|#310|#300|Cannot read|is not a function/i.test(line));const fail = [];
if (probe?.boundary) fail.push("ErrorBoundary 遮罩出现（界面已经崩了）");
if (reactNoise.length) fail.push(`运行时报错 ${reactNoise.length} 条`);
if (!probe?.shell && (probe?.rootChildren ?? 0) === 0) fail.push("#root 空（主界面没渲染）");

console.log(`\n[运行时探针] 端口 ${port} / 等待 ${settleMs}ms`);
console.log(`  · ErrorBoundary: ${probe?.boundary ? "✗ 出现" : "✓ 无"}`);
console.log(`  · .app-shell: ${probe?.shell ? "✓" : "✗"} | #root 子节点: ${probe?.rootChildren ?? "?"}`);
console.log(`  · 侧栏笔名徽标: ${probe?.aliasBadges ?? "?"} 个 | 会话行: ${probe?.threadRows ?? "?"} 个`);
console.log(`  · 首屏文本: ${probe?.bodyText || "(空)"}`);
/* 可选：笔名链路（`--alias-e2e`）—— 检查桥是否接上 + 快照里有多少条笔名。
   ⛔ 老会话**本来就没有笔名**（只对新建会话分配，用户令「以后每次新建会话自动取笔名」）⇒
      徽标 0 个是**预期**，不是故障。这里只证明「桥通、快照可读」，分配逻辑另有守卫与实测。 */
if (process.argv.includes("--alias-e2e")) {
  const aliasProbe = await evaluate(`(async () => ({
    hasEnsure: typeof window.codex?.sessionAliasEnsure === 'function',
    hasSet: typeof window.codex?.sessionAliasSet === 'function',
    hasSnapshot: typeof window.codex?.sessionAliasSnapshot === 'function',
    count: Object.keys((await window.codex?.sessionAliasSnapshot?.()) ?? {}).length,
  }))()`);
  const bridged = aliasProbe?.hasEnsure && aliasProbe?.hasSet && aliasProbe?.hasSnapshot;
  console.log(`  · 笔名链路: ${bridged ? "✓ 三个通道都在" : "✗ 通道缺失"}`
    + ` | 已有笔名 ${aliasProbe?.count ?? "?"} 条（老会话不分配，0 属正常）`);
}
if (reactNoise.length) {
  console.log(`  · 报错明细:`);
  for (const line of [...new Set(reactNoise)].slice(0, 6)) console.log(`      ${line.slice(0, 220)}`);
}
console.log(fail.length ? `\n[运行时探针] FAIL — ${fail.join(" / ")}` : `\n[运行时探针] PASS`);

ws.close();
child.kill();
setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } process.exit(fail.length ? 1 : 0); }, 800);
