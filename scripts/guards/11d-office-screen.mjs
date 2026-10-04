/**
 * 办公室「显示器内容区」坐标判据（2026-10-04）
 *
 * ⛔⛔ 起因：用户截图里办公室出现**三个大黑块盖在桌子上**。
 *   根因 = `SEATS[].screen` 的坐标是**从用户截图反推**的（792×544 截图按 960/792 换算），
 *   而**那张截图是缩放过的** ⇒ y 偏了 **91px**（真值 253，我算176）⇒ 内容区画在桌子上。
 *
 * ⭐ 判据形状（这才是重点）：**不许从"用户截图"反推画布坐标**。
 *   有原始素材（`assets/bg.webp`，与画布 1:1）就直接在**素材本身**上量。
 *   ⇒ 本判据把**实测出的六个屏面矩形**写成常量，逐个核对 `座位 + 偏移` 落在其中。
 *
 * ⛔ 为什么必须逐个钉：六个屏面尺寸**各不相同**（53/58/58/53/55/53 宽、30-32 高），
 *   背景图是手绘像素风、显示器本来就不齐 ⇒ 写一个"统一值"必然有一两个错位。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【screen】${m}`); if (!c) fails++; };

/* 实测值：在 `src/features/team-office/assets/bg.webp`（960×640，与画布 1:1）上扫出来的屏面矩形。
   识别判据：像素 rgb(36,50,75) 一带（暗且 B > R+20）⇒ 逐行取长度 > 30 的连续段
   → 按「相邻 y 且 x 范围相近」聚成矩形。重测方法见office-format.ts 的注释。 */
const TRUTH = [
  { x1: 241, y1: 253, x2: 293, y2: 282 },
  { x1: 460, y1: 253, x2: 517, y2: 282 },
  { x1: 677, y1: 253, x2: 734, y2: 283 },
  { x1: 240, y1: 447, x2: 292, y2: 476 },
  { x1: 464, y1: 447, x2: 518, y2: 478 },
  { x1: 677, y1: 447, x2: 729, y2: 478 },
];

const fmt = readFileSync(join(ROOT, "src", "features", "team-office", "office-format.ts"), "utf8");

// 解析 SEATS 里的 screen 偏移与座位坐标
// ⛔⛔ 判据自己踩的坑：正则**必须带 `s` 标志**（dotAll）。
//   否则 `.*?` 不跨行，而每个座位对象是**单行**的 —— 于是一个都匹配不到，
//   而"解析出 0 个"这种失败**不像报错**（脚本继续跑、其它断言照常）⇒ 极易误判成"通过"。
// ⛔ 另：必须先切出 `SEATS` 数组块，否则会匹配到文件里其它 `{ x: …, y: … }`（DOOR_SPOT 之类）。
const seatsIdx = fmt.indexOf("export const SEATS");
const seatsEnd = fmt.indexOf("\n];", seatsIdx);
ok(seatsIdx > 0 && seatsEnd > seatsIdx, "找得到 SEATS 数组块");
const seatsBlock = seatsIdx > 0 ? fmt.slice(seatsIdx, seatsEnd) : "";
const seats = [...seatsBlock.matchAll(
  /x:\s*(-?\d+),\s*y:\s*(-?\d+)[^\n]*?screen:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g,
)].map((m) => ({
  seatX: Number(m[1]), seatY: Number(m[2]),
  dx: Number(m[3]), dy: Number(m[4]), w: Number(m[5]), h: Number(m[6]),
}));

ok(seats.length === 6, `解析出 6 个座位的 screen（实际 ${seats.length}）`);

