/**
 * 工作伙伴独立窗口探测（11-08 用户令）。
 * ⛔ 同步读 URL query（与 popoutFromQuery 同口径）：异步探测会让独立窗口先按主界面
 *    布局渲染一帧，用户看到一闪而过的侧栏 / 时间线。
 */
export function isTeamPopoutWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("teamPopout") === "1";
  } catch {
    return false;
  }
}
