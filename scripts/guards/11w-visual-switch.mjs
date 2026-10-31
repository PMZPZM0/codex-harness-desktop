/**
 * 视觉切换（主题 / 代码高亮）的过渡与回执 · 守卫（2026-10-07 立）
 *
 * 守用户那条需求：「主题切换和代码高亮切换缺少过渡动画和切换完成后的通知提示」+
 * 「统一补齐…保证反馈风格一致、不引起布局跳动，并兼顾 prefers-reduced-motion」。
 *
 * 六条判据：
 *   ① 单一入口：三处切换（设置页主题卡 / 代码高亮卡 / 侧栏快捷明暗）都走 `runVisualSwitch`，
 *      不各写一份挂类+摘类+发回执。
 *   ② 时序：回执必须在**过渡结束之后**（在摘掉过渡类的同一个计时回调里），不是点击瞬间。
 *   ③ 同源：CSS 的 `--dur-theme` 与 TS 的 `VISUAL_FX_MS` 必须相等（否则提示与变色对不上）。
 *   ④ 不引起布局跳动：过渡属性里**不许出现** width/height/margin/padding/transform/font-size。
 *   ⑤ 无障碍：过渡规则**不许加 `!important`** —— 否则会与既有的
 *      `@media (prefers-reduced-motion: reduce) { … !important }` 按源码顺序打架，把兜底废掉。
 *   ⑥ 回执覆盖面：语言切换、以及全仓那个静默的复制点。
 *
 * ⛔ 覆盖边界（如实声明）：只验证**接线与变量同源**，不做"动画看起来顺不顺"的视觉判定；
 *   真实观感需要人眼（本轮结论里说明）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, readSettingsSurface } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【visual-switch】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
/** 剥注释（CSS 块注释 + JSX 注释 + `//` 行注释）。
 *  ⛔ 负向断言一律先剥：本文件的规则里就写着"绝不加 !important"和"width/height/transform"
 *  这些被禁的字样 —— 不剥会让断言读到注释里的字面量，自己把自己顶红（11u/11v 都踩过）。 */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const VS = "src/lib/visual-switch.ts";
const BASE = "src/styles/01-base-and-chrome.css";
const vs = read(VS);
const base = read(BASE);

