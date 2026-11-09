import { createContext, useContext, useSyncExternalStore } from "react";

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
 * ⛔ 11-01 用户令「对话流默认详细」：没存过键（老档案）一律 detailed；显式选过简洁的保持 simple。
 */
export type DialogFlowMode = "simple" | "detailed";

const KEY = "dialog-flow-mode-v1";
let mode: DialogFlowMode = (() => {
  try { return localStorage.getItem(KEY) === "simple" ? "simple" : "detailed"; } catch { return "detailed"; }
})();
const listeners = new Set<() => void>();

/** 读「对话流展示模式」（detailed = 展开每步，simple = 只留结论）。 */
export function getDialogFlowMode(): DialogFlowMode {
  return mode;
}

/** 写展示模式（非法值归一成 simple）→ 落 localStorage → 通知订阅者。 */
export function setDialogFlowMode(next: DialogFlowMode): void {
  mode = next === "detailed" ? "detailed" : "simple";
  try { localStorage.setItem(KEY, mode); } catch { /* 隐私模式忽略 */ }
  for (const listener of listeners) listener();
}

/** 订阅展示模式变化，返回退订函数。 */
export function subscribeDialogFlowMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ⛔⛔ 11-09 用户（群设置截图）：「对话流」现在是**默认折叠**，可群里跑起来照样把详细步骤铺开了。
   根因：群聊有**自己的**「对话流」设置（`dialogFlow: simple | detail`），而 `TurnView` 里的过程折叠
   读的是**全局**这个偏好（默认 detailed）⇒ 群的设置根本没被消费。
   ⇒ 加一个**作用域覆盖**：谁在自己的子树里提供 `DialogFlowScope`，子树内所有 TurnView 都跟它走。
   ⛔ 只覆盖、不改全局值：主对话与设置页照旧读 localStorage，⛔ 别用 setDialogFlowMode 去改（会污染用户偏好）。 */
export const DialogFlowScope = createContext<DialogFlowMode | null>(null);

/** React 侧读展示模式（`useSyncExternalStore`，同值不重渲）；有作用域覆盖时以覆盖为准。 */
export function useDialogFlowMode(): DialogFlowMode {
  const scoped = useContext(DialogFlowScope);
  const global = useSyncExternalStore(subscribeDialogFlowMode, getDialogFlowMode, getDialogFlowMode);
  return scoped ?? global;
}
