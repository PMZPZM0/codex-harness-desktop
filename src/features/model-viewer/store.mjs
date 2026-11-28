/**
 * 3D 预览的目标（11-28 用户令：「3D 建模展示接到侧边栏新标签页展示」）。
 *
 * 为什么要有独立 store：预览目标来自两条路 —— 引擎推 `model-viewer:open`（模型调 preview_3d）、
 * 渲染层内部 `openModelViewer()`（文件卡）。而右栏「3D」页可能此刻**还没挂载**（右栏关着 / 停在别的页）。
 * ⇒ 目标存模块级、订阅者按需取：右栏打开时能把上一次的目标补上，而不是事件到了就丢。
 * ⛔ 这里只存「看什么」（path/title），不碰加载状态与 blob —— 那些属于视图组件。
 */
let current = null;
const listeners = new Set();

/** 设置当前要预览的模型（null = 清空）。 */
export function setModelViewerTarget(target) {
  current = target ?? null;
  for (const fn of [...listeners]) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 读当前目标（首次挂载时补历史用）。 */
export function getModelViewerTarget() {
  return current;
}

/** 订阅目标变化；返回取消函数。 */
export function subscribeModelViewerTarget(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
