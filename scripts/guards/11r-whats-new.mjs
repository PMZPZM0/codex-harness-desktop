/**
 * whats-new 域 · 守卫（2026-10-06 立）
 *
 * 守的是用户那条需求的**可执行部分**：
 *   ① 「更新后首次启动弹一次，看过不再弹」——判定必须在**主进程**且只有一处；
 *   ② 「展示本版的要点」——每次发版**必须**给当前版本写一条要点，否则用户更新后啥也看不到（静默）；
 *   ③ 全新安装不该弹（新用户看到"更新内容"会莫名其妙）。
 *
 * ⛔ 为什么要点数据要**真跑**（子进程 import 那个 TS）而不是 grep：
 *   "条目在不在"是**数据**不是字符串 —— grep 一条 `version: "0.0.32"` 只能证明文件里出现过这串字，
 *   证明不了 `whatsNewEntryOf(当前版本)` 真能取到（比如写在了注释里、或版本号写成了 0.0.32-b）。
 *   本域已经踩过同型的坑（`11d` 的 TRUTH 存的其实是内容矩形自身，判据永远绿）。
 *
 * ⛔⛔ 本文件的 BODY 是**模板串**：里面**不许出现反引号**（会提前结束字符串，
 *   症状是莫名其妙的 "xxx is not defined"）。要提"反引号"三个字就写中文，别写那个符号。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【whatsnew】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/* ⛔ 负向结构断言必须**先剥注释**再匹配：本域的头注里恰好就在讲
   「不要把看过没看过记在 localStorage」—— 直接 `!/localStorage/` 会被自己的注释打成假红
   （本项目已两次同型：check-bag-types 的 bag.Xxx()、以及 09-25 那次）。口径与 _ctx 的 codeOnly 同源。 */
const codeOnly = (source) => String(source)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");
const pkg = JSON.parse(read("package.json"));
const VERSION = String(pkg.version);

/* ── ① 要点数据：真跑（当前版本必须有条目）────────────────────────────── */
const BODY = `
import { WHATS_NEW_ENTRIES, whatsNewEntryOf } from "./electron/whats-new-notes.ts";
const version = ${JSON.stringify(VERSION)};
const entry = whatsNewEntryOf(version);
const bad = [];
for (const e of WHATS_NEW_ENTRIES) {
  if (!/^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?$/.test(String(e.version))) bad.push("版本号形态非法:" + e.version);
  if (!Array.isArray(e.items) || e.items.length < 1) bad.push("没有要点:" + e.version);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(e.date))) bad.push("日期形态非法:" + e.version);
  for (const it of e.items) {
    if (!String(it.t ?? "").trim()) bad.push("空标题:" + e.version);
    if (String(it.t ?? "").length > 40) bad.push("标题过长:" + e.version + " " + String(it.t).length + "字");
    if (it.d != null && String(it.d).length > 240) bad.push("细节过长:" + e.version);
  }
}
const dup = WHATS_NEW_ENTRIES.map((e) => e.version).filter((v, i, a) => a.indexOf(v) !== i);
console.log("DATA " + JSON.stringify({
  total: WHATS_NEW_ENTRIES.length,
  hasCurrent: Boolean(entry),
  items: entry ? entry.items.length : 0,
  bad,
  dup,
}));
`;
let data = null;
let raw = "";
try {
  raw = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      /* ⛔ --import 必须给 file:// URL：绝对 Windows 路径会被 ESM 加载器拒（实测踩过） */
      "--import", pathToFileURL(join(ROOT, "scripts", "guards", "_ts-register.mjs")).href,
      "--input-type=module", "-e", BODY,
    ],
    /* ⛔ stdio 必须显式给（本机沙箱里默认 stdio 会 spawnSync EBUSY） */
    { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  raw = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  if (!raw) console.log(`     子进程没输出：${String(error?.message ?? error).slice(0, 200)}`);
}
raw = raw.replace(/^.*MODULE_TYPELESS.*$|^.*Reparsing.*$|^.*To eliminate.*$|^.*trace-warnings.*$/gm, "");
const line = raw.split("\n").find((l) => l.trim().startsWith("DATA "));
if (line) { try { data = JSON.parse(line.trim().slice(5)); } catch { data = null; } }

ok(Boolean(data), "子进程真跑出要点数据（⛔ 没解析到 = 脚本没跑起来，别当成通过）");
ok(Boolean(data?.hasCurrent), `当前版本 ${VERSION} 有要点条目（缺了 = 用户更新后看不到任何介绍，发版即红）`);
ok((data?.items ?? 0) >= 3 && (data?.items ?? 0) <= 8, `当前版本要点条数 ${data?.items ?? 0} 在 3~8 之间（太少没信息量 / 太多没人看）`);
ok((data?.bad?.length ?? 1) === 0, `所有条目字段合法（${(data?.bad ?? []).slice(0, 3).join("；") || "无问题"}）`);
ok((data?.dup?.length ?? 1) === 0, `没有重复版本号（${(data?.dup ?? []).join(",") || "无"}）`);

