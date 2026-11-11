/** 异步执行反馈板块（11-11 立，独立板块 / 零 IPC）。
 *  数据：主进程 `group-async-run` 事件；状态归约：`reduceAsyncRunEvent`；展示：`AsyncRunPanel`。
 *  扩展点见 `useAsyncRunState.ts` 文件头，⛔ 不在群聊域里另开一条链。 */
export { AsyncRunPanel } from "./AsyncRunPanel";
export { useAsyncRunState, reduceAsyncRunEvent, scopeKeyOf, PHASES } from "./useAsyncRunState";
export type { AsyncRunBatch, AsyncRunRow, AsyncRunPhase } from "./useAsyncRunState";
