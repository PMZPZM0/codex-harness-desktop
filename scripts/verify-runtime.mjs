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
/* ⛔ 不复用就每次都是"全新首启"：要建 codex-home、扫 rollout、首次渲染更慢 ——
   实测会超过 60s 等不到页面（假 FAIL）。⇒ 只清**单实例锁**与缓存，其余保留（热 profile）。 */
fs.mkdirSync(profile, { recursive: true });
for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
  try { fs.rmSync(path.join(profile, name), { force: true }); } catch { /* 不存在就算了 */ }
}

const env = { ...process.env, CODEX_HARNESS_DEBUG_PORT: String(port) };
for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]) delete env[key];
/* ⛔⛔ 11-01 实测踩到的坑：`--user-data-dir` **改不了** `app.getPath("userData")` ——
   本应用在 main.ts 里显式 `app.setPath("userData", resolveStartupUserData())`，
   只认 `CODEX_HARNESS_USER_DATA` 环境变量 ⇒ 之前所有"隔离实例"其实都在读写**用户的真实数据目录**。
   普通探针只读，问题不大；但 `--alias-e2e` 会给会话**改名**，那会改到用户头上。
   ⇒ 显式传这个环境变量，隔离才是真的。 */
env.CODEX_HARNESS_USER_DATA = profile;

const child = spawn(electronPath, [".", `--user-data-dir=${profile}`], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
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
  /* ⛔ 全新 profile 首启会停在登录页（没有 .app-shell）——那也算"界面渲染成功"，
     否则每次第一跑都是假 FAIL。有 profile 的前提下才要求是主壳。 */
  shell: Boolean(document.querySelector('.app-shell')) || /开始使用|暂时不登录/.test(document.body.innerText || ''),
  rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  /* ⛔ 11-01：会话名徽标已撤（名字本身就是标题），改看「有没有还在显示『未命名任务』的行」
     —— 那正是用户截图里"侧栏没同步名字"的可见症状。 */
  untitledRows: Array.from(document.querySelectorAll('.thread-row-name')).filter((el) => /未命名任务/.test(el.textContent || '')).length,
  namedRows: Array.from(document.querySelectorAll('.thread-row-name')).map((el) => (el.textContent || '').trim()).filter(Boolean).slice(0, 4),
  threadRows: document.querySelectorAll('[data-thread-row], .thread-row').length,
  bodyText: (document.body.innerText || '').slice(0, 160).replace(/\\n+/g, ' | '),
}))()`);

const reactNoise = [...errors, ...consoleErrors].filter((line) => /React|Minified React error|#\d{3}\b|TypeError|ReferenceError|RangeError|is not a function|is not defined|Cannot read|undefined is not/i.test(line));const fail = [];
if (probe?.boundary) fail.push("ErrorBoundary 遮罩出现（界面已经崩了）");
if (reactNoise.length) fail.push(`运行时报错 ${reactNoise.length} 条`);
if (!probe?.shell && (probe?.rootChildren ?? 0) === 0) fail.push("#root 空（主界面没渲染）");

console.log(`\n[运行时探针] 端口 ${port} / 等待 ${settleMs}ms`);
console.log(`  · ErrorBoundary: ${probe?.boundary ? "✗ 出现" : "✓ 无"}`);
console.log(`  · .app-shell: ${probe?.shell ? "✓" : "✗"} | #root 子节点: ${probe?.rootChildren ?? "?"}`);
console.log(`  · 会话行: ${probe?.threadRows ?? "?"} 个 | 未命名行: ${probe?.untitledRows ?? "?"} 个（应为 0） | 名字样本: ${(probe?.namedRows ?? []).join(" / ") || "(无)"}`);
console.log(`  · 首屏文本: ${probe?.bodyText || "(空)"}`);
/* 可选：会话名联动 e2e（`--alias-e2e`）——
   ⛔ 验的是**用户点名的那个现象**：改一个名字，侧栏和顶栏要同时变（原来是「顶栏暗匣 / 侧栏未命名任务」）。
   只在探针自己的临时 profile 里改名，不碰真实数据；没有会话行时跳过（全新 profile 首启确实一条都没有）。 */
