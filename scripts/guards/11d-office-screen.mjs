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
ok(/Math\.min\(len \* u,/.test(screen) || /Math\.min\(len,/.test(screen),
  "代码行段长按 innerW 收口（防画出屏面外）");

/* ── 判据组 E：**每种模式都必须有「持续变化」**（2026-10-04 用户报
   「显示器上没有 CSS 动画」）──
   ⛔ 病根不是"没调 drawScreen"（它每帧都在跑），而是**变化幅度在 53×30 屏面上
     看不见**：code 长满 6 行后完全静止（只剩 3×3px 光标，占屏面 0.6%）、
     thinking 只跳 2px、report 柱子 6 秒长完就停。
   ⇒ 判据形状：每种模式都必须在**每一帧**产生不同的像素，且**不得"长完就停"**。
   ⚠️ 屏面小 ⇒ 只有**位移 / 增删**看得见，"淡入淡出 / 缓慢变色"一律看不出来。 */
{
  /* 每种模式块：限定在 **drawScreen 函数体**内找，取**最后一个**匹配。
   * ⛔⛔ 两个坑叠在一起（各踩一次）：
   *   ① `indexOf` 找到的是文件尾部 `screenModeOf()` 里的三元（`mode === "code" ? PAL.codeBg`），
   *      那里也**同样写着一模一样的字符串** ⇒ 取到无关代码 ⇒ 恒红。
   *   ② 改成"取最后一个"也不够 —— `screenModeOf` 里的三元**同时含全部五个模式名**，
   *      "最后一个"照样落在它里面。
   * ✅ 唯一可靠做法：**先把 drawScreen 的函数体切出来**，再在块内找模式。 */
  const fnStart = screen.indexOf("export function drawScreen");
  const fnEnd = screen.indexOf("\n/** 成员活动", fnStart);
  const drawBody = fnStart >= 0
    ? screen.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined)
    : "";
  ok(drawBody.length > 200, `切出 drawScreen 函数体（${drawBody.length} 字符）`);

  /* 每种模式的绘制块。⚠️⛔ **不能靠 `mode === "xxx"` 定位**：
     · `report` 是**兜底分支**（if 链走完直接执行），源码里**没有** `mode === "report"`；
     · `search` 等虽有大写模式名，但同名的 `PAL.xxxBg` 三元会误导定位。
     ✅ 统一用**该模式专属的注释标记**（`// <name>：` 或 `if (mode === "<name>")` 前的注释）
        作为块起点，再取到下一个同缩进的 `if (mode ===` 或函数尾。 */
  /* 每种模式的绘制块。
   * ⛔⛔⛔ 判据自己在这上面裕了**三次**（indexOf → 取最后 → CRLF → 起点回退），
   *   每次都表现为「改动明明在，判据却恒红」。根因：**靠缩进/空白猜边界太脆**。
   * ✅ 稳的形状：**边界 = 下一个块标记**（显式标记，不猜）。
   *   判据面与代码面因此**共用同一套显式标记** —— 标记删了判据立刻报「找不到块」，
   *   不会静默取到错的那段。 */
  const MARK = /\/\/\s*(\w+)\s*[:：]\s*【块标记】/g;
  const marks = [...drawBody.matchAll(MARK)].map((m) => ({ name: m[1], at: m.index }));
  ok(marks.length >= 5, `扫到 ${marks.length} 个块标记（应 ≥5）`);

  const modeBlock = (name) => {
    if (!drawBody) return "";
    const i = marks.findIndex((m) => m.name === name);
    if (i < 0) return "";
    const from = marks[i].at;
    const to = i + 1 < marks.length ? marks[i + 1].at : drawBody.length;
    return drawBody.slice(from, to);
  };
  for (const name of ["code", "thinking", "search", "wait", "report"]) {
    const b = modeBlock(name);
    ok(b.length > 0, `找到 ${name} 模式的绘制块`);
    if (!b) continue;
    // 连续时间函数（Math.sin/cos）⇒ 每帧不同，不会"长完就停"
    const continuous = /Math\.(sin|cos)\s*\(/.test(b);
    // 位移类（y/x 坐标随t 变）⇒ 幅度够大看得见
    const moves = /yOff|sweep|groupY|% innerH|% \(Math\.sin|slot/.test(b);
    ok(continuous || moves,
      `${name} 模式有持续变化（连续函数或逐帧位移）—— 否则长完即静止 ⇒ 看着像没动画`);
  }
  // ⛔ 具体钉住 code 模式：必须有"像素级滚动"（yOff）而不是只靠行数增长
  ok(/const yOff = -/.test(modeBlock("code")),
    "⛔ code 模式有**像素级纵向滚动**（yOff）—— 只让行数增长的话长满就静止");
  // ⛔ report 模式：基准高度不能用 rnd()（每帧抖成噪声），且要有 wobble 波动
  const rep = modeBlock("report");
  ok(/wobble/.test(rep) && !/rnd\(\) \* 0\.7/.test(rep),
    "⛔ report 模式柱高有稳定基准 + 波动（不用 rnd() 当高度，否则每帧闪成噪声）");
}

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

/* ── 判据组 F：**普通会话也能开办公室**（2026-10-04 用户要求「给普通会话也加上，
   调度其他会话后就新增一个卡通人物」）──
   ⛔ 病根：成员来源只有 `team`（专家团）一条 ⇒ 普通会话里办公室永远是空的；
     且显示门槛是 `if (!teamId || !team) return null` ⇒ 连浮层都打不开。
   ⇒ 判据形状：两条来源（team / delegatedRuns）+ 门槛只认 teamId + 徽标计数与成员同源。 */
{
  const preview = readFileSync(join(ROOT, "src", "features", "team-office", "TeamOfficePreview.tsx"), "utf8");
  const appView = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");

  ok(/delegatedRuns\?:\s*DelegateRecordEntry\[\]/.test(preview),
    "⛔ TeamOfficePreview 接受 delegatedRuns prop（普通会话的成员来源）");
  ok(/if \(!team\)\s*\{[\s\S]{0,600}?delegatedRuns/.test(preview),
    "⛔ team 为空时走「委托记录当成员」这条路径");
  ok(/\.filter\(\(r\) => r\.status === "running"\)/.test(preview),
    "⛔ 只取 running 的委托（跑完的子会话该下班，不能越积越多直到 6 个满）");
  ok(/if \(!teamId\) return null;/.test(preview) && !/if \(!teamId \|\| !team\) return null;/.test(preview),
    "⛔ 显示门槛只认 teamId（原来的 `|| !team` 会把普通会话浮层直接挡掉）");
  // 成员 id 必须是 threadId（点角色要能直接打开子会话）
  ok(/id:\s*r\.threadId/.test(preview),
    "⛔ 普通会话成员的 id 是 threadId（点角色才能直接打开子会话）");
  // 点角色：普通会话分支直接用 threadId
  ok(/if \(!team\)\s*\{[\s\S]{0,300}?openThread\(del\.threadId\)/.test(preview),
    "⛔ 点角色在普通会话下直接打开该子会话");
  // 事件状态：普通会话不能返回 null（否则屏幕永远熄）
  /*⛔⛔ 不用固定字符窗口（`[\s\S]{0,400}?`）—— 实测这段有 **511 字符**，窗口不够就恒红。
     ⛔ 本轮已经因为"固定字符窗口"栽过三次（spinner 900 vs 1671、kb 900 vs 1671、这里 400 vs 511）。
     ✅ 改成按**函数边界**取块：取 `eventStateOf` 的函数体，与长度无关。 */
  const esStart = preview.indexOf("const eventStateOf = (memberId: string) => {");
  const esEnd = preview.indexOf("\n  /*", esStart);
  const esBody = esStart >= 0 ? preview.slice(esStart, esEnd > esStart ? esEnd : undefined) : "";
  ok(esBody.length > 100, `切出 eventStateOf 函数体（${esBody.length} 字符）`);
  ok(/if \(!team\)/.test(esBody) && /thinking:/.test(esBody),
    "⛔ 普通会话下 eventStateOf 有默认活动（否则屏幕永远熄屏）");
  // 随机取名：必须按 id 确定性取，不能每次渲染重随
  ok(/ROLE_NAMES/.test(preview) && /run\.threadId\.charCodeAt/.test(preview),
    "⛔ 随机名按 threadId 哈希取（同一人恒定同名，不会每帧改名）");
  // AppView：传参 + 徽标计数同源
  ok(/delegatedRuns=\{app\.delegatedRailRuns\}/.test(appView),
    "⛔ AppView 把 delegatedRailRuns 传进去");
  ok(/officeRunningCount\s*=\s*delegatedRailRuns\.filter\(\(r\) => r\.status === "running"\)\.length/.test(appView),
    "⛔ 徽标计数与办公室成员同源（都用 running 的委托条数，否则徽标 3、屋里 0 人）");
  ok(/OFFICE_SESSION_TEAM_ID\s*=\s*"__office-session__"/.test(appView),
    "⛔ 普通会话用哨兵 teamId 打开（不能用空串 —— 与「未打开」不可区分）");
  // 入口按钮
  ok(/className="office-entry-btn"/.test(appView), "有常驻入口按钮");
  ok(/\.office-entry-btn\s*\{/.test(
      readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8"),
    ), "入口按钮有样式（否则裸按钮不可见）");
}

console.log(`\n【screen】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
