/**
 * 右栏「媒体」页当前要预览的目标（11-28 用户令：「媒体预览接一下」）。
 *
 * 为什么要独立 store：预览请求来自三条路（文件卡 `openMediaPreview`、引擎 `media-preview:open`、
 * 工具产物卡），而右栏页此刻**可能没挂载**（右栏关着 / 停在别的页）。
 * ⇒ 目标存模块级，右栏打开时补上；桥（Bridge）只负责「写 store + 请宿主切页」，不渲染 UI。
 * ⛔ 这里只存「看哪个文件」，播放状态属于视图组件。
 */
let current = null;
const listeners = new Set();

/** 设置当前媒体预览目标（null = 清空）。 */
export function setMediaPanelTarget(target) {
  current = target ?? null;
  for (const fn of [...listeners]) {
    try { fn(current); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 读当前目标（右栏挂载时补历史用）。 */
export function getMediaPanelTarget() {
  return current;
}

/** 订阅目标变化；返回取消函数。 */
export function subscribeMediaPanelTarget(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
