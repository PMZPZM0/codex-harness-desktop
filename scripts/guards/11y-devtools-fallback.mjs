/**
 * 开发工具「装不上 → 交给 Codex 自己装」的备用方案 · 守卫（10-08 立）
 *
 * 用户原话：「加一个开发工具备用方案，每个工具后面如果安装不上，可以预置一个提示词，提示用户，
 *   发 codex 自行安装就行，有的电脑网不好，容易下载报错」。
 *
 * 守三件事：
 *   ① 提示词**只在主进程生成**（渲染层只展示 + 复制）—— 否则又是「两处口径各自为政」，
 *      本项目 10-08 一天内已经栽过三次（【286】pip 元数据 /【241】python 判定 /【243】⑥ MinGW）。
 *   ② 「这个工具刚装失败了」的判据**两边同名**：产出侧写 `安装失败：`、消费侧读同一个前缀。
 *   ③ **真跑**全部工具的文案生成器（stub electron + require 编译产物）：每条都必须含
 *      「装到哪 / 装完请验证 / 网络兜底」，且 **不许出现按 marker 占位推导出来的不存在路径**
 *      （pip 包的 marker 是占位 —— 照它拼会得到 `tools\markitdown` 这种根本没那条路的东西）。
 *
 * ⛔ 本文件是独立守卫（不进 `_ctx.mjs` 的 MODULES），故**不计入 EXPECTED_CHECKS**，
 *   与 11* 系列同款；同时要加进 `package.json` 的 check 链，否则等于没写。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【devtools-fallback】${m}`); if (!c) fails++; };
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const rt = read("electron/features/runtime-ipc.ts");
const capability = read("src/features/app-state/parts/part02/04-runtime-commands-account/01-dev-runtimes-capability.tsx");
const page = read("src/features/settings-devtools/DevtoolsSettingsSection.tsx");
const css = read("src/styles/08-settings-engine-update.css");

/* ── ① 单一真相源：文案在主进程生成，随 runtime:list 下发 ──────────────── */
ok(/fallbackPrompt:\s*fallbackPromptFor\(id, spec\)/.test(rt),
  "提示词随 runtime:list 一起下发（fallbackPrompt 字段）—— 渲染层不许自己拼文案");
