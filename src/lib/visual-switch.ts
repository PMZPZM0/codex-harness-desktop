/**
 * 主题 / 代码高亮切换的「过渡 + 完成提示」（10-07 立，10-31 改为整屏涟漪转场）
 *
 * 需求原文（10-07）：「主题切换（如明暗模式）和代码高亮切换目前缺少过渡动画和切换完成后的通知提示」。
 * 需求原文（10-31）：「白天黑夜切换太生硬了，一点切换动画没有，应用级看看怎么做」。
 *
 * ⛔⛔ 两条路径，按能力与无障碍偏好自动选：
 *   ① **涟漪转场**（首选）：`document.startViewTransition` + 一个从**你点的位置**扩散的圆形裁切，
 *      旧主题的整屏快照被新主题从圆心推开。这是真正的"应用级"动画 —— 整屏一起动，
 *      而不是每个元素各自改颜色（后者在大面积深/浅底之间切换时观感就是硬闪）。
 *      Electron 44（Chromium 138）实测支持；不支持的环境自动回落 ②。
 *   ② **整站颜色过渡**（回落）：切换的 ~240ms 内给 `<html>` 挂 `.fx-theme`，只过渡颜色类属性。
 *
 * ⛔⛔ 为什么回落路径要「临时挂类」而不是常驻 transition：
 *   主题切换要过渡的是**全站颜色**，常驻 `* { transition: … }` 会把所有 hover/点击反馈一起拖慢，
 *   且大面积重绘影响滚动性能。
 *
 * ⛔⛔ 为什么提示放在**切换动画结束之后**（而不是点击瞬间）：
 *   用户的口径是"切换完成后的通知提示" —— 先给"已经变了"再给"变成什么"。
 *
 * ⛔ 无障碍：`prefers-reduced-motion: reduce` 下**不进涟漪路径**，只走 ②，
 *   而 ② 的时长受 CSS 变量控制、并被既有全局兜底压到 0.001ms ⇒ 等于瞬切。
 *
 * ⛔⛔ `apply` 必须**同步可观测**（调用方的 React setState 要包 `flushSync`）：
 *   涟漪路径是在 `startViewTransition(update)` 的 update 回调返回后**立刻拍新快照**的，
 *   若此刻 DOM 还是旧主题，得到的是一张"新旧相同"的空动画 —— 看着就是没动。
 *
 * 拓展接口：新增一类"全站颜色切换"（比如将来加主题色/强调色）⇒ 只调 `runVisualSwitch()`。
 */
import { THEMES, normalizeThemeId } from "./themes";
import { codeThemes } from "./code-themes";

/** 回落路径的过渡类名（CSS 里 `html.fx-theme` 那条规则靠它生效）。⛔ 改名必须同步 CSS 与守卫【11w】。 */
export const VISUAL_FX_CLASS = "fx-theme";
/** 回落路径的过渡时长（ms）—— 必须与 CSS 的 `--dur-theme` **同源**：这里只是 JS 侧摘类的时点。 */
export const VISUAL_FX_MS = 240;
/** 涟漪转场的类名（CSS 里 `html.fx-ripple::view-transition-*` 那组规则靠它生效）。 */
export const VISUAL_RIPPLE_CLASS = "fx-ripple";

/** 界面主题的显示名（取不到就用 id，别返回空串 —— 提示里会出现「已切换到「」」）。 */
export function themeLabelOf(id: string): string {
  const hit = THEMES.find((entry) => entry.id === normalizeThemeId(id));
  return hit?.label ?? id;
}

/** 代码高亮主题的显示名 */
export function codeThemeLabelOf(id: string): string {
  return codeThemes.find((entry) => entry.id === id)?.label ?? id;
}

/* ── 涟漪圆心 = 最近一次按下指针的位置（点哪从哪扩散） ─────────────────────
   ⛔ 用 capture 阶段监听：调用方的按钮常带 stopPropagation，冒泡阶段可能收不到。
   ⛔⛔ **必须在模块加载时就挂上**，不能等到点击时才挂：`pointerdown` 早于 `click`，
     等 `runVisualSwitch` 里再 bind 就永远慢一步 ⇒ 第一次点击拿不到圆心，只能落到默认位置
     （实测踩到：圆心跑到视口中心，而不是手指按下的地方）。幂等，重复调用无副作用。
   ⛔ 没有指针事件（键盘触发 / 程序化 click）时退化为"视口下方居中"，仍有方向感。 */
