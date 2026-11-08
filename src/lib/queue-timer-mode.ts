import { useSyncExternalStore } from "react";

/**
 * 排队消息「定时发送」总开关（11-02 用户令：默认关闭，关闭时排队卡不显示定时入口）。
 *
 * ⛔ 关闭 ≠ 只隐藏按钮：已设的定时要一并撤销（主进程定时器 + 本地徽标），
 *    否则消息会在用户看不见的地方到点自动发出。
 * ⛔ 默认关闭：没写过这个键（老档案 / 新装）一律 false，只有明确开启过才显示定时。
 */
const KEY = "queue-timer-enabled-v1";
let enabled = (() => {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
})();
const listeners = new Set<() => void>();

/** 读「排队定时」开关的当前值。 */
export function isQueueTimerEnabled(): boolean {
  return enabled;
}

/** 写开关 → 落 localStorage → 通知订阅者（同值重复调用无副作用）。 */
export function setQueueTimerEnabled(next: boolean): void {
  enabled = Boolean(next);
  try { localStorage.setItem(KEY, enabled ? "true" : "false"); } catch { /* 隐私模式忽略 */ }
  for (const listener of listeners) listener();
}

/** 订阅开关变化，返回退订函数。 */
export function subscribeQueueTimerMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React 侧读开关（`useSyncExternalStore`）。 */
export function useQueueTimerEnabled(): boolean {
  return useSyncExternalStore(subscribeQueueTimerMode, isQueueTimerEnabled, isQueueTimerEnabled);
}
