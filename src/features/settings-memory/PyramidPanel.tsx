/**
 * PyramidPanel —— 「金字塔记忆架构」入口的主体（10-10 用户要求**重新做界面**）。
 *
 * ⛔⛔ 两条用户原话决定了这一版的形态：
 *   ① 「界面重新做哦，别偷懒又用旧的记忆库界面」⇒ 不复用 `MemoryWorkbench`（那个回答"有哪些记忆"，
 *      这里要回答"金字塔长什么样、每个会话独立在哪"）。
 *   ② 「金字塔层级效果也是，重新做」⇒ **不能只是逐层一行的列表**，要真的长成金字塔：
 *      上窄下宽的**梯形层叠**（每层一个梯形、越往下越宽、上下紧贴），层内的填充条就是该层水位。
 *
 * ── 每层显示什么 ───────────────────────────────────────────────────
 *   层 id · 层名 · 共享/独立徽章 · 该会话在独立层的条目数 · 水位（梯形内的填充比例）
 *   点一层 → 展开该层的**规则详情**（存储范围 / 共享边界 / 隔离原则 / 引用与去向 / 注入档）。
 *
 * ── 数据来源（⛔ 页面只渲染，不自己造数）────────────────────────────
 *   · 层与水位：`memoryLayers`（主进程快照）
 *   · 层规则：`src/lib/memory-scope-rules.mjs`（唯一真相源）
 *   · 每会话独立条目数：`listFabricNamespaces(workspace)` 的 `private__<threadId>` 计数（一次 IPC）
 */
import { useEffect, useMemo, useState } from "react";
import { Layers, Users } from "lucide-react";
import { MEMORY_LAYER_RULES, MEMORY_INJECT_LABEL, MEMORY_SCOPE_LABEL } from "../../lib/memory-scope-rules.mjs";

type LayerLive = { id: string; name: string; used?: number; budget?: number; ratio?: number | null; needDistill?: boolean; where?: string };

/** 金字塔几何：顶部最窄、每往下一层加宽一点（百分比）。 */
const TOP_WIDTH = 44;
const WIDTH_STEP = 7;

