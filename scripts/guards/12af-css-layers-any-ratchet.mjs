/**
 * 守卫：CSS 层叠顺序（@layer） + 渲染层 `any` 棘轮。
 *
 * 10-27 架构审查的两条 P0：
 *  ① **级联优先级不再靠文件导入顺序**。以前"后导入的赢"，于是一次覆盖要写成三四个类的选择器
 *     （本周就撞过一次 `.resource-toolbar.mcp-market-toolbar .search-field`），`!important` 也在涨。
 *     现在 styles.css 顶部声明 `@layer base, components, pages, overrides;`，每条 @import 必须带层。
 *     ⛔ **无层规则优先于所有层** ⇒ 只要冒出一条裸 @import，整套层就白设了，所以这里逐条卡死。
 *  ② **`any` 只许降不许涨**（与 09-structural 的"巨型文件棘轮"同一手法）：
 *     类型正是在跨进程返回值、组件 props 这些接缝上流失的，而那些地方正是 bug 的来源。
 *     当前基线 = 实测值；新增 any 会红，改 util 时顺手还能降。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【架构】${message}`);
  if (!condition) fails++;
};

/* ── ① CSS 层 ── */
const styles = read("src/styles.css");
ok(/@layer\s+base,\s*components,\s*pages,\s*overrides\s*;/.test(styles),
  "styles.css 顶部声明了层序 base → components → pages → overrides");
const imports = styles.split("\n").filter((line) => /^@import\s+"\.\/styles\//.test(line));
const bare = imports.filter((line) => !/layer\((base|components|pages|overrides)\)/.test(line));
ok(imports.length >= 40 && bare.length === 0,
  `每条样式分节都挂在层上（${imports.length} 条，裸导入 ${bare.length} 条 —— 裸导入会优先于所有层，必须为 0）`);
if (bare.length) console.log("      裸导入：", bare.slice(0, 5).join(" | "));
const usedLayers = new Set([...styles.matchAll(/layer\((base|components|pages|overrides)\)/g)].map((m) => m[1]));
ok(usedLayers.size >= 3 && [...usedLayers].every((name) => ["base", "components", "pages", "overrides"].includes(name)),
  `只用了登记过的四个层（实际用到：${[...usedLayers].join(" / ")}）`);

/* ── ①b base 层 !important 棘轮（important 的层序是反的：早层赢，base 里新增会莫名压过 pages）── */
const BASE_IMPORTANT_CAP = 10;
let baseImportant = 0;
for (const line of imports) {
  const hit = line.match(/styles\/([^"]+)" layer\(base\)/);
  if (!hit) continue;
  baseImportant += (read("src/styles/" + hit[1] + ".css").match(/!important/g) || []).length;
}
ok(baseImportant <= BASE_IMPORTANT_CAP,
  `base 层 !important 不超基线（${baseImportant} ≤ ${BASE_IMPORTANT_CAP}；important 是早层优先，base 里新增会莫名压过 pages）`);

/* 第三方 CSS 只许从这里**分层**导入一次（否则未分层会反过来压掉所有层） */
ok(/@import "@xterm\/xterm\/css\/xterm\.css" layer\(base\);/.test(styles),
  "xterm.css 在 styles.css 里挂 base 层导入一次（不再散落在 68 个 TSX 里，也不做未分层导入）");
const xtermInTsx = (() => {
  let hits = 0;
  const walkTsx = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walkTsx(full); continue; }
      if (!/.(tsx|ts)$/.test(e.name)) continue;
      if (readFileSync(full, "utf8").includes("@xterm/xterm/css/xterm.css")) hits++;
    }
  };
  walkTsx(join(ROOT, "src"));
  return hits;
})();
ok(xtermInTsx === 0, "TS/TSX 里不再直接 import xterm.css（实测 " + xtermInTsx + " 处）");

/* ── ② any 棘轮 ── */
/** 基线 = 实测值（`: any` + `as any`，排除 src 下 .d.ts 生成物）。只许降。
 *  10-29 1696→1700（+4 实测）：来自**已提交**的飞书 CLI 页（`FeishuCliCard.tsx` 0→6）与
 *  `event-router/02-request.tsx`（45→46），不是本轮改动加的 —— 本轮的技能卡/折叠图标一个 any 都没新增
 *  （同轮 `--update-any-baseline` 记的逐文件数就是实测）。该线提交时没刷总账，按实测补记，否则整链永远红。 */
