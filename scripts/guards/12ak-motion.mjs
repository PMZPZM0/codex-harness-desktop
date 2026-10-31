/**
 * 浮层动效守卫（10-31 立）
 *
 * 起因（用户原话）：「设置面板 / 手机远控弹窗 / 侧边栏展开折叠……多数元素是直接闪现且没有平滑过渡，
 * 全面排查其他类似弹窗、面板、菜单，统一补充打开动画，时长和缓动一致，不出现闪烁或卡顿。」
 *
 * 守四件事：
 *   ① **单一代码层**：所有浮层动效只在 `59-motion.css` 定义，且它由入口**最后**引入
 *      （各分节里历史遗留的 .12s/.14s/.16s/.3s 靠它统一覆盖）。
 *   ② **三档语义令牌**：遮罩 < 菜单 < 面板，时长必须真的递增（不是三个随便的数字）。
 *   ③ **关键帧只用独立变换属性**（translate/scale），不许写 `transform` —— 大量菜单用
 *      `transform` 做定位/翻转，写进去会在动画期间覆盖定位、结束后回到 none ⇒ 菜单位置错。
 *   ④ **侧栏折叠靠列宽插值**：`--side-w` 必须 @property 注册、模板里用 var、折叠只改这个变量；
 *      ⛔ 不许退回"折叠时换掉整条 grid 模板"（轨道数变了就不能插值 = 主区瞬移 256px）。
 *
 * ⛔ 覆盖边界（如实声明）：只验证**规则与接线**，不判"看起来顺不顺"；真实观感靠真机采样
 *   （`.workbuddy/tmp/verify-motion.cjs`：开设置面板采样 animationName/opacity、折叠时采样 --side-w）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【motion】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
/** 去注释（本文件的说明里就写着 `transform` / `.12s` 这些被禁字样，不剥会自己把自己顶红）。 */
const codeOnly = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");

const BASE = "src/styles/01-base-and-chrome.css";
const MOTION = "src/styles/59-motion.css";
const ENTRY = "src/styles.css";

const base = codeOnly(read(BASE));
const motion = codeOnly(read(MOTION));
const entry = read(ENTRY);
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));

/* ── ① 单一代码层 + 引入顺序 ─────────────────────────────────────────── */
ok(/--dur-overlay:|--dur-panel:|--dur-menu:/.test(base),
  "① 三档时长令牌在 base 的 :root（--dur-overlay / --dur-panel / --dur-menu）");
const num = (name) => Number(new RegExp(`--${name}:\\s*(\\d+)ms`).exec(base)?.[1] ?? NaN);
const [overlayMs, panelMs, menuMs] = [num("dur-overlay"), num("dur-panel"), num("dur-menu")];
ok(Number.isFinite(overlayMs) && Number.isFinite(panelMs) && Number.isFinite(menuMs) && menuMs <= overlayMs && overlayMs < panelMs,
  `① 三档时长语义递增：菜单 ${menuMs}ms ≤ 遮罩 ${overlayMs}ms < 面板 ${panelMs}ms`);

ok(/--ease-enter:\s*cubic-bezier/.test(base), "① 进场缓动令牌 `--ease-enter` 在 base 定义");

const imports = entry.split("\n").filter((l) => /@import/.test(l));
ok(imports[imports.length - 1].includes("59-motion"),
  "① `59-motion` 是**最后一条** @import（靠后写者胜去覆盖各分节的历史时长；挪到前面就失效）");

/* ── ② 三组浮层都接了动画（抽查语义最关键的几个） ──────────────────── */
const groupOf = (selector) => {
  const idx = motion.indexOf(selector);
  if (idx < 0) return "";
  const head = motion.slice(Math.max(0, idx - 600), idx);
  /* ⛔ 窗口要够大：选择器是成组罗列的，`animation:` 声明在整串之后（1400 字符内） */
  const anim = /animation:\s*(motion-[a-z-]+)/.exec(motion.slice(idx, idx + 1400));
  return anim?.[1] ?? "";
};
ok(groupOf(".modal-backdrop") === "motion-fade-in" && groupOf(".lightbox") === "motion-fade-in",
  "② 遮罩/灯箱走纯淡入（motion-fade-in）");
ok(groupOf(".settings-modal") === "motion-panel-in" && groupOf(".remote-panel2") === "motion-panel-in",
  "② 设置面板 / 手机远控弹窗走面板档（motion-panel-in）—— 用户点名的两处");
ok(groupOf(".task-menu") === "motion-menu-in" && groupOf(".notice-center-panel") === "motion-menu-in",
  "② 右键菜单 / 通知中心走菜单档（motion-menu-in）");