export function PyramidPanel({ snapshot, workspace, onOpenThread }: {
  snapshot: any;
  workspace: string;
  onOpenThread?: (id: string) => void;
}) {
  const layers: LayerLive[] = Array.isArray(snapshot?.layers) ? snapshot.layers : [];
  const [activeSession, setActiveSession] = useState<string>("__all__");
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [nsRows, setNsRows] = useState<{ threadId: string; entries: number }[]>([]);

  /* 会话维度：只取 `private__<threadId>` 的条目数（⛔ 一次 IPC，不逐会话查） */
  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    Promise.resolve((window as any).codex?.listFabricNamespaces?.(workspace))
      .then((list: any) => {
        if (!alive || !Array.isArray(list)) return;
        setNsRows(list
          .map((row: any) => {
            const ns = String(row?.namespace ?? "");
            return { threadId: ns.startsWith("private__") ? ns.slice("private__".length) : "", entries: Number(row?.entries ?? 0) };
          })
          .filter((row: any) => row.threadId));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [workspace]);

  const short = (id: string) => (id.length > 22 ? id.slice(0, 10) + "…" + id.slice(-6) : id);
  const sessions = useMemo(() => [...nsRows].sort((a, b) => b.entries - a.entries), [nsRows]);
  const totalOwn = sessions.reduce((sum, row) => sum + row.entries, 0);
  const activeCount = activeSession === "__all__" ? totalOwn : (sessions.find((row) => row.threadId === activeSession)?.entries ?? 0);

  return (
    <div className="pyr-root">
      {/* ── 会话选择：换个会话，金字塔的"独立层"就换一份内容 ─────────────── */}
      <div className="pyr-sessions">
        <span className="pyr-sessions-label"><Users size={12} />会话</span>
        <div className="memory-funnel-chips" role="tablist" aria-label="选择会话">
          <button role="tab" aria-selected={activeSession === "__all__"} data-pyr-session="__all__"
            className={`memory-funnel-chip ${activeSession === "__all__" ? "active" : ""}`}
            onClick={() => setActiveSession("__all__")}>全部会话（{totalOwn} 条）</button>
          {sessions.map((row) => (
            <button role="tab" key={row.threadId} aria-selected={activeSession === row.threadId} data-pyr-session={row.threadId}
              className={`memory-funnel-chip ${activeSession === row.threadId ? "active" : ""}`}
              title={row.threadId} onClick={() => setActiveSession(row.threadId)}>
              {short(row.threadId)}（{row.entries} 条）
            </button>
          ))}
        </div>
      </div>

      <div className="pyr-legend">
        <span className="pyr-legend-item"><i className="pyr-dot shared" />共享层 L0–L6：所有会话读**同一份**</span>
        <span className="pyr-legend-item"><i className="pyr-dot own" />独立层 L7：只有选中的会话读得到</span>
      </div>

      {/* ── 金字塔本体：梯形层叠（上窄下宽、上下紧贴）─────────────────────── */}
      <div className="pyr-shape" data-layers={MEMORY_LAYER_RULES.length}>
        {MEMORY_LAYER_RULES.map((rule, index) => {
          const live = layers.find((l) => l.id === rule.layer);
          const shared = rule.scope !== "session";
          const pct = Math.min(100, Math.round(((live?.ratio ?? 0) as number) * 100));
          const open = openLayer === rule.layer;
          return (
            <div className="pyr-tier-wrap" key={rule.layer} data-pyr-layer={rule.layer}>
              <button type="button" aria-expanded={open}
                className={`pyr-tier ${shared ? "is-shared" : "is-own"} ${open ? "is-open" : ""}`}
                style={{ width: `${TOP_WIDTH + index * WIDTH_STEP}%` }}
                onClick={() => setOpenLayer(open ? null : rule.layer)}>
                <span className="pyr-tier-fill" style={{ backgroundSize: `${pct}% 100%` }} />
                <span className="pyr-tier-body">
                  <b className="pyr-tier-id">{rule.layer}</b>
                  <span className="pyr-tier-name">{rule.name}</span>
                  <span className="pyr-tier-badge">{shared ? "共享" : `${activeCount} 条`}</span>
                  {live?.needDistill ? <em className="pyr-tier-need">需蒸馏</em> : null}
                  <span className="pyr-tier-pct">{live ? `${pct}%` : "—"}</span>
                </span>
              </button>
              {open && (
                <dl className="pyr-detail">
                  <dt>存储范围</dt><dd>{rule.store}</dd>
                  <dt>共享给谁</dt><dd>{rule.sharedWith}</dd>
                  <dt>谁读不到</dt><dd>{rule.isolatedFrom}</dd>
                  <dt>从哪来</dt><dd>{rule.inheritsFrom}</dd>
                  <dt>往哪去</dt><dd>{rule.syncsTo}</dd>
                  <dt>作用域 / 注入</dt><dd>{MEMORY_SCOPE_LABEL[rule.scope]} · {MEMORY_INJECT_LABEL[rule.inject]}{live ? ` · ${(live.used ?? 0).toLocaleString()} / ${(live.budget ?? 0).toLocaleString()} 字` : ""}</dd>
                </dl>
              )}
            </div>
          );
        })}
      </div>

      <p className="pyr-note">
        {activeSession === "__all__"
          ? <>当前看**全部会话**：独立层合计 <b>{totalOwn}</b> 条，分散在 {sessions.length} 个会话里。上面选一个会话，独立层就换那一份。</>
          : <>当前看会话 <code>{short(activeSession)}</code>：共享层（L0–L6）与别的会话**完全一样**（这就是"共享"的含义）；独立层只有它自己的 <b>{activeCount}</b> 条。</>}
        <span className="pyr-note-hint">点任意一层可展开它的规则（存储范围 / 共享边界 / 引用与去向）。</span>
      </p>
      {activeSession !== "__all__" && onOpenThread && (
        <div className="memory-overview-actions">
          <button className="secondary-setting" onClick={() => onOpenThread(activeSession)}>
            <Layers size={13} />打开这个会话
          </button>
        </div>
      )}
    </div>
  );
}
