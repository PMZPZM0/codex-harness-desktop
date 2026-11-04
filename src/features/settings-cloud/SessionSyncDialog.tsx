/**
 * 会话同步弹窗（10-18）—— **独立弹窗**，非内嵌。
 *
 * 用户令：「上传会话功能需新增一个独立弹窗（非内嵌形式），供用户勾选要上传的会话，
 *   弹窗需列出全部可选会话项并提供确认按钮；同步功能同样需新增一个独立弹窗……
 *   上传与同步流程均需提供完整的状态反馈：上传中、上传失败、上传成功，以及同步中、同步失败、同步成功，
 *   并在状态变化后正确渲染刷新界面」
 *
 * 两种模式共用一套 UI：
 *   · `upload` —— 勾选 → `cloudSyncPush`（推本地 → 云端）
 *   · `pull`   —— 勾选 → `cloudSyncPull({ keys })`（拉云端 → 本地）
 *
 * ⛔ 状态机只有五个相位，任何时刻界面都必须落在其中一个：
 *    loading（拉列表）→ idle（可勾选）→ submitting → success | error
 * ⛔ 成功/失败后**留在弹窗里**显示结果（用户要"状态变化后正确渲染"），
 *    由用户点「完成」关闭；关闭时把结果抛给父级去刷新外部界面。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

type SessionRow = {
  id: string;
  title: string;
  project: string;
  lines: number;
  sizeBytes: number;
  updatedAt: number;
  /** 来源分类：main / boss / lead / team / member / expert / subagent / cli / group-member */
  kind?: string;
  /** 同步游标：已传行数 / 新增行数 */
  syncedLines?: number;
  newLines?: number;
};

type Phase = "loading" | "idle" | "submitting" | "success" | "error";

const KIND_LABELS: Record<string, string> = {
  main: "主会话",
  boss: "指挥中枢",
  lead: "专家团主理人",
  team: "专家团调度",
  member: "团队成员",
  expert: "专家调度",
  subagent: "子智能体调度",
  cli: "CLI 智能体调度",
  "group-member": "群成员",
};
const KIND_ORDER = ["main", "boss", "lead", "team", "member", "expert", "subagent", "cli", "group-member"];
/* 默认只勾「主会话 / 中枢 / 专家团主理人 / 专家团调度」；调度与成员子会话默认不传（用户按需勾）。 */
const DEFAULT_PICK_KINDS = new Set(["main", "boss", "lead", "team"]);

type CodexBridge = {
  cloudSyncList?: () => Promise<{ ok: boolean; error?: string; sessions: SessionRow[] }>;
  cloudSyncPush?: (input?: { ids?: string[] }) => Promise<{ ok: boolean; code?: string; error?: string; pushedSessions?: number; pushedLines?: number }>;
  cloudSyncPull?: (input?: { keys?: string[] }) => Promise<{ ok: boolean; code?: string; error?: string; pulled?: number }>;
};

