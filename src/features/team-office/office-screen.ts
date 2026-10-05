/**
 * 显示器内容 · Canvas 逐帧绘制（2026-10-04 立，10-05 修）
 *
 * ⛔ 用户报「显示器内容像一张图，没有 CSS 动画」—— 真因：背景图 `bg.webp` 把六个显示器
 *   **烙死**了，只有角色是动态的。⇒ 在角色之前，**按每个座位叠画动态内容区**。
 *
 * ⛔⛔ **10-05 用户再报「显示器都还是固定的、你做的那个显示没对准、没显示」** ——
 *   上一条修复**没真正生效**，两层原因（两个都已修）：
 *     ① **坐标画错**：`SEATS[].screen` 是从 bg.webp 扫出来的，但判据同时命中了**椅背**
 *        （椅背 rgb(47,65,95) 与屏幕玻璃同属"暗且偏蓝"）⇒ 屏面 y 全部落在椅背上，
 *        而椅背随后会被"重贴"盖回人物身上 ⇒ 画上去的内容**被整块盖掉**。
 *        修法见 `office-format.ts` 的 SEATS 注释（换亮度判据 + 限定 y 带）。
 *     ② **待机 = 熄屏**：下面对 `idle` 的处理原来是直接画成 `off`（静态色块）。
 *        委托真机 3.7s 就跑完 ⇒ 用户点开办公室时**全员待机** ⇒ 六块屏全黑静止。
 *        ⇒ 现在 `idle` 有自己的**屏保**（见下方分支），`off` 只留给空座。
 *
 * ⛔ 为什么用原生 canvas 逐帧、而不是 CSS 动画：
 *   像素风要 `imageSmoothingEnabled=false` 的最近邻放大；内容是"代码行/光标"这类
 *   逐帧变化的小图形，CSS 做要一堆 div + 动画帧同步，反而更重也更难和人物动画对齐。
 *
 * ⛔ 坐标来自 `office-format.ts` 的 `SEATS[].screen`。改这里先改那边。
 */

/** 一个屏幕的状态机：不同活动 ⇒ 不同内容。 */
export type ScreenMode =
  /** 空座/没人 ⇒ 熄屏（只画深色底+一点反光） */
  | "off"
  /** ⭐ 有人在座但没在跑 ⇒ **屏保**（2026-10-05 加）。
   *  ⛔⛔ 为什么必须与 off 分开：原来两者共用 "off" ⇒ 委托跑完（真机 3.7s）后全员待机、
   *  六块屏**全黑且静止**，用户看到的就是「显示器都还是固定的、没有动画」。 */
  | "idle"
  /** 敲键盘写代码：逐行浮现 + 光标闪 */
  | "code"
  /** 思考中：跳动的思考点 + 缓慢扫描 */
  | "thinking"
  /** 查资料：搜索框 + 结果行跳动 */
  | "search"
  /** 等审批/等待：转圈 */
  | "wait"
  /** 汇报中：柱状图抽动 */
  | "report"
  /** 喝水/休息：屏幕变暗 + 偶尔闪一下 */
  | "rest";

/** 屏幕配色（与背景图的像素风一致：低饱和、无渐变）。 */
const PAL = {
  offBg: "#1b2530",
  offGlow: "#26313d",
  /* 待机屏保：底色比 off 略亮（"开着但闲着"），方块低调不抢戏 */
  idleBg: "#141c26",
  idleBlock: "#2f4a68",
  idleTrail: "#1d2b3c",
  idleLamp: "#3f6b8f",
  codeBg: "#16212c",
  codeText: "#7fd6a8",
  codeKeyword: "#e8a13c",
  codeDim: "#3d5a4a",
  thinkBg: "#1a2130",
  thinkDot: "#8fb6e8",
  scan: "rgba(143,182,232,0.16)",
  searchBg: "#1c2430",
  searchHit: "#e8c76a",
  waitBg: "#20242c",
  waitRing: "#d8a04a",
  reportBg: "#172028",
  bar: "#6fb3d8",
  barAlt: "#8fd6a8",
  restBg: "#141a20",
  restFlash: "rgba(200,220,235,0.10)",
} as const;

