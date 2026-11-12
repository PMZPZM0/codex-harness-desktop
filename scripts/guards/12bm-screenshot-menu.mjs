/**
 * 12bm-screenshot-menu —— 输入框「+」菜单里的截图按键（11-12 用户令）。
 *
 * 用户原话：「把设置里面的截图快捷键，和按键放这里面来一下」+「做成按键截图两张的」
 *          +「按键+快捷键提示，快捷键展示记得联动，万一修改了，也要联动展示」。
 *
 * 链路五道，断任何一道都会让用户看到「菜单里有截图但键帽是死的 / 改键后不更新」：
 *   ① 快捷键文案纯函数（同源 lib/hotkey，两处各写一份就会出两种写法）；
 *   ② 菜单里真有**两个**按键（全屏 / 框选），键帽读的是主进程设置；
 *   ③ 打开菜单取一次设置（进页面就准，不必等事件）；
 *   ④ 改键后**联动**：主进程广播 screenshot-settings-changed，渲染层订阅；
 *   ⑤ 点击走既有 screenshot:capture 通道（不新造第二套截图逻辑），先关菜单。
 *
 * ⛔ 独立守卫（不进 _ctx MODULES 计数），必须同时加进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【screenshot-menu】${m}`); if (!c) fails++; };
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const count = (src, re) => (src.match(re) || []).length;

const COMPOSER = "src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx";
const IPCS = "electron/features/screenshot-ipc.ts";
const CSS = "src/styles/04-cards-tools.css";

/* ── ① 快捷键文案纯函数（真跑：Windows 与 mac 两种写法）────────────── */
try {
  const mod = await import(pathToFileURL(join(ROOT, "src/lib/hotkey.mjs")).href);
  ok(mod.acceleratorLabel("CommandOrControl+Shift+Alt+A", "win32") === "Ctrl+Shift+Alt+A",
    "acceleratorLabel：Windows 把 CommandOrControl 写成 Ctrl");
  ok(mod.acceleratorLabel("CommandOrControl+Shift+A", "darwin") === "⌘⇧A",
    "acceleratorLabel：mac 出 ⌘⇧ 符号（不是 Ctrl）");
  ok(mod.acceleratorLabel("Command+Shift+A", "darwin") === "⌘⇧A"
    && mod.acceleratorLabel("Command+Shift+A", "win32") === "Win+Shift+A",
    "acceleratorLabel：mac 上 Command 不许被翻成 Win（那是 ⌘），Windows 上才写成 Win");
  ok(mod.acceleratorLabel("", "win32") === "",
    "空键回落空串（由调用方显示「未设置」，不伪造快捷键）");
} catch (e) {
  ok(false, `hotkey.mjs 真值表执行失败：${e && e.message ? e.message : e}`);
}

/* ── ② 菜单里两个按键 + 键帽读主进程设置 ─────────────────────────────── */
const composer = codeOnly(read(COMPOSER));
ok(/data-shot-action="full"/.test(composer) && /data-shot-action="region"/.test(composer),
  "「+」菜单里有全屏 / 框选两个截图按键");
ok(/shotHotkeyText\("full"\)/.test(composer) && /shotHotkeyText\("region"\)/.test(composer)
  && /className="quick-menu-kbd"/.test(composer),
  "两个按键各带一个快捷键键帽（kbd.quick-menu-kbd）");
ok(/shotSettings\?\.settings\?\.\[mode\]/.test(composer) && /!slot\?\.enabled \|\| !slot\.accelerator/.test(composer),
  "键帽读的是主进程设置（未启用/未设置显示「未设置」，不是空键帽）");
ok(/acceleratorLabel\(slot\.accelerator/.test(composer),
  "键帽文案走 lib/hotkey 的 acceleratorLabel（与设置页同源）");
ok(!/Ctrl\+Shift\+Alt\+A|CommandOrControl\+Shift\+Alt/.test(composer),
  "菜单里没有写死的快捷键字面量（全部来自设置，才不会改键后对不上）");

/* ── ③ 打开菜单取一次设置 ───────────────────────────────────────────── */
ok(/window\.codex\.screenshotSettingsGet\(\)/.test(composer),
  "打开菜单时向主进程取设置（进面板即准，不必等事件）");
ok(/\}, \[attachmentMenuOpen\]\);/.test(composer),
  "取设置只在菜单打开时执行且随开合刷新（effect 依赖 attachmentMenuOpen）");

