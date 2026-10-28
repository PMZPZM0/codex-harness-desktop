/**
 * check-app-dist.mjs —— 收尾第四步的工具：确认**跑起来的应用加载的是刚构建的 dist**。
 *
 * 为什么需要它：`npm run build` 成功 ≠ 应用加载了那份产物。用户实例可能：
 *   · 起的是旧进程（改完没重启）⇒ 看到的是上一版界面；
 *   · 装着安装版、读 asar 里的旧 dist ⇒ 仓库 dist 再新也没用；
 *   · 白屏（懒加载 chunk 被裁）⇒ 窗口在、内容是空的。
 * 只看「窗口标题出现了」会把这些全判成通过（10-29 记忆里的「守卫自洽地错」同型）。
 *
 * 判据（三条都要过）：
 *   ① 页面地址落在**本仓** dist/index.html 上；
 *   ② 渲染层真的画出来了（body 文本量 + 可见控件数 > 0，不是白屏）；
 *   ③ 页面**实际加载**的 /assets/*.js 每一个都在磁盘 dist 里存在，且 dist/index.html 的
 *      引用与磁盘一致 —— 加载的确实是这一份产物，不是缓存里的旧 chunk。
 *
 * 用法：
 *   node scripts/check-app-dist.mjs --port 9333 --dir "D:/Codex Assistant" --tag cloud
 *   node scripts/check-app-dist.mjs --port 9334 --dir "D:/PPcode" --tag pp --shot
 *
 * ⛔ 依赖主进程的 `CODEX_HARNESS_DEBUG_PORT`（启动前设成同一个端口）。
 * ⛔ 不要用 fetch 取 /json：本机 HTTP_PROXY 会把 127.0.0.1 也代理掉（实测 fetch failed）。
 * ⛔ 检查必须和「启动应用」在**同一次调用里**完成：GUI 进程会被会话 job 回收（10-29 实测）。
 */
import http from "node:http";
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const WebSocket = createRequire(import.meta.url)("ws");

const argv = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const port = Number(arg("port", "9333"));
const appDir = resolve(arg("dir", process.cwd()));
const tag = arg("tag", "app");

