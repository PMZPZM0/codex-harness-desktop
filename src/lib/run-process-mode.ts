import { useSyncExternalStore } from "react";

/** 运行过程展示（10-25 用户令）：简洁 = 默认只显示文件行 +N -M；
 *  详细 = 每个生成/修改/编辑文件自动展开内容或 diff，并跟随最新内容。 */
export type RunProcessMode = "simple" | "detailed";

const KEY = "run-process-mode-v1";
let mode: RunProcessMode = (() => {
  try { return localStorage.getItem(KEY) === "detailed" ? "detailed" : "simple"; } catch { return "simple"; }
})();
const listeners = new Set<() => void>();

export function getRunProcessMode(): RunProcessMode {
  return mode;
}

export function setRunProcessMode(next: RunProcessMode): void {
  mode = next === "detailed" ? "detailed" : "simple";
  try { localStorage.setItem(KEY, mode); } catch { /* 隐私模式忽略 */ }
  for (const listener of listeners) listener();
}

export function subscribeRunProcessMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunProcessMode(): RunProcessMode {
  return useSyncExternalStore(subscribeRunProcessMode, getRunProcessMode, getRunProcessMode);
}
