/**
 * FileTrustDialog —— 工作区外文件预览的**应用内确认卡片**（10-18）。
 *
 * 用户定性：「不要系统弹窗，也不要内嵌」⇒ 居中模态 + 遮罩，视觉复用关闭确认那套
 * （`.close-confirm-*`），与整体风格一致。
 *
 * ⛔ 必须 portal 到 `document.body`：带 transform 的祖先会成为 `fixed` 的包含块，
 *    不 portal 会跟着输入框跑、被时间线裁掉（与 CloseConfirmDialog 同款教训）。
 * ⛔ 自包含：订阅/回包都在本组件内，挂载处只要一行 `<FileTrustDialog />`。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, ShieldAlert } from "lucide-react";
import { onFileTrustAsk, respondFileTrust } from "../lib/file-trust-ask.mjs";

type Ask = { dir: string; path?: string };

export function FileTrustDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => onFileTrustAsk((payload: Ask) => setAsk(payload)), []);

  /* ⛔ 10-28 审查（对话框组件）：同 CloseConfirmDialog —— 原来只能鼠标点，Esc 无反应。
     Esc = 拒绝（安全方向：不会因为误按 Esc 就授权一个工作区外的目录）。 */
  useEffect(() => {
    if (!ask) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setAsk(null);
      respondFileTrust(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask]);

  if (!ask || typeof document === "undefined") return null;

  const close = (allowed: boolean) => {
    setAsk(null);
    respondFileTrust(allowed);
  };

  return createPortal(
    <div
      className="close-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="文件在工作区之外"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}
    >
      <div className="close-confirm-card">
        <div className="close-confirm-head">
          <span className="close-confirm-title">
            <ShieldAlert size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            这个文件在工作区之外
          </span>
        </div>
        <p className="close-confirm-desc">
          目录：<b>{ask.dir}</b>
          <br />
          允许后，该目录下的文件都能直接预览；授权会记住（重启仍生效），可在设置里清空。
        </p>
        <div className="close-confirm-actions">
          <button type="button" className="close-confirm-btn ghost" onClick={() => close(false)}>取消</button>
          <button type="button" className="close-confirm-btn primary" onClick={() => close(true)}>
            <FolderOpen size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            允许并预览
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