ok(/function fallbackPromptFor\(/.test(rt) && /fallbackSteps|FALLBACK_STEPS/.test(rt),
  "主进程里有每工具一段的「首选做法」表（单工具缺条目会走通用的一键脚本文案，不会留空）");
ok(/fallbackTargetDir\(/.test(rt) && /fallbackExpectLine\(/.test(rt),
  "「装到哪」与「装完怎么验证」各有独立函数（不许退化成一个 marker 拼接）");
// ⛔ pip 包的 marker 是占位 ⇒ 期望路径必须走 pythonSiteDir，不能拼 toolsRoot()/marker
ok(/if \(PIP_PACKAGE_DIRS\[id\]\)/.test(rt.slice(rt.indexOf("function fallbackExpectLine"), rt.indexOf("function fallbackPromptFor")))
  && /pythonSiteDir\(/.test(rt.slice(rt.indexOf("function fallbackExpectLine"), rt.indexOf("function fallbackPromptFor"))),
  "pip 包的「装完怎么验证」走 pythonSiteDir（照占位 marker 拼会得到不存在的 tools\\<pkg> —— 10-08 当天同类坑）");

/* ── ② 失败判据两边同名 ──────────────────────────────────────────────── */
ok(/安装失败：\$\{error\.message\}/.test(capability),
  "产出侧：安装失败时把 `安装失败：<原因>` 写进 runtimeProgress（备用方案按它决定出不出现）");
ok(/runtimeProgress\?\.\[runtime\.id\][^;]*startsWith\("安装失败"\)/.test(page),
  "消费侧：开发工具页按同一个前缀判断「这个工具刚装失败了」");
ok(/copyTextToClipboard\(runtime\.fallbackPrompt\)/.test(page) && /runtime-fallback/.test(page),
  "页面里有「复制提示词」按钮（复制的是主进程下发的原文）");
ok(/\.runtime-fallback\b/.test(css) && /\.runtime-fallback-copy\b/.test(css),
  "备用方案的样式类已定义（缺了按钮会退化成裸元素）");

/* ── ③ 真跑：全部工具的文案都要过结构检查 ─────────────────────────────── */
/* ⛔ 依赖 dist-electron（check 链先 build 再跑守卫）；缺产物 = 直接红，不静默跳过。
   ⛔ 必须显式 process.exit(0)：dev-runtimes 顶层注册了 tools 目录的递归 watchFs，
     进程不会自己退出，看起来像「无输出 + SIGTERM」（10-08 实测踩过）。 */
const PROBE = `
const Module = require("node:module");
const path = require("node:path");
const ROOT = ${JSON.stringify(ROOT)};
const USERDATA = path.join(process.env.APPDATA || "", "Codex Harness Desktop");
const electronStub = {
  app: { isPackaged: false, getAppPath: () => ROOT, getPath: () => USERDATA, getVersion: () => "0.0.0",
         isReady: () => true, on: () => {}, once: () => {}, removeListener: () => {} },
  shell: { openExternal: async () => {} },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
  BrowserWindow: class {},
};
const orig = Module._load;
Module._load = function (req) { if (req === "electron") return electronStub; return orig.apply(this, arguments); };
let out = { fatal: "" };
try {
  const dr = require(path.join(ROOT, "dist-electron", "features", "dev-runtimes.js"));
  const rt = require(path.join(ROOT, "dist-electron", "features", "runtime-ipc.js"));
  if (typeof rt.fallbackPromptFor !== "function") throw new Error("fallbackPromptFor 未导出");
  const ids = Object.keys(dr.devRuntimeSpecs);
  const bad = [];
  const samples = {};
  for (const id of ids) {
    const text = rt.fallbackPromptFor(id, dr.devRuntimeSpecs[id]);
    if (typeof text !== "string" || text.length < 60) { bad.push(id + ":文案过短"); continue; }
    if (!text.includes("装到哪")) bad.push(id + ":缺目标位置");
    if (!text.includes("装完请验证")) bad.push(id + ":缺验证行");
    if (!text.includes("网络兜底")) bad.push(id + ":缺网络兜底");
    if (!text.includes("首选做法")) bad.push(id + ":缺首选做法");
    // pip 包不许出现「按占位 marker 推导」的不存在路径
    const m = /装完请验证：([^\\n]*)/.exec(text);
    if (m && /tools.[\\\\/](markitdown|laya|phone-harness)\\b/.test(m[1])) bad.push(id + ":验证路径是 marker 占位推导出来的");
    samples[id] = text;
  }
  out = { total: ids.length, bad, mingw: samples.mingw || "", markitdown: samples.markitdown || "" };
} catch (error) {
  out = { fatal: String((error && error.message) || error).slice(0, 240) };
}
console.log("DATA " + JSON.stringify(out));
process.exit(0);
`;
let raw = "";
try {
  raw = execFileSync(process.execPath, ["--input-type=commonjs", "-e", PROBE], {
    cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  raw = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  if (!raw) console.log(`     探针没输出：${String(error?.message ?? error).slice(0, 200)}`);
}
const line = raw.split("\n").find((l) => l.trim().startsWith("DATA "));
let data = null;
if (line) { try { data = JSON.parse(line.trim().slice(5)); } catch { data = null; } }

ok(Boolean(data) && !data?.fatal, `真跑文案生成器拿到结果（${data?.fatal || "ok"}）`);
ok((data?.total ?? 0) >= 25, `真跑覆盖全部开发工具（${data?.total ?? 0} 项）`);
ok((data?.bad?.length ?? 1) === 0,
  `真跑：每条文案都有「用途 / 装到哪 / 首选做法 / 网络兜底 / 装完请验证」（问题：${(data?.bad ?? []).slice(0, 4).join("；") || "无"}）`);
ok(/装到哪：.*mingw\b/.test(data?.mingw ?? "") && /g\+\+\.exe/.test(data?.mingw ?? ""),
  "真跑：MinGW 的文案给出 tools\\mingw 与 g++.exe --version（路径与判定同源）");
ok(/site-packages/.test(data?.markitdown ?? ""),
  "真跑：markitdown 的验证行指向 python 的 site-packages 包目录（不是被占位 marker 拼出来的假路径）");

console.log(`\n【devtools-fallback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
