/**
 * 「在右栏『图片』页打开这张图」的请求（11-27 立）。
 *
 * 为什么要有：图片芯片 / 文件卡在回合里（深层），右栏标签页在 AppView 顶层，
 * 而「点芯片」原本一律走 `right-file` → 切到「文件」页（工作区树 + 预览）。
 * 用户要的是：点图片就进「图片」页（只读大图），别在文件树里找。
 *
 * 形态与 `canvas-open.mjs` 同款极小事件箱：只记「打开哪张图」，不传 DOM、不传回调；
 * 面板挂载时取一次、活着时订阅（⛔ 同一张图不会重复处理）。
 */
let current = null;
const listeners = new Set();

/** 请求在「图片」页打开某个文件（非图片请走 `right-file`，那边不认这个箱）。 */
export function requestRightImage(path, name = "") {
  const value = String(path || "").trim();
  if (!value) return;
  current = { path: value, name: String(name || ""), at: Date.now() };
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 取走并清空（面板首次挂载时调用）。 */
export function takeRightImage() {
  const value = current;
  current = null;
  return value;
}

/** 订阅（面板存活期间）；返回取消函数。 */
export function subscribeRightImage(fn) {
  if (typeof fn !== "function") return () => undefined;
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
