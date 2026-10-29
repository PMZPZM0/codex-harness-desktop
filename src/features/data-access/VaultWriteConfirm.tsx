/**
 * VaultWriteConfirm（10-29）：模型要写密码本时的**一次性确认弹窗**。
 *
 * 用户定规矩：「任何写入需一次性确认弹窗」—— 所以模型调用 password_book(action=save) 时，
 * 这里必须先弹出来，用户点了「允许」才真的写盘。
 *
 * 安全约束（写死在 UI 上，别改松）：
 *  · 密码**只显示长度与圆点**，弹窗里没有明文（明文在提交时原样传给主进程加密落盘）；
 *  · 明确告诉用户「这次允许只对这一次生效」—— 不存在"记住我的选择"。
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { KeyRound, ShieldAlert, X } from "lucide-react";
import { currentVaultWrite, settleVaultWrite, subscribeVaultWrite } from "./vault-write-gate";

export function VaultWriteConfirm() {
  const pending = useSyncExternalStore(subscribeVaultWrite, currentVaultWrite, () => null);

  /* Esc = 取消（与其它弹窗一致；这里 capture 掉，别让 Esc 顺带关掉背后的会话面板） */
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      settleVaultWrite(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending]);

  if (!pending) return null;
  const { draft } = pending;

  return createPortal(
    <div className="modal-backdrop vault-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) settleVaultWrite(false); }}>
      <section className="vault-confirm" role="dialog" aria-modal="true" aria-label="确认写入密码本">
        <header>
          <span className="vault-confirm-title"><ShieldAlert size={15} />写入密码本？</span>
          <button type="button" className="icon-button" title="取消" aria-label="取消" onClick={() => settleVaultWrite(false)}><X size={16} /></button>
        </header>

        <p className="vault-confirm-lead">
          Codex 想{draft.id ? "更新" : "新增"}一条密码记录。<strong>只有你点「允许」才会写入</strong>，且只对这一次生效。
        </p>

        <dl className="vault-confirm-fields">
          <div><dt>名称</dt><dd>{draft.title || "（未填）"}</dd></div>
          <div><dt>账号</dt><dd>{draft.username || "（未填）"}</dd></div>
          {draft.url ? <div><dt>网址</dt><dd className="vault-confirm-url">{draft.url}</dd></div> : null}
          <div>
            <dt>密码</dt>
            <dd>{draft.hasPassword ? <span className="vault-confirm-dots">{"•".repeat(Math.min(draft.passwordLength, 24))}（{draft.passwordLength} 位）</span> : "（不修改）"}</dd>
          </div>
          {draft.note ? <div><dt>备注</dt><dd>{draft.note}</dd></div> : null}
        </dl>

        <p className="vault-confirm-hint">
          <KeyRound size={12} />密码会用系统加密后存进本机密码本，<strong>不会写入对话、也不会同步到云端</strong>。
        </p>

        <footer>
          <button type="button" className="vault-confirm-cancel" onClick={() => settleVaultWrite(false)}>不允许</button>
          <button type="button" className="vault-confirm-allow" onClick={() => settleVaultWrite(true)}>允许写入</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
