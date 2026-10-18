/**
 * 本地绝对路径 → file:// URL（webview / 内置浏览器可直接渲染本地 HTML）。
 *
 * ⛔⛔ 两个坑（10-17 实测，各吃过一次）：
 *   ① 中文不编码 ⇒ webview 加载失败/空白（地址栏里中文原文 + 反斜杠原样）；
 *   ② 整段 encodeURIComponent 会把**盘符冒号**也编码成 `D%3A` ⇒ `file://D%3A/…`
 *      变成非法 authority ⇒ 同样空白（截图实证）。「放大预览」走主进程正规 URL 所以一直正常。
 * ⇒ 正确形态：反斜杠归一；**盘符冒号保留**；其余路径段逐段 encodeURIComponent。
 *
 * 10-18 从 `src/features/app-view/helpers/paths.ts` 下沉到基座：HTML 实时预览板块也要用，
 * 不能跨域深链 app-view 的内部文件；helpers 原位置保留同名 re-export（调用方零改动）。
 */
export function toFileUrl(p) {
  const norm = String(p).replace(/\\/g, "/");
  const segs = norm.split("/");
  const drive = /^([a-zA-Z]):$/.test(segs[0]) ? segs[0] : encodeURIComponent(segs[0]);
  const encoded = [drive, ...segs.slice(1).map((seg) => encodeURIComponent(seg))].join("/");
  return norm.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}
