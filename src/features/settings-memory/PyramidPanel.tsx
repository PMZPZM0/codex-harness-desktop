/**
 * PyramidPanel —— 「金字塔记忆架构」入口的主体（10-10 用户要求**重新做界面**）。
 *
 * ⛔⛔ 三条用户原话决定了这一版的形态：
 *   ① 「界面重新做哦，别偷懒又用旧的记忆库界面」⇒ 不复用 `MemoryWorkbench`（那个回答"有哪些记忆"，
 *      这里要回答"金字塔长什么样、每个会话独立在哪"）。
 *   ② 「金字塔层级效果也是，重新做」⇒ **不能只是逐层一行的列表**，要真的长成金字塔：
 *      上窄下宽的**梯形层叠**（每层一个梯形、越往下越宽、上下紧贴），层内的填充条就是该层水位。
 *   ③ 「新版金字塔没有项目切换功能，现在已有的会话他也没有识别出来」（10-10 二轮反馈）⇒
 *      **顶部给项目切换**（切了就重读该项目的层快照），**会话列表来自真实会话**，
 *      ⛔ 不再只看 `private__<threadId>` 命名空间 —— 那样只有"写过记忆的会话"才出现，
 *      用户会觉得"我的会话它一个都没认出来"（没写过私有记忆的会话本来就该显示 0 条）。
 *
 * ── 每层显示什么 ───────────────────────────────────────────────────
 *   层 id · 层名 · 共享/独立徽章 · 该会话在独立层的条目数 · 水位（梯形内的填充比例）
 *   点一层 → 展开该层的**规则详情**（存储范围 / 共享边界 / 隔离原则 / 引用与去向 / 注入档）。
 *
 * ── 数据来源（⛔ 页面只渲染，不自己造数）────────────────────────────
 *   · 层水位：`readMemoryLayers(项目)`（主进程快照，随项目切换重读）
 *   · 层规则：`src/lib/memory-scope-rules.mjs`（唯一真相源）
 *   · 会话清单：`threads`（真实会话，按 cwd 归属项目）
 *   · 每会话独立条目数：`listFabricNamespaces(项目)` 的 `private__<threadId>` 计数（一次 IPC）
 */
import { useEffect, useMemo, useState } from "react";
import { Layers, Users, FolderOpen } from "lucide-react";
import { MEMORY_LAYER_RULES, MEMORY_INJECT_LABEL, MEMORY_SCOPE_LABEL } from "../../lib/memory-scope-rules.mjs";

type LayerLive = { id: string; name: string; used?: number; budget?: number; ratio?: number | null; needDistill?: boolean; where?: string };
type ThreadRow = { id?: string; name?: string; cwd?: string; updatedAt?: number; preview?: string; turns?: unknown[] };

/** 金字塔几何：顶部最窄、每往下一层加宽一点（百分比）。 */
const TOP_WIDTH = 44;
const WIDTH_STEP = 7;

