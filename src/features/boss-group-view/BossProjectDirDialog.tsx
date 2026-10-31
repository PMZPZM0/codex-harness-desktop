/**
 *指挥中枢的项目地址对话框（10-25 用户令）
 *
 * 「指挥中枢，项目地址，不要自动同步其他会话的项目地址，必须重新选项目地址，
 *   或者自动在软件安装的对应盘…弹窗提醒，**不要系统弹窗和内联弹窗**，
 *   两个选项：选择指挥中枢项目地址 / 自动生成项目地址」
 *
 * ── 这不是「确认框」，是**选择器** ────────────────────────────────────────
 *   10-25 用户实测：「这个弹窗真小气…那个按键真丑」。
 *   ⇒ 之前复用了 `.close-confirm-*`（那是给「确认/取消」两按钮设计的紧凑卡片），
 *     结果：卡片挤、两个选项被压成两行字、按钮换行。
 *   ⇒ 这里用**自己的宽体样式** `.boss-dir-*`：两个**大选项卡**（图标 + 标题 + 说明），
 *     取消退到右上角 × 与遮罩点击。
 *
 *   ⛔ 不用 Electron 原生 messageBox（系统弹窗），⛔ 不用 toast（内联弹窗）。
 *     真正的「选目录」仍然要走系统的目录选择器（浏览器/Electron 无法凭空取路径），
 *     但**那一步是用户主动点的按钮**，不是系统弹窗糊脸。
 */
import { createPortal } from "react-dom";
import { FolderOpen, FolderPlus, X } from "lucide-react";

export type BossProjectDirChoice = "pick" | "auto" | "cancel";

export function BossProjectDirDialog({
  open,
  busy,
  error,
  onChoose,
}: {
  open: boolean;
  busy?: boolean;
  /** 上一次失败的原因（自动新建失败 / 目录没权限等）。
   *  ⛔ 为什么要显示：失败时原先只有一句 `catch {}` —— 点下去按钮闪一下、弹窗还在，
   *     用户完全不知道为什么（10-31 实测「点了没法确认，闪一下还是这个界面」）。 */
  error?: string;
  onChoose: (choice: BossProjectDirChoice) => void;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="boss-dir-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="选择指挥中枢的项目地址"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onChoose("cancel"); }}
    >
      <div className="boss-dir-card">
        <header className="boss-dir-head">
          <div className="boss-dir-head-copy">
            <h3 className="boss-dir-title">指挥中枢的项目地址</h3>
            <p className="boss-dir-sub">
              这个地址<strong>不跟其它会话同步</strong>，每次新建指挥中枢都要定一次。
            </p>
          </div>
          <button type="button" className="boss-dir-x" onClick={() => onChoose("cancel")} aria-label="取消" disabled={busy}>
            <X size={16} />
          </button>
        </header>

        <div className="boss-dir-options">
          <button type="button" className="boss-dir-option" onClick={() => onChoose("pick")} disabled={busy}>
            <span className="boss-dir-option-icon"><FolderOpen size={18} /></span>
            <span className="boss-dir-option-body">
              <strong>选择项目地址</strong>
              <small>从已有目录里挑一个 —— 群成员就在这个目录里干活。</small>
            </span>
          </button>
          <button type="button" className="boss-dir-option" onClick={() => onChoose("auto")} disabled={busy}>
            <span className="boss-dir-option-icon"><FolderPlus size={18} /></span>
            <span className="boss-dir-option-body">
              <strong>在软件所在盘自动新建</strong>
              <small>建一个专属目录（如 <code>指挥中枢项目-2026-10-25</code>），互不干扰。</small>
            </span>
          </button>
        </div>

        <footer className="boss-dir-foot">
          {error ? <span className="boss-dir-error" role="alert">{error}</span> : <span className="boss-dir-foot-note">也可以点外面取消。</span>}
          <button type="button" className="boss-dir-cancel" onClick={() => onChoose("cancel")} disabled={busy}>取消</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
