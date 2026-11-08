import { useSyncExternalStore } from "react";

/** 运行过程展示（10-25 用户令）：简洁 = 只显示文件行 +N -M；
 *  详细 = 每个生成/修改/编辑文件自动展开内容或 diff，并跟随最新内容。
 *  ⛔ 11-01 用户令「运行过程默认详细」：没存过键（老档案）一律 detailed。 */
export type RunProcessMode = "simple" | "detailed";

const KEY = "run-process-mode-v1";
let mode: RunProcessMode = (() => {
  try { return localStorage.getItem(KEY) === "simple" ? "simple" : "detailed"; } catch { return "detailed"; }
})();
const listeners = new Set<() => void>();

/** 读「运行过程展示模式」（detailed = 展开步骤，simple = 只留结论）。 */
export function getRunProcessMode(): RunProcessMode {
  return mode;
}

/** 写运行过程模式（非法值归一成 simple）→ 落 localStorage → 通知订阅者。 */
export function setRunProcessMode(next: RunProcessMode): void {
  mode = next === "detailed" ? "detailed" : "simple";
  try { localStorage.setItem(KEY, mode); } catch { /* 隐私模式忽略 */ }
  for (const listener of listeners) listener();
}

/** 订阅运行过程模式变化，返回退订函数。 */
export function subscribeRunProcessMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React 侧读运行过程模式（`useSyncExternalStore`）。 */
export function useRunProcessMode(): RunProcessMode {
  return useSyncExternalStore(subscribeRunProcessMode, getRunProcessMode, getRunProcessMode);
}
