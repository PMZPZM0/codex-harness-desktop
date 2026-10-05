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
import { readFileSync, readdirSync } from "node:fs";
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
   ⇒ 判据形状：两条来源（team / delegatedRuns）+ 门槛只认 teamId + 成员 id 用 threadId。
   ⭐ 10-05 追加（用户：「普通会话的办公室预览按键图标和位置跟专家和专家团一样，
     展示在对话框右边轨道上」）：入口**从 AppView 的浮动胶囊改成右侧轨道末位节点**，
     与专家团成员轨共用 `OfficeRailNode` —— 见本组尾部那几条。
   ⭐⭐ 10-05 再追加（用户：「我调度了一个专家，办公室预览里面没有更新成员」）：
     **成员来源 = 委托登记表（含已完成）**，跑完的坐工位待机、⛔ 不从名单里消失。
     ⛔ 病根是曾经按 `status === "running"` 过滤 —— 委托真机实测 **3.7 秒**就跑完，
       用户点开办公室时它早已 done ⇒ 办公室永远空的（而头像轨还挂着它，两个面自相矛盾）。 */
{
  const preview = readFileSync(join(ROOT, "src", "features", "team-office", "TeamOfficePreview.tsx"), "utf8");
  const appView = readFileSync(join(ROOT, "src", "features", "app-view", "AppView.tsx"), "utf8");

  ok(/delegatedRuns\?:\s*DelegateRecordEntry\[\]/.test(preview),
    "⛔ TeamOfficePreview 接受 delegatedRuns prop（普通会话的成员来源）");
  ok(/if \(!team\)\s*\{[\s\S]{0,600}?delegatedRuns/.test(preview),
    "⛔ team 为空时走「委托记录当成员」这条路径");
  ok(/running:\s*r\.status === "running"/.test(preview),
    "⛔ 跑完的成员**留在办公室**但置为待机（running 是标志位，不是过滤条件）");
  ok(!/\.filter\(\(r\) => r\.status === "running"\)/.test(preview),
    "⛔ 不许按 running 过滤成员（那正是「派了专家、办公室却没人」的病根）");
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
  /* ⛔ 成员源必须是**委托登记表**（`delegateRecords`，含已完成）——
     10-05 用户报「我调度了一个专家，办公室预览里面没有更新成员」：
     喂头像轨的 live 表（跑完 20 秒就摘）或按 running 过滤，都会让办公室永远是空的。 */
  ok(/delegatedRuns=\{officeDelegates\}/.test(appView) &&
    /Object\.values\(app\.delegateRecords\)/.test(appView),
    "⛔ AppView 把委托登记表（含已完成）传进办公室");
  ok(!/delegatedRuns=\{app\.delegatedRailRuns\}/.test(appView),
    "⛔ 不许把头像轨的 live 表传给办公室（跑完 20 秒就摘 ⇒「派了专家没人」）");
  const railsSrc = readFileSync(join(ROOT, "src", "features", "experts-teams", "ExpertsTeams", "02-rails.tsx"), "utf8");
  const tlSrc = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "02-main-stage", "01-timeline.tsx"), "utf8");
  /* ⭐ 10-05 入口改位置（用户：「普通会话的办公室预览按键图标和位置跟专家和专家团一样，
     展示在对话框右边轨道上」）⇒ 判据跟着换形状：
       · 旧形态 = `.office-entry-btn` 浮动胶囊（左下角）⇒ **整体删除**，⛔ 不许回潮；
       · 新形态 = **两条轨共用同一个末位节点**（`OfficeRailNode`）。
     ⛔ 为什么钉"共用同一个组件"：用户这次报的正是"两处入口长得不一样"——
       各写一份 markup 就一定会漂（图标/位置/title 三处都会各自演化）。 */
  const officeNodeUses = railsSrc.match(/<OfficeRailNode onOpen=\{/g) ?? [];
  ok(/function OfficeRailNode\(/.test(railsSrc),
    "⛔ 办公室入口节点抽成了共用组件 OfficeRailNode");
  ok(officeNodeUses.length === 2,
    `⛔ TeamMemberRail 与 DelegatedRail **都**用它渲染入口（实际 ${officeNodeUses.length} 处）`);
  /* ⛔ 共用的是**外观**，不是文案：两条轨里"办公室里坐的是谁"不一样
     （专家团 = 团队成员；普通会话 = 本会话派出去的子会话）⇒ 各带自己的 title。
     本轮 code review 抓到的正是这条：合并节点时把专家团那句"成员状态实时映射"也改掉了。 */
  ok(/<OfficeRailNode onOpen=\{onOpenOffice\} title="办公室预览：成员状态实时映射成像素办公室/.test(railsSrc) &&
    /<OfficeRailNode onOpen=\{onOpenOffice\} title="办公室预览：调度出去的子会话会变成办公室里的人/.test(railsSrc),
    "⛔ 两个入口各带自己的 title（写死一句 ⇒ 对其中一条会话的悬停提示说假话）");
  ok(/onOpenOffice=\{\(\) => setCompanyPreviewTeamId\(OFFICE_SESSION_TEAM_ID\)\}/.test(tlSrc),
    "⛔ 普通会话的调度轨把入口接到预览状态（哨兵 teamId 开浮层）");
  // ⛔ 门槛不许再用 runs.length：那会让「还没调度过」的普通会话整条轨消失 ⇒ 入口无处安放
  ok(/\{!railTeam && \(/.test(tlSrc) &&
    !/delegatedRailRuns\.length > 0 && \(/.test(tlSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")),
    "⛔ 轨道按「非专家团会话」渲染（⛔ 不拿 runs.length 当门槛，否则没调度过就没有入口）");
  ok(/OFFICE_SESSION_TEAM_ID\s*=\s*"__office-session__"/.test(
      readFileSync(join(ROOT, "src", "features", "team-office", "index.ts"), "utf8"),
    ), "⛔ 哨兵 teamId 定义在 team-office 域（timeline 与 AppView 都要用，留 AppView 会循环 import）");
  // 入口样式：复用成员轨那套轨道节点样式
  ok(/\.team-rail-node\.team-rail-office\s*\{/.test(
      readFileSync(join(ROOT, "src", "styles", "19-misc-hints.css"), "utf8"),
    ), "入口复用轨道节点样式 team-rail-office（否则裸按钮不可见）");
  // ⛔ 负向：浮动胶囊不许回来（它正是"跟专家团不一样"的那个形态）。
  //    ⛔ 必须**先剥注释**——AppView 里那段说明文字本身就写着 `.office-entry-btn`，
  //    不剥的话这条永远红（项目里点名的"注释里引用代码片段"坑，负向断言必踩）。
  const appViewCode = appView.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/office-entry-btn/.test(appViewCode), "⛔ AppView 不再有 .office-entry-btn 浮动入口（入口归轨道）");
  /* ── 素材内联判据（2026-10-05 用户报「办公室白了」）──
     bg.webp 80KB > 全局 assetsInlineLimit(64KB) ⇒ 被拆成独立文件 /assets/bg-*.webp，
     构建版 file:// 下解析到盘根 ⇒ 404 ⇒ 白底。人物 PNG 小于阈值内联所以一直正常（拖到今天才暴露）。
     ⛔ 同族坑第三次（0.0.27 死块 / drama-canvas 白方块 / 本次）：canvas import 的素材必须内联。 */
  const canvasSrc = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  ok(/bg\.webp\?inline/.test(canvasSrc), "办公室 bg.webp 必须 ?inline 强制 data: URI（80KB 超阈值，拆成文件 = 构建版白底）");
  const distAssets = readdirSync(join(ROOT, "dist", "assets"));
  ok(!distAssets.some((f) => /^bg-.*\.webp$/.test(f)), "dist/assets 不许出现 bg-*.webp 独立文件（出现 = 内联失效，构建版必白）");
}

console.log(`\n【screen】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
