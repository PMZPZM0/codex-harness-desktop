/**
 * 12ag-dev-port —— 本机测试端口自动打开右栏浏览器（10-29 用户令，对照 Qoder）。
 *
 * 链路四道，断任何一道 = 用户「起了 dev server 右栏却没反应」：
 *   ① 纯函数真值表（本地 URL 提取 / 0.0.0.0 归一 / 去重 / 只认带端口）；
 *   ② 桥只认「当前会话正在跑的回合」（turn/started..ended 门 + 每个URL只开一次）；
 *   ③ AppView 挂载（不在 popout 窗口挂）；
 *   ④ 验收在位（accept.mjs 的 dev-port 项）。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【dev-port】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

/* ── ① 纯函数真值表（真跑）──────────────────────────────────────────── */
try {
  const mod = await import(pathToFileURL(join(ROOT, "src/features/dev-port/dev-port.mjs")).href);
  ok(mod.pickDevServerUrl("VITE v5.0.0  ready in 320 ms\n\n  ➜  Local:   http://localhost:5173/\n", new Set()) === "http://localhost:5173/",
    "vite 风格输出能提取 Local URL");
  ok(mod.normalizeDevUrl("http://0.0.0.0:8000/api") === "http://127.0.0.1:8000/api",
    "0.0.0.0 归一到 127.0.0.1（浏览器里 0.0.0.0 打不开）");
  ok(mod.pickDevServerUrl("详见文档 http://localhost/docs 或 http://localhost:3000/x", new Set()) === "http://localhost:3000/x"
    && mod.pickDevServerUrl("裸的 http://localhost/ 不是本机服务", new Set()) === "",
    "只认带端口的本机地址（裸 localhost 是文档链接，不算服务）");
  const seen = new Set();
  seen.add(mod.pickDevServerUrl("http://127.0.0.1:4173/a", seen));
  ok(mod.pickDevServerUrl("http://127.0.0.1:4173/a 又打印一遍", seen) === ""
    && mod.pickDevServerUrl("本地: http://localhost:5173/ 就绪", new Set()) === "http://localhost:5173/",
    "同一 URL 只报一次（seen 去重）；紧跟 URL 的中文不被吞进路径");
  ok(mod.normalizeDevUrl("http://127.0.0.1:4173/preview).") === "http://127.0.0.1:4173/preview",
    "剥掉输出里跟在 URL 后面的右括号/句号");
} catch (e) {
  ok(false, `dev-port.mjs 真值表执行失败：${e && e.message ? e.message : e}`);
}

/* ── ② 桥结构 ──────────────────────────────────────────────────────────── */
const bridge = codeOnly(read("src/features/dev-port/DevPortBridge.tsx"));
ok(/window\.codex\.onEvent\(onCodex\)/.test(bridge) && /outputDelta/.test(bridge) && /commandExecution/.test(bridge),
  "数据源 = 命令执行的流式输出与 started/completed（⛔ 不读文件报告）");
ok(/turn\/started/.test(bridge) && /turn\\?\/\(completed\|aborted\|failed\|interrupted\)/.test(bridge) && /runningRef\.current = false/.test(bridge),
  "只认当前会话正在跑的回合（回合结束即关闸，历史输出/重播不触发）");
ok(/seenRef\.current\.add\(url\)/.test(bridge) && /seenRef\.current\.add\(url\);[\s\S]{0,200}actionsRef\.current\.open\(url\)/.test(bridge),
  "每个 URL 每个渲染会话只自动开一次（dev server 会反复打印同一地址）");
ok(/PANEL_MIN = 360/.test(bridge) && /PANEL_MAX = 560/.test(bridge) && /setPanelWidth\(target\)/.test(bridge),
  "右栏按 45% 加宽且钳在 360–560（沿用 html-preview 的口径）");

/* ── ③④ 挂载 + 验收在位 ─────────────────────────────────────────────── */
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
ok(/!popoutThreadId && <DevPortBridge app=\{app\} threadId=\{thread\?\.id \?\? ""\} \/>/.test(appView),
  "AppView 挂载（popout 窗口不挂，threadId 传当前会话）");
ok(/id: "dev-port"/.test(read("scripts/accept.mjs")),
  "验收项在位（accept.mjs 的 dev-port）");

console.log(`\n【dev-port】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
