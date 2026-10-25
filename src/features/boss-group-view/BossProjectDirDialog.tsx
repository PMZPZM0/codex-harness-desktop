/**
 * BOSS 会话的项目地址对话框（10-25 用户令）
 *
 * 「BOSS 会话，项目地址，不要自动同步其他会话的项目地址，必须重新选项目地址，
 *   或者自动在软件安装的对应盘…弹窗提醒，**不要系统弹窗和内联弹窗**，
 *   两个选项：选择 BOSS 会话项目地址 / 自动生成项目地址」
 *
 * ⇒ 这是**应用内模态**（复用 CloseConfirmDialog 的卡片样式，层级 950 = 全局最高），
 *   ⛔ 不用 Electron 原生 messageBox（系统弹窗），⛔ 不用 toast（内联弹窗）。
 *   真正的「选目录」仍然要走系统的目录选择器（浏览器/Electron 无法凭空取路径），
 *   但**这一步是用户主动点的按钮**，不是系统弹窗糊脸。
 */
import { createPortal } from "react-dom";
import { FolderOpen, FolderPlus, X } from "lucide-react";

export type BossProjectDirChoice = "pick" | "auto" | "cancel";

export function BossProjectDirDialog({
  open,
  busy,
  onChoose,
}: {
  open: boolean;
  busy?: boolean;
  onChoose: (choice: BossProjectDirChoice) => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="close-confirm-backdrop" role="dialog" aria-modal="true" aria-label="选择 BOSS 会话项目地址">
      <div className="close-confirm-card">
        <div className="close-confirm-head">
          <span className="close-confirm-title">BOSS 会话的项目地址</span>
          <button type="button" className="close-confirm-x" onClick={() => onChoose("cancel")} aria-label="取消">
            <X size={15} />
          </button>
        </div>
        <p className="close-confirm-desc">
          BOSS 会话的项目地址<strong>不跟其他会话同步</strong>，每次新建都要定一次。
          可以选一个已有的项目目录，或者在软件所在的盘自动新建一个专属目录。
        </p>
        <div className="close-confirm-actions">
          <button type="button" className="close-confirm-btn" onClick={() => onChoose("cancel")} disabled={busy}>
            取消
          </button>
          <button type="button" className="close-confirm-btn" onClick={() => onChoose("auto")} disabled={busy}>
            <FolderPlus size={13} />
            在软件所在盘自动新建
          </button>
          <button type="button" className="close-confirm-btn primary" onClick={() => onChoose("pick")} disabled={busy}>
            <FolderOpen size={13} />
            选择项目地址
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
