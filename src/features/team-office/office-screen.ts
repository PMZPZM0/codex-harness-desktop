/**
 * 显示器内容 · Canvas 逐帧绘制（2026-10-04）
 *
 * ⛔ 用户报「显示器内容像一张图，没有 CSS 动画」—— 真因：背景图 `bg.webp` 把六个显示器
 *   **烙死**了，只有角色是动态的。⇒ 在角色之前，**按每个座位叠画动态内容区**。
 *
 * ⛔ 为什么用原生 canvas 逐帧、而不是 CSS 动画：
 *   像素风要 `imageSmoothingEnabled=false` 的最近邻放大；内容是"代码行/光标"这类
 *   逐帧变化的小图形，CSS 做要一堆 div + 动画帧同步，反而更重也更难和人物动画对齐。
 *
 * ⛔ 坐标来自 `office-format.ts` 的 `SEATS[].screen`，那组值是**从用户截图量出来的**，
 *   不是猜的（那边注释写了量法）。改这里先改那边。
 */

/** 一个屏幕的状态机：不同活动 ⇒ 不同内容。 */
export type ScreenMode =
  /** 空座/没人 ⇒ 熄屏（只画深色底+一点反光） */
  | "off"
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

/** 伪随机（同一个 seed 每次刷新给同一条"代码"，画面稳定不乱跳）。 */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const rnd = mulberry(seed * 2654435761);
  const bg = mode === "code" ? PAL.codeBg
    : mode === "thinking" ? PAL.thinkBg
    : mode === "search" ? PAL.searchBg
    : mode === "wait" ? PAL.waitBg
    : mode === "report" ? PAL.reportBg
    : mode === "rest" ? PAL.restBg
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

  if (mode === "code") {
    // 逐行浮现：已"敲出来"的行数随时间增长
    const rowH = u + 1;                       // h=30 ⇒ 4px/行 ⇒ 6 行
    const rows = Math.max(1, Math.floor(innerH / rowH));
    const typed = Math.min(rows, Math.floor(t * 1.6) % (rows + 12));
    for (let r = 0; r < typed; r++) {
      const segs = CODE_LINES[(r + seed) % CODE_LINES.length];
      const ly = y + pad + r * rowH;
      let lx = x + pad;
      segs.forEach(([indent, len], si) => {
        lx = x + pad + indent * u;
        // 关键字段落用暖色，其余用绿色
        ctx.fillStyle = si === 0 ? PAL.codeKeyword : PAL.codeText;
        //⛔ 每段长度按 innerW 收口：CODE_LINES 里的数字是给"宽屏"设计的，
        //   直接用会画出屏面之外 ⇒ 又是"内容溢出"那一类错。
        ctx.fillRect(lx, ly, Math.min(len, Math.max(1, x + w - pad - lx)), u - 1);
        lx += len * u + u;
      });
    }
    // 光标闪烁（1.6s 周期）
    const cy = y + pad + (typed % rows) * rowH;
    ctx.fillStyle = "#e8f0f6";
    if ((t * 1.6) % 1 < 0.55) ctx.fillRect(x + pad + Math.floor(rnd() * 5) * u, cy, u, u);
    return;
  }

  if (mode === "thinking") {
    // 思考：三个点依次跳动 + 扫描线缓慢下移
    const dots = 3;
    for (let i = 0; i < dots; i++) {
      const phase = (t * 2.2 - i * 0.5) % 3;
      const lift = phase >= 0 && phase < 1 ? Math.round(u * 0.6 * Math.sin(phase * Math.PI)) : 0;
      ctx.fillStyle = PAL.thinkDot;
      ctx.fillRect(x + pad + i * u * 2, y + h / 2 - u / 2 - lift, u, u);
    }
    // 扫描线
    const sy = y + pad + ((t * 14) % Math.max(1, innerH));
    ctx.fillStyle = PAL.scan;
    ctx.fillRect(x + pad, sy, innerW, u - 1);
    return;
  }

  if (mode === "search") {
    // 搜索：顶部一条搜索框 + 下面几行结果，命中的那条高亮并跳动
    const barH = u * 2;
    ctx.fillStyle = PAL.thinkDot;
    ctx.fillRect(x + pad, y + pad, Math.round(innerW * 0.72), barH);
    // 搜索框里的放大镜 + 光标
    ctx.fillStyle = PAL.searchBg;
    ctx.fillRect(x + pad + u, y + pad + Math.floor(u / 2), u, u);
    if ((t * 2) % 1 < 0.5) ctx.fillRect(x + pad + Math.round(innerW * 0.3), y + pad + Math.floor(u / 2), u, u);
    // 结果行（行数按剩余高度算，⛔ 不写死 4 行）
    const resTop = y + pad + barH + u;
    const resRows = Math.max(1, Math.floor((y + h - pad - resTop) / (u * 2)));
    for (let r = 0; r < resRows; r++) {
      const ry = resTop + r * u * 2;
      const hit = r === Math.floor(t * 1.4) % resRows;
      ctx.fillStyle = hit ? PAL.searchHit : PAL.codeDim;
      const len = Math.round(innerW * (0.45 + rnd() * 0.5));
      ctx.fillRect(x + pad, ry, len, u);
    }
    return;
  }

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

  // report：柱状图逐根抽动
  const n = Math.max(3, Math.floor(innerW / (u * 2)));   // ⛔ 不写死 6 根
  const slot = Math.floor(innerW / n);
  const bw = Math.max(1, slot - u);
  for (let i = 0; i < n; i++) {
    const grow = Math.min(1, Math.max(0, t * 0.9 - i * 0.28));
    const bh = Math.round(innerH * (0.25 + rnd() * 0.7) * grow);
    ctx.fillStyle = i % 2 ? PAL.bar : PAL.barAlt;
    ctx.fillRect(x + pad + i * slot, y + h - pad - bh, bw, bh);
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
  return "off";
}
