/**
 * 悬浮播报 · 贴边吸附几何
 *
 * 用户令（10-31）：「图标支持拖拽，并能吸附到对话框边框上；需充分考虑侧边栏拖动以及
 * 左右侧栏可展开折叠的情况，实现自适应贴边吸附。」
 *
 * ── 为什么用 DOM 实测而不是传 props ────────────────────────────────────────
 * 悬浮图标挂在 AppView 顶层（root 层，和 VoiceCallFloat 同款），而侧栏宽度是 AppView 的
 * state、右栏开合在另一条子树里。把三处宽度一层层传下来要改一路签名，而且**侧栏拖拽**是
 * 逐帧 setState（260~420px 连续变化）—— 传 props 就是每帧重渲染整棵子树。
 * 直接量容器的矩形，天然覆盖「拖动侧栏 / 折叠展开左右栏 / 拖窗口边」三种情况，
 * 且悬浮窗自己用 ResizeObserver + MutationObserver 就能跟上，不需要任何上层配合。
 *
 * ── 边界口径 ──────────────────────────────────────────────────────────────
 *   left   = 左栏（`.sidebar`）的右缘；没有侧栏（欢迎页/弹窗）时退到 0
 *   right  = 右栏（`.context-panel`）的左缘；右栏收起时它就是视口右边
 *   top    = 顶栏（`.topbar`）的下缘；没有顶栏时退到 0
 *   bottom = 输入框（`.composer-wrap`）的上缘；没有输入框时退到视口底
 * ⛔ 「对话框边框」= 这四条边围出来的聊天区边框 —— 吸附永远落在这四条边上，
 *    所以侧栏一拖动/一收起，图标跟着新边框重新贴，不会留在屏幕外或压在侧栏上。
 */

export type DockEdge = "left" | "right" | "top" | "bottom";

export type StageRect = {
  left: number; right: number; top: number; bottom: number;
  /** 输入框的实际左右边界：面板与横幅的**宽度对齐口径**（聊天区还含 rail/内边距，不能直接用） */
  composerLeft?: number;
  composerWidth?: number;
};

/** 磁吸阈值：松手时图标**边缘**距边框 ≤ 这个值才吸附，否则保持自由悬浮。
 *  ⛔ 10-31 用户反馈：「拉都拉不出来，不管拉到哪里都自动吸附过去了，他可以悬浮展示的」
 *     —— 上一版松手必吸附 = 拖不出聊天区中间。改成磁吸后，中间松手就是自由悬浮。 */
export const SNAP_THRESHOLD = 56;

/** 吸附后图标中心到边框的距离。
 *  ⛔ 10-31 用户令：「吸附是**跟边框融入到一起**，留一个展开按键就行了」——
 *    所以吸附态中心**正好落在边框线上**（inset=0），图标只露出朝内的一半，
 *    看起来像边框上长出来的一个把手，而不是浮在旁边的一颗球。
 *    （拖拽时的 clamp 也用这个值，所以拖到边缘会精确压线。） */
export const DOCK_INSET = 0;

function rectOf(selector: string): DOMRect | null {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  /* 折叠态的侧栏宽度仍可量（它只是变窄）；显示为 none 的元素宽度为 0 ⇒ 视作不存在 */
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/** 量出当前聊天区可用矩形（每次调用都新鲜，代价 = 几次 getBoundingClientRect）。 */
export function measureStage(): StageRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sidebar = rectOf(".sidebar");
  const aside = rectOf(".context-panel");
  const composer = rectOf(".composer-wrap");
  const topbar = rectOf(".topbar");
  const left = sidebar ? Math.round(sidebar.right) : 0;
  /* ⛔ 右界 = **输入框的右缘**（不是视口右边）：右侧还有成员轨/办公室轨（约 92px），
     按视口算会把图标吸到轨道外沿、甚至贴到窗口边缘盖住滚动条。
     没有输入框（极早期/欢迎页）时依次退到右栏左缘 → 视口右边。 */
  const right = composer ? Math.round(composer.right) : aside ? Math.round(aside.left) : vw;
  const top = topbar ? Math.round(topbar.bottom) : 0;
  const bottom = composer ? Math.round(composer.top) : vh;
  /* 极端情形（左右栏同时展开把聊天区挤没）兜底：至少留 120px，否则图标会跑到栏上 */
  const composerLeft = composer ? Math.round(composer.left) : undefined;
  const composerWidth = composer ? Math.round(composer.width) : undefined;
  if (right - left < 120) return { left, right: Math.min(vw, left + 120), top, bottom, composerLeft, composerWidth };
  return { left, right, top, bottom, composerLeft, composerWidth };
}

export type DockState = {
  edge: DockEdge;
  /** 沿吸附边的相对位置（0~1）。⛔ 存比例而不是像素：侧栏拖动后边框移动，
   *  按比例贴回去才符合"跟着边框走"的直觉（存像素会在边框变窄时跑到栏上）。 */
  ratio: number;
  /** true = 贴边（融入边框把手形态）；false = **自由悬浮**（完整圆钮，用户想放哪放哪） */
  docked: boolean;
  /** 自由悬浮的中心点（docked=false 时生效）。⛔ 只存像素 —— 自由位置本来就与边框无关。 */
  free?: { x: number; y: number };
};

/** 自由悬浮态的圆钮尺寸（含 padding），锚点布局与 CSS 必须同一个值。 */
export const POD_SIZE = 44;
/** 收纳态把手的半宽 / 半高（22×40）—— **贴边落位按各自轴的半宽算**，
 *  让把手的**边缘**正好压在边框线上，而不是中心对中心（那会内缩 9px，看着"浮在旁边"）。
 *  ⛔ 两个轴不能共用一个值：横向用 13、纵向用 22，否则贴上/下边时把手会压进顶栏/输入框。 */