/* ── ② 判定链在主进程，且只有一处 ─────────────────────────────────────── */
const ipc = read("electron/features/whats-new-ipc.ts");
ok(ipc.includes('ipcHost.handle("whatsnew:state"') && ipc.includes('ipcHost.handle("whatsnew:ack"'),
  "两个通道都在本域注册（state 取要点与判定 / ack 记已看过）");
/* ⛔ 判据打**取值**：ack 必须拿"主进程的当前版本"跟入参比 —— 锚 `!== current` 这个比较本身，
   别锚某个变量名（改名就假红）。 */
ok(/!== current/.test(ipc) && /version_mismatch/.test(ipc),
  "ack 只接受「当前版本」（渲染层传别的值一律拒 ⇒ 记录不会被伪造）");
ok(/fresh_install/.test(ipc) && /hadPriorState/.test(ipc),
  "全新安装不弹（新用户看不到「更新内容」），老用户才弹");
/* ⛔ 时机纪律：判定"以前跑过没有"的快照必须取在 ready（早于创建窗口）——
   在 handler 里现场读会偶发把老用户判成全新安装（boot-timing.json 那一刻可能还没写）。
   ⛔ 负向判据用**顶格**（不允许缩进）匹配：模块顶层的 `app.getPath("userData")` 才是被禁的那种；
     函数体内的缩进调用是本域的正常写法。 */
ok(/app\.once\("ready"/.test(codeOnly(ipc)) && !/^(?:const|let|var)\s+\w+\s*=\s*app\.getPath\("userData"\)/m.test(codeOnly(ipc)),
  "「以前跑过没有」在 ready 时刻抓快照（⛔ 不在模块顶层读 userData，守卫【91】也盯这条）");
ok(/whats-new\.json/.test(ipc) && /lastSeenVersion/.test(ipc),
  "「看过没有」持久化在 userData/whats-new.json（⛔ 不放 localStorage：popout 多窗口各一份会重复弹）");

/* ── ③ 渲染层：只画不判 ───────────────────────────────────────────────── */
const dialog = read("src/features/whats-new/WhatsNewDialog.tsx");
const appView = read("src/features/app-view/AppView.tsx");
ok(/shouldShow/.test(codeOnly(dialog)) && !/localStorage/.test(codeOnly(dialog)),
  "渲染层按主进程给的 shouldShow 画，自己不判版本（也不碰 localStorage）");
/* ⛔ 判据打**全部关闭路径**：按钮 / ✕ / ESC / 点遮罩都走同一个 close()，
   而 close() 里必须回报 ack —— 漏一条就变成"关掉后下次还弹"。 */
ok(/const close = useCallback/.test(dialog) && /whatsNewAck/.test(dialog)
  && (dialog.match(/onClick=\{close\}|onKey === "Escape"\) close\(\)/g)?.length ?? 0) >= 2,
  "所有关闭路径（✕ / 知道了 / ESC / 遮罩）都走同一个 close()，且 close() 里回报 ack");
ok(/<WhatsNewDialog \/>/.test(appView) && /from "\.\.\/whats-new"/.test(appView),
  "AppView 无条件挂载弹窗（该不该弹由主进程定 ⇒ 这里不判版本）");

/* ── ④ 域已登记进 IPC 账本 ───────────────────────────────────────────── */
const reg = read("electron/ipc-registry.ts");
ok(/prefix: "whatsnew", count: 3/.test(reg) && /whatsnew:state/.test(reg) && /whatsnew:ack/.test(reg) && /whatsnew:history/.test(reg),
  "域 whatsnew 已登记进 ipc-registry（count=3：state / ack / history —— history 10-07 随新手引导「版本更新日志」页接入）");

/* ── ④b clientInfo 版本不许硬编码（10-09 改；0.0.16 事故：只改了 package.json，
      clientInfo 还停在 0.0.15 —— 引擎侧拿到的是旧版本号，排查时极难对上）────────
   ⛔ 判据取**代码**（过 codeOnly）：本文件头注与下面这段注释里都有版本字面量，
      不剥注释会被自己的注释打成假红。 */
const srvCode = codeOnly(read("electron/codex-server.ts"));
ok(/from "electron"/.test(srvCode) && /version: app\.getVersion\(\)/.test(srvCode),
  "引擎 initialize 的 clientInfo.version 取 app.getVersion()（⛔ 不许回到硬编码字面量）");
ok(!/version:\s*"\d+\.\d+\.\d+/.test(srvCode),
  "codex-server.ts 代码里没有版本字面量（发版只改 package.json 一处 ⇒ 不会漂）");
ok(!/tray\.ts[\s\S]*version:\s*"\d+\.\d+\.\d+/.test(codeOnly(read("electron/tray.ts"))),
  "托盘提示同样走 app.getVersion()（同口径，别留第二处版本真相源）");

/* ── ⑤ 判定状态机：**真跑**编译产物（stub electron + 真 userData 目录）─────────
   ⛔ 为什么不能只靠上面那些静态判据：那几条只能证明"函数在、分支写了"，
     证明不了"升级会弹、全新安装不弹、看过之后真不弹"—— 而这三条正是用户需求本身。
     本仓已经有同型的教训：契约两边出自同一份想象 ⇒ 56/56 全绿但功能是坏的。
   ⛔ 依赖 `dist-electron/`（check 链在跑守卫之前先 build）；缺产物 = 直接红，不静默跳过。
   子进程用 commonjs：探针要 require 编译产物 + 劫持 node:module（ESM 下做不了）。 */