/* ── ④ 改键联动：主进程广播 + 渲染层订阅 ────────────────────────────── */
const ipcs = codeOnly(read(IPCS));
ok(/broadcastHarnessEvent\(\{[\s\S]{0,200}type: "screenshot-settings-changed"/.test(ipcs),
  "主进程广播 screenshot-settings-changed（设置变更的唯一通知源）");
ok(count(ipcs, /emitSettingsChanged\((?:next|current)\)/g) >= 4,
  "settings-set 与 hotkey-set 三条路径（停用/失败/成功）都发广播（改键后必联动）");
ok(/"screenshot-settings-changed"/.test(composer)
  && /window\.codex\.onHarnessEvent\(/.test(composer),
  "渲染层订阅该事件（设置页改完键，菜单键帽立刻变）");

/* ── ⑤ 点击复用既有截图通道 + 先关菜单 ─────────────────────────────── */
const takeShotBody = composer.slice(composer.indexOf("const takeShot ="), composer.indexOf("const takeShot =") + 600);
ok(/screenshotCapture\(mode\)/.test(takeShotBody),
  "点击走 screenshot:capture 正式通道（与快捷键、设置页「试试截图」同一条链路）");
ok(takeShotBody.indexOf("setAttachmentMenuOpen(false)") >= 0
  && takeShotBody.indexOf("setAttachmentMenuOpen(false)") < takeShotBody.indexOf("screenshotCapture"),
  "先关菜单再截图（否则截图覆盖层挂在弹出的菜单下面）");

/* ── ⑥ 样式与同源收口 ───────────────────────────────────────────────── */
const css = read(CSS);
ok(/\.quick-menu-sep \{/.test(css) && /\.quick-menu-kbd \{/.test(css),
  "CSS：分隔线与键帽样式在位（键帽内容由渲染层实时生成）");
const settings = codeOnly(read("src/features/settings-screenshot/ScreenshotSettingsSection.tsx"));
ok(/acceleratorLabel/.test(settings) && !/\bhk\(/.test(settings),
  "设置页也改用同一个 acceleratorLabel（不再自己拼 Windows/mac 两种写法）");

/* ── ⑦ 隐藏窗口开关（全屏 / 框选共用 hideWindow）──────────────────── */
ok(/quick-menu-toggle/.test(composer) && /shotSettings\?\.settings\.hideWindow/.test(composer),
  "菜单里有「隐藏本窗口」开关，状态取自 screenshot 设置（两种截图都按它执行）");
ok(/screenshotSettingsSet\(\{ hideWindow: value \}\)/.test(composer)
  && !/localStorage[^\n]*hideWindow/.test(composer),
  "开关写回主进程 hideWindow（与设置页同一真相源，不另存一份）");
ok(/\.quick-menu-switch/.test(css),
  "开关样式在位（菜单面板内的小胶囊，不额外引一套控件）");

/* ── ⑧ 截图覆盖层：铺满整屏 + 工具条留在屏内 ───────────────────────── */
const overlayWin = codeOnly(read("electron/screenshot/overlay-window.ts"));
ok(/thickFrame: false/.test(overlayWin) && /overlay\.setBounds\(\{/.test(overlayWin),
  "覆盖层去掉 Windows 不可见边框并强制 setBounds（否则内容区被压成工作区高度、看不到屏幕底部）");
const overlayPage = codeOnly(read("electron/screenshot/overlay-page.ts"));
ok(/bx=Math\.max\(6,Math\.min\(bx,innerWidth-bw-6\)\)/.test(overlayPage)
  && /by=Math\.max\(6,Math\.min\(by,innerHeight-bh-6\)\)/.test(overlayPage),
  "工具条最终一律钳进可视区（全屏选区=整屏时不会跑到屏幕外）");

console.log("");
console.log(fails === 0
  ? `【screenshot-menu】通过（${checks} 条）`
  : `【screenshot-menu】失败：${fails}/${checks} 条`);
process.exit(fails === 0 ? 0 : 1);
