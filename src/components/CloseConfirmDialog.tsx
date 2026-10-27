/**
 * 关闭确认弹窗（10-13）—— 点 X 时的**应用内**确认卡片（替代原生系统对话框）。
 *
 * 流程：主进程关窗守卫（window-factory）preventDefault 后经 `close-confirm:ask`
 * 推「要不要关」⇒ 本组件订阅该事件、渲染与整体风格一致的卡片；用户选完经
 * `close-confirm:respond` 回包，主进程执行 hide（tray）/ 二次 close（quit）/ 不动（cancel）。
 * 「不再询问」由主进程落盘（closeToTray + closePromptSeen），此后不再弹。
 *
 * ⛔⛔ **必须 portal 到 `document.body`**（同 UpdateReadyToast：带 transform 的祖先
 *    会成为 `fixed` 的包含块，不 portal 会跟着输入框跑、被 timeline 裁掉）。
 * ⛔ **自包含**：订阅与状态都在本组件内（不进 app-state）—— 它与设置无关，
 *    是窗口级的一次性确认；挂载处只需要 `<CloseConfirmDialog />` 一行。
 * ⛔ 云助手（headless + shim）同样可用：`wc.send` 会被转成 SSE 广播给浏览器，
 *    `respondCloseConfirm` 走 /__ipc —— 同一份代码，桌面与云助手两处一致。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Minimize2, X } from "lucide-react";

type AskPayload = { busy: number; appName: string };
type CloseAction = "tray" | "quit" | "cancel";

export function CloseConfirmDialog() {
  const [ask, setAsk] = useState<AskPayload | null>(null);
  const [remember, setRemember] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // ⛔ 桥不存在就不挂（理论上桌面/云助手都有；防御一下，别让没有桥的形态报错）。
    if (!window.codex?.onCloseConfirmAsk || !window.codex.respondCloseConfirm) return;
    return window.codex.onCloseConfirmAsk((payload) => {
      setRemember(false);
      setSending(false);
      setAsk(payload);
    });
  }, []);

  /* ⛔ 10-28 审查（对话框组件）：这个确认框原来**只能用鼠标**关 —— 有 role/aria-modal、有取消按钮，
     但没有 Esc，键盘用户按 Esc 什么都不会发生（全局 Esc 还会去关别的面板）。
     ⇒ capture 阶段拦 Esc = 取消（方向安全：Esc 永远不会误触"退出应用"）。 */
  useEffect(() => {
    if (!ask) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setSending(true);
      void window.codex.respondCloseConfirm?.("cancel", remember).catch(() => undefined).finally(() => setAsk(null));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask, remember]);

  if (!ask || typeof document === "undefined") return null;

  const respond = (action: CloseAction) => {
    setSending(true);
    void window.codex
      .respondCloseConfirm(action, remember)
      .catch(() => undefined)
      .finally(() => setAsk(null));
  };

  return createPortal(
    <div className="close-confirm-backdrop" role="dialog" aria-modal="true" aria-label={`关闭 ${ask.appName} 窗口`}>
      <div className="close-confirm-card">
        <div className="close-confirm-head">
          <span className="close-confirm-title">关闭 {ask.appName} 窗口？</span>
          <button type="button" className="close-confirm-x" onClick={() => respond("cancel")} aria-label="取消">
            <X size={15} />
          </button>
        </div>
        <p className="close-confirm-desc">
          最小化到托盘后，Agent 和后台任务会继续运行；退出应用会停止正在进行的工作。
          {ask.busy > 0 ? `当前还有 ${ask.busy} 个任务在运行。` : ""}
        </p>
        <label className="close-confirm-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>不再询问</span>
        </label>
        <div className="close-confirm-actions">
          <button type="button" className="close-confirm-btn" onClick={() => respond("cancel")} disabled={sending}>
            取消
          </button>
          <button type="button" className="close-confirm-btn danger" onClick={() => respond("quit")} disabled={sending}>
            <LogOut size={13} />
            退出应用
          </button>
          <button type="button" className="close-confirm-btn primary" onClick={() => respond("tray")} disabled={sending}>
            <Minimize2 size={13} />
            最小化到托盘
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
