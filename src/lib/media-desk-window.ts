/**
 * 自媒体工作台独立窗口识别（11-11）。
 *
 * 主进程用 `?mediaDesk=1` 打开派生窗口；该窗口只渲染工作台（不渲染侧栏/时间线），
 * 因此它与登录态、引导页无关 —— App.tsx 必须**在 earlyView 之前**分流。
 */
export function isMediaDeskWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("mediaDesk") === "1";
  } catch {
    return false;
  }
}
