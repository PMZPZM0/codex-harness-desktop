/** claimSendAnimation（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { claimSendAnimation as claimSendAnimationLib } from "./send-anim.mjs";
import { sendAnimStore } from "./send-anim-store";

/** 认领一次「发送动画」：同一句话在节流窗口内重复发送返回 null（不重播），否则返回该次应有的延迟毫秒。 */
export function claimSendAnimation(messageText: string): number | null {
  const result = claimSendAnimationLib(sendAnimStore, messageText, Date.now());
  return result.kind === "continue" ? result.delayMs : null;
}