const PROBE = `
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const FEATURE = path.join(process.cwd(), "dist-electron", "features", "whats-new-ipc.js");
const VERSION = require(path.join(process.cwd(), "package.json")).version;
if (!fs.existsSync(FEATURE)) { console.log("DATA " + JSON.stringify({ fatal: "缺少 dist-electron 产物（先 npm run build）" })); process.exit(0); }

let userData = "";
let readyFired = false;
const readyCbs = [];
const electronStub = {
  app: {
    getVersion: () => VERSION,
    getPath: (n) => (n === "userData" ? userData : os.tmpdir()),
    isReady: () => readyFired,
    once: (ev, cb) => { if (ev === "ready") readyCbs.push(cb); },
    removeListener: () => {},
  },
  shell: {},
};
const origLoad = Module._load;
Module._load = function (request) { if (request === "electron") return electronStub; return origLoad.apply(this, arguments); };

const boot = () => {
  delete require.cache[require.resolve(FEATURE)];
  const handlers = {};
  require(FEATURE).whatsNewFeature.apply({
    get: (n) => (n === "ipc" ? { handle: (c, f) => { handlers[c] = f; }, removeHandler: () => {} } : undefined),
    effect: () => {},
  }, null);
  return handlers;
};
const dir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "whatsnew-"));
  for (const k of Object.keys(files || {})) fs.writeFileSync(path.join(d, k), files[k]);
  return d;
};
const R = {};
(async () => {
  /* ① 全新安装（userData 空）⇒ 不弹，但要记下本次启动版本 */
  userData = dir(); readyFired = false; readyCbs.length = 0;
  let h = boot(); readyFired = true; readyCbs.forEach((cb) => cb());
  let st = await h["whatsnew:state"]();
  R.freshNoShow = st.shouldShow === false && st.reason === "fresh_install";
  R.hasItems = Boolean(st.entry && st.entry.items && st.entry.items.length >= 3);
  R.recordedLaunch = fs.readFileSync(path.join(userData, "whats-new.json"), "utf8").includes(VERSION);
  R.releaseUrl = String(st.releaseUrl).includes("/releases/tag/v" + VERSION);

  /* ② 老用户升级（有本应用状态文件）⇒ 弹 */
  userData = dir({ "boot-timing.json": "[]", "app-settings.json": "{}" });
  readyFired = true; readyCbs.length = 0;
  h = boot();
  st = await h["whatsnew:state"]();
  R.upgradeShows = st.shouldShow === true && st.reason === "upgrade";

  /* ③ 伪造版本号被拒 + 看过之后不再弹 */
  const forged = await h["whatsnew:ack"]({}, "0.0.30");
  R.forgedRejected = forged.ok === false && forged.error === "version_mismatch";
  await h["whatsnew:ack"]({}, VERSION);
  st = await h["whatsnew:state"]();
  R.ackedNoRepeat = st.shouldShow === false && st.reason === "already_seen";

  /* ④ 只有"上次启动版本"记录（无状态文件）⇒ 也算升级 */
  userData = dir({ "whats-new.json": JSON.stringify({ lastLaunchedVersion: "0.0.31" }) });
  readyFired = true; readyCbs.length = 0;
  h = boot();
  st = await h["whatsnew:state"]();
  R.prevRecordUpgrade = st.shouldShow === true && st.reason === "upgrade";
  console.log("DATA " + JSON.stringify(R));
})();
`;
let probeRaw = "";
let probe = null;
try {
  probeRaw = execFileSync(process.execPath, ["--input-type=commonjs", "-e", PROBE], {
    cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  probeRaw = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  if (!probeRaw) console.log(`     探针没输出：${String(error?.message ?? error).slice(0, 200)}`);
}
const probeLine = probeRaw.split("\n").find((l) => l.trim().startsWith("DATA "));
if (probeLine) { try { probe = JSON.parse(probeLine.trim().slice(5)); } catch { probe = null; } }

ok(Boolean(probe) && !probe?.fatal, `真跑判定状态机拿到结果（${probe?.fatal ?? "ok"}）`);
ok(probe?.freshNoShow === true, "真跑：全新安装不弹（新用户看不到「更新内容」）");
ok(probe?.hasItems === true && probe?.releaseUrl === true, "真跑：要点条数与「查看完整说明」链接都拿得到");
ok(probe?.recordedLaunch === true, "真跑：即使不弹也记下本次启动版本（下次升级才判得出来）");
ok(probe?.upgradeShows === true, "真跑：老用户升级**要弹**");
ok(probe?.forgedRejected === true, "真跑：伪造/过期版本号的 ack 被拒");
ok(probe?.ackedNoRepeat === true, "真跑：看过之后不再弹（already_seen）");
ok(probe?.prevRecordUpgrade === true, "真跑：只有上次启动记录时也判为升级");

console.log(`\n【whatsnew】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
