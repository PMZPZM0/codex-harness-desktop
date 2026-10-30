/**
 * app-state 域的 barrel（10-28）。
 *
 * ⛔ 只导出**类型**：域间深链（`../app-state/useHarnessApp`）会被预检【130】判红，
 * 而其它域本来也不需要握到组合根的实现 —— 需要的只是那个由 hook 推导出来的 API 形状。
 */
export type { HarnessAppApi } from "./useHarnessApp";
/* 10-30 任务监控「进化」：预填 + 一次性技能 + 直接发送（避开 setState 未刷新） */
export { sendPrefilled } from "./parts/part08/02-seg/send";