/* ── ① 单一入口 ──────────────────────────────────────────────────────── */
ok(/export function runVisualSwitch\(/.test(vs), "① 存在统一入口 `runVisualSwitch`（三处切换共用，不各写一份）");
ok(/export const VISUAL_FX_CLASS = "fx-theme"/.test(vs), "① 过渡类名字面量 = `fx-theme`（改名必须同步 CSS 与本守卫）");

const APPEAR = "src/features/settings-appearance/AppearanceSettingsSection.tsx";
const CODEAPP = "src/components/CodeAppearance.tsx";
const SIDEBAR = "src/features/app-view/AppView/01-sidebar-shell.tsx";
ok(/runVisualSwitch\("主题"/.test(read(APPEAR)), "① 设置页主题卡走统一入口");
ok(/runVisualSwitch\("代码高亮"/.test(read(CODEAPP)), "① 代码高亮卡走统一入口");
const sidebarQuick = (read(SIDEBAR).match(/runVisualSwitch\("主题"/g) ?? []).length;
ok(sidebarQuick === 2, `① 侧栏快捷明暗钮（浅色/深色）都走统一入口（实测 ${sidebarQuick}/2）`);

/* 回执通道真的接上了（三处都要能把提示送出去） */
ok(/onNotice/.test(read(APPEAR)) && /onNotice=\{setNotice\}/.test(readSettingsSurface()),
  "① 设置页的回执通道由注册表穿透（appearance 页真的拿到了 setNotice）");
ok(/onNotice\?:/.test(read(CODEAPP)) && /onNotice=\{onNotice\}/.test(read(APPEAR)),
  "① 代码高亮卡的回执由外观页下传（⛔ 可选通道：拿不到就静默，绝不阻止切换）");

/* ── ② 时序：回执在过渡结束之后 ──────────────────────────────────────── */
/* 锚「onNotice 出现在摘类的同一个 setTimeout 回调里」，而不是点击瞬间同步发出。 */
const afterFx = /classList\.add\(VISUAL_FX_CLASS\);[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?classList\.remove\(VISUAL_FX_CLASS\)[\s\S]*?onNotice\?\./.test(vs);
ok(afterFx, "② 回执在**过渡结束之后**发出（与摘掉过渡类同一个回调）—— 不是点击瞬间");
ok(/apply\(\);/.test(vs) && vs.indexOf("apply();") < vs.indexOf("setTimeout("), "② 先应用再定时（顺序：挂过渡 → 应用 → 摘过渡 + 发回执）");

/* ── ③ 同源：CSS 时长 == TS 时长 ─────────────────────────────────────── */
const cssMs = Number(/--dur-theme:\s*(\d+)ms/.exec(base)?.[1] ?? NaN);
const tsMs = Number(/VISUAL_FX_MS = (\d+)/.exec(vs)?.[1] ?? NaN);
ok(Number.isFinite(cssMs) && Number.isFinite(tsMs) && cssMs === tsMs,
  `③ CSS --dur-theme(${cssMs}ms) 与 TS VISUAL_FX_MS(${tsMs}ms) **同源**（不一致会出现"提示弹了颜色还在变"）`);
ok(/--dur-theme/.test(base) && /var\(--dur-theme/.test(codeOnly(base)), "③ CSS 侧的过渡时长读的是变量，不是写死数字");

/* ── ④/⑤ 过渡规则的性质 ─────────────────────────────────────────────── */
const fxBlock = /html\.fx-theme[\s\S]*?\{([^}]*)\}/.exec(codeOnly(base))?.[1] ?? "";
ok(/html\.fx-theme/.test(codeOnly(base)) && fxBlock.length > 0, "④ 存在 `html.fx-theme` 过渡规则");

const LAYOUT = /\b(width|height|margin|padding|font-size|flex|grid|top|left|right|bottom|transform)\b/;
ok(!LAYOUT.test(fxBlock),
  "④ 负向：过渡属性里**没有**会引发布局跳动的项（width/height/margin/padding/font-size/transform…）");
ok(!/!important/.test(fxBlock),
  "⑤ 负向：过渡规则**不加 `!important`** —— 否则与 reduced-motion 那条 !important 比源码顺序，兜底会被废掉");

/* reduced-motion 兜底仍在（这是"兼顾无障碍"的判据来源） */
const reduceBlocks = ["src/styles/02-sidebar-threads.css"].filter((f) => /prefers-reduced-motion/.test(read(f)));
ok(reduceBlocks.length === 1 && /transition-duration:\s*0\.001ms\s*!important/.test(read(reduceBlocks[0])),
  "⑤ `prefers-reduced-motion: reduce` 的全局兜底仍在（duration 压到 0.001ms 且带 !important）");

/* ── ⑥ 反馈覆盖面 ────────────────────────────────────────────────────── */
ok(/showToast\("界面语言已切换"/.test(read(SIDEBAR)),
  "⑥ 审计补漏：界面语言「简体中文」也有回执（此前只有 English 那项有，同类操作两种待遇）");
const remote = read("src/features/app-view/AppView/04-remote-approval.tsx");
ok(/还没有可复制的链接/.test(remote) && /远程控制链接已复制/.test(remote) && /复制失败/.test(remote),
  "⑥ 审计补漏：远程控制「复制链接」三态齐全（无链接 / 成功 / 失败）—— 此前完全静默");

/* 统一时长变量：新增的切换控件过渡一律走 --dur-ui，不再各写一份 .16s/.22s */
const uiBlock = /\.settings-nav \.settings-group button,\s*\n[\s\S]*?\{([^}]*)\}/.exec(codeOnly(base))?.[1] ?? "";
ok(/--dur-ui/.test(base) && /var\(--dur-ui\)/.test(uiBlock),
  "⑥ 切换类控件的过渡统一走 `--dur-ui`（此前散着好几档时长，观感对不齐）");
ok(!LAYOUT.test(uiBlock), "⑥ 负向：切换控件的过渡同样**不碰**布局属性");

/* ── ⑦ 文档同步 ──────────────────────────────────────────────────────── */
const design = read("DESIGN.md");
ok(/--dur-theme/.test(design) && /visual-switch/.test(design),
  "⑦ DESIGN.md 已登记过渡变量与统一入口（⛔ 改了 CSS 变量/新增约定就必须同步）");

/* ── ⑧ 10-31：明暗切场改成整屏涟漪（用户「太生硬、一点切换动画没有」）──────
   守四件事：走 View Transitions、圆心来自点击处、快照前 DOM 必须已是新主题、
   以及「不支持/减少动效」时仍能回落（不能让动画成为切换的前置条件）。 */
ok(/export const VISUAL_RIPPLE_CLASS = "fx-ripple"/.test(vs), "⑧ 涟漪转场类名字面量 = `fx-ripple`（改名须同步 CSS 与本守卫）");
ok(/startViewTransition/.test(codeOnly(vs)) && /prefersReducedMotion\(\)/.test(codeOnly(vs)),
  "⑧ 首选 View Transitions，且 `prefers-reduced-motion` 下**不进**该路径（回落到颜色过渡）");
ok(/addEventListener\("pointerdown"[\s\S]{0,120}capture: true/.test(codeOnly(vs)),
  "⑧ 涟漪圆心取自指针按下位置（capture 阶段，按钮 stopPropagation 也收得到）");
ok(/--switch-x/.test(codeOnly(vs)) && /--switch-r/.test(codeOnly(vs)),
  "⑧ 把圆心与半径写进 CSS 变量（JS 不参与画：几何归 CSS）");
/* ⛔ catch 允许带参数与日志（10-31 加：那个 catch 曾把「裸调用 Illegal invocation」吞掉，
   表现为"怎么改都没动画"，所以现在必须 console.warn 出来 —— 断言跟着放宽到 `catch (e) {`）。 */
ok(/catch(?: \([^)]*\))? \{[\s\S]{0,400}?fadeSwitch\(/.test(codeOnly(vs)),
  "⑧ 负向兜底：`startViewTransition` 抛错时回落颜色过渡（⛔ 不许让主题切不动）");

const rippleBlock = /html\.fx-ripple::view-transition-new\(root\) \{([^}]*)\}/.exec(codeOnly(base))?.[1] ?? "";
ok(/html\.fx-ripple::view-transition-old\(root\)/.test(codeOnly(base)) && rippleBlock.length > 0,
  "⑧ CSS 侧有 `::view-transition-old/new(root)` 规则（旧快照留底、新快照盖上来）");
ok(/clip-path: circle\(0px at var\(--switch-x/.test(codeOnly(base)) &&
  /clip-path: circle\(var\(--switch-r/.test(codeOnly(base)),
  "⑧ 新快照用**圆形裁切**从圆心扩散（几何运动，不是整屏插值发灰）");
ok(!/!important/.test(rippleBlock), "⑧ 负向：涟漪规则同样不加 `!important`（无障碍兜底要压得住）");
ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*html\.fx-ripple/.test(codeOnly(base)),
  "⑧ 涟漪伪元素不受全局 `*` 兜底覆盖 ⇒ 单独写了一条 reduced-motion 关动画");

/* 快照时序：flushSync 必须包住 setState（三处切换点），否则拍到的新旧快照相同 = 没动画 */
const SYNC_CALLS = [
  [SIDEBAR, /runVisualSwitch\("主题"[\s\S]{0,120}flushSync\(\(\) => setTheme/, "侧栏浅/深切换"],
  [APPEAR, /runVisualSwitch\("主题"[\s\S]{0,120}flushSync\(\(\) => setTheme/, "设置页主题卡"],
  [CODEAPP, /runVisualSwitch\("代码高亮"[\s\S]{0,160}flushSync\(\(\) => setCodeSettings/, "代码高亮卡"],
];
for (const [file, re, name] of SYNC_CALLS) {
  ok(re.test(read(file)), `⑧ ${name} 用 flushSync 包住状态更新（快照前 DOM 必须已是新主题）`);
}
ok(/useLayoutEffect\(\(\) => \{\s*\n\s*document\.documentElement\.dataset\.theme = bag\.theme;/.test(read("src/features/app-state/parts/part04/02-seg/02-chat-search-history.tsx")),
  "⑧ `dataset.theme` 写在 useLayoutEffect 里（useEffect 会晚一拍 ⇒ 两张快照相同）");

/* 明暗切换控件：滑轨 thumb + 自绘图标，且两枚图标仍在（不许退化成纯文字） */
const THEME_SWITCH = read("src/components/ThemeQuickSwitch.tsx");
ok(/theme-quick-thumb/.test(THEME_SWITCH) && /is-dark/.test(THEME_SWITCH),
  "⑧ 明暗控件是滑轨胶囊（thumb 随当前态平移，有「在哪一档」的几何线索）");
ok(/tq-rays/.test(THEME_SWITCH) && /tq-star/.test(THEME_SWITCH),
  "⑧ 太阳光线 / 月旁星各自可独立动效（激活时点亮）");
ok(/aria-pressed=/.test(THEME_SWITCH) && /role="group"/.test(THEME_SWITCH),
  "⑧ 无障碍：容器 role=group + 按钮 aria-pressed 表达当前档位");

console.log(`\n  【visual-switch】${checks - fails}/${checks} 通过`);
if (fails) process.exit(1);
