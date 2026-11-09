/**
 * app-view 对其它板块暴露的**组件**出口（11-09 新增）。
 *
 * ⛔ 只做 re-export，不放实现：群聊板块要复用右栏（变更/审阅/浏览器/文件 + 预览），
 *   但规则禁止深链 `AppView/*` 内部文件 —— 走这个 barrel 即“对方板块的公开面”。
 */
export { AppViewReviewPanel } from "./AppView/03-review-panel";
