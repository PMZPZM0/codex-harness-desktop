/**
 * 通用结果弹窗（10-18）—— 用于「连通测试」「刷新」这类**一次性结果**的反馈。
 *
 * 用户要求：「刷新反馈和连通测试弹窗反馈都要加上」。
 * ⛔ 为什么单独做个弹窗而不是内嵌提示：设置页那排 hint 会被长文挤变形，而且
 *    成功后用户常常往下滚动就看不到了。弹窗是**阻断式**反馈，不会漏。
 * ⛔ 必须 Portal 到 body：设置面板祖先有 transform，fixed 会被降级+裁切（已踩过）。
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

export type ResultTone = "ok" | "err" | "info";

/** 弹窗底部动作（10-19）：云端模型连通测试需要「保存并重启应用 / 重签密钥并重试」两个出口。 */
export type ResultAction = { label: string; onClick: () => void | Promise<void>; primary?: boolean };

export function ResultDialog(props: {
  title: string;
  tone: ResultTone;
  message: string;
  /** 可选的明细行（如"端点 已下发 / 凭据 已保存"） */
  details?: Array<{ label: string; value: string }>;
  /** 可选的动作按钮；不传 = 原来的「知道了」。⛔ 点击后弹窗先关闭，再执行回调。 */
  actions?: ResultAction[];
  onClose: () => void;
}) {
  const { title, tone, message, details, actions, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accent = tone === "ok" ? "#1a7f37" : tone === "err" ? "#c0392b" : "#6a6a64";
  const soft = tone === "ok" ? "#e8f5ec" : tone === "err" ? "#fdecea" : "#fafaf8";
  const icon = tone === "ok" ? "✓" : tone === "err" ? "✕" : "i";

  return createPortal(
    <div role="alertdialog" aria-modal="true" aria-label={title}
      style={{
        position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,.42)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "min(460px, 100%)", background: "var(--panel,#fff)", color: "var(--text,#22221f)",
        border: "1px solid var(--line,#e6e6e1)", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 18px 48px rgba(0,0,0,.28)",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid var(--line,#e6e6e1)`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 22, height: 22, borderRadius: "50%", flex: "0 0 22px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: soft, color: accent, fontWeight: 700, fontSize: 13,
          }}>{icon}</span>
          <strong style={{ fontSize: 14, color: accent }}>{title}</strong>
          <button type="button" onClick={onClose} aria-label="关闭"
            style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", fontSize: 16, color: "var(--muted,#6a6a64)" }}>×</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{message}</p>
          {details && details.length > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line-soft,#efefeb)", paddingTop: 10 }}>
              {details.map((d) => (
                <div key={d.label} style={{ display: "flex", gap: 10, fontSize: 12.5, padding: "2px 0" }}>
                  <span style={{ color: "var(--muted,#6a6a64)", minWidth: 72 }}>{d.label}</span>
                  <span>{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "10px 18px 14px", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {actions?.length ? actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              type="button"
              onClick={() => { onClose(); void action.onClick(); }}
              style={{
                fontSize: 12.5, padding: "5px 16px", borderRadius: 7, cursor: "pointer",
                border: action.primary ? 0 : "1px solid var(--line,#e6e6e1)",
                background: action.primary ? "var(--brand,#7c3aed)" : "transparent",
                color: action.primary ? "#fff" : "var(--text,#22221f)",
              }}
            >{action.label}</button>
          )) : (
            <button type="button" onClick={onClose}
              style={{
                fontSize: 12.5, padding: "5px 16px", borderRadius: 7, border: 0, cursor: "pointer",
                background: "var(--brand,#7c3aed)", color: "#fff",
              }}>知道了</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
