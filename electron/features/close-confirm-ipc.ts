/**
 * close-confirm-ipc（10-13）：关闭确认弹窗的回包通道
 *
 * 域：close-confirm(1)
 * 通道：close-confirm:respond（渲染层 → 主进程：用户在**应用内弹窗**上做的选择）
 *
 * 流程：点 X → window-factory 的关窗守卫 preventDefault，并经 `close-confirm:ask`
 * 把「要不要关」推给渲染层（应用内卡片，替代原生系统框）→ 用户选择 → 本通道回包：
 *   · tray   → 隐藏主窗口（引擎 / 调度器 / 渠道机器人 / 正在跑的回合全不中断）
 *   · quit   → 置 closeConfirmed 后二次 close（弹窗文案已说明会停止正在进行的工作）
 *   · cancel → 什么都不做
 * 「不再询问」= remember ⇒ 写 closeToTray（动作本身）+ closePromptSeen（已问过），
 * 此后点 X 不再弹窗（守卫按 closeToTray 直接走）。
 */
import { closeConfirmBridge, rememberCloseChoice } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const closeConfirmFeature = defineFeature<null>({
  id: "close-confirm",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("close-confirm: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("close-confirm:respond", async (_event, action: string, remember: boolean) => {
      const pending = closeConfirmBridge.pending;
      closeConfirmBridge.pending = null;
      if (!pending) return { ok: false, error: "no-pending-close" };
      const kind = action === "tray" || action === "quit" ? action : "cancel";
      if (remember && kind !== "cancel") rememberCloseChoice(kind === "tray");
      /* ⛔ 10-13 晚：按 pending.source 分发 —— 助手窗口（云助手形态）的回包走 respondAssistant */
      closeConfirmBridge.respond?.(kind, Boolean(remember), pending.source ?? "main");
      return { ok: true };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("close-confirm:respond");
    });
  },
});