seats.forEach((s, i) => {
  const ax = s.seatX + s.dx;
  const ay = s.seatY + s.dy;
  const ax2 = ax + s.w - 1;
  const ay2 = ay + s.h - 1;
  const t = TRUTH[i];
  if (!t) { ok(false, `座位 ${i} 没有对应的实测矩形`); return; }
  // 内容区必须**完全落在**实测屏面内（可内缩，不可越界）
  const inside = ax >= t.x1 && ay >= t.y1 && ax2 <= t.x2 && ay2 <= t.y2;
  ok(inside,
    `座位${i} 内容区 (${ax},${ay})-(${ax2},${ay2}) 落在屏面 (${t.x1},${t.y1})-(${t.x2},${t.y2}) 内`
    + (inside ? "" : "  ⛔ 越界 ⇒ 会画到桌子上（用户截图的大黑块）"));
  //⛔ 越界量也要报出来，方便直接看偏了多少
  if (!inside) {
    const d = { dx: t.x1 - ax, dy: t.y1 - ay, dw: (t.x2 - t.x1 + 1) - s.w, dh: (t.y2 - t.y1 + 1) - s.h };
    console.log(`      偏差：Δx=${d.dx} Δy=${d.dy} Δw=${d.dw} Δh=${d.dh}`);
  }
});

//⛔ 尺寸合理性：屏面只有 ~53×30，内容区不能画成大块（那正是"大黑屏"的观感）
seats.forEach((s, i) => {
  ok(s.w <= 60 && s.h <= 34,
    `座位${i} 内容区 ${s.w}×${s.h} 不超过屏面尺度（≤60×34，实测最大 58×32）`);
});

// ⛔⛔ 排版不许硬编码：六个屏面尺寸不同，写死一套偏移必然在小的那个上溢出
const screen = readFileSync(join(ROOT, "src", "features", "team-office", "office-screen.ts"), "utf8");
ok(/const u = Math\.max\(2, Math\.round\(h \/ 10\)\)/.test(screen),
  "⛔ 排版从 w/h 推导单位格 u（六个屏面尺寸不同，硬编码必溢出）");
ok(!/const rowH = 6;/.test(screen) && !/const n = 6;/.test(screen),
  "⛔ 不许写死行高 6 / 柱数 6（那是给 116×62 大屏设计的）");
// 代码行段长必须按可用宽度收口
ok(/Math\.min\(len,/.test(screen), "代码行段长按 innerW 收口（防画出屏面外）");

/* ── 判据组 D：**sim 必须是全局单例**（2026-10-04 用户报「每次打开办公室预览，
   人物就重新进办公室」）──
   ⛔ 病根：`OfficeCanvas` 在 `useEffect(..., [])` 里 `new OfficeSim()`，
     而**每次打开预览 = 画布重新挂载** ⇒ 新 sim ⇒ 成员回门口 (`x:64,y:596`) 重播进场。
   ⇒ 判据形状：**sim 的创建点必须在模块顶层**（不在任何函数/组件体内）。
   ⚠️ 单纯 grep "有没有 new OfficeSim"不够—— 单例函数里也该有；
     要钉的是「它被一个模块级变量持有、且那个变量不在组件里」。 */
{
  const canvas = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  ok(/let officeSimSingletonRef\s*:\s*OfficeSim \| null = null/.test(canvas),
    "⛔ sim 由模块级变量持有（不在组件里）—— 否则画布重挂载 ⇒ 位置全丢");
  ok(/function officeSimSingleton\(\)\s*:\s*OfficeSim\s*\{[\s\S]{0,200}?if \(!officeSimSingletonRef\)[\s\S]{0,120}?officeSimSingletonRef = new OfficeSim\(\)/.test(canvas),
    "⛔ 单例函数惰性创建 sim（重复 new 会退回到「每次进场」）");
  //⛔ 组件里**不许**再直接 new OfficeSim()
  const inEffect = /useEffect\(\(\) => \{[\s\S]*?\n {4}\}\);/.exec(canvas)?.[0] ?? "";
  ok(!/new OfficeSim\(\)/.test(inEffect),
    "⛔ useEffect 里没有直接 new OfficeSim()（那正是重播进场的病根）");
  ok(/const sim = officeSimSingleton\(\)/.test(canvas),
    "⛔ 画布用的是单例（而不是自己 new）");
}

console.log(`\n【screen】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
