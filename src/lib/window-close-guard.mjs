/**
 * 窗口关闭守卫（11-09 用户令：「工作伙伴弹窗在群聊有任务在跑的时候，关闭加一个弹窗提示；
 * 没有在跑就不提示」）。
 *
 * 机制：自绘窗口钮（`WindowControls` 的 X）先问一遍守卫；返回 true = **拦下这次关闭**，
 * 由注册方自己弹确认框（确认后再直接调 `window.codex.windowClose()`）。
 * ⛔ 只是渲染层的一道闸：OS 级关闭（Alt+F4）不经过它，别把它当安全边界。
 * ⛔ 注册方必须在卸载时注销，避免窗口形态切换后残留别人的守卫。
 */
let guard = null;

/** 注册关闭守卫；返回注销函数（组件卸载时调用）。 */
export function registerWindowCloseGuard(fn) {
  guard = typeof fn === "function" ? fn : null;
  return () => { if (guard === fn) guard = null; };
}

/** 窗口钮按下时调用：返回 true = 本次关闭已被拦下（注册方会自己弹确认）。 */
export function runWindowCloseGuard() {
  try { return Boolean(guard && guard()); } catch { return false; }
}
