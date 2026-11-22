/**
 * 归属气泡（11-11 用户令：「所有的小窗口就近弹，哪里点击就在这里打开，带归属箭头」）。
 *
 * 调用方在打开全局 prompt / confirm 之前，把触发按钮的矩形放进这里；
 * AppView 渲染时会把它交给气泡壳（`AnchoredDialogCard`）定位并画箭头。
 * ⛔ 取走即清空（`take`），避免上一个菜单的锚点被下一个无关弹窗误用。
 */
/** 锚点矩形（只需要几何量，⛔ 不要 DOMRect 的完整接口 —— 调用方常常只有这几个数）。 */
export type DialogAnchorRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

let pending: DialogAnchorRect | null = null;

/** 记住触发按钮的位置（传 DOMRect 或 null 清空）。 */
export function setDialogAnchor(rect: DialogAnchorRect | null): void {
  pending = rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
}

/** 只看一眼（AppView 决定用气泡还是居中模态）。 */
export function peekDialogAnchor() {
  return pending;
}

/** 取走并清空（气泡壳挂载时调用一次）。 */
export function takeDialogAnchor() {
  const rect = pending;
  pending = null;
  return rect;
}

/**
 * 没有显式锚点时的就近兜底：用**当前焦点元素**（点按钮触发时浏览器会给它焦点）。
 * 拿不到（键盘触发 / body）返回 null ⇒ 仍回落到居中模态。
 */
export function activeDialogAnchor(): DialogAnchorRect | null {
  const el = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