function bridge(): CodexBridge {
  return ((window as unknown as { codex?: CodexBridge }).codex) || {};
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 服务端的「管理员已关闭」要翻成人话，⛔ 不能显示成网络错误让用户反复重试。 */
function humanError(code: string | undefined, fallback: string | undefined, mode: "upload" | "pull"): string {
  if (code === "session-sync-disabled") return "管理员已关闭云端会话同步";
  if (code === "not-logged-in") return "未登录云账号，请先在设置里登录";
  if (code === "not-paired") return "未登录云账号，请先在设置里登录";
  if (code === "quota-exceeded") return "云端存储配额不足，请清理后重试";
  if (code === "exception") return fallback || "本地异常，详见应用日志";
  return fallback || (mode === "upload" ? "上传失败" : "同步失败");
}

export function SessionSyncDialog(props: {
  mode: "upload" | "pull";
  onClose: (result: { kind: "ok" | "err"; text: string } | null) => void;
}) {
  const { mode, onClose } = props;
  const verb = mode === "upload" ? "上传" : "同步";

  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    const api = bridge();
    if (!api.cloudSyncList) {
      setRows([]);
      setPhase("error");
      setMessage("当前版本不支持会话列表（缺少 cloudSyncList 通道）");
      return;
    }
    try {
      const r = await api.cloudSyncList();
      if (!r.ok) {
        setRows([]);
        setPhase("error");
        setMessage(humanError(undefined, r.error, mode));
        return;
      }
      const list = r.sessions || [];
      setRows(list);
      /* 默认只勾主会话 / 中枢 / 专家团主理人 / 专家团调度；调度与成员子会话留空让用户自己选。 */
      setPicked(new Set(list.filter((row) => DEFAULT_PICK_KINDS.has(String(row.kind || "main"))).map((row) => row.id)));
      setPhase("idle");
    } catch (e) {
      setRows([]);
      setPhase("error");
      setMessage((e as Error).message ? `读取会话列表失败：${(e as Error).message.slice(0, 120)}` : "读取会话列表失败");
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  // Esc 关闭（提交中不允许，避免半途中断）
  /* ⛔ 10-31：Esc 走全局 ESC 栈（只关最上层）；提交中不关闭（消费掉，别让外层跟着关）。 */
  useEscapeLayer(true, () => {
    if (phase === "submitting") return;
    onClose(phase === "success" ? { kind: "ok", text: message } : null);
  });

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => `${row.title} ${row.project}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const groups = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const row of visibleRows) {
      const kind = String(row.kind || "main");
      const list = map.get(kind) || [];
      list.push(row);
      map.set(kind, list);
    }
    /* 未来新增的来源类型也不许从弹窗里消失（未知类型排在已知类型之后）。 */
    const order = [...KIND_ORDER, ...[...map.keys()].filter((kind) => !KIND_ORDER.includes(kind))];
    return order.filter((kind) => map.has(kind)).map((kind) => ({ kind, label: KIND_LABELS[kind] || kind, items: map.get(kind) as SessionRow[] }));
  }, [visibleRows]);
  const allPicked = visibleRows.length > 0 && visibleRows.every((row) => picked.has(row.id));
  const toggleAll = () => {
    const next = new Set(picked);
    if (allPicked) for (const row of visibleRows) next.delete(row.id);
    else for (const row of visibleRows) next.add(row.id);
    setPicked(next);
  };
  const toggleGroup = (items: SessionRow[]) => {
    const next = new Set(picked);
    const all = items.every((row) => next.has(row.id));
    for (const row of items) { if (all) next.delete(row.id); else next.add(row.id); }
    setPicked(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const submit = async () => {
    if (phase === "submitting") return;
    if (!picked.size) { setPhase("idle"); setMessage("请先勾选至少一个会话"); return; }
    const api = bridge();
    setPhase("submitting");
    setMessage(mode === "upload" ? "上传中…" : "同步中…");
    try {
      const r = mode === "upload"
        ? await (api.cloudSyncPush?.({ ids: [...picked] }) ?? Promise.resolve({ ok: false, error: "缺少 cloudSyncPush" }))
        : await (api.cloudSyncPull?.({ keys: [...picked] }) ?? Promise.resolve({ ok: false, error: "缺少 cloudSyncPull" }));
      if (r.ok) {
        const detail = mode === "upload"
          ? `已上传 ${(r as { pushedSessions?: number }).pushedSessions ?? picked.size} 个会话`
          : `已同步 ${(r as { pulled?: number }).pulled ?? picked.size} 个会话`;
        setPhase("success");
        setMessage(`${verb}成功：${detail}`);
      } else {
        setPhase("error");
        setMessage(humanError((r as { code?: string }).code, (r as { error?: string }).error, mode));
      }
    } catch (e) {
      setPhase("error");
      setMessage(`${verb}失败：${(e as Error).message ? (e as Error).message.slice(0, 120) : "未知异常"}`);
    }
  };

  const canSubmit = phase === "idle" && picked.size > 0;
  const tone = phase === "error" ? "#f5cdc7" : phase === "success" ? "#cfe9d8" : "#e6e6e1";

  return createPortal(
    /* ⛔ 用 Portal 挂到 document.body —— 设置面板祖先若有 transform/filter/contain，
       position:fixed 会降级成相对该祖先定位并被 overflow 裁切，看起来就是内嵌弹窗
       （用户实测截图：弹窗被设置面板下沿截断）。
       ⛔ 层级 1100：高于确认框(950)，否则弹窗内按钮点不到。 */
    <div role="dialog" aria-modal="true" aria-label={`${verb}会话`}
      style={{
        position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,.42)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== "submitting") onClose(null); }}>
      <div style={{
        width: "min(720px, 100%)", maxHeight: "80vh", display: "flex", flexDirection: "column",
        background: "var(--panel, #fff)", color: "var(--text, #22221f)",
        border: "1px solid var(--line, #e6e6e1)", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 18px 48px rgba(0,0,0,.28)",
      }}>
        {/* 头 */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line, #e6e6e1)", display: "flex", alignItems: "baseline", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{verb}会话到云端</strong>
          <span style={{ fontSize: 12, color: "var(--muted, #6a6a64)" }}>
            {phase === "loading" ? "正在读取本地会话…" : `共 ${rows.length} 个会话，已选 ${picked.size} 个`}
          </span>
          <button type="button" onClick={() => onClose(phase === "success" ? { kind: "ok", text: message } : null)}
            disabled={phase === "submitting"}
            style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", fontSize: 16, color: "var(--muted,#6a6a64)" }}
            aria-label="关闭">×</button>
        </div>

        {mode === "upload" && (
          <div style={{ padding: "6px 18px", borderBottom: "1px solid var(--line-soft, #efefeb)", fontSize: 11.5, color: "var(--muted, #6a6a64)", lineHeight: 1.6 }}>
            默认只勾 <b>主会话 / 指挥中枢 / 专家团主理人 / 专家团调度</b>；调度与成员子会话请按需勾选。确认上传后，后台会自动保持这些会话的增量同步（新会话需再次选择；没选过不会自动上传）。
          </div>
        )}

        {/* 筛选 + 全选 */}
        {phase !== "loading" && rows.length > 0 && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--line, #e6e6e1)", display: "flex", alignItems: "center", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会话 / 项目"
              style={{
                flex: "0 1 240px", minWidth: 160, height: 28, padding: "0 9px", fontSize: 12,
                border: "1px solid var(--line, #e6e6e1)", borderRadius: 7,
                background: "var(--field, #fafaf8)", color: "var(--text, #22221f)",
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={phase === "submitting"} />
              全选当前筛选
            </label>
            <span style={{ color: "var(--muted, #6a6a64)" }}>已选 {picked.size} 个</span>
          </div>
        )}

        {/* 列表：按来源分组 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {phase === "loading" && <p style={{ padding: 16, fontSize: 13, color: "var(--muted,#6a6a64)" }}>读取中…</p>}
          {phase !== "loading" && rows.length === 0 && (
            <p style={{ padding: 16, fontSize: 13, color: "var(--muted,#6a6a64)" }}>本地没有可{verb}的会话。</p>
          )}
          {phase !== "loading" && rows.length > 0 && visibleRows.length === 0 && (
            <p style={{ padding: 16, fontSize: 13, color: "var(--muted,#6a6a64)" }}>没有匹配「{query}」的会话。</p>
          )}
          {groups.map((group) => {
            const groupAll = group.items.every((row) => picked.has(row.id));
            return (
              <div key={group.kind} style={{ padding: "2px 0" }}>
                <label style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  fontSize: 11.5, fontWeight: 600, color: "var(--muted, #6a6a64)", cursor: "pointer",
                }}>
                  <input type="checkbox" checked={groupAll} onChange={() => toggleGroup(group.items)} disabled={phase === "submitting"} />
                  {group.label}（{group.items.length}）
                </label>
                {group.items.map((r) => (
                  <label key={r.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 10px 7px 22px", borderRadius: 8,
                    cursor: phase === "submitting" ? "default" : "pointer",
                    background: picked.has(r.id) ? "var(--field, #fafaf8)" : "transparent",
                  }}>
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggleOne(r.id)}
                      disabled={phase === "submitting"} style={{ marginTop: 3 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.title}
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--muted,#6a6a64)", marginTop: 2 }}>
                        {r.project ? `${r.project} · ` : ""}{r.lines} 行
                        {typeof r.syncedLines === "number" ? (r.syncedLines > 0 ? ` · 已传 ${r.syncedLines} 行` : " · 未上传") : ""}
                        {typeof r.newLines === "number" && r.newLines > 0 ? ` · 新增 ${r.newLines} 行` : ""}
                        {` · ${fmtBytes(r.sizeBytes)} · ${fmtTime(r.updatedAt)}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        {/* 状态 + 操作 */}
        <div style={{ borderTop: "1px solid var(--line, #e6e6e1)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{
            flex: 1, minWidth: 200, fontSize: 12.5,
            color: phase === "error" ? "var(--bad,#c0392b)" : phase === "success" ? "var(--ok,#1a7f37)" : "var(--muted,#6a6a64)",
            padding: message ? "4px 8px" : 0, borderRadius: 6,
            background: message ? tone : "transparent", border: message ? `1px solid ${tone}` : "none",
          }}>{message || "\u00A0"}</span>

          {phase === "error" && (
            <button type="button" onClick={() => void load()}
              style={{ fontSize: 12.5, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--line,#e6e6e1)", background: "transparent", cursor: "pointer" }}>
              重新读取
            </button>
          )}
          <button type="button" onClick={() => onClose(phase === "success" ? { kind: "ok", text: message } : null)}
            disabled={phase === "submitting"}
            style={{ fontSize: 12.5, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--line,#e6e6e1)", background: "transparent", cursor: "pointer" }}>
            {phase === "success" ? "完成" : "取消"}
          </button>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit}
            style={{
              fontSize: 12.5, padding: "5px 14px", borderRadius: 7, border: 0, cursor: canSubmit ? "pointer" : "default",
              background: canSubmit ? "var(--brand,#7c3aed)" : "var(--line,#e6e6e1)",
              color: canSubmit ? "#fff" : "var(--muted,#6a6a64)",
            }}>
            {phase === "submitting" ? `${verb}中…` : `确认${verb}`}
          </button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
