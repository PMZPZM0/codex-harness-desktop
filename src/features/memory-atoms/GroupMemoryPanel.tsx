/**
 * 工作伙伴记忆（11-11 用户令：「加一个工作伙伴记忆模块入口显示」）。
 *
 * 数据来源与 `MemoryAtomsPanel` 同一条通道（`memory:atoms:list`）—— ⛔ 不另开通道，
 * 也不在前端拼路径：条目归属由主进程按目录 + frontmatter 得出（`entries/session/<群id>/`）。
 *
 * 这一屏只回答一个问题：**每个群各自记得什么**。
 * ⛔ 工作区级（project / rule）在这里不列：它们本来就跨群共享，混进来会让人以为"这个群也记了这个"。
 * ⛔ 11-11：与另外三个记忆板块共用 `MemoryListTools`（搜索 / 筛选 / 批量管理）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import {
  ATOM_STATUS_OPTIONS, ATOM_TYPE_OPTIONS, filterRows, toggleSelection,
} from "../../lib/memory-list-filter.mjs";
import { MemoryListTools, type MemoryListAction } from "../memory-list-tools";

type AtomEntry = {
  id: string; summary: string; type: string; scope: string;
  status: string; confidence: string; updated: string; tags: string[]; group?: string; body: string;
};

/** 群归属 → 显示名（拿不到群名就退回 id，⛔ 不显示空标题）。 */
type GroupNameMap = Record<string, string>;

/** 三类群策略摘要：由主进程 policyOf 生成，⛔ 前端不写第二份口径。 */
type PolicyRow = {
  label: string; writable: string[]; supersede: string;
  render: string; recallLimit: number; inject: string[];
};

/** ⛔ 同一条 id 可能在不同群各有一份 ⇒ 勾选键必须带群，批量作废时再映射回真实 id。 */
const rowKeyOf = (e: AtomEntry) => `${e.group ?? ""}:${e.id}`;

