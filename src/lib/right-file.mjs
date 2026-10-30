/**
 * 右栏「工作区文件」的打开请求（10-22，Qoder 式文件卡联动）。
 *
 * 文件卡在回合里（深处），右栏在 AppView 顶层；中间隔着好几层。用一个**极小的事件箱**
 * 把「要打开哪个文件」传上去，比给整条组件链加 props 改动面小（同 turn-review-store 的做法）。
 * ⛔ 只传路径，不传 DOM / 回调；订阅者负责开栏、切标签、展开目录。
 */

let current = null;
const listeners = new Set();
/* 路径解析器（由 RightFileBridge 注册）：把卡片给的路径补绝对 + 不存在就回落。
   ⛔ 解析放在**广播之前**，所有订阅方（右栏预览 / 文件树高亮 / 回合胶囊）拿到的都是**可用路径**；
     否则每个订阅方各自拼一次，就会出现"树里高亮了一个不存在的路径、预览报不存在"。 */
let resolver = null;

/** 注册路径解析器（传 null 注销）。 */
export function registerRightFileResolver(fn) {
  resolver = typeof fn === "function" ? fn : null;
}

function emit(path) {
  current = { path, at: Date.now() };
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它订阅方 */ }
  }
}

/** 请求在右侧栏预览一个文件（相对路径按会话工作区解析，路径不存在时按文件名找回）。 */
export function openRightFile(path) {
  const value = String(path || "").trim();
  if (!value) return;
  if (!resolver) { emit(value); return; }
  void Promise.resolve(resolver(value))
    .then((resolved) => emit(String(resolved || value)))
    .catch(() => emit(value));
}

/** 最近一次请求（右栏刚挂载时用它恢复选中项）。 */
export function getRightFile() {
  return current;
}

export function subscribeRightFile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
