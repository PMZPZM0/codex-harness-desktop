/**
 * 办公室「显示器内容区」坐标判据（2026-10-04 立，**10-05 修**）
 *
 * ⛔⛔ 起因：用户截图里办公室出现**三个大黑块盖在桌子上**。
 *   根因 = `SEATS[].screen` 的坐标是**从用户截图反推**的（792×544 截图按 960/792 换算），
 *   而**那张截图是缩放过的** ⇒ y 偏了 **91px**。
 *
 * ⛔⛔⛔ **10-05 再次翻车，且这次是"判据自己在保护错误"** —— 必须记死：
 *   本文件下面的 `TRUTH` 常量是 10-04 用判据 `(r+g+b)<260 and b>r+20 and 30<=r<=90 and 40<=g<=110`
 *   扫 bg.webp 得到的 —— 而**椅背 rgb(47,65,95) 恰好完全命中了那条判据**
 *   （sum=207、b=95>r+20、r=47∈[30,90]、g=65∈[40,110]）⇒ `TRUTH` 里存的是**椅背**矩形，
 *   六个都错，y 真值 ~169-202 被写成 253-283（差 ~84px）。
 *   ⇒ 于是本判据"内容区落在 TRUTH 内"**一直绿**，因为 `SEATS[].screen` 也是用同一份
 *     错误扫描写的 —— **参照与对象出自同一份想象，自洽地一起错**。
 *   ⇒ 用户 10-05 报「你做的那个显示没对准、没显示」，本判据**拦不住**。
 *
 * ✅ 10-05 修正：`TRUTH` 换成**亮度判据**重扫的结果
 *   （屏幕玻璃 sum≈130 / 椅背 sum≈207 / 显示器外框 sum≈300 ⇒ `sum<190` 可分），
 *   **且必须先限定 y 带再逐列判**（上排 165-205、下排 355-400）——
 *   不限定 y 的话椅背会一起被收进来（这正是 10-04 出错的原因）。
 *
 * ⛔⛔⛔ **10-06 第三次翻车（用户：「两侧仍有固定展示内容」）—— 这次最隐蔽**：
 *   10-05 换的亮度判据**看似修好了**，其实把玻璃区**测窄了 30%**（50×34 vs 真实 66×32）：
 *   它要求"该列 ≥35% 像素 sum<190"，而**屏幕右半有背景图里烙死的彩色界面**（亮）
 *   ⇒ 右半列的暗占比达不到阈值 ⇒ **被整列切掉**，连"框的位置"都跟着偏到左边。
 *   ⇒ 动态内容只盖住玻璃的左 3/4（右侧露出背景静态界面），再加上部分场景自己
 *     也只用到内容区的左半 ⇒ 用户看到的就是"两侧没动画"。
 *   ⛔ 教训（比前两次更深一层）：错误不在于"扫错了对象"，而在于**判据自己划定了
 *     测量范围**——先假定"暗的才是玻璃"，再在暗像素里量宽度 ⇒ 结果必然 ≤ 真值，
 *     而且六台读数很整齐（48~52），**自洽到完全看不出问题**。
 *   ✅ 10-06 正解（三层交叉，缺一层就可能再错）：
 *     ① 闭运算（MaxFilter→MinFilter）填掉屏内彩色内容 ⇒ 逐列取**最长连续段**（得上界）；
 *     ② 把该区域**放大 8 倍 + 画 10px 网格**，人工读精确边界；
 *     ③ 把最终框**画回 bg 上目视复核**（`verify-screen.py`）⇒ 必须正好套住玻璃。
 *   现行值：**66×32**（玻璃 65×32 + 1px 边缘容差）。
 *
 * ⭐ 教训（比坐标本身更重要）：**判据的参照值必须来自与断言对象相互独立的一次测量**。
 *   两边用同一个脚本同一次跑出来的结果 ⇒ 断言只能证明"自洽"，证明不了"对"。
 *   ⇒ 本文件另加一条**不依赖 TRUTH** 的几何判据（屏面必须在椅背上方），
 *     作为交叉验证 —— 它能在 TRUTH 再次写错时独立报红。
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【screen】${m}`); if (!c) fails++; };

/* 实测值（**10-06 第三次重测**）：在 `src/features/team-office/assets/bg.webp` 上测出的
   **屏幕玻璃**矩形 = **66×32**。
   ⛔ 前两版都测窄/测错（详见文件头），10-06 这次的判据是「闭运算填洞 + 逐列最长连续段」
     **再加人工放大 8 倍读数**，并用 `.workbuddy/tmp/screen-verify.py` 把框画回 bg 上目视复核。
   ⚠️ 这里的 x2 比"人工读到的玻璃右边界 300"多 1（= 301）：内容区**故意**比玻璃多 1px
     盖住边缘的过渡像素（否则边缘会露出背景里的静态界面 —— 那正是用户报的现象）。
     所以这一条不是"为适配代码而改"：**玻璃读数 236~300 是独立测的，+1 是明确的设计选择**。
   重测方法见 `office-format.ts` 的 SEATS 注释。⛔ 改这里必须重新测图，别照抄。 */