export const DOCK_HALF_W = 11;
export const DOCK_HALF_H = 20;

/** 把一个中心点吸附到最近的边，并夹进聊天区（防止吸到被挤没的区域）。 */
export function snapPoint(
  center: { x: number; y: number },
  stage: StageRect,
  size = POD_SIZE,
  inset = DOCK_INSET,
): { edge: DockEdge; x: number; y: number } {
  const minX = stage.left + DOCK_HALF_W + inset;
  const maxX = Math.max(minX, stage.right - DOCK_HALF_W - inset);
  const minY = stage.top + DOCK_HALF_H + inset;
  const maxY = Math.max(minY, stage.bottom - DOCK_HALF_H - inset);
  const cx = Math.max(minX, Math.min(maxX, center.x));
  const cy = Math.max(minY, Math.min(maxY, center.y));

  const dl = cx - stage.left;
  const dr = stage.right - cx;
  const dt = cy - stage.top;
  const db = stage.bottom - cy;
  const nearest = Math.min(dl, dr, dt, db);

  if (nearest === dl) return { edge: "left", x: stage.left + DOCK_HALF_W + inset, y: cy };
  if (nearest === dr) return { edge: "right", x: stage.right - DOCK_HALF_W - inset, y: cy };
  if (nearest === dt) return { edge: "top", x: cx, y: stage.top + DOCK_HALF_H + inset };
  return { edge: "bottom", x: cx, y: stage.bottom - DOCK_HALF_H - inset };
}

/** 按「边 + 比例」算出图标中心点（侧栏拖动 / 右栏开合 / 窗口 resize 后重新落位）。 */
export function pointForDock(
  dock: Pick<DockState, "edge" | "ratio">,
  stage: StageRect,
  size = POD_SIZE,
  inset = DOCK_INSET,
): { x: number; y: number } {
  if (dock.edge === "left" || dock.edge === "right") {
    const minY = stage.top + DOCK_HALF_H + inset;
    const maxY = Math.max(minY, stage.bottom - DOCK_HALF_H - inset);
    const y = minY + (maxY - minY) * clamp01(dock.ratio);
    return { x: dock.edge === "left" ? stage.left + DOCK_HALF_W + inset : stage.right - DOCK_HALF_W - inset, y };
  }
  const minX = stage.left + DOCK_HALF_W + inset;
  const maxX = Math.max(minX, stage.right - DOCK_HALF_W - inset);
  const x = minX + (maxX - minX) * clamp01(dock.ratio);
  return { x, y: dock.edge === "top" ? stage.top + DOCK_HALF_H + inset : stage.bottom - DOCK_HALF_H - inset };
}

/** 由吸附后的中心点反推「沿边比例」，用于拖动结束后落盘。 */
export function ratioForPoint(
  point: { x: number; y: number },
  edge: DockEdge,
  stage: StageRect,
  size = POD_SIZE,
  inset = DOCK_INSET,
): number {
  if (edge === "left" || edge === "right") {
    const minY = stage.top + DOCK_HALF_H + inset;
    const maxY = Math.max(minY, stage.bottom - DOCK_HALF_H - inset);
    return maxY === minY ? 0.5 : clamp01((point.y - minY) / (maxY - minY));
  }
  const minX = stage.left + DOCK_HALF_W + inset;
  const maxX = Math.max(minX, stage.right - DOCK_HALF_W - inset);
  return maxX === minX ? 0.5 : clamp01((point.x - minX) / (maxX - minX));
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

/** 图标中心到最近边框的距离（**减去半径** = 图标边缘到边框的间隙）。 */
export function edgeGapOf(
  point: { x: number; y: number },
  stage: StageRect,
  size = POD_SIZE,
): number {
  const half = size / 2;
  return Math.min(
    point.x - half - stage.left,
    stage.right - (point.x + half),
    point.y - half - stage.top,
    stage.bottom - (point.y + half),
  );
}

/** 离哪条边最近（自由悬浮时用它决定横幅往哪边弹）。 */
export function nearestEdgeOf(point: { x: number; y: number }, stage: StageRect): DockEdge {
  const dl = point.x - stage.left;
  const dr = stage.right - point.x;
  const dt = point.y - stage.top;
  const db = stage.bottom - point.y;
  const nearest = Math.min(dl, dr, dt, db);
  if (nearest === dl) return "left";
  if (nearest === dr) return "right";
  if (nearest === dt) return "top";
  return "bottom";
}

/** 把任意点夹进聊天区（自由悬浮位置在侧栏变宽 / 窗口缩放后仍然可见）。 */
export function clampIntoStage(
  point: { x: number; y: number },
  stage: StageRect,
  size = POD_SIZE,
): { x: number; y: number } {
  const half = size / 2;
  const minX = stage.left + half + 2;
  const maxX = Math.max(minX, stage.right - half - 2);
  const minY = stage.top + half + 2;
  const maxY = Math.max(minY, stage.bottom - half - 2);
  return { x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(minY, Math.min(maxY, point.y)) };
}

/** 面板展开方向（依吸附边决定，永远朝聊天区内侧长）。 */
export function panelSideOf(edge: DockEdge): "left" | "right" | "top" | "bottom" {
  if (edge === "left") return "right";
  if (edge === "right") return "left";
  if (edge === "top") return "bottom";
  return "top";
}