/* ── ③ 关键帧不许写 transform（会把菜单的定位 transform 覆盖掉） ─────── */
const keyframeBlocks = [...motion.matchAll(/@keyframes\s+motion-[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
ok(keyframeBlocks.length >= 3, `③ 三个动效关键帧都在（实测 ${keyframeBlocks.length} 个）`);
ok(keyframeBlocks.every((b) => !/[^-]transform:/.test(b)),
  "③ 负向：关键帧里只用 translate/scale，**不许**写 transform（菜单靠 transform 定位，写了会跳位）");

/* ── ④ 无障碍兜底 ────────────────────────────────────────────────────── */
const reduceBlock = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(motion)?.[1] ?? "";
ok(/animation-duration:\s*0\.001ms/.test(reduceBlock) && /\.settings-modal/.test(reduceBlock),
  "④ `prefers-reduced-motion: reduce` 下把面板动效压到 0.001ms（与 02-sidebar 的全局兜底同口径）");

/* ── ⑤ 侧栏折叠 = 列宽插值 ──────────────────────────────────────────── */
ok(/@property --side-w \{[\s\S]{0,80}?syntax: "<length>"/.test(base),
  "⑤ `--side-w` 用 @property 注册成 <length>（不注册就无法插值 ⇒ 折叠只能瞬移）");
ok(/grid-template-columns:\s*var\(--side-w, 256px\)/.test(base),
  "⑤ 壳模板首列读 `var(--side-w, 256px)`（列宽可动）");
ok(/\.app-shell:not\(\.narrow\)\.side-collapsed \{\s*--side-w:\s*0px;/.test(base),
  "⑤ 折叠只把 `--side-w` 置 0（轨道数不变），且只在非窄屏生效（窄屏侧栏是覆盖层）");
ok(!/\.app-shell\.side-collapsed \{[^}]*grid-template-columns/.test(base),
  "⑤ 负向：折叠态**不许**再整体替换 grid 模板（轨道数变化 ⇒ 不能插值 ⇒ 主区瞬移）");
ok(!/gridTemplateColumns:\s*`?minmax\(0, 1fr\) 1px \$\{panelWidth\}/.test(appView) && !/gridTemplateColumns: popoutThreadId/.test(appView),
  "⑤ 负向：JSX 的 inline 模板不许写死（10-31 起整份模板交给 CSS，inline 只留 `--panel-w`）");


/* ── ⑥ 侧栏抽屉手感（用户："要那种从侧边横向抽屉的感觉"）──────────────────
   判据：宽度恒定 + 只做横向 translate + 折叠态不再切成 position:fixed。
   ⛔ 三条缺一条就会退回"压扁再撑开"（实测宽度 142→238→256 的重排）或"折叠顺、展开硬"的位置瞬跳。 */
ok(/\.sidebar \{[^}]*width: 256px;/.test(base) && /\.sidebar \{[^}]*min-width: 256px;/.test(base),
  "⑥ 侧栏宽度恒定 256px（跟着网格轨道走会在展开时被压扁重排）");
ok(/\.sidebar \{[^}]*transition: translate var\(--dur-panel\)/.test(base),
  "⑥ 侧栏过渡的是 translate（横向抽屉位移），与列宽同一条时长/缓动");
ok(/\.app-shell\.side-collapsed:not\(\.narrow\) \.sidebar \{[^}]*translate: -100% 0;/.test(base),
  "⑥ 折叠态用 translate: -100% 推出侧边（抽屉滑出）");
ok(!/\.app-shell\.side-collapsed:not\(\.narrow\) \.sidebar \{[^}]*position: fixed;/.test(base),
  "⑥ 负向：折叠态**不许**再切 position:fixed —— 位置切换无法过渡，展开那一下会硬跳");
ok(/\.sidebar\.flyout-open \{[^}]*translate: 0 0;/.test(base),
  "⑥ 悬停展开（flyout）同样用 translate 滑回原位（写 transform 会叠加成两次位移、拉不出来）");


/* ── ⑦ 右侧面板同为横向抽屉（10-31 用户：「左边这里这抽屉效果，右边为什么不」）──────
   判据：轨道数恒定 + 宽度走 --right-w 插值 + 面板自己横向滑入/滑出 + 关闭延迟卸载。
   ⛔ 四条缺一条就会退回「闪现」：换列模板（轨道数变）／换 inline 模板／条件渲染（无退场元素）。 */
const reviewPanel = codeOnly(read("src/features/app-view/AppView/03-review-panel.tsx"));
const dragSrc = codeOnly(read("src/features/app-state/parts/part02/01-mcp-teams-plan/02-team-roles-import.tsx"));

ok(/@property --right-w \{\s*syntax: "<length>"/.test(base),
  "⑦ --right-w 注册为 <length>（不注册就插值不了，右栏只能瞬开瞬关）");
ok(/grid-template-columns: var\(--side-w, 256px\) minmax\(0, 1fr\) 1px var\(--right-w, 0px\)/.test(base),
  "⑦ 主壳模板恒为 4 轨、右栏宽度走 var(--right-w)（轨道数不变才可插值）");
ok(/\.app-shell\.with-context \{[^}]*--right-w: var\(--panel-w, 308px\)/.test(base),
  "⑦ 开右栏只改变量 --right-w，不换模板");
ok(/transition: --side-w var\(--dur-panel\)[^;]*--right-w var\(--dur-panel\)/.test(base),
  "⑦ 侧栏与右栏同一条时长/缓动（不然一边快一边慢）");
ok(/\.context-panel \{[^}]*transition: translate var\(--dur-panel\)/.test(base),
  "⑦ 面板自身过渡 translate（横向抽屉），不是位移瞬变");
ok(/\.context-panel\[data-state="closed"\] \{[^}]*translate: 100% 0/.test(base),
  "⑦ 关闭态把面板整体推出右侧（translate 100%）");
ok(/setTimeout\(\(\) => setMounted\(false\), 220\)/.test(reviewPanel),
  "⑦ 关闭**延迟卸载** 220ms（立刻卸载 = 没有退场元素，CSS 过渡无从触发）");
ok(/data-state=\{rightOpen && entered \? "open" : "closed"\}/.test(reviewPanel),
  "⑦ 面板按状态挂 data-state（开/合各有样式，退场靠它）");
ok(/requestAnimationFrame\(\(\) => \{ raf2 = requestAnimationFrame\(\(\) => setEntered\(true\)\)/.test(reviewPanel),
  "⑦ 进场用**两次 rAF** 先挂关闭态再切 open（直接以最终态插入 = CSS 过渡不触发，打开仍是瞬现）");
ok(!/gridTemplateColumns: popoutThreadId|gridTemplateColumns: `var\(--side-w/.test(appView) && /--panel-w/.test(appView),
  "⑦ 负向：AppView 不许再 inline 写整份列模板（写死就插值不了）");
ok(/classList\.add\("panel-resizing"\)/.test(dragSrc) && /setProperty\("--panel-w"/.test(dragSrc),
  "⑦ 拖分隔条只改 --panel-w 并挂 panel-resizing（否则列宽滞后 220ms、拖起来发粘）");
ok(!/style\.gridTemplateColumns =/.test(dragSrc),
  "⑦ 负向：拖拽不许再写 style.gridTemplateColumns（钉死 inline 后变量变化全失效）");

/* ── ⑧ 顶栏 / 外圈 / 右栏细线（10-31 用户四连问）───────────────────────────────
   ① 原生窗口钮要跟顶栏图标行同一条水平线；② 顶部外圈那条缝要能拖窗口；
   ③ 右栏与主区之间的线要细；④ 悬停/拖动要有跟左侧一样的主题色光。 */
const rrSrc = codeOnly(read("electron/runtime-refs.ts"));
const mainTs = codeOnly(read("electron/main.ts"));
const appViewFull = codeOnly(read("src/features/app-view/AppView.tsx"));

ok(/grid-template-rows: 50px minmax\(0, 1fr\)/.test(base),
  "⑧ 首行 = 6px 外圈 + 44px 顶栏（50px）：第 2 行不再被顶栏压住 6px —— 否则右栏滚动区/对话区顶端会被切一条")
ok(/\.shell-drag-top \{[^}]*height: 6px/.test(base) && /\.shell-drag-top \{[^}]*app-region: drag/.test(base),
  "⑧ 顶部外圈 6px 铺了 drag 条（外圈是卡片 margin 让出来的死区，不补就拖不动窗口）")
ok(/className="shell-drag-top"/.test(appViewFull),
  "⑧ 外圈拖拽条真的挂进了 DOM（只写 CSS 不挂元素 = 装饰品）")
ok(/height: 55 \};/.test(rrSrc) && !/height: 43/.test(rrSrc),
  "⑧ titleBarOverlay 高度 = 55（顶栏中心 6+22=28 ⇒ 原生钮 27.5 才同行；43 ⇒ 中心 21.5，整体上移 6.5px）")
ok(!/symbolColor: symbol, height: 43/.test(mainTs),
  "⑧ 负向：切主题时的 setTitleBarOverlay 不许再用 43（一写就把建窗的 55 打回去，表现是\"改了没生效\"）")
ok(/\.app-shell\.with-context > \.panel-divider:hover::after,[\s\S]{0,120}?background: var\(--accent\)/.test(base),
  "⑧ 右栏分隔条悬停/拖动 = 主题色光（与左侧 .sidebar-resizer:hover::after 同款）")
ok(!/\.panel-divider:hover,\s*\n?\.panel-divider:active \{[^}]*background: var\(--muted\)/.test(base),
  "⑧ 负向：不许再给分隔条整列铺 --muted（1px 格子涂满 + 高分屏缩放 = 看着像 2~3px 的粗条）")
console.log(`\n  【motion】${checks - fails}/${checks} 通过`);
if (fails) process.exit(1);
