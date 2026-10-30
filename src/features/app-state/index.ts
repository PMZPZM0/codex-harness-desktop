/**
 * app-state 域的 barrel（10-28）。
 *
 * ⛔ 只导出**类型**：域间深链（`../app-state/useHarnessApp`）会被预检【130】判红，
 * 而其它域本来也不需要握到组合根的实现 —— 需要的只是那个由 hook 推导出来的 API 形状。
 */
export type { HarnessAppApi } from "./useHarnessApp";
/* ⛔ 10-30：sendPrefilled 不从这里导出 —— 它要真正的 bag，必须走 `app.sendPrefilled`
   （part08 里绑好 bag 的包装）。这里导出会诱使调用方把合并对象当 bag 传（缺字段，静默失败）。 */