/** 工作伙伴记忆：按群折叠的会话记忆（只列 session 域，工作区级不在这里重复）。 */
export function GroupMemoryPanel({ workspace }: { workspace?: string }) {
  const [entries, setEntries] = useState<AtomEntry[]>([]);
  const [names, setNames] = useState<GroupNameMap>({});
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /* 11-11 搜索 / 筛选 / 勾选批量管理。 */
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!workspace) { setEntries([]); return; }
    setLoading(true);
    setError("");
    try {
      const res = await window.codex.listMemoryAtoms(workspace);
      if (!res?.ok) { setError(res?.error ?? "读取失败"); return; }
      setEntries(Array.isArray(res.entries) ? res.entries : []);
      setPolicies(Array.isArray(res.policies) ? res.policies : []);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  /* 群名映射：只为了"看得出这是哪个群"。⛔ 失败就不显示群名，⛔ 不影响条目展示。 */
  useEffect(() => {
    let alive = true;
    void window.codex?.harnessTeamList?.()
      .then((r) => {
        if (!alive || !r?.groups) return;
        const map: GroupNameMap = {};
        for (const g of r.groups as Array<{ id?: string; name?: string }>) {
          const id = String(g?.id ?? "").trim();
          if (id) map[id] = String(g?.name ?? "").trim() || id;
        }
        setNames(map);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* 只留 session 域：其余域跨群共享，列在这里会误导。 */
  const sessionEntries = useMemo(() => entries.filter((e) => e.scope === "session"), [entries]);

  const groupOptions = useMemo(() => [
    { value: "all", label: "全部群" },
    ...[...new Set(sessionEntries.map((e) => String(e.group ?? "").trim()).filter(Boolean))]
      .map((id) => ({ value: id, label: names[id] ?? id })),
  ], [sessionEntries, names]);

  const visibleRows = useMemo(() => filterRows(sessionEntries, {
    query,
    textOf: (e) => `${e.id} ${e.summary} ${(e.tags ?? []).join(" ")} ${String(e.group ?? "")} ${names[String(e.group ?? "")] ?? ""} ${e.body}`,
    predicates: [
      (e) => groupFilter === "all" || String(e.group ?? "").trim() === groupFilter,
      (e) => typeFilter === "all" || e.type === typeFilter,
      (e) => statusFilter === "all" || (statusFilter === "active" ? e.status === "active" : e.status !== "active"),
    ],
  }), [sessionEntries, names, query, groupFilter, typeFilter, statusFilter]);

  /* ⛔ 切筛选就清选择，不许跨筛选误选看不见的行。 */
  const changeFilter = (set: (v: string) => void) => (v: string) => { set(v); setChecked([]); };

  const groups = useMemo(() => {
    const buckets = new Map<string, AtomEntry[]>();
    for (const e of visibleRows) {
      const key = String(e.group ?? "").trim();
      const rows = buckets.get(key) ?? [];
      rows.push(e);
      buckets.set(key, rows);
    }
    return [...buckets.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([id, rows]) => ({ id, name: names[id] ?? (id || "未归属（老数据）"), rows: rows.sort((a, b) => String(b.updated).localeCompare(String(a.updated))) }));
  }, [visibleRows, names]);

  /* 批量作废：勾选键 `群:id` 映射回真实 id（⛔ 显式 id，不物理删文件）。 */
  const batchActions: MemoryListAction[] = [{
    key: "forget", label: "批量作废", danger: true,
    confirmText: (n) => `将把选中的 ${n} 条群记忆标记为「已作废」（文件保留可查，不再注入）。`,
    run: async (keys) => {
      if (!workspace) return;
      const targets = sessionEntries.filter((e) => keys.includes(rowKeyOf(e)))
        .map((e) => ({ id: e.id, group: String(e.group ?? "").trim() }));
      try {
        const res = await window.codex.forgetMemoryAtoms(workspace, targets);
        setNotice(res?.ok
          ? `已作废 ${res.done} 条${res.failed ? `，失败 ${res.failed} 条` : ""}（文件保留，可查）`
          : String(res?.error ?? "作废失败"));
      } catch (e) {
        setNotice(`作废失败：${String((e as Error)?.message ?? e)}`);
      }
      await load();
    },
  }];

  if (!workspace) {
    return <p className="memory-atoms--empty">先打开一个项目 —— 工作伙伴的记忆跟着项目走。</p>;
  }

  return (
    <div className="memory-atoms">
      <div className="memory-atoms__head">
        <span className="memory-atoms__title"><Users size={14} /> 按群分开的记忆</span>
        <button type="button" className="memory-atoms__ghost" onClick={() => void load()} disabled={loading} title="重新读取">
          <RefreshCw size={13} /> {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      <p className="memory-atoms__hint">
        每个群只看到自己的会话记忆；项目规则与代码事实是工作区级，所有群共享（所以不列在这里）。
        ⛔ 别的群的客户口径不会漏进来 —— 这是隔离，不是汇总。
      </p>

      {error ? <p className="memory-atoms__error"><AlertTriangle size={13} /> {error}</p> : null}
      {notice ? <div className="memory-atoms__notice">{notice}</div> : null}

      <MemoryListTools
        query={query} onQueryChange={setQuery} placeholder="搜条目 / 群名 / 正文"
        filters={[
          { key: "group", label: "按群筛选", value: groupFilter, options: groupOptions, onChange: changeFilter(setGroupFilter) },
          { key: "type", label: "按类型筛选", value: typeFilter, options: ATOM_TYPE_OPTIONS, onChange: changeFilter(setTypeFilter) },
          { key: "status", label: "按状态筛选", value: statusFilter, options: ATOM_STATUS_OPTIONS, onChange: changeFilter(setStatusFilter) },
        ]}
        visibleIds={visibleRows.map(rowKeyOf)} selected={checked} onSelectionChange={setChecked}
        actions={batchActions} summary={`共 ${sessionEntries.length} 条`}
      />

      {/* ⛔ 11-11 补方案第 12 项「群策略说明」：数值由主进程 policyOf 返回，
          界面只渲染，不另写一份口径（改了策略层这里自动跟着变）。 */}
      {policies.length ? (
        <details className="memory-policy">
          <summary>群策略说明（谁能写 · 谁说了算 · 注入多少）</summary>
          <div className="memory-policy__scroll">
            <div className="memory-policy__table">
              <div className="memory-policy__row is-head">
                <span>群 / 座位</span><span>可写域</span><span>取代权</span><span>渲染</span><span>召回</span><span>注入预算</span>
              </div>
              {policies.map((p) => (
                <div className="memory-policy__row" key={p.label}>
                  <span>{p.label}</span>
                  <span>{p.writable.length ? p.writable.join(" / ") : "写不了（宿主代写）"}</span>
                  <span>{p.supersede === "any" ? "可取代任何人" : p.supersede === "own" ? "只能取代自己" : "不允许"}</span>
                  <span>{p.render === "plain" ? "纯文本" : "markdown"}</span>
                  <span>{p.recallLimit} 条</span>
                  <span>{p.inject.join(" + ")}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      {groups.length ? (
        groups.map((g) => (
          <details className="memory-group" key={g.id || "__orphan"} open={groups.length <= 3}>
            <summary>
              <strong>{g.name}</strong>
              <span className="memory-atoms__stats">{g.rows.length} 条{g.id && g.name !== g.id ? ` · ${g.id}` : ""}</span>
            </summary>
            <ul>
              {g.rows.map((e) => (
                <li key={rowKeyOf(e)}>
                  <input type="checkbox" className="mlt-check" aria-label={`选择 ${e.summary}`}
                    checked={checked.includes(rowKeyOf(e))}
                    onChange={(ev) => setChecked(toggleSelection(checked, [rowKeyOf(e)], ev.target.checked))} />
                  <span className="memory-atoms__row-summary">{e.summary}</span>
                  <span className="memory-atoms__row-meta">
                    <em className={e.status === "active" ? "" : "is-retired"}>{e.status === "active" ? "生效中" : e.status}</em>
                    <span>{e.type}</span>
                    <span>{String(e.updated).slice(0, 10)}</span>
                    {e.confidence === "tentative" ? <span>待验证</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))
      ) : (
        <p className="memory-atoms--empty">
          {sessionEntries.length ? "没有符合条件的群记忆（换个搜索词或筛选条件）。" : "还没有群记忆。在群里派活时，伙伴自己记下的内容会按群归档到这里。"}
        </p>
      )}
    </div>
  );
}
