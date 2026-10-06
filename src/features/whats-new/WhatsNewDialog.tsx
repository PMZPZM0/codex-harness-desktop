/**
 * 「新功能介绍」弹窗（whats-new 域 · 渲染层，2026-10-06 立）。
 *
 * 用户需求：应用更新到新版本后，首次启动自动弹一个小窗，展示**版本号 + 本次更新要点**，
 * 带「查看详情」与「关闭」两个动作，**看过就不再弹**。
 *
 * ── 边界（⛔ 别把判定搬到这里来）────────────────────────────────────────────
 *   「该不该弹」「弹什么」**全在主进程**判定（见 `electron/features/whats-new-ipc.ts`）：
 *   渲染层只做两件事 —— 取一次 `whatsNewState()` 并按 `shouldShow` 画；用户看完回报 `whatsNewAck`。
 *   ⛔ 判定一旦分两处写，必然漂：比如"本地存过看过标记"和"主进程存的看过版本"不一致时，
 *     会出现"弹了一次又弹一次"或"该弹却不弹"（都是静默的，最难查）。
 *   ⛔ 更不要把"看过没看过"记在 localStorage：多窗口（popout）各有一份 localStorage，
 *     在 A 窗口关掉后 B 窗口下次启动还会再弹。
 *
 * ── 与更新弹窗的关系 ───────────────────────────────────────────────────────
 *   更新弹窗（设置 → 关于 / 发现新版本）管的是**还没装**的那一版（内容来自 GitHub Release 正文）；
 *   本弹窗管的是**已经装上**的这一版 —— 两者内容粒度不同，不是重复（见 whats-new-notes.ts 头注）。
 */
import { useCallback, useEffect, useState } from "react";
import { Sparkles, X, ExternalLink } from "lucide-react";

type WhatsNewEntry = { version: string; date: string; items: { t: string; d?: string }[] };

type WhatsNewState = {
  ok: boolean;
  version: string;
  entry: WhatsNewEntry | null;
  shouldShow: boolean;
  reason: string;
  seen: boolean;
  releaseUrl: string;
};

/** 启动后等一拍再弹：主进程此刻还在起窗口/引擎，弹窗跟启动动画抢同一帧会看着"闪"一下。 */
const SHOW_DELAY_MS = 900;

export function WhatsNewDialog() {
  const [state, setState] = useState<WhatsNewState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    void (async () => {
      try {
        const next = (await window.codex.whatsNewState()) as WhatsNewState;
        if (cancelled || !next?.shouldShow || !next.entry) return;
        timer = window.setTimeout(() => { if (!cancelled) setOpen(true); }, SHOW_DELAY_MS);
        setState(next);
      } catch { /* 取不到就不弹（绝不因为"介绍弹窗"挡住用户用应用） */ }
    })();
    return () => { cancelled = true; if (timer != null) window.clearTimeout(timer); };
  }, []);

  /** 关闭 = 看过。⛔ 无论走哪条关闭路径（按钮 / ✕ / ESC / 点遮罩）都要回报，否则下次还弹。 */
  const close = useCallback(() => {
    setOpen(false);
    const version = state?.version;
    if (version) void window.codex.whatsNewAck(version).catch(() => undefined);
  }, [state?.version]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !state?.entry) return null;
  const { version, date, items } = state.entry;

  return (
    <div
      className="modal-backdrop agent-ask-backdrop whats-new-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="agent-ask-card whats-new-card" role="dialog" aria-modal="true" aria-label={`新版本 ${version} 功能介绍`}>
        <header>
          <Sparkles size={16} />
          <strong>已更新到 v{version}</strong>
          <button type="button" className="icon-button relay-modal-close" title="关闭" onClick={close}><X size={16} /></button>
        </header>
        <p className="whats-new-sub">{date} · 本次上新的 {items.length} 件事</p>
        <ul className="whats-new-list">
          {items.map((item, index) => (
            <li key={index}>
              <span className="whats-new-idx">{index + 1}</span>
              <div className="whats-new-body">
                <strong>{item.t}</strong>
                {item.d && <span>{item.d}</span>}
              </div>
            </li>
          ))}
        </ul>
        <div className="app-prompt-actions">
          {/* 「查看详情」= 完整发版说明（GitHub Release 正文）。⛔ 不关弹窗：用户常要对照着看列表 */}
          {state.releaseUrl && (
            <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(state.releaseUrl)}>
              <ExternalLink size={13} />查看完整说明
            </button>
          )}
          <button type="button" className="primary-setting" onClick={close}>知道了</button>
        </div>
      </div>
    </div>
  );
}