let origin = { x: 0, y: 0 };
let originBound = false;
function bindOrigin(): void {
  if (originBound || typeof window === "undefined") return;
  originBound = true;
  window.addEventListener("pointerdown", (event) => {
    origin = { x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
}
bindOrigin();

const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

const noticeOf = (kind: "主题" | "代码高亮", label: string): string =>
  kind === "主题" ? `已切换到「${label}」主题` : `代码高亮已切换到「${label}」`;

let timer = 0;

/**
 * 执行一次「全站颜色切换」：转场/过渡 → 应用 → 动画结束后摘类并给回执。
 *
 * @param kind  提示里的类别词（"主题" / "代码高亮"），决定文案措辞
 * @param label 切换后的显示名
 * @param apply 真正改状态的那一步（⚠️ 必须**同步可观测**：React 的 setState 用 `flushSync` 包住；
 *              不要在这里塞异步持久化，否则动画已经结束、颜色还没变）
 * @param onNotice 回执通道（设置页传 `setNotice`，侧栏传 `showToast`；缺省 = 静默，不报错）
 */
export function runVisualSwitch(
  kind: "主题" | "代码高亮",
  label: string,
  apply: () => void,
  onNotice?: (text: string) => void,
): void {
  /* ⛔⛔ 必须 `.bind(document)`：`document.startViewTransition` 是**未绑定**的属性方法，
     裸调用会抛 `Illegal invocation`（实测踩到：异常被下面的兜底 catch 吃掉 ⇒ 永远走颜色过渡，
     表现就是"怎么改都没动画"）。绑完 typeof 仍是 "function"，判断照旧。 */
  const startRipple = (document as Document & {
    startViewTransition?: (update: () => void) => { finished: Promise<void> };
  }).startViewTransition?.bind(document);
  if (typeof startRipple === "function" && !prefersReducedMotion()) {
    rippleSwitch(startRipple, kind, label, apply, onNotice);
    return;
  }
  fadeSwitch(kind, label, apply, onNotice);
}

/* ── 涟漪的高光描边（10-31 追加）────────────────────────────────────────────
   为什么要一个独立 DOM 而不是纯 CSS：VT 的 `::view-transition-new(root)` 只有一层，
   给它加 `filter: drop-shadow` 会被 `clip-path` 先裁掉（滤镜在内、裁切在外），加 `box-shadow`
   是矩形阴影 —— 都做不出"沿着扩散圆边缘的一圈光"。
   ⇒ 在同一条圆形轨迹上叠一个 popover（**top layer**，绘制在 VT 伪元素之上），
     用 `radial-gradient` 在半径处画一圈极淡高光，半径由 `@property --rim-r` 插值。
   ⛔ 必须在 `transition.ready` 之后才挂：早了会被拍进"新主题快照"，被裁切后变成一团色块。
   ⛔ `pointer-events: none` + `aria-hidden`：纯装饰，不吃点击、不进读屏。 */
let rimEl: HTMLDivElement | null = null;

function mountRim(elapsedMs = 0): void {
  try {
    const el = document.createElement("div");
    el.className = "theme-ripple-rim";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("popover", "manual");   // 进 top layer ⇒ 画在 view-transition 快照之上
    document.body.appendChild(el);
    /* ⛔ 负 delay 追平相位：光边在 ready 之后才挂，若从 0 开始播就会落后裁剪圆
       （实测 150ms 时半径 483px vs 应有 ~650px）⇒ 落后时被压在深色圆内部、肉眼看不见。 */
    if (elapsedMs > 0) el.style.animationDelay = `-${Math.round(elapsedMs)}ms`;
    (el as HTMLElement & { showPopover?: () => void }).showPopover?.();
    rimEl = el;
  } catch {
    rimEl = null;   // 老环境没有 popover：只是没有高光，动画本体照常
  }
}

function unmountRim(): void {
  try { rimEl?.remove(); } catch { /* 已被移除 */ }
  rimEl = null;
}

/** ① 涟漪转场：整屏快照 + 从指针位置扩散的圆形裁切（CSS 见 `html.fx-ripple::view-transition-*`）。 */
function rippleSwitch(
  start: (update: () => void) => { finished: Promise<void> },
  kind: "主题" | "代码高亮",
  label: string,
  apply: () => void,
  onNotice?: (text: string) => void,
): void {
  bindOrigin();
  const root = document.documentElement;
  const x = origin.x || Math.round(window.innerWidth / 2);
  const y = origin.y || Math.round(window.innerHeight * 0.82);
  /* 半径 = 圆心到**最远角**的距离 ⇒ 无论点在哪，圆最后都能覆盖整屏。 */
  const radius = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));
  root.style.setProperty("--switch-x", `${x}px`);
  root.style.setProperty("--switch-y", `${y}px`);
  root.style.setProperty("--switch-r", `${radius}px`);
  root.classList.add(VISUAL_RIPPLE_CLASS);

  const finish = () => {
    unmountRim();
    root.classList.remove(VISUAL_RIPPLE_CLASS);
    /* 三个内联变量只在动画期有用；留着会让下次的圆心停留在旧位置（若指针事件缺失）。 */
    root.style.removeProperty("--switch-x");
    root.style.removeProperty("--switch-y");
    root.style.removeProperty("--switch-r");
    onNotice?.(noticeOf(kind, label));
  };

  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  let transition: { finished: Promise<void> } | null = null;
  try {
    transition = start(() => { apply(); });
  } catch (error) {
    /* 起不来（极端环境）：清干净再走回落路径，别把类挂在上面挡住后续。
       ⛔ 必须留一行日志：这条 catch 曾把一个「裸调用 Illegal invocation」吞了整整半天，
          表现为"改了没动画"，只能靠时间轴探针才挖出来。 */
    console.warn("[visual-switch] 涟漪转场起不来，回落颜色过渡：", error);
    unmountRim();
    root.classList.remove(VISUAL_RIPPLE_CLASS);
    fadeSwitch(kind, label, apply, onNotice);
    return;
  }
  /* ⛔ 等 `ready`（快照已拍完、伪元素已就绪）再挂高光：早一步就会被算进新主题快照。 */
  const ready = (transition as unknown as { ready?: Promise<void> })?.ready;
  const withElapsed = () => mountRim(typeof performance !== "undefined" ? performance.now() - startedAt : 0);
  Promise.resolve(ready).then(withElapsed, withElapsed);
  Promise.resolve(transition?.finished).then(finish, finish);
}

/** ② 回落：挂 `.fx-theme` → 应用 → 240ms 后摘类并给回执（不支持 View Transitions 时）。 */
function fadeSwitch(
  kind: "主题" | "代码高亮",
  label: string,
  apply: () => void,
  onNotice?: (text: string) => void,
): void {
  const root = document.documentElement;
  root.classList.add(VISUAL_FX_CLASS);
  apply();
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    root.classList.remove(VISUAL_FX_CLASS);
    onNotice?.(noticeOf(kind, label));
  }, VISUAL_FX_MS);
}
