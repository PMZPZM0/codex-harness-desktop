/**
 * 图标色板与齿轮入口 · 守卫（2026-10-06 立）
 *
 * 守用户那条需求：「把左下角那个进设置界面的图标改成齿轮⚙️，图标都加点色彩，主界面其他图标和设置里面的图标也是」。
 *
 * 拆成三条判据：
 *   ① 入口形态：侧栏进设置的是**齿轮**（`Settings`，lucide）—— 不是滑杆 `Settings2`。
 *   ② 色板机制：`--ic-*` 亮/暗两套都定义；`.ic-*` 工具类**只设 `--ic`**、不许写 `color:`
 *      （写 `color` 会跟各域既有的图标取色规则按权重打架 —— 详见 DESIGN.md）。
 *   ③ 消费端接线：取色规则必须写成 `var(--ic, <原色>)` / `var(--ic-page, <原色>)`，
 *      回落值是**原来的颜色** ⇒ 没挂 `ic-*` 的地方零回归。
 *   ④ 真相源：设置分类的色相只在 `settingsNav` 的第 4 位声明一次，页内色相由 `settingsTone()` 派生。
 *
 * ⛔ 覆盖边界（如实声明）：只看**接线与变量**，不做像素级视觉校验（配色好不好看是用户的眼睛说了算，
 *   不是断言能判的）。暗色能不能看靠"暗色值是另一套手调值"这一条机械判据兜底。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【icon-palette】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => existsSync(path.join(ROOT, rel));
/** 剥注释：CSS/TS 的注释里会**引用被禁的模式**（比如「⛔ 别写 color:」），不剥会自己把自己顶红。 */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const TONES = ["blue", "green", "amber", "pink", "violet", "cyan"];
const BASE = "src/styles/01-base-and-chrome.css";

/* ── ① 入口：进设置的是齿轮，不是滑杆 ────────────────────────────────── */
const SIDEBAR = "src/features/app-view/AppView/01-sidebar-shell.tsx";
const sidebarSrc = read(SIDEBAR);

ok(has(SIDEBAR), "侧栏壳文件存在（左下角设置入口的落点）");

/* 锚「同一行里既有 sidebar-settings 又是 Settings 图标」。
   ⛔ 别写 `<button ...[^>]*>` 一路吃到 `<Settings`：这行的 onClick 里有 `() => {`，
   `[^>]*` 会在箭头函数的 `>` 处提前截断（本轮真跑抓到，锚点假红）。 */