const TRUTH = [
  { x1: 236, y1: 168, x2: 301, y2: 199 },
  { x1: 462, y1: 168, x2: 527, y2: 199 },
  { x1: 677, y1: 168, x2: 742, y2: 199 },
  { x1: 236, y1: 366, x2: 301, y2: 397 },
  { x1: 461, y1: 366, x2: 526, y2: 397 },
  { x1: 677, y1: 366, x2: 742, y2: 397 },
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
  /x:\s*(-?\d+),\s*y:\s*(-?\d+)[^\n]*?backrest:\s*\{\s*dx:\s*(-?\d+),\s*dy:\s*(-?\d+),\s*w:\s*\d+,\s*h:\s*\d+\s*\}[^\n]*?screen:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/g,
)].map((m) => ({
  seatX: Number(m[1]), seatY: Number(m[2]),
  backrestDy: Number(m[4]),
  dx: Number(m[5]), dy: Number(m[6]), w: Number(m[7]), h: Number(m[8]),
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

//⛔ 尺寸合理性：屏面实测 **66×32**，内容区不能画成大块（那正是"大黑屏"的观感）。
//  ⚠️ 10-06 从 ≤60×36 放宽到 ≤70×38：真实玻璃区就是 66×32（见 TRUTH 注释），
//    旧阈值（≤60）来自那次**测窄了的**读数 ⇒ 继续用会把正确的值判成红。
seats.forEach((s, i) => {
  ok(s.w >= 60 && s.w <= 70 && s.h >= 28 && s.h <= 38,
    `座位${i} 内容区 ${s.w}×${s.h} 在屏面尺度内（60~70 × 28~38；10-06 实测 66×32）`);
});

/* ⛔⛔ 交叉验证 —— **不依赖上面的 TRUTH**（10-05 教训的正解）。
   理由：椅背随后会被"重贴"盖回人物身上（见 OfficeCanvas 的 backrest 重贴），
   ⇒ 屏面若与椅背相交，画上去的动态内容会被**整块盖掉**（用户报的"没显示"）。
   判据用**几何不可能性**：屏面底必须高于椅背顶（相对座位坐标 dy+h <= backrestDy）。
   ⛔ 这条与 TRUTH 相互独立 ⇒ 即使 TRUTH 又被写错，它仍能独立报红。 */
seats.forEach((s, i) => {
  const screenBottom = s.dy + s.h;
  ok(screenBottom <= s.backrestDy,
    `座位${i} 屏面底(${screenBottom}) 在椅背顶(${s.backrestDy}) 之上`
    + (screenBottom <= s.backrestDy ? "" : "  ⛔ 与椅背相交 ⇒ 会被椅背重贴整块盖掉"));
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
  /* ⛔ 10-05 晚改契约：eventStateOf 走**真实阶段 + 真实事件**（原来是"编三个布尔"）。
     锚点跟着换（原来锚 `=> {` 会 indexOf 到 -1 ⇒ 切出 0 字符 ⇒ 判据在空跑）。 */
  const esStart = preview.indexOf("const eventStateOf = (memberId: string)");
  const esEnd = preview.indexOf("\n  /* ⛔ 门槛", esStart);
  const esBody = esStart >= 0 ? preview.slice(esStart, esEnd > esStart ? esEnd : undefined) : "";
  ok(esBody.length > 100, `切出 eventStateOf 函数体（${esBody.length} 字符）`);
  /* ⛔ 事件查询走 `eventOf`（它内部才是 officeActivityOf）——
     锚点取的是 eventStateOf 的函数体，别去里面找 officeActivityOf（那会恒红）。 */
  /* ⛔ 用 `!team` + 词边界：非专家团分支的条件已经变成
     `if (!team && self?.threadId && …)`，钉死 `if (!team)` 会恒红（实测踩过）。 */
  ok(/if \(!team\b/.test(esBody) && /phaseOfRun\(/.test(esBody) && /eventOf\(/.test(esBody),
    "⛔⛔ 非专家团路径也走**真实阶段 + 真实事件**（⛔ 退回\"编一个默认活动\"就是「事件状态未接通」）");
  ok(!/thinking:\s*(true|false|act ===)/.test(esBody),
    "⛔⛔ 不许再出现**编造的** thinking/waiting/reporting 三布尔（上一版 `reporting: act === null` ⇒ code 屏永不出现）");
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

/* ══ 组 G：全屏铺满（10-05 晚 用户报「画面未铺满全屏，只显示在中间区域」）═════
   ⛔ 病根：画布只有 `max-width/max-height:100%` —— 那只**限制上限、不会放大**，
     而画布固有尺寸就是 960×640 ⇒ 窗口一大就只剩中间一块，四周是浮层底色。
   ✅ 判据钉三件事：① 舞台裁溢出；② 画布不许被 flex 压回去（flex:none）；
     ③ 尺寸由 `fitCover` 按 cover 规则显式写死。
   ⛔⛔ 另加一条**负向**断言：不许用 `object-fit` —— 那会让元素盒与实际渲染区不一致，
     而点击命中算的是 `getBoundingClientRect()` ⇒ 人物点不中（比留边距更坏）。 */
{
  const css = readFileSync(join(ROOT, "src", "styles", "20-team-office.css"), "utf8");
  const canvasSrc = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  ok(/\.office-overlay-stage\s*\{[\s\S]{0,400}?overflow:\s*hidden/.test(css),
    "⛔ 舞台容器裁溢出（cover 铺满靠它把画布多出来的部分裁掉）");
  ok(/\.office-pixel-canvas\s*\{[\s\S]{0,300}?flex:\s*none/.test(css),
    "⛔⛔ 画布 `flex: none`（不写的话 flex 会把超出容器的子项压回去 ⇒ cover 静默失效）");
  ok(!/\.office-pixel-canvas\s*\{[\s\S]{0,300}?object-fit/.test(css),
    "⛔⛔ 画布不许用 object-fit（元素盒≠渲染区 ⇒ 点击命中整体偏移、人物点不中）");
  ok(/const scale = Math\.max\(sw \/ CANVAS_W, sh \/ CANVAS_H\)/.test(canvasSrc),
    "⛔ 铺满用 cover 规则（取两轴较大缩放 ⇒ 永远铺满且保持 3:2，不拉伸像素）");
  ok(/canvas\.style\.width = /.test(canvasSrc) && /canvas\.style\.height = /.test(canvasSrc),
    "⛔ 画布尺寸**显式写死**（而不是交给 CSS 上限，那样只会缩不会放）");
}

/* ══ 组 H：事件面 + 画面映射（10-05 晚 用户要求「把对话框里出现的所有事件接入显示器」）
   ⛔ 真跑（`--experimental-strip-types` 直接 import .ts）：`office-activity.ts` 的依赖
     全是 .mjs，node 能直接解析 ⇒ 不需要扩展名补全钩子。
   ⛔ 判据形状：拿**对话框真实会出现的 item**（引擎的几种 type）过分类器，
     核对"事件 → 画面模式 → 顶栏词"这条链，而不是只查函数存在。 */
{
  const script = `
import { classifyOfficeItem } from "./src/features/team-office/office-activity.ts";
import { screenModeOfEvent, screensaverAt, drawScreen, SA_SCENES, marqueeText, microWidth } from "./src/features/team-office/office-screen.ts";
const cases = [
  [{ type: "fileChange", changes: [{ path: "a/b.ts", diff: "@@\\n-old\\n+new\\n" }] }, "file-edit", "file-edit"],
  [{ type: "fileChange", changes: [{ path: "a/new.md", diff: "@@\\n+x\\n" }] }, "file-write", "file-write"],
  [{ type: "commandExecution", command: "Select-String -Pattern foo -Path src/*.ts" }, "file-search", "file-search"],
  [{ type: "commandExecution", command: "Get-Content -LiteralPath a.ts" }, "file-read", "file-read"],
  [{ type: "commandExecution", command: "Set-Content -Path a.ts -Value x" }, "file-edit", "file-edit"],
  [{ type: "commandExecution", command: "npm run build" }, "terminal", "terminal"],
  [{ type: "commandExecution", command: "start chrome https://example.com" }, "browser", "browser"],
  [{ type: "mcpToolCall", server: "playwright", tool: "browser_navigate" }, "browser", "browser"],
  [{ type: "mcpToolCall", server: "x", tool: "y" }, "service", "service"],
  [{ type: "webSearch", query: "sse" }, "websearch", "search"],
  [{ type: "collabAgentToolCall", tool: "spawn" }, "collab", "collab"],
  [{ type: "reasoning" }, "thinking", "thinking"],
  [{ type: "userMessage", text: "hi" }, null, null],
  [{ type: "plan" }, null, null],
];
let bad = 0;
for (const [item, wantKind, wantMode] of cases) {
  const got = classifyOfficeItem(item);
  const mode = got ? screenModeOfEvent(got.kind) : null;
  const pass = (got ? got.kind : null) === wantKind && mode === wantMode;
  if (!pass) bad += 1;
  console.log((pass ? "OK " : "NO ") + item.type + " → " + (got ? got.kind : "null") + " / " + mode);
}
/* ⭐ 屏保（10-06 重做）：9 档覆盖 + 同刻六工位不同档 + mix 合法。
   ⛔ 判据换成"遍历"而不是"取几个采样点"—— 旧版只查 size>=2，
     新的档位池要是写错步进（比如步进与池长不互质）就会有档永远不出现。 */
const saAll = new Set();
for (let s = 0; s < 40; s += 1) for (let tt = 0; tt < 200; tt += 0.5) saAll.add(screensaverAt(tt, s * 3 + 1).from);
const saTiles = new Set([0, 1, 2, 3, 4, 5].map((i) => screensaverAt(3.2, i + 1).from));
let mixOk = true;
for (let k = 0; k < 400; k += 1) { const m = screensaverAt(k * 0.37, 7).mix; if (m < 0 || m > 1) mixOk = false; }
console.log((saAll.size === SA_SCENES.length && saTiles.size >= 4 && mixOk ? "OK " : "NO ")
  + "屏保：覆盖 " + saAll.size + "/" + SA_SCENES.length + " 档、同刻 6 工位 " + saTiles.size + " 档不同、mix 合法=" + mixOk);
/* ⭐ 每档都必须铺满**恰好等于屏面框**的底色。
   ⛔ 这条防的是真实事故（10-04「三个大黑块盖在桌子上」）：屏保里"云从屏外飘进来"
     "代码雨从顶上落下"是**故意**越界的（由调用侧 clip 裁掉），但**底色**一旦画错尺寸
     就会盖住显示器外框和桌子。 */
{
  const mk = () => {
    const rects = []; const t = { fillStyle: "#000", globalAlpha: 1 };
    return { rects, ctx: new Proxy(t, {
      get: (o, k) => {
        if (k === "fillRect") return (x, y, w, h) => rects.push({ x, y, w, h });
        if (k === "measureText") return () => ({ width: 8 });
        if (k in o) return o[k];
        return () => undefined;
      },
      set: (o, k, v) => { o[k] = v; return true; },
    }) };
  };
  const missing = [];
  const thin = [];
  for (const scene of SA_SCENES) {
    let hit = false;
    for (let s = 1; s <= 60 && !hit; s += 1) {
      for (let tt = 0; tt < 400; tt += 0.25) {
        const at = screensaverAt(tt, s);
        if (at.from !== scene || at.mix > 0) continue;
        const { ctx, rects } = mk();
        drawScreen(ctx, tt, "idle", s, 216, 138, 66, 32, {});
        hit = rects.some((r) => r.x === 216 && r.y === 138 && r.w === 66 && r.h === 32);
        /* ⭐ 内容**横向铺满**（10-06 用户报「两侧仍有固定展示内容」的正面判据）：
           剔除"整块底色"后，剩余元素的并集宽度必须覆盖 ≥85%。
           ⛔ 只查底色不够 —— 底色对、内容只画左半边，照样会露出右侧的背景静态界面。 */
        const inner = rects.filter((r) => !(r.x === 216 && r.y === 138 && r.w >= 66 && r.h >= 32));
        let x0 = 1e9, x1 = -1e9;
        for (const r of inner) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); }
        if (inner.length && (x1 - x0) / 66 < 0.85) thin.push(scene + "(" + Math.round(((x1 - x0) / 66) * 100) + "%)");
        break;
      }
    }
    if (!hit) missing.push(scene);
  }
  console.log((missing.length === 0 ? "OK " : "NO ") + "屏保每档铺满屏面底色（缺：" + (missing.join(",") || "无") + "）");
  console.log((thin.length === 0 ? "OK " : "NO ") + "屏保内容横向铺满 ≥85%（偏窄的档：" + (thin.join(",") || "无") + "）");
}
const long = marqueeText("NPM RUN BUILD ELECTRON", 46, 0);
const moved = marqueeText("NPM RUN BUILD ELECTRON", 46, 1.4);
console.log((long !== moved && microWidth("SEARCH") < 46 ? "OK " : "NO ") + "微字模：SEARCH 宽 " + microWidth("SEARCH") + "px、长文本滚动");
console.log(bad === 0 ? "OK 事件分类全部符合" : "NO " + bad + " 条分类不符");
`;
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script],
    { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  const lines = out.split("\n").filter((line) => /^(OK|NO) /.test(line.trim()));
  ok(lines.length >= 18, `事件面真跑出 ${lines.length} 条（⛔ 0 条 = 脚本没跑起来）`);
  for (const line of lines) {
    const good = line.trim().startsWith("OK ");
    checks += 1;
    if (!good) fails += 1;
    console.log(`  ${good ? "✓" : "✗"} 【screen】${line.trim().slice(3)}`);
  }
}

/* ══ 组 I：**姿态与屏幕同源**（用户 10-05：「确保事件对应的卡通人物动画与显示器内容
   严格一一联动对应」）═══════════════════════════════════════════════════════
   ⛔ 判据：姿态必须由**同一个 mode** 推出来（而不是另判一套条件）——
     两套条件必然漂（屏幕上放着剧、人却在猛敲键盘）。 */
{
  const canvasSrc = readFileSync(join(ROOT, "src", "features", "team-office", "OfficeCanvas.tsx"), "utf8");
  ok(/const seatMode: ScreenMode\[\] = \[\]/.test(canvasSrc) && /seatMode\[i\] = mode/.test(canvasSrc),
    "⛔ 每个工位这一帧的画法被记下来（供第二遍画人物时推姿态）");
  /* ⛔ 10-06 改：屏保由 `idle` 一档承载轮播，`seatMode` 不再被换成 video/game
     ⇒ 姿态要拿**当前屏保档**（`seatScene`，与屏面同源同一个 `screensaverAt`）判。
     ⛔ 仍然只允许**一个**判据来源 —— 别再另判一套条件。 */
  ok(/const seatScene: \(SaScene \| null\)\[\] = \[\]/.test(canvasSrc)
    && /const slack = a\.action === "sit" && \(scene === "tv" \|\| scene === "game"\)/.test(canvasSrc)
    && /seatScene\[i\] = screensaverAt\(now \/ 1000, seed\)\.from/.test(canvasSrc),
    "⛔⛔ 摸鱼姿态**由屏保当前档推出**（tv/game ⇒ 后仰看剧），且与屏面用同一个 screensaverAt");
  /* ⛔ 屏面必须被裁剪在显示器框内（屏保里有"云从屏外飘进来"这类故意越界的元素）。 */
  ok(/ctx\.clip\(\)/.test(canvasSrc) && /ctx\.rect\(Math\.round\(seat\.x \+ sc\.x\)/.test(canvasSrc),
    "⛔ 屏面绘制被 clip 在显示器框内（否则云/代码雨会盖到外框和桌子上）");
  /* ⭐ 名牌贴脚（10-06 用户：「顶部一排名字与其对应角色的距离过远」）——
     原来写死 `a.y + 30`，而上排**坐姿**人物底边在 `a.y + r.dy + 65`（r.dy=−62 ⇒ a.y+3）
     ⇒ 名牌浮在脚下 27px 外。现在改成从**人物绘制底边**（spriteBottom）推。 */
  ok(/const spriteBottom = new Map<string, number>\(\)/.test(canvasSrc)
    && /spriteBottom\.set\(a\.id, dy \+ dh\)/.test(canvasSrc)
    && /const ply = \(spriteBottom\.get\(a\.id\) \?\? a\.y \+ 26\) \+ 4/.test(canvasSrc),
    "⛔ 名牌贴脚：位置由**人物绘制底边**（spriteBottom）推，⛔ 不再写死 a.y + 30");
  /* ⭐ 渲染层微错位：体积碰撞删掉之后，防止两人同格时叠成"一个人"。 */
  ok(/function renderOffsetY\(id: string\): number/.test(canvasSrc)
    && /const off = a\.action === "sit" \? 0 : renderOffsetY\(a\.id\)/.test(canvasSrc),
    "⛔ 删掉体积碰撞后，走路/站立有**渲染层微错位**（坐姿不给偏移 —— 锚点是实测像素）");
  ok(/eventWordZhOf/.test(canvasSrc) && /statusOf/.test(canvasSrc),
    "⛔ 名牌状态与屏幕同源（`eventWordZhOf` 与顶栏同一个映射表 ⇒ 不会自相矛盾）");
  ok(/sim\.dispatchFx/.test(canvasSrc),
    "⛔ 任务派发动画由画布绘制（sim 只管记录，画布管表现）");
  const seg = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part05", "01-seg.tsx"), "utf8");
  const noteIdx = seg.indexOf("noteOfficeActivity(params");
  const filterIdx = seg.indexOf("params.threadId !== bag.threadRef.current?.id");
  ok(noteIdx > 0 && filterIdx > noteIdx,
    "⛔⛔ 办公室事件面接在**会话过滤之前**（放后面的话，后台会话的工具事件一条都到不了办公室）");
}

console.log(`\n【screen】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
