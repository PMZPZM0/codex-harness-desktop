/**
 * 「把这张图片放到画布上」的打开请求（11-26 立）。
 *
 * 为什么要有：文件卡 / 消息附件在回合里（深层），画布在右栏标签页里（顶层且按需挂载）。
 * 用户右键图片时想要的是「在画布中打开」，但那一层拿不到画布实例，画布也不一定已挂载。
 * ⇒ 用同 `right-file.mjs` 那套**极小事件箱**：菜单只发「把哪个文件交给画布」，
 *   画布挂载时取一次、活着时订阅；⛔ 不传 DOM、不传回调、不在这里碰 board 状态。
 */
let current = null;
const listeners = new Set();

/** 请求把一张图片放到画布上（菜单调用；画布没开也会先记下，开的时候消费）。 */
export function requestCanvasImage(path, name = "") {
  const value = String(path || "").trim();
  if (!value) return;
  current = { path: value, name: String(name || ""), at: Date.now() };
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 取走并清空（画布首次挂载时调用，⛔ 同一张图不会重复落两次）。 */
export function takeCanvasImage() {
  const value = current;
  current = null;
  return value;
}

/** 订阅（画布存活期间）；返回取消函数。 */
export function subscribeCanvasImage(fn) {
  if (typeof fn !== "function") return () => undefined;
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