const settingsBtn = sidebarSrc
  .split(/\r?\n/)
  .some((line) => /className="sidebar-settings/.test(line) && /<Settings size=\{\d+\} \/>/.test(line));
ok(settingsBtn, "① 左下角进设置的按钮用的是**齿轮** Settings（⛔ 不是滑杆 Settings2）");

/* 负向：滑杆不许再出现在这个文件里（曾经就是它；留着会被下一个人又换回去） */
ok(!/<Settings2 /.test(codeOnly(sidebarSrc)),
  "① 负向：侧栏里不再有 Settings2（滑杆 —— 用户点名要换成齿轮）");

/* ── ② 色板：亮/暗两套都定义，且是两套**不同**的值 ───────────────────── */
const base = read(BASE);
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(base)?.[1] ?? "";
const darkBlock = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(base)?.[1] ?? "";
const pick = (block, name) => new RegExp(`--ic-${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? "";

ok(rootBlock && darkBlock, "② 亮色块与暗色块都定位到了（变量表在 01-base-and-chrome.css）");

let bothDefined = 0, distinct = 0;
for (const tone of TONES) {
  const light = pick(rootBlock, tone);
  const dark = pick(darkBlock, tone);
  if (light && dark) bothDefined++;
  if (light && dark && light !== dark) distinct++;
}
ok(bothDefined === TONES.length, `② 六个色相亮/暗都定义了（实测 ${bothDefined}/${TONES.length}）`);
/* ⛔ 这条是 DESIGN.md「深色主题不是把亮色反过来」的机械判据：
   暗色若与亮色同值，说明是复制粘贴上去的 —— 暗底上深色图标会瞎。 */
ok(distinct === TONES.length, `② 暗色是**另一套值**、不是复制亮色（实测 ${distinct}/${TONES.length} 个不同）`);

/* ── ③ 机制：.ic-* 只设 --ic，不许写 color ───────────────────────────── */
const icRules = [...base.matchAll(/^\.ic-(blue|green|amber|pink|violet|cyan)\s*\{([^}]*)\}/gm)];
ok(icRules.length === TONES.length, `③ 六个 .ic-* 工具类都定义了（实测 ${icRules.length}/${TONES.length}）`);

const onlySetsVar = icRules.every(([, , body]) => /--ic:\s*var\(--ic-[a-z]+\);/.test(body) && !/color\s*:/.test(body));
ok(onlySetsVar, "③ .ic-* 只设 `--ic`、**不许写 `color:`**（写了会跟各域图标规则按权重打架 —— DESIGN.md 有记）");

/* 负向：语义色不许混进装饰色板 */
ok(!/--ic-(blue|green|amber|pink|violet|cyan)\s*:\s*var\(--(ok|red|orange)\)/.test(base),
  "③ 负向：装饰色板不引语义色（语义色只表意，不做装饰）");

/* ── ④ 消费端：回落必须是原色（零回归） ──────────────────────────────── */
const consumers = [
  ["src/styles/15-queued-messages.css", /\.sidebar-tab svg \{[\s\S]{0,120}?color:\s*var\(--ic,\s*var\(--muted\)\)/],
  ["src/styles/01-base-and-chrome.css", /\.search-box > svg \{[\s\S]{0,120}?color:\s*var\(--ic,\s*var\(--muted\)\)/],
  ["src/styles/02-sidebar-threads.css", /\.sidebar-settings \{[\s\S]{0,160}?color:\s*var\(--ic,\s*var\(--muted\)\)/],
  ["src/styles/11-settings-secrets.css", /\.account-icon \{[\s\S]{0,160}?color:\s*var\(--ic,\s*var\(--muted\)\)/],
];
for (const [file, re] of consumers) {
  ok(re.test(read(file)), `④ ${file.split("/").pop()} 的图标取色写的是 var(--ic, 原色)（没挂 ic-* 时自动保持原样）`);
}

/* 设置导航：回落用 currentColor —— 按钮 hover/active 会把 color 刷成 --text，
   写死回落会让选中项图标变回灰色（跟文字脱节）。 */
ok(/\.settings-nav \.settings-group button svg \{[\s\S]{0,120}?color:\s*var\(--ic,\s*currentColor\)/.test(read("src/styles/05-composer-input.css")),
  "④ 设置左栏图标回落用 currentColor（选中态图标跟着文字走，不掉回灰）");

/* 设置页内两类图标读 --ic-page，且回落是各自原来的颜色 */
ok(/\.settings-card-head svg \{[\s\S]{0,200}?color:\s*var\(--ic-page,\s*var\(--green\)\)/.test(read("src/styles/07-settings-mcp-connectors.css")),
  "④ 设置卡头图标读 var(--ic-page, var(--green))（原色是绿 ⇒ 未设色相时零回归）");
ok(/\.settings-toggle-icon \{[\s\S]{0,260}?color:\s*var\(--ic-page,\s*var\(--muted\)\)/.test(read("src/styles/08-settings-engine-update.css")),
  "④ 设置开关行的图标盒也跟分类色相（只改 color，不动边框/底 —— 整块染色会很吵）");

/* ── ⑤ 真相源：色相只在 settingsNav 声明一次 ────────────────────────── */
const catalogs = read("src/features/app-view/helpers/catalogs.ts");
const navItems = [...catalogs.matchAll(/\["([a-z-]+)",\s*"[^"]+",\s*\w+,\s*"(\w+)"\]/g)];
const illegal = navItems.filter(([, , tone]) => !TONES.includes(tone));
ok(navItems.length >= 27 && illegal.length === 0,
  `⑤ 设置导航每一项都带**合法**色相（实测 ${navItems.length} 项，非法 ${illegal.length} 项）`);

/* 派生而不是第二份表：加一页设置时只改 settingsNav 那行 */
ok(/export function settingsTone\(/.test(catalogs) && /for \(const group of settingsNav\)/.test(codeOnly(catalogs)),
  "⑤ 页内色相由 settingsTone() 从 settingsNav **派生**（⛔ 不许另立第二份色相表）");
ok(/settingsTone/.test(read("src/features/app-view/helpers.tsx")),
  "⑤ settingsTone 已从 helpers 导出面露出（消费方在 app-view 目录外也拿得到）");

/* 弹窗根把色相写成 --ic-page，且值是 var(--ic-*) 而不是写死 hex */
const sheet = read("src/features/app-view/AppView/08-settings-sheet.tsx");
ok(/--ic-page/.test(sheet) && /settingsTone\(settingsPage\)/.test(sheet),
  "⑤ 设置弹窗根按当前分类写 --ic-page（左栏点哪一项 ⇒ 页内就是那一色）");
ok(!/--ic-page["'`]?\s*:\s*["'`]#/.test(sheet),
  "⑤ 负向：--ic-page 的值是变量引用，**不是写死色值**（DESIGN.md：组件不许写死色）");

/* 设置导航渲染处真的把色相挂成了 ic-* 类 */
ok(/ic-\$\{tone\}/.test(read("src/features/app-view/AppView/08-settings-sheet/01-settings-layout/01-settings-nav.tsx")),
  "⑤ 左栏渲染处把第 4 位色名挂成 `ic-<tone>` 类（声明与渲染同源）");

/* ── ⑥ 文档同步 ───────────────────────────────────────────────────────── */
const design = read("DESIGN.md");
const documented = TONES.every((tone) => new RegExp(`--ic-${tone}\\b`).test(design));
ok(documented, "⑥ DESIGN.md 已登记全部六个色相（⛔ 改了 CSS 变量就必须同步，否则文档会变成骗人的）");
ok(/ic-<色名>|ic-\*/.test(design) && /--ic-page/.test(design),
  "⑥ DESIGN.md 写明了用法机制（容器挂 .ic-* / 页内读 --ic-page），不只是一张色值表");

console.log(`\n  【icon-palette】${checks - fails}/${checks} 通过`);
if (fails) process.exit(1);