/** 像素风"代码行"：每行若干段（缩进/关键字/正文），用方块画而不是字体（免字体在像素风里违和）。 */
const CODE_LINES = [
  [[0, 3], [1, 5], [2, 9]],
  [[1, 2], [3, 7], [5, 4]],
  [[0, 6], [2, 3], [7, 6]],
  [[2, 2], [4, 8], [6, 3]],
  [[0, 4], [1, 3], [5, 7]],
  [[1, 5], [3, 4], [9, 5]],
  [[0, 2], [2, 8], [6, 4]],
  [[3, 3], [5, 6], [8, 3]],
];

/**
 * 画一个屏幕。
 * @param t      全局帧时钟（秒）
 * @param mode   该成员当前活动决定的内容
 * @param seed   成员 id 派生 ⇒ 每人屏幕内容不同但不随机跳变
 * @param x/y/w/h 屏幕内容区（画布坐标）
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  t: number,
  mode: ScreenMode,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const bg = mode === "code" ? PAL.codeBg
    : mode === "thinking" ? PAL.thinkBg
    : mode === "search" ? PAL.searchBg
    : mode === "wait" ? PAL.waitBg
    : mode === "report" ? PAL.reportBg
    : mode === "rest" ? PAL.restBg
    : mode === "idle" ? PAL.idleBg
    : PAL.offBg;

  /* ⛔⛔ 所有尺寸**必须从 w/h 推导**，⛔ 不许硬编码。
     起因（2026-10-04）：屏面实测是 **53×30**（六个各不相同），而我第一版按"红框量出来的
     116×62" 写死排版（rowH=6、结果行 y+17+8r、柱子 6 根…）⇒ 内容撑出屏面，
     再叠加坐标也错位 ⇒ 用户看到"三个大黑块盖在桌子上"。
     ⚠️ 六个屏面尺寸**逐个不同**（53/58/58/53/55/53 宽、30-32 高）⇒ 更不能写统一值。
     ✅ 统一做法：先算一个**单位格** `u = max(2, round(h/10))`，其余全部按 u / w / h 推。 */
  const u = Math.max(2, Math.round(h / 10));   // 单位格：h=30 ⇒ u=3
  const pad = Math.max(1, Math.round(u * 0.5));
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  // 屏底（像素风：纯色，不要渐变）
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);

  // 熄屏：一点点反光暗示"没开"
  if (mode === "off") {
    ctx.fillStyle = PAL.offGlow;
    ctx.fillRect(x + pad, y + pad, innerW, u);
    return;
  }

  if (mode === "rest") {
    // 休息：屏幕暗下去，偶尔（很久一次）闪一下
    ctx.fillStyle = PAL.restFlash;
    if ((t * 0.4 + seed) % 7 < 0.08) ctx.fillRect(x, y, w, h);
    return;
  }

  /* ⭐ idle（屏保）—— 2026-10-05 加。
     ⛔⛔ 用户报「显示器都还是固定的、没有动画」，**两层原因**：
       ① 屏面坐标画在了椅背上（已修，见 office-format.ts 的 SEATS 注释）；
       ② 这里原先把"有人在座但没在跑"直接归到 "off" ⇒ 只画一个静态色块 ⇒
          委托真机 3.7s 就跑完，用户点开办公室时**全员 idle** ⇒ 六块屏全黑静止。
     ✅ 待机 ≠ 熄屏：给一个**屏保**（方块缓慢弹跳），保证"任何时候打开都在动"。
     ⚠️ 屏面只有 ~50×34 ⇒ 位移幅度必须够大（同 10-04 那条教训：小位移肉眼看不出）。
     ⚠️ 两轴用**不同周期**（5.2s / 3.7s）⇒ 轨迹不重复，不会看着像"卡住了在抖"。 */
  if (mode === "idle") {
    const bw = Math.max(u * 2, Math.round(innerW * 0.2));
    const spanX = Math.max(1, innerW - bw);
    const spanY = Math.max(1, innerH - bw);
    const tri = (v: number) => (v < 1 ? v : 2 - v);          // 三角波：来回弹
    const bx = x + pad + Math.round(tri(((t / 5.2) + seed * 0.11) % 2) * spanX);
    const by = y + pad + Math.round(tri(((t / 3.7) + seed * 0.07) % 2) * spanY);
    ctx.fillStyle = PAL.idleTrail;
    ctx.fillRect(bx + Math.round(bw * 0.3), by + Math.round(bw * 0.3), Math.round(bw * 0.5), Math.round(bw * 0.5));
    ctx.fillStyle = PAL.idleBlock;
    ctx.fillRect(bx, by, bw, bw);
    // 电源灯：极慢呼吸 ⇒ 即使方块恰好停在端点，屏面也不是完全静态
    if ((t * 0.38 + seed) % 1 < 0.5) {
      ctx.fillStyle = PAL.idleLamp;
      ctx.fillRect(x + w - pad - u, y + h - pad - u, u, u);
    }
    return;
  }

  // code：【块标记】下面这一段是 code 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "code") {
    /*⛔⛔ 2026-10-04 用户报「显示器上没有动画」—— 动画**在跑**，但屏面只有 53×30，
     *   原来的"逐行浮现"长满 6 行后就**完全静止**，只剩3×3px 光标在闪
     *   （占屏面 0.6%）⇒ 肉眼根本看不出来。
     *   ✅ 改成**永远在动**的三件事（缺一件又变静态）：
     *     ① 内容**向上滚动**（不是长满就停）：行进位置随时间连续变化
     *     ② **活跃行**（正在敲的那行）随时间换行，且高亮 ⇒ 视线有落点
     *     ③ 活跃行里有一段"正在输入的尾巴"在伸长/收缩
     *   ⚠️ 屏面小 ⇒ 任何"渐变/缓慢淡入"都看不出来；必须是**位移或增删**。 */
    const rowH = u + 1;                       // h=30 ⇒ 4px/行 ⇒ 6 行
    const rows = Math.max(1, Math.floor(innerH / rowH));
    // 每秒 1.15 行 ⇒ 一屏 6 行约 5.2s 走完，够慢到能看清在滚
    const head = Math.floor(t * 1.15);
    for (let r = 0; r < rows; r++) {
      const lineIndex = head + r;              // 每一行用不同内容 ⇒ 滚动看得出来
      const segs = CODE_LINES[(lineIndex + seed) % CODE_LINES.length];
      // ⛔ 纵向做**像素级滚动**（不是整行跳）：行高 4px、步长 1px ⇒ 连续移动
      const yOff = -((t * 1.15 * rowH) % rowH);
      const ly = Math.round(y + pad + r * rowH + yOff);
      if (ly + u <= y || ly >= y + h) continue;   // 完全在屏外就不画
      let lx = x + pad;
      segs.forEach(([indent, len], si) => {
        lx = x + pad + indent * u;
        ctx.fillStyle = si === 0 ? PAL.codeKeyword : PAL.codeText;
        ctx.fillRect(lx, ly, Math.min(len * u, Math.max(1, x + w - pad - lx)), u - 1);
        lx += len * u + u;
      });
    }
    // 活跃行：底部一行（永远可见）高亮 + 一段"正在输入"的尾巴在伸长/缩
    const activeY = y + pad + (rows - 1) * rowH;
    const tail = Math.round((Math.sin(t * 5) * 0.5 + 0.5) * innerW * 0.35);
    ctx.fillStyle = PAL.codeKeyword;
    ctx.fillRect(x + pad, activeY, Math.max(u, tail), u - 1);
    // 光标（跟随尾巴末端，1.6s 周期闪）
    ctx.fillStyle = "#e8f0f6";
    if ((t * 1.6) % 1 < 0.55) ctx.fillRect(x + pad + tail + u, activeY, u, u - 1);
    return;
  }

  // thinking：【块标记】下面这一段是 thinking 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "thinking") {
    /* ⛔ 原来只有"三个点上下跳 2px"+ 一条扫描线 ⇒ 53×30 屏面上几乎看不出动。
     * ✅ 改成两件**位移幅度够大**的事：
     *   ① 一条**横向扫描光标**在屏宽内来回扫（行程 = innerW ⇒ 肉眼明确）
     *   ② 三个思考点：跳动幅度给到 u（3px）且**整组上下浮沉**（不是只跳 2px） */
    // 横向扫描光标（来回，不是单向 ⇒ 不会"走完就没"）
    const sweep = Math.round((Math.sin(t * 1.6) * 0.5 + 0.5) * Math.max(0, innerW - u));
    ctx.fillStyle = PAL.scan;
    ctx.fillRect(x + pad + sweep, y + pad, u, innerH);
    // 三个点：整组浮沉 + 逐个相位差
    const groupY = y + pad + innerH / 2 - u / 2 + Math.round(Math.sin(t * 2.4) * (u * 0.9));
    for (let i = 0; i < 3; i++) {
      const phase = (t * 3 - i * 0.55) % 3;
      const lift = phase >= 0 && phase < 1 ? Math.round(u * Math.sin(phase * Math.PI)) : 0;
      ctx.fillStyle = PAL.thinkDot;
      ctx.fillRect(x + pad + innerW / 2 - u * 3 + i * u * 2, groupY - lift, u, u);
    }
    return;
  }

  // search：【块标记】下面这一段是 search 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "search") {
    /* ⛔ 原来只有"命中高亮每 0.7s 换一行"，而**每行长度用 rnd() 固定**（同一 seed 每次一样）
     *   ⇒ 整屏只有一行变色 ⇒ 53×30 上看着几乎不动。
     * ✅ 改成三件持续变化的事：搜索光标来回扫 · 命中行**逐行下移** · 结果行**向上滚动**。 */
    const barH = u * 2;
    // 搜索框（宽度随时间轻微呼吸，像在加载）
    const boxW = Math.round(innerW * (0.66 + Math.sin(t * 1.9) * 0.06));
    ctx.fillStyle = PAL.thinkDot;
    ctx.fillRect(x + pad, y + pad, boxW, barH);
    // 放大镜
    ctx.fillStyle = PAL.searchBg;
    ctx.fillRect(x + pad + u, y + pad + Math.floor(u / 2), u, u);
    // 搜索光标：在框内**来回扫**（位移幅度 = 框宽，肉眼明确）
    const curX = x + pad + u * 2 + Math.round((Math.sin(t * 3.4) * 0.5 + 0.5) * Math.max(0, boxW - u * 4));
    ctx.fillStyle = "#e8f0f6";
    ctx.fillRect(curX, y + pad + Math.floor(u / 2), u, u);
    // 结果行：内容随"行号"变化（滚动感）+ 命中行逐行下移
    const resTop = y + pad + barH + u;
    const resRows = Math.max(1, Math.floor((y + h - pad - resTop) / (u * 2)));
    const hitRow = Math.floor(t * 1.6) % resRows;          // 命中行逐行往下走
    const scroll = Math.floor(t * 1.1);                    // 内容整体滚动
    for (let r = 0; r < resRows; r++) {
      const ry = resTop + r * u * 2;
      const hit = r === hitRow;
      ctx.fillStyle = hit ? PAL.searchHit : PAL.codeDim;
      // ⚠️ 长度由 (行号+seed) 决定 ⇒ 滚动时每行内容都在变；⛔ 不用 rnd()（同一 seed 恒定 ⇒ 静止）
      const n = (r + scroll + seed) % 3;
      const len = Math.round(innerW * (0.42 + n * 0.18));
      ctx.fillRect(x + pad, ry, len, u);
      // 未命中的行给一个"进度条"尾段，让画面层次更密
      if (!hit) {
        ctx.fillStyle = PAL.thinkDot;
        const dotW = Math.round(innerW * 0.14 * (0.4 + ((r + scroll) % 3) / 3));
        ctx.fillRect(x + pad + len + u, ry, dotW, u);
      }
    }
    return;
  }

  // wait：【块标记】下面这一段是 wait 模式的绘制代码（判据面依赖这个标记定位）
  if (mode === "wait") {
    // 等待：像素转圈
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.max(u, Math.min(innerW, innerH) / 2 - u);
    for (let i = 0; i < 8; i++) {
      const a = (t * 3 + i * 0.785) % (Math.PI * 2);
      ctx.fillStyle = i === 0 ? PAL.waitRing : PAL.codeDim;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), u, u);
    }
    return;
  }

  // report：【块标记】下面这一段是 report 模式的绘制代码（判据面依赖这个标记定位）
  const n = Math.max(3, Math.floor(innerW / (u * 2)));   // ⛔ 不写死 6 根
  const slot = Math.floor(innerW / n);
  const bw = Math.max(1, slot - u);
  for (let i = 0; i < n; i++) {
    // ⛔ 原来 grow 到 1 就静止 ⇒ 只有前 6 秒在动。改成**长完之后继续小幅波动**：
    //   每根柱子在基准高度上按自己的相位上下浮动（±18%），永远不静止。
    //   ⚠️ 用 i+seed 错开相位 ⇒ 不会整齐上下，看起来像数据在动。
    const base = 0.25 + ((i * 37 + seed * 13) % 70) / 100;   // 稳定的基准高度（不用 rnd()，否则每帧抖）
    const wobble = 1 + Math.sin(t * 2.1 + i * 0.9 + seed) * 0.18;
    const grow = Math.min(1, Math.max(0, t * 0.9 - i * 0.28));
    const bh = Math.max(1, Math.round(innerH * base * wobble * grow));
    ctx.fillStyle = i % 2 ? PAL.bar : PAL.barAlt;
    ctx.fillRect(x + pad + i * slot, y + h - pad - bh, bw, bh);
    // 柱顶亮点：跟着柱高走 ⇒ 波动更明显
    ctx.fillStyle = PAL.barAlt;
    ctx.fillRect(x + pad + i * slot, y + h - pad - bh, bw, u - 1);
  }
}