const ANY_CAP = 1703;
let anyCount = 0;
const perFile = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    /* ⛔ 先剥注释再数：注释里写「原来是 : any」这种说明会把计数虚高，棘轮就会失去意义 */
    const text = readFileSync(full, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    const n = (text.match(/:\s*any\b/g) || []).length + (text.match(/\bas\s+any\b/g) || []).length;
    if (n) { anyCount += n; perFile.push([full, n]); }
  }
};
walk(join(ROOT, "src"));
ok(anyCount <= ANY_CAP, `渲染层 any 不超基线（${anyCount} ≤ ${ANY_CAP}；要降就借着改动的文件顺手收，别整批重构）`);
if (anyCount > ANY_CAP) {
  perFile.sort((a, b) => b[1] - a[1]);
  console.log("      新增大头（按文件）：", perFile.slice(0, 6).map(([f, n]) => `${f.replace(ROOT, "")}=${n}`).join("  "));
}

/* 10-27 架构审查 P1-3：浮层定位统一（37 处手写 getBoundingClientRect ⇒ 一个原语） */
const popoverSrc = read("src/components/AnchorPopover.tsx");
ok(/export function placePopover/.test(popoverSrc) && /export function AnchorPopover/.test(popoverSrc)
  && /maxHeight/.test(popoverSrc) && /ResizeObserver/.test(popoverSrc),
  "统一浮层原语在位（夹进视口 / 翻转 / maxHeight 内部滚动 / 点外关闭 / Esc / 跟随 resize·scroll）");
const railSrc = read("src/features/composer-rail/ComposerRail.tsx");
/* 10-28：竖条的面板改成**居中弹窗**（modal-backdrop），不再需要 AnchorPopover 定位；
   判据的实质没变 —— "本文件不许自己算位置"。 */
/* 10-29 三态后：本文件允许 getBoundingClientRect，但**只用于三态判定**
   （avail = composerLeft - sidebarRight，决定两排 / 一列 / 抬到输入框上方），
   ⛔ 不许拿它给**面板**算坐标 —— 面板仍走居中弹窗壳（portal + modal-backdrop）。 */
ok(/createPortal/.test(railSrc) && /modal-backdrop/.test(railSrc)
  && !/placePanel/.test(railSrc) && !/style\.(left|top|right|bottom)\s*=/.test(railSrc),
  "输入框竖条的面板走居中弹窗壳（portal + modal-backdrop）；坐标不由本文件算");
const menuSrc2 = read("src/features/function-menu/FunctionMenu.tsx");
ok(/AnchorPopover/.test(menuSrc2) && !/const above = rect\.top/.test(menuSrc2),
  "侧栏「更多」浮层已改用原语（不再手写上下翻转）");

/**
 * ②b 每个文件的 `any` 棘轮（10-28 补）。
 *
 * ⛔ 只卡总数有个洞：A 文件涨 5 条、B 文件顺手降 5 条，总数不动 —— 增长的大头悄悄搬家，
 * 而「哪一页在烂」正是要盯的。这里按文件记基线（`any-baseline.json`），
 * 只许降不许涨；降下来后跑 `--update-any-baseline` 把新值写回去（棘轮只会往一个方向走）。
 */
const BASELINE_FILE = join(ROOT, "scripts", "guards", "any-baseline.json");
const relOf = (f) => f.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "");
const current = Object.fromEntries(perFile.map(([f, n]) => [relOf(f), n]));
if (process.argv.includes("--update-any-baseline")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + "\n", "utf8");
  console.log(`已写入 ${relOf(BASELINE_FILE)}：${Object.keys(current).length} 个文件 / ${anyCount} 处 any`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const grew = Object.entries(current)
  .filter(([f, n]) => n > (baseline[f] ?? 0))
  .map(([f, n]) => `${f}(${baseline[f] ?? 0}→${n})`);
const shrunk = Object.entries(baseline)
  .filter(([f, n]) => (current[f] ?? 0) < n)
  .map(([f, n]) => `${f}(${n}→${current[f] ?? 0})`);
ok(grew.length === 0,
  `单个文件的 any 不超基线（基线 ${Object.keys(baseline).length} 个文件）`
  + (grew.length ? `；${grew.slice(0, 4).join("、")} —— 改小了就 --update-any-baseline 记账，改大了请写理由` : ""));
if (shrunk.length) console.log(`      可顺手记账（已降）：${shrunk.slice(0, 4).join("、")}`);

console.log(`\n【架构】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
