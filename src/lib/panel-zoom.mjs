/**
 * 右栏「放大 / 缩小」的共享状态（11-27 用户令）。
 *
 * 为什么要有独立状态：放大要改的是**壳的布局**（`.app-shell` 的 `--right-w`），
 * 而按钮在右栏组件里 —— 两边不是父子传参关系，用 DOM 类名互相改又会和 React 渲染打架
 * （className 是 AppView 每帧算出来的，手加的类随时可能被覆盖）。
 * ⇒ 用极小 store：按钮写、AppView 读（useSyncExternalStore），布局走**内联 style**，
 *   ⛔ 不再往壳上手动 toggle 类。
 *
 * 语义（两次纠正后定稿）：
 *  · 放大 = 整个侧边栏**覆盖主对话区**（主区那一列压成 0，右栏吃掉整行剩余宽度）；
 *  · 缩小 = 回到原来的侧边栏宽度（默认 308，与拖拽同一个 localStorage key）。
 *  ⛔ 不是把面板宽度调大几档（那是原地打转，用户明确否掉）。
 */
const DEFAULT_PANEL_W = 308;
let maximized = false;
const listeners = new Set();

/** 当前是否处于「覆盖主对话区」态。 */
export function getPanelMaximized() {
  return maximized;
}

/** 默认面板宽度（缩小回到这个值；与拖拽改宽同一个口径）。 */
export function defaultPanelWidth() {
  return DEFAULT_PANEL_W;
}

/** 设置放大态；变化才通知（避免同值刷屏）。 */
export function setPanelMaximized(next) {
  const value = Boolean(next);
  if (value === maximized) return;
  maximized = value;
  for (const fn of [...listeners]) {
    try { fn(value); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 订阅；返回取消函数。 */
export function subscribePanelMaximized(fn) {
  if (typeof fn !== "function") return () => undefined;
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