if (process.argv.includes("--alias-e2e")) {
  const aliasProbe = await evaluate(`(async () => {
    const pick = () => document.querySelector('[data-thread-id]');
    const threadId = pick()?.getAttribute('data-thread-id') || '';
    const count = Object.keys((await window.codex?.sessionAliasSnapshot?.()) ?? {}).length;
    if (!threadId) return { count, skipped: '没有会话行' };
    const sidebarOf = () => document.querySelector('[data-thread-id="' + threadId + '"] .thread-row-name')?.textContent || '';
    const topbarOf = () => document.querySelector('.task-title strong')?.textContent || '';
    const before = { sidebar: sidebarOf(), topbar: topbarOf() };
    const probeName = '联动' + String(Date.now() % 10000);\n    const set = await window.codex.sessionAliasSet({ threadId, alias: probeName, allowDuplicate: true });
    await new Promise((r) => setTimeout(r, 1200));
    const after = { sidebar: sidebarOf(), topbar: topbarOf() };\n    return { count, before, after, probeName, ok: Boolean(set?.ok) };
  })()`);
  const state = aliasProbe?.skipped ? `— 跳过（${aliasProbe.skipped}）` : aliasProbe?.ok ? "✓ 改名成功" : "✗ 改名失败";
  console.log(`  · 会话名联动: ${state}`
    + ` | 侧栏 ${aliasProbe?.before?.sidebar ?? "?"} → ${aliasProbe?.after?.sidebar ?? "?"}`
    + ` | 顶栏 ${aliasProbe?.before?.topbar ?? "?"} → ${aliasProbe?.after?.topbar ?? "?"}`
    + ` | 快照 ${aliasProbe?.count ?? "?"} 条`);
  const probeName = aliasProbe?.probeName ?? "";
  if (aliasProbe && !aliasProbe.skipped && (aliasProbe.after?.sidebar !== probeName || aliasProbe.after?.topbar !== probeName
    || aliasProbe.before?.sidebar === probeName)) {
    fail.push("改名没有同时反映到侧栏与顶栏");
  }
}
/* 可选：播报面板 e2e（`--broadcast-e2e`）——
   11-01 用户三条反馈：① 短群事件「标题+正文」重复同一句；② 每条要能单独删除；③ 开合不重播逐字。
   这里能验 ①②（③ 是动画观感，靠"只播一次"的标记断言 + 肉眼）。 */
if (process.argv.includes("--broadcast-e2e")) {
  const bc = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pod = () => document.querySelector('.bc-pod');
    if (!pod()) return { skipped: '没有播报按钮' };
    const items = () => Array.from(document.querySelectorAll('.bc-item'));
    const openPanel = async () => {
      if (!document.querySelector('.bc-panel')) pod().click();
      await sleep(600);
    };
    const closePanel = async () => {
      if (document.querySelector('.bc-panel')) pod().click();
      await sleep(200);
    };
    /* ⛔ 不靠"碰巧有群事件历史"：直接走对外推播口（harness:broadcast）塞两条，
       这样面板渲染 / 逐字 / 单条删除三条路径每次都能被真跑一遍。 */
    await closePanel();
    /* 推 6 条：既要验删除，也要验「最多露 4 条、多的走滚轮」（11-01 用户令） */
    for (let i = 1; i <= 6; i += 1) {
      window.dispatchEvent(new CustomEvent('harness:broadcast', { detail: { kind: 'group', title: '探针播报' + i, text: '这是用于验证面板渲染、滚动上限与单条删除的正文。' } }));
    }
    await sleep(300);
    await openPanel();
    if (!items().length) return { skipped: '推播后面板仍为空' };
    const before = items().length;
    /* 同一条里标题与正文是否说同一句话（重复展示的判据） */
    const dupes = items().filter((row) => {
      const title = (row.querySelector('.bc-item-title')?.textContent || '').trim();
      const body = (row.querySelector('.bc-item-text')?.textContent || '').trim();
      return Boolean(title && body && (title === body || (body.length <= title.length + 8 && title.startsWith(body.slice(0, 12)))));
    }).length;
    const del = document.querySelector('.bc-item-del');
    if (del) del.click();
    await sleep(400);
    /* 「最多露 4 条」的判据：列表被钳高且有溢出（scrollHeight > clientHeight） */
    const list = document.querySelector('.bc-panel-list');
    const listH = Math.round(list?.clientHeight || 0);
    const overflow = Boolean(list && list.scrollHeight > list.clientHeight + 4);
    return { before, after: items().length, dupes, hasDel: Boolean(del), listH, overflow };
  })()`);
  const st = bc?.skipped ? `— 跳过（${bc.skipped}）` : `✓ 面板 ${bc?.before ?? "?"} 条`;
  console.log(`  · 播报面板: ${st} | 单条删除 ${bc?.hasDel ? `✓ ${bc?.before} → ${bc?.after}` : "✗ 没有删除按钮"}`
    + ` | 标题/正文重复 ${bc?.dupes ?? "?"} 条（应为 0）`
    + ` | 列表高 ${bc?.listH ?? "?"}px 可滚 ${bc?.overflow ? "✓" : "✗"}`);
  if (bc && !bc.skipped) {
    if (!bc.hasDel) fail.push("播报面板没有单条删除按钮");
    else if (bc.after !== bc.before - 1) fail.push("点删除后条数没变（删除没生效）");
    if (bc.dupes > 0) fail.push(`播报面板有 ${bc.dupes} 条标题与正文同文（重复展示）`);
    if (!bc.overflow) fail.push("播报列表没有限高（超过 4 条仍继续变高 ⇒ 会铺满屏幕）");
    if (bc.listH > 380) fail.push(`播报列表高 ${bc.listH}px 超过 4 行上限`);
  }
}
if (reactNoise.length) {
  console.log(`  · 报错明细:`);
  for (const line of [...new Set(reactNoise)].slice(0, 6)) console.log(`      ${line.slice(0, 220)}`);
}
console.log(fail.length ? `\n[运行时探针] FAIL — ${fail.join(" / ")}` : `\n[运行时探针] PASS`);

ws.close();
child.kill();
setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } process.exit(fail.length ? 1 : 0); }, 800);