const out = (key, value) => console.log(`[${tag}] ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`[${tag}] ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

/* ── 磁盘侧：dist/index.html 里引用的 entry + assets 文件名清单 ── */
const indexPath = join(appDir, "dist", "index.html");
if (!existsSync(indexPath)) {
  out("FAIL", `没有 ${indexPath}（先跑 npm run build）`);
  process.exit(1);
}
const indexHtml = readFileSync(indexPath, "utf8");
const indexMtime = statSync(indexPath).mtime;
const assetsDir = join(appDir, "dist", "assets");
const diskAssets = new Set(existsSync(assetsDir) ? readdirSync(assetsDir) : []);
const entryRefs = [...indexHtml.matchAll(/(?:src|href)="[^"]*?\/assets\/([^"]+)"/g)].map((m) => m[1]);
out("dist", { index: indexPath, indexMtime: indexMtime.toISOString(), assetsOnDisk: diskAssets.size, entryRefs });
check(entryRefs.length > 0, "dist/index.html 引用了构建产物", `${entryRefs.length} 个`);
check(entryRefs.every((name) => diskAssets.has(name)), "index.html 引用的文件都在 dist/assets 里",
  entryRefs.filter((name) => !diskAssets.has(name)).join(",") || "全部命中");

/* ── CDP 侧 ── */
const getJson = (path) =>
  new Promise((resolveP, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, timeout: 8000 }, (res) => {
      let buf = "";
      res.on("data", (c) => { buf += c; });
      res.on("end", () => { try { resolveP(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("CDP timeout")); });
  });

let pages;
try {
  pages = (await getJson("/json/list")).filter((t) => t.type === "page");
} catch (e) {
  out("FAIL", `连不上 CDP :${port}（应用没起来？）— ${e.message}`);
  process.exit(1);
}
if (!pages.length) {
  out("FAIL", "CDP 里没有页面（窗口没渲染出来）");
  process.exit(1);
}
out("page", { title: pages[0].title, url: pages[0].url });
/* Windows 路径不区分大小写：两边都 toLowerCase 再比（否则 D:/ppcode 与 D:/PPcode 会误判） */
const liveUrl = decodeURIComponent(String(pages[0].url)).toLowerCase();
const expectedPrefix = appDir.replace(/\\/g, "/").toLowerCase();
check(liveUrl.startsWith("file://") && liveUrl.includes(expectedPrefix),
  "页面地址落在**本仓** dist 上", decodeURIComponent(String(pages[0].url)).slice(0, 90));

const ws = new WebSocket(pages[0].webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0;
const waiting = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await send("Runtime.enable");
const probe = await send("Runtime.evaluate", {
  expression: `(function(){
    /* ⛔ 别用 performance.getEntriesByType("resource")：Electron 走 file:// 时不记录资源条目
       （10-29 实测返回空数组 ⇒ 判据永远失败）。改看 DOM 里真正注入的 script/link。 */
    const refs = [...document.querySelectorAll("script[src], link[href]")]
      .map((el) => el.getAttribute("src") || el.getAttribute("href"))
      .filter((v) => v && /\\/assets\\/.+\\.(js|css)$/.test(v))
      .map((v) => decodeURIComponent(v.split("/").pop()));
    const text = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim();
    const controls = [...document.querySelectorAll("button, input, textarea, a[href]")].filter((el) => el.offsetParent !== null).length;
    return { title: document.title, theme: document.documentElement.dataset.theme || null,
      bodyLen: text.length, textHead: text.slice(0, 80), controls,
      loadedAssets: [...new Set(refs)] };
  })()`,
  returnByValue: true,
});
const dom = probe.result?.result?.value ?? {};
out("dom", { title: dom.title, theme: dom.theme, bodyLen: dom.bodyLen, controls: dom.controls, textHead: dom.textHead });
check((dom.bodyLen ?? 0) > 0 && (dom.controls ?? 0) > 0, "渲染层真的画出来了（不是白屏）",
  `正文 ${dom.bodyLen} 字 / 可见控件 ${dom.controls} 个`);

const loaded = Array.isArray(dom.loadedAssets) ? dom.loadedAssets : [];
out("loadedAssets", loaded);
const missing = loaded.filter((name) => diskAssets.size > 0 && !diskAssets.has(name) && /\.js$/.test(name));
check(loaded.length > 0, "页面报告了自己加载的 assets", `${loaded.length} 个`);
check(missing.length === 0, "页面加载的 assets 全部存在于磁盘 dist（不是旧缓存 chunk）",
  missing.length ? `磁盘上没有: ${missing.join(",")}` : "全部命中");

/* entry 名带内容 hash：磁盘 index.html 引用 index-XXXX.js，页面里也必须跑同一个 —— 
   旧的 index-YYYY.js 只可能来自上一次构建（改完没重启 / 装的是旧 asar）。 */
const diskEntry = entryRefs.find((name) => /^index-.*\.js$/.test(name)) || "";
const liveEntry = loaded.find((name) => /^index-.*\.js$/.test(name)) || "";
check(Boolean(diskEntry) && diskEntry === liveEntry, "页面跑的 entry 就是本次构建的 entry",
  `磁盘 ${diskEntry || "(无)"} ↔ 运行 ${liveEntry || "(无)"}`);

if (flag("shot")) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot.result?.data) {
    const dir = join(process.cwd(), ".e2e-artifacts", "shots");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `check-${tag}.png`);
    writeFileSync(path, Buffer.from(shot.result.data, "base64"));
    out("SHOT", path);
  }
}

ws.close();
console.log(`[${tag}] ${failed === 0 ? "PASS" : `FAIL(${failed})`} — dist 已刷新且应用加载的就是它`);
process.exit(failed === 0 ? 0 : 1);