export function PyramidPanel({ workspace, threads, onOpenThread }: {
  workspace: string;
  /** 真实会话清单（页面上已有的数据，⛔ 不新增 IPC） */
  threads?: ThreadRow[];
  onOpenThread?: (id: string) => void;
}) {
  const projects = useMemo(
    () => Array.from(new Set((threads ?? []).map((t) => String(t?.cwd ?? "")).filter(Boolean))),
    [threads],
  );
  /* 项目：默认跟随页面工作区（没有就取第一个项目）。⛔ 切换只影响"读哪个项目的快照/命名空间"。 */
  const [project, setProject] = useState<string>(workspace || "");
  useEffect(() => { if (!project && (workspace || projects[0])) setProject(workspace || projects[0]); }, [workspace, projects, project]);
  useEffect(() => { if (workspace && workspace !== project && !projects.includes(project)) setProject(workspace); }, [workspace, projects, project]);

  const [snapshot, setSnapshot] = useState<any>(null);
  const [nsRows, setNsRows] = useState<{ threadId: string; entries: number }[]>([]);
  const [activeSession, setActiveSession] = useState<string>("__all__");
  const [openLayer, setOpenLayer] = useState<string | null>(null);

  const layers: LayerLive[] = Array.isArray(snapshot?.layers) ? snapshot.layers : [];

  /* 层水位：按**当前项目**读（切项目重读 —— 共享层是项目级的，不重新读就会显示上一个项目的数字） */
  useEffect(() => {
    if (!project) return;
    let alive = true;
    Promise.resolve((window as any).codex?.readMemoryLayers?.(project))
      .then((snap: any) => { if (alive) setSnapshot(snap ?? null); })
      .catch(() => { if (alive) setSnapshot(null); });
    return () => { alive = false; };
  }, [project]);

  /* 会话维度：只取 `private__<threadId>` 的条目数（⛔ 一次 IPC，不逐会话查）。
     它**只用来算条目数**，不再是"有哪些会话"的来源（会话清单走 threads）。 */
  useEffect(() => {
    if (!project) return;
    let alive = true;
    setActiveSession("__all__");
    Promise.resolve((window as any).codex?.listFabricNamespaces?.(project))
      .then((list: any) => {
        if (!alive || !Array.isArray(list)) return;
        setNsRows(list
          .map((row: any) => {
            const ns = String(row?.namespace ?? "");
            return { threadId: ns.startsWith("private__") ? ns.slice("private__".length) : "", entries: Number(row?.entries ?? 0) };
          })
          .filter((row: any) => row.threadId));
      })
      .catch(() => { if (alive) setNsRows([]); });
    return () => { alive = false; };
  }, [project]);

  const short = (id: string) => (id.length > 22 ? id.slice(0, 10) + "…" + id.slice(-6) : id);
  const projectName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

  /* ── 会话清单 = **真实会话**（本项目）× 各自的独立条目数 ──────────────────
     ⛔ 以 threads 为准、条目数左联命名空间：这样"没写过记忆的会话"也会出现（0 条）——
       用户要的正是"认出我已有的会话"，而不是"只列出写过记忆的那些"。 */
  const sessions = useMemo(() => {
    const countOf = new Map(nsRows.map((row) => [row.threadId, row.entries]));
    const rows = (threads ?? [])
      .filter((t) => t?.id && String(t.cwd ?? "") === project)
      .map((t) => ({
        threadId: String(t.id),
        name: (t.name ?? "").trim() || short(String(t.id)),
        entries: countOf.get(String(t.id)) ?? 0,
        updatedAt: Number(t.updatedAt ?? 0),
        turns: Array.isArray(t.turns) ? t.turns.length : 0,
      }));
    /* 有私有命名空间但不在会话清单里的（会话已被删/换了项目）也如实列出，不静默丢 */
    const known = new Set(rows.map((r) => r.threadId));
    for (const row of nsRows) if (!known.has(row.threadId)) rows.push({ threadId: row.threadId, name: short(row.threadId), entries: row.entries, updatedAt: 0, turns: 0 });
    /* 排序：先按"有没有独立记忆"，再按条目数、最近更新 —— 有内容的会话排前面，但空格子不隐藏。 */
    return rows.sort((a, b) => (b.entries > 0 ? 1 : 0) - (a.entries > 0 ? 1 : 0) || b.entries - a.entries || b.updatedAt - a.updatedAt);
  }, [threads, nsRows, project]);

  const totalOwn = nsRows.reduce((sum, row) => sum + row.entries, 0);
  const activeCount = activeSession === "__all__" ? totalOwn : (sessions.find((row) => row.threadId === activeSession)?.entries ?? 0);
  const withMemory = sessions.filter((row) => row.entries > 0).length;

  return (
    <div className="pyr-root">
      {/* ── 项目切换（10-10 二轮反馈：金字塔原来没有项目维度）──────────────────── */}
      <div className="pyr-projects">
        <span className="pyr-sessions-label"><FolderOpen size={12} />项目</span>
        {projects.length === 0 ? (
          <p className="lib-empty">还没有发现项目 —— 先打开一个工作区。</p>
        ) : (
          <div className="memory-funnel-chips" role="tablist" aria-label="选择项目">
            {projects.map((p) => (
              <button role="tab" key={p} aria-selected={project === p} data-pyr-project={p} title={p}
                className={`memory-funnel-chip ${project === p ? "active" : ""}`}
                onClick={() => setProject(p)}>{projectName(p)}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── 会话选择：换个会话，金字塔的"独立层"就换一份内容 ─────────────── */}
      <div className="pyr-sessions">
        <span className="pyr-sessions-label"><Users size={12} />会话</span>
        {sessions.length === 0 ? (
          <p className="lib-empty">{project ? "这个项目下还没有会话记录。" : "先选一个项目。"}</p>
        ) : (
          <div className="memory-funnel-chips" role="tablist" aria-label="选择会话">
            <button role="tab" aria-selected={activeSession === "__all__"} data-pyr-session="__all__"
              className={`memory-funnel-chip ${activeSession === "__all__" ? "active" : ""}`}
              onClick={() => setActiveSession("__all__")}>全部会话（{totalOwn} 条）</button>
            {sessions.map((row) => (
              <button role="tab" key={row.threadId} aria-selected={activeSession === row.threadId} data-pyr-session={row.threadId}
                className={`memory-funnel-chip ${activeSession === row.threadId ? "active" : ""} ${row.entries ? "" : "is-empty"}`}
                title={`${row.threadId}\n${row.turns} 轮对话${row.entries ? "" : " · 还没有独立记忆"}`}
                onClick={() => setActiveSession(row.threadId)}>
                {row.name.length > 18 ? row.name.slice(0, 17) + "…" : row.name}（{row.entries} 条）
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pyr-legend">
        <span className="pyr-legend-item"><i className="pyr-dot shared" />共享层 L0–L6：本项目所有会话读**同一份**</span>
        <span className="pyr-legend-item"><i className="pyr-dot own" />独立层 L7：只有选中的会话读得到</span>
        {sessions.length > 0 && <span className="pyr-legend-item">本项目 {sessions.length} 个会话，其中 {withMemory} 个写过独立记忆</span>}
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
          ? <>当前看 <b>{project ? projectName(project) : "未选项目"}</b> 的**全部会话**：独立层合计 <b>{totalOwn}</b> 条，分散在 {withMemory} 个写过记忆的会话里（共 {sessions.length} 个会话）。上面选一个会话，独立层就换那一份。</>
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
