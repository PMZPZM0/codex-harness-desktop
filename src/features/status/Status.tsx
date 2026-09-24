/** 运行状态 / 上下文用量（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState, useEffect, useRef } from "react";
import { FileCode2, ChevronDown, CircleGauge, Minimize2 } from "lucide-react";
import { RUN_CLOCK } from "../../lib/run-clock-2";
import { Turn } from "../../lib/turn";
import { diffStats } from "../../lib/diff-stats";
import { usageBucket } from "../../lib/usage-bucket";
import { usageInputTokens } from "../../lib/usage-input-tokens";
import { usageCachedTokens } from "../../lib/usage-cached-tokens";

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} title={status === "ready" ? "Codex 已连接" : status === "error" ? "Codex 连接失败" : "Codex 正在启动"} />;
}

export function CompletedChanges({ turn }: { turn: Turn }) {
  const changes = turn.items.flatMap((item) => item.type === "fileChange" ? (item.changes ?? []) : []);
  if (!changes.length) return null;
  const byPath = new Map<string, { path: string; added: number; deleted: number }>();
  for (const change of changes) {
    const path = change.path ?? change.filePath ?? "未知文件";
    const stats = diffStats(change.diff ?? "");
    const current = byPath.get(path) ?? { path, added: 0, deleted: 0 };
    byPath.set(path, { path, added: current.added + stats.added, deleted: current.deleted + stats.deleted });
  }
  const files = [...byPath.values()];
  const totals = files.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 });
  return (
    <details className="completed-changes" open>
      <summary><FileCode2 size={15} /><strong>已编辑 {files.length} 个文件</strong><span className="diff-add">+{totals.added}</span><span className="diff-delete">-{totals.deleted}</span><ChevronDown size={14} /></summary>
      <div>{files.map((file) => <div className="completed-file" key={file.path}><code>{file.path}</code><span><b>+{file.added}</b> <i>-{file.deleted}</i></span></div>)}</div>
    </details>
  );
}

export function RunningProcessTime({ turnId }: { turnId: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const totalSeconds = RUN_CLOCK.elapsedSeconds(turnId, now);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return <div className="running-process-time">正在处理 {minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`}</div>;
}

export function ContextRing({ tokenUsage, fallbackWindow }: { tokenUsage?: any; fallbackWindow?: number }) {
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  const currentUsage = usageBucket(tokenUsage, "last") ?? usageBucket(tokenUsage, "total");
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  // 有 contextWindow 但还没用量时仍显示图标占位（0%），让"上下文进度"始终可见
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const label = used != null ? `${Math.round(percent)}%` : "—";
  const title = used != null ? `上下文 ${Math.round(percent)}% · ${Number(used).toLocaleString()} / ${Number(contextWindow).toLocaleString()} Token` : `上下文窗口 ${Number(contextWindow).toLocaleString()} Token · 用量未同步`;
  // 重度长上下文：接近窗口上限时变色预警（warn 80% / danger 95%），提示该压缩了
  const tone = percent >= 95 ? "danger" : percent >= 80 ? "warn" : "";
  return <span className={`context-ring ${tone}`} role="progressbar" aria-label="上下文用量" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} title={title}><CircleGauge size={13} /><small>{label}</small></span>;
}

function usageCacheRate(usage: any): number | null {
  const input = usageInputTokens(usage);
  if (input <= 0) return null;
  const cached = Math.min(input, usageCachedTokens(usage));
  return Math.round((cached / input) * 1000) / 10;
}

export type UsageCounterSnapshot = { input: number; cached: number; output: number; total: number };

export function ContextUsageBadge({ tokenUsage, fallbackWindow, recentCompaction, onCompact }: { tokenUsage?: any; fallbackWindow?: number; recentCompaction?: boolean; onCompact?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  const lastUsage = usageBucket(tokenUsage, "last");
  const totalUsage = usageBucket(tokenUsage, "total");
  const currentUsage = lastUsage ?? totalUsage;
  const cacheUsage = tokenUsage?.derivedLast ?? currentUsage;
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const input = usageInputTokens(cacheUsage);
  const cached = Math.min(input, usageCachedTokens(cacheUsage));
  const turnCacheRate = usageCacheRate(cacheUsage);
  const averageCacheRate = totalUsage ? usageCacheRate(totalUsage) : null;
  const summaryCacheRate = averageCacheRate ?? turnCacheRate;
  const ctx = (value: any) => value != null ? Math.round((Number(value) / contextWindow) * 1000) / 10 : null;
  const details = [
    { label: "消息", value: ctx(currentUsage?.messageTokens ?? currentUsage?.message_tokens) },
    { label: "MCP 工具", value: ctx(currentUsage?.mcpToolTokens ?? currentUsage?.mcp_tool_tokens) },
    { label: "系统工具", value: ctx(currentUsage?.systemToolTokens ?? currentUsage?.system_tool_tokens) },
    { label: "技能", value: ctx(currentUsage?.skillTokens ?? currentUsage?.skill_tokens) },
    { label: "系统提示词", value: ctx(currentUsage?.systemPromptTokens ?? currentUsage?.system_prompt_tokens) },
    { label: "其他", value: ctx(currentUsage?.otherTokens ?? currentUsage?.other_tokens) },
  ].filter((entry) => entry.value != null) as { label: string; value: number }[];
  const rows = details.length ? details : [{ label: "已用", value: Math.round(percent * 10) / 10 }];
  return (
    <div className="ctx-badge" ref={wrapRef}>
      <button type="button" className="ctx-badge-btn" title={used != null ? `上下文 ${Math.round(percent)}%` : `上下文窗口 ${contextWindow.toLocaleString()} Token · 用量待同步`} aria-label="上下文容量" onClick={() => setOpen((currentOpen) => !currentOpen)} onMouseEnter={() => setOpen(true)}>
        <ContextRing tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} />
      </button>
      {open && (
        <div className="ctx-pop" role="dialog" aria-label="上下文容量明细" onMouseLeave={() => setOpen(false)}>
          <div className="ctx-pop-head"><strong>上下文容量</strong></div>
          <div className="ctx-pop-sub">{used != null ? (used / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "0.0"}万/{(contextWindow / 10000).toLocaleString()}万（{used != null ? Math.round(percent * 10) / 10 : "—"}%{summaryCacheRate != null ? ` · 累计 ${summaryCacheRate}% 缓存` : ""}）</div>
          <div className="ctx-pop-bar"><i style={{ width: `${Math.max(2, percent)}%` }} /></div>
          <div className="ctx-pop-grid">
            {rows.map((entry) => (
              <div className="ctx-pop-cell" key={entry.label}>
                <span className="ctx-pop-cell-label">{entry.label}</span>
                <b className="ctx-pop-cell-value">{entry.value}%</b>
              </div>
            ))}
            {turnCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">本轮缓存命中率</span><b className="ctx-pop-cell-value">{turnCacheRate}%</b></div>}
            {averageCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">会话累计命中率</span><b className="ctx-pop-cell-value">{averageCacheRate}%</b></div>}
            {input > 0 && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">缓存输入</span><b className="ctx-pop-cell-value">{cached.toLocaleString()} / {input.toLocaleString()}</b></div>}
          </div>
          {turnCacheRate != null && turnCacheRate < 20 && input >= 8192 && <p className="ctx-pop-cache-note">{recentCompaction ? "上下文刚压缩过：提示词前缀已被重写，上游缓存需要 1~3 轮对话重建，期间命中率偏低属正常现象。" : "本轮缓存较低，通常是首次请求、恢复旧会话、上下文压缩、切换模型/供应商，或上游未复用相同提示词前缀导致。"}</p>}
          {onCompact && percent >= 70 && (
            <button type="button" className="ctx-pop-compact-btn" onClick={() => { setOpen(false); onCompact && onCompact(); }}>
              <Minimize2 size={13} />压缩上下文（已用 {Math.round(percent)}%）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
