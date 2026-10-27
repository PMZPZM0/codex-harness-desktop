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

/* ── ② any 棘轮 ── */
/** 基线 = 10-27 实测值（`: any` + `as any`，排除 src 下 .d.ts 生成物）。只许降。 */
const ANY_CAP = 1696;
let anyCount = 0;
const perFile = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    const text = readFileSync(full, "utf8");
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
ok(/AnchorPopover/.test(railSrc) && !/placePanel/.test(railSrc) && !/getBoundingClientRect/.test(railSrc),
  "输入框竖条已改用原语（本文件不再自己算位置）");
const menuSrc2 = read("src/features/function-menu/FunctionMenu.tsx");
ok(/AnchorPopover/.test(menuSrc2) && !/const above = rect\.top/.test(menuSrc2),
  "侧栏「更多」浮层已改用原语（不再手写上下翻转）");

console.log(`\n【架构】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
