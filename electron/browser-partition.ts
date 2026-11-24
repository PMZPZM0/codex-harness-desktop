/**
 * 内置浏览器 webview 的持久分区名（11-24 单独成模块）。
 *
 * ⛔ 为什么不让调用方直接从 `features/browser-ipc` 拿：那个文件反过来 import `../main`，
 *    而 `main.ts` 又 import `features/boot` —— boot 若去 import browser-ipc 就是一条环。
 *    分区名是纯常量，拆出来两边都能安全引用（单一真相源仍在）。
 * ⛔ 值不许改：登录态跟着这个分区落盘，改了等于把用户所有网页登录态清空。
 */
export const BROWSER_PARTITION = "persist:harness-browser";
