/**
 * 群聊面板的开关（10-05）
 *
 * ⛔ 为什么不放 app bag：这是个**纯面板可见性**状态，进 bag 要动 bag-types（两处）+ 守卫，
 *    而它只被「侧栏按钮」与「面板自己」用。项目里 badge 循环用的就是同一套
 *    `useSyncExternalStore` 模式（见 02-thread-attention-rows），照它办。
 * ⛔ 单一真相源：只有这里能改 open；组件只订阅。
 */
import { useSyncExternalStore } from "react";

let opened = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export const teamChatOpen = {
  get: () => opened,
  set(next: boolean) {
    if (opened === next) return;
    opened = next;
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** 组件侧：`const open = useTeamChatOpen()`。 */
export function useTeamChatOpen(): boolean {
  return useSyncExternalStore(teamChatOpen.subscribe, teamChatOpen.get, teamChatOpen.get);
}
