/**
 * 右栏「工作区文件」的打开请求（10-22，Qoder 式文件卡联动）。
 *
 * 文件卡在回合里（深处），右栏在 AppView 顶层；中间隔着好几层。用一个**极小的事件箱**
 * 把「要打开哪个文件」传上去，比给整条组件链加 props 改动面小（同 turn-review-store 的做法）。
 * ⛔ 只传路径，不传 DOM / 回调；订阅者负责开栏、切标签、展开目录。
 */

let current = null;
const listeners = new Set();

/** 请求在右侧栏预览一个文件（绝对路径优先；相对路径由订阅方按工作区解析）。 */
export function openRightFile(path) {
  const value = String(path || "").trim();
  if (!value) return;
  current = { path: value, at: Date.now() };
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它订阅方 */ }
  }
}

/** 最近一次请求（右栏刚挂载时用它恢复选中项）。 */
export function getRightFile() {
  return current;
}

export function subscribeRightFile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
