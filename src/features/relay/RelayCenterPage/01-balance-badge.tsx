/**
 * RelayCenterPage 的「balance-badge」部分（09-22 从同目录 RelayCenterPage.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { resolveRelayTarget, writeRelayActive, readRelayActive, RelayActive } from "../../../lib/relay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
export function shortGroupName(name: unknown, max: number) {
  const cleaned = String(name ?? "套餐").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim() || "套餐";
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

export function RelayBalanceBadge({ active }: { active: RelayActive | null }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // 强信号指纹：provider / apiKey / mode / groupId / switchedAt 任一变化都代表切换了账户或计费方式。
  // 原实现只按 provider 名做 useMemo，同网关换账号时 provider 字符串不变 → 徽标永不刷新、余额/套餐卡死在旧账号。
  const fingerprint = `${active?.provider ?? ""}|${active?.apiKey ?? ""}|${active?.mode ?? ""}|${active?.groupId ?? ""}|${active?.switchedAt ?? 0}`;
  const refresh = useCallback(() => {
    if (!active) return;
    window.codex.relayOverview().then((data) => { setOverview(data); setErr(""); }).catch((e) => setErr(e.message ?? "加载失败"));
  }, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!active) return null;
  const subs: any[] = overview?.subscriptions ?? [];
  const current = subs.find((s) => s.group_id === active.groupId);
  let label = "中转站";
  if (active.mode === "balance") {
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  } else if (current) {
    const limit = current.monthly_limit_usd ?? current.daily_limit_usd ?? 0;
    const used = current.monthly_used_usd ?? current.daily_used_usd ?? 0;
    label = overview ? `${shortGroupName(current.group_name, 12)} 剩 $${Math.max(0, limit - used).toFixed(2)}` : "套餐 …";
  } else if (overview) {
    // 该分组没有生效订阅：用量按量从账户余额扣（如站方把 key 分组清掉、或选了非订阅分组的老 key）
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  }
  return <div className="relay-badge" ref={wrapRef}>
    <button type="button" className="context-ring relay-badge-btn" title="中转站余额" aria-label="中转站余额" onClick={() => { setOpen((v) => !v); if (!overview) refresh(); }}>
      <Wallet size={13} /><small>{err ? "余额同步失败" : label}</small>
    </button>
    {open && <div className="ctx-pop relay-pop" role="dialog" aria-label="中转站余额明细" onMouseLeave={() => setOpen(false)}>
      <div className="ctx-pop-head"><strong>{active.label || "中转站"}</strong></div>
      <div className="ctx-pop-sub">{overview?.email || ""}{err ? ` · ${err}` : ""}{active.apiKey ? ` · 密钥 …${active.apiKey.slice(-6)}` : ""}</div>
      <div className="ctx-pop-grid">
        <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">账户余额</span><b className="ctx-pop-cell-value">{overview ? `$${Number(overview.balance).toFixed(2)}` : "…"}</b></div>
        {subs.map((s) => {
          const values = [
            s.monthly_limit_usd != null ? `月剩 $${Math.max(0, s.monthly_limit_usd - (s.monthly_used_usd ?? 0)).toFixed(2)}` : "",
            s.weekly_limit_usd != null ? `周剩 $${Math.max(0, s.weekly_limit_usd - (s.weekly_used_usd ?? 0)).toFixed(2)}` : "",
          ].filter(Boolean).join(" · ");
          return (
            <div className="ctx-pop-cell" key={s.id}>
              <span className="ctx-pop-cell-label" title={`${s.group_name ?? ""}${s.expires_at ? `（至 ${String(s.expires_at).slice(0, 10)}）` : ""}`}>{shortGroupName(s.group_name, 18)}{s.expires_at ? ` · ${String(s.expires_at).slice(5, 10)}` : ""}</span>
              <b className="ctx-pop-cell-value">{values || "生效中"}</b>
            </div>
          );
        })}
      </div>
      <p className="ctx-pop-cache-note">设置 → 账户 → 中转站 可切换账号、套餐或密钥。</p>
    </div>}
  </div>;
}

/** 模型设置页里的中转站精简入口：显示当前绑定状态，点击进独立中转站页。 */
export function RelayAccountEntryBanner({ active, onOpen }: { active: { label: string } | null; onOpen: () => void }) {
  return (
    <button type="button" className="relay-entry-banner" onClick={onOpen}>
      <Wallet size={14} />
      <span>{active ? <>中转站账户 · 当前使用 <b>{active.label}</b></> : "中转站账户 · 登录后同步余额与订阅套餐，一键接入"}</span>
      <ChevronRight size={14} />
    </button>
  );
}
