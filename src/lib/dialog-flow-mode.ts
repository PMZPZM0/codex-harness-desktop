import { useSyncExternalStore } from "react";

/**
 * 对话流展示（10-31 用户令）：
 *   简洁（默认）= 正文之间的**所有**过程（工具 / 命令 / 文件 / 已结束的思考）收成**一个**块，
 *                块头一直显示**最新一步**在干什么（跟着流实时换），点开看全部；
 *   详细       = 过程逐条内联展示（正在跑的那一段保持原样），只有被后续正文隔开的段才折叠。
 *
 * ⛔ 与 `run-process-mode`（设置 → 运行过程）**不是同一件事**，别再合并：
 *   那个管「文件改动要不要自动弹浮窗跟着看内容 / diff」（单条卡片的行为），
 *   这个管「正文之间的过程要不要整体收敛成一个块」（整条流的结构）。
 *   两者正交：可以「运行过程：详细 + 对话流：简洁」（看内容但不让过程把正文顶散）。
 *
 * ⛔ 默认必须是 simple：用户 10-31 明确「默认简洁」。老档案没有这个键时也走 simple ——
 *   所以读取时不能拿 `localStorage.getItem(KEY) === "detailed"` 之外的值当 detailed。
 */
export type DialogFlowMode = "simple" | "detailed";

const KEY = "dialog-flow-mode-v1";
let mode: DialogFlowMode = (() => {
  try { return localStorage.getItem(KEY) === "detailed" ? "detailed" : "simple"; } catch { return "simple"; }
})();
const listeners = new Set<() => void>();

export function getDialogFlowMode(): DialogFlowMode {
  return mode;
}

export function setDialogFlowMode(next: DialogFlowMode): void {
  mode = next === "detailed" ? "detailed" : "simple";
  try { localStorage.setItem(KEY, mode); } catch { /* 隐私模式忽略 */ }
  for (const listener of listeners) listener();
}

export function subscribeDialogFlowMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDialogFlowMode(): DialogFlowMode {
  return useSyncExternalStore(subscribeDialogFlowMode, getDialogFlowMode, getDialogFlowMode);
}
