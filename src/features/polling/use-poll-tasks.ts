/**
 * 轮询任务表的 React 接入口。
 *
 * ⛔ 必须用 `useSyncExternalStore` 而不是 `useState + useEffect`：任务表是**模块外部状态**
 *    （主进程广播随时写、卡片与胶囊同时读），useState 得自己实现"通知所有订阅者"，漏一个就是
 *    「胶囊显示 2 个、卡片一个没有」—— 这类 bug 只在两个消费点同时挂载时才出现，极难归因。
 *    与 `src/runtime/Slot.tsx`（插槽注册表）同一条纪律。
 */
import { useSyncExternalStore } from "react";
import { getPollSnapshot, subscribePollStore, type PollTask } from "../../polling/poll-store";

export function usePollTasks(): PollTask[] {
  return useSyncExternalStore(subscribePollStore, getPollSnapshot, getPollSnapshot);
}
