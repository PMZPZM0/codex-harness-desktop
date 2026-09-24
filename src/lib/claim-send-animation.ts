/** claimSendAnimation（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { claimSendAnimation as claimSendAnimationLib } from "./send-anim.mjs";
import { sendAnimStore } from "./send-anim-store";

export function claimSendAnimation(messageText: string): number | null {
  const result = claimSendAnimationLib(sendAnimStore, messageText, Date.now());
  return result.kind === "continue" ? result.delayMs : null;
}