/** 成员活动 ⇒ 屏幕内容。⛔ 这是"显示器反映真实在干什么"的唯一映射点。 */
export function screenModeOf(input: {
  /** 该成员当前活动（与 office-sim 的 activity 同名） */
  activity: null | "tea" | "water" | "book" | "toilet" | "run" | "gym";
  mode: "work" | "idle";
  /** 是否正在思考（真实事件驱动传进来） */
  thinking?: boolean;
  /** 是否正在等审批/轮询 */
  waiting?: boolean;
  /** 是否正在汇报/总结 */
  reporting?: boolean;
  /** 有人 ⇒ 屏幕亮 */
  occupied: boolean;
}): ScreenMode {
  if (!input.occupied) return "off";
  if (input.activity === "toilet" || input.activity === "run" || input.activity === "gym") return "rest";
  if (input.activity === "water" || input.activity === "tea" || input.activity === "book") return "rest";
  if (input.reporting) return "report";
  if (input.waiting) return "wait";
  if (input.thinking) return "thinking";
  if (input.mode === "work") return "code";
  /* ⛔ 有人坐着但没在跑 ⇒ **屏保**，⛔ 不是 "off"。
     原来返回 "off" 的后果：委托跑完（真机 3.7s）后全员待机 ⇒ 六块屏全黑静止
     ⇒ 用户报「显示器都还是固定的、没有动画」。
     ⛔ "off" 从此**只表示空座**（没人），语义收窄 —— 改这里要同步 office-screen 顶部注释。 */
  return "idle";
}
