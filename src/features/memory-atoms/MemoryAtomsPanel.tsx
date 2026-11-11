/**
 * 记忆原子面板（11-10 用户令：废弃金字塔，定制一套本地记忆界面）
 *
 * 与豆包那套的差别就在这一屏：
 *   · 左边是**索引**（一行一条，按类型分组），不是「一棵层级树」；
 *   · 右边是**单条正文**，可直接改（改完写回 .md，frontmatter 由主进程维护）；
 *   · 底部是**注入预览**：输入一句话，显示"引擎本轮会看到什么" —— 与真实注入同一套打分。
 *     ⛔ 这一块是金字塔从未有过的：以前用户只能猜"记忆到底喂进去没有"。
 *
 * ⛔ 所有读写都走 IPC（memory:atoms:*）：本组件不拼路径、不解析 frontmatter。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, RefreshCw, Save } from "lucide-react";
import {
  ATOM_SCOPE_OPTIONS, ATOM_STATUS_OPTIONS, ATOM_TYPE_OPTIONS, filterRows, toggleSelection,
} from "../../lib/memory-list-filter.mjs";
import { MemoryListTools, type MemoryListAction } from "../memory-list-tools";

type AtomEntry = {
  id: string; summary: string; type: string; scope: string;
  status: string; confidence: string; updated: string; tags: string[]; group?: string; body: string;
};

/** 变更历史一行（主进程从 .changelog.jsonl 尾部取，与列表同一次请求返回）。 */
type HistoryRow = { at: string; op: string; id: string; by: string; summary: string };

type ListResult = {
  ok: boolean;
  stats?: { total: number; active: number; broken: number };
  entries?: AtomEntry[];
  history?: HistoryRow[];
  broken?: string[];
  error?: string;
};

const TYPE_LABEL: Record<string, string> = {
  rule: "规则", decision: "决定", fact: "事实", runbook: "流程", preference: "偏好",
};
const TYPE_ORDER = ["rule", "decision", "runbook", "fact", "preference"];

const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;
/** ⛔ 同一 id 可在多个群各存一份 ⇒ 勾选/作废键必须带群。 */
const rowKeyOf = (e: AtomEntry) => `${e.group ?? ""}:${e.id}`;

/**
 * 本地记忆面板：左边索引、右边正文、底部注入预览。
 *
 * ⛔ 金字塔（MemoryPyramid）已下线：用户明确要求「改掉，不使用」。
 * ⛔ 数据只从 memory:atoms:* 三个通道来 —— 组件不拼路径、不解析 frontmatter。
 */
export function MemoryAtomsPanel({ workspace }: { workspace?: string }) {
  const [entries, setEntries] = useState<AtomEntry[]>([]);
  const [stats, setStats] = useState<{ total: number; active: number; broken: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  /* 11-11 四个记忆板块统一：筛选 + 勾选批量管理（搜索复用上面的 filter）。 */
  const [typeFilter, setTypeFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [broken, setBroken] = useState<string[]>([]);
  /* 新建条目：不改用弹窗 —— 就在右侧详情区就地填，填完保存。 */
  const [creating, setCreating] = useState(false);
  const [nid, setNid] = useState("");
  const [nsummary, setNsummary] = useState("");
  const [nbody, setNbody] = useState("");

  const reload = useCallback(async () => {
    if (!workspace) { setEntries([]); setStats(null); return; }
    setLoading(true);
    setError("");
    try {
      const res = (await window.codex.listMemoryAtoms(workspace)) as ListResult;
      if (!res?.ok) { setError(res?.error ?? "读取失败"); return; }
      setEntries(Array.isArray(res.entries) ? res.entries : []);
      setStats(res.stats ?? null);
      setHistory(Array.isArray(res.history) ? res.history : []);
      setBroken(Array.isArray(res.broken) ? res.broken : []);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void reload(); }, [reload]);

  const current = useMemo(() => entries.find((e) => e.id === selected) ?? null, [entries, selected]);

  useEffect(() => {
    /* 切换条目时重置草稿（⛔ 不能把 A 的编辑带到 B 上）。 */
    setDraft(current?.body ?? "");
    setDirty(false);
  }, [current?.id]);

  /* ⓵ 搜索 + 三档筛选交给纯函数（守卫 12bl 真跑）；⓶ 再按类型分组显示。 */
  const visibleEntries = useMemo(() => filterRows(entries, {
    query: filter,
    textOf: (e) => `${e.id} ${e.summary} ${(e.tags ?? []).join(" ")} ${e.body}`,
    predicates: [
      (e) => typeFilter === "all" || e.type === typeFilter,
      (e) => scopeFilter === "all" || e.scope === scopeFilter,
      (e) => statusFilter === "all" || (statusFilter === "active" ? e.status === "active" : e.status !== "active"),
    ],
  }), [entries, filter, typeFilter, scopeFilter, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, AtomEntry[]>();
    for (const e of visibleEntries) {
      const list = map.get(e.type) ?? [];
      list.push(e);
      map.set(e.type, list);
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({
      type: t,
      rows: (map.get(t) ?? []).sort((a, b) => b.updated.localeCompare(a.updated)),
    }));
  }, [visibleEntries]);

  const save = async () => {
    if (!current || !workspace) return;
    setSaving(true);
    try {
      const res = await window.codex.saveMemoryAtoms(workspace, { id: current.id, body: draft, summary: current.summary });
      if (!res?.ok) { setError(res?.error ?? "保存失败"); return; }
      setDirty(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  /** 新建一条：id / 摘要 / 正文三项齐了才写（⛔ 少一项就是一条读不出来的坏记忆）。 */
  const createAtom = async () => {
    if (!workspace) return;
    if (!nid.trim() || !nsummary.trim() || !nbody.trim()) { setError("id、摘要、正文都要填"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await window.codex.saveMemoryAtoms(workspace, { id: nid.trim(), summary: nsummary.trim(), body: nbody });
      if (!res?.ok) { setError(res?.error ?? "保存失败"); return; }
      const created = nid.trim();
      setCreating(false); setNid(""); setNsummary(""); setNbody("");
      await reload();
      setSelected(created);
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    if (!workspace) return;
    setPreviewing(true);
    try {
      const res = await window.codex.recallMemoryAtoms(workspace, query);
      setPreview(res?.ok ? String(res.text ?? "") : String(res?.error ?? "预览失败"));
    } finally {
      setPreviewing(false);
    }
  };

  /* 批量动作：⛔ 走 memory:atoms:forget（复用引擎侧 memory_forget，标作废、文件保留可查），
     ⛔ 不是物理删除；页内二次确认由通用工具条统一提供。 */
  const batchActions: MemoryListAction[] = [{
    key: "forget", label: "批量作废", danger: true,
    confirmText: (n) => `将把选中的 ${n} 条标记为「已作废」（文件保留可查，不再注入）。`,
    run: async (ids) => {
      if (!workspace) return;
      try {
        const targets = visibleEntries.filter((e) => ids.includes(rowKeyOf(e)))
          .map((e) => ({ id: e.id, group: String(e.group ?? "").trim() }));
        const res = await window.codex.forgetMemoryAtoms(workspace, targets);
        setNotice(res?.ok
          ? `已作废 ${res.done} 条${res.failed ? `，失败 ${res.failed} 条` : ""}（文件保留，可查）`
          : String(res?.error ?? "作废失败"));
      } catch (e) {
        setNotice(`作废失败：${String((e as Error)?.message ?? e)}`);
      }
      await reload();
    },
  }];

  if (!workspace) {
    return <div className="memory-atoms memory-atoms--empty">先打开一个项目 —— 记忆跟着工作区走。</div>;
  }

  return (
    <section className="memory-atoms">
      <header className="memory-atoms__head">
        <div className="memory-atoms__title">
          <BookOpen size={15} />
          <b>本地记忆</b>
          <span className="memory-atoms__stats">
            {stats ? `共 ${stats.total} 条 · 在用 ${stats.active}${stats.broken ? ` · ⚠ 坏文件 ${stats.broken}` : ""}` : loading ? "读取中…" : ""}
          </span>
        </div>
        <span className="memory-atoms__head-actions">
          <button type="button" className="memory-atoms__ghost" onClick={() => { setCreating(true); setSelected(""); }} title="新建一条记忆">
            + 新建
          </button>
          <button type="button" className="memory-atoms__ghost" onClick={() => void reload()} title="重新读取">
            <RefreshCw size={13} /> 刷新
          </button>
        </span>
      </header>

      {error ? <div className="memory-atoms__error"><AlertTriangle size={13} /> {error}</div> : null}
      {notice ? <div className="memory-atoms__notice">{notice}</div> : null}

      <div className="memory-atoms__body">
        <aside className="memory-atoms__list">
          {/* 11-11：四个记忆板块共用同一套工具条（搜索 / 三档筛选 / 批量作废）。 */}
          <MemoryListTools
            query={filter} onQueryChange={setFilter} placeholder="搜索条目 / 标签 / 正文"
            filters={[
              { key: "type", label: "按类型筛选", value: typeFilter, options: ATOM_TYPE_OPTIONS, onChange: (v) => { setTypeFilter(v); setChecked([]); } },
              { key: "scope", label: "按作用域筛选", value: scopeFilter, options: ATOM_SCOPE_OPTIONS, onChange: (v) => { setScopeFilter(v); setChecked([]); } },
              { key: "status", label: "按状态筛选", value: statusFilter, options: ATOM_STATUS_OPTIONS, onChange: (v) => { setStatusFilter(v); setChecked([]); } },
            ]}
            visibleIds={visibleEntries.map(rowKeyOf)} selected={checked} onSelectionChange={setChecked}
            actions={batchActions} summary={`共 ${entries.length} 条`}
          />
          {!entries.length ? (
            <p className="memory-atoms__hint">
              这个工作区还没有记忆条目。跑一次迁移：
              <code>node scripts/memory-atoms-migrate.mjs</code>
            </p>
          ) : null}
          <div className="memory-atoms__groups">
            {grouped.map((group) => (
              <div className="memory-atoms__group" key={group.type}>
                <div className="memory-atoms__group-title">{typeLabel(group.type)}</div>
                {group.rows.map((row) => (
                  <div className="memory-atoms__row-wrap" key={row.id}>
                    <input type="checkbox" className="mlt-check" aria-label={`选择 ${row.summary}`}
                      checked={checked.includes(rowKeyOf(row))}
                      onChange={(e) => setChecked(toggleSelection(checked, [rowKeyOf(row)], e.target.checked))} />
                    <button
                      type="button"
                      className={`memory-atoms__row${row.id === selected ? " is-on" : ""}${row.status !== "active" ? " is-off" : ""}`}
                      onClick={() => setSelected(row.id)}
                      title={`${row.id} · ${row.updated}`}
                    >
                      <span className="memory-atoms__row-summary">{row.summary}</span>
                      <span className="memory-atoms__row-meta">
                        {row.confidence === "tentative" ? <em>待验证</em> : null}
                        {row.status !== "active" ? <em className="is-retired">{row.status === "superseded" ? "已被取代" : "已过期"}</em> : null}
                        <i>{row.updated.slice(5)}</i>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <main className="memory-atoms__detail">
          {creating ? (
            <>
              <div className="memory-atoms__detail-head">
                <code>新建记忆条目</code>
                <span className="memory-atoms__chips"><span>写进 entries/project/</span></span>
              </div>
              <input className="memory-atoms__field" value={nid} onChange={(e) => setNid(e.target.value)} placeholder="id（kebab-case，例如 feibi-path）" />
              <input className="memory-atoms__field" value={nsummary} onChange={(e) => setNsummary(e.target.value)} placeholder="一句话摘要（索引里显示的就是它，≤40 字）" />
              <textarea
                className="memory-atoms__editor"
                value={nbody}
                spellCheck={false}
                onChange={(e) => setNbody(e.target.value)}
                placeholder={"正文：什么时候、在哪、测出什么；多个口径分点列全；最后写 Why（不这样会错在哪）和 How to apply（下次怎么用）"}
              />
              <div className="memory-atoms__actions">
                <button type="button" className="memory-atoms__ghost" onClick={() => { setCreating(false); setNid(""); setNsummary(""); setNbody(""); }}>取消</button>
                <button type="button" className="memory-atoms__primary" disabled={saving} onClick={() => void createAtom()}>
                  <Save size={13} /> {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </>
          ) : current ? (
            <>
              <div className="memory-atoms__detail-head">
                <code>{current.id}</code>
                <span className="memory-atoms__chips">
                  <span>{typeLabel(current.type)}</span>
                  <span>{current.scope}</span>
                  <span>{current.confidence === "tentative" ? "待验证" : "已确认"}</span>
                  {current.status !== "active" ? <span className="is-retired">{current.status}</span> : null}
                </span>
              </div>
              {current.tags.length ? (
                <div className="memory-atoms__tags">{current.tags.map((t) => <span key={t}>#{t}</span>)}</div>
              ) : null}
              <textarea
                className="memory-atoms__editor"
                value={draft}
                spellCheck={false}
                onChange={(e) => { setDraft(e.target.value); setDirty(e.target.value !== current.body); }}
              />
              <div className="memory-atoms__actions">
                <span className="memory-atoms__saved">{dirty ? "未保存" : "已保存"}</span>
                <button type="button" className="memory-atoms__primary" disabled={!dirty || saving} onClick={() => void save()}>
                  <Save size={13} /> {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </>
          ) : (
            <p className="memory-atoms__hint">左边选一条看正文。索引只有一行，细节在这里改。</p>
          )}
        </main>
      </div>

      <footer className="memory-atoms__preview">
        <div className="memory-atoms__preview-head">
          <b>注入预览</b>
          <span>输入一句你可能会说的话，看引擎本轮**实际**会拿到哪些记忆（与真实注入同一套打分）</span>
        </div>
        <div className="memory-atoms__preview-row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例：费比的三种口径分别是多少" />
          <button type="button" className="memory-atoms__ghost" disabled={previewing} onClick={() => void runPreview()}>
            {previewing ? "计算中…" : "预览"}
          </button>
        </div>
        {preview ? <pre className="memory-atoms__preview-body">{preview}</pre> : null}
      </footer>

      {broken.length ? (
        <div className="memory-atoms__broken">
          <AlertTriangle size={13} />
          <span>有 {broken.length} 个文件解析失败（不会被注入）：</span>
          <code>{broken.slice(0, 4).join("、")}{broken.length > 4 ? " …" : ""}</code>
        </div>
      ) : null}

      <details className="memory-atoms__history">
        <summary>变更历史（最近 {history.length} 条）</summary>
        {history.length ? (
          <ul>
            {history.slice(0, 12).map((row, i) => (
              <li key={`${row.at}-${row.id}-${i}`}>
                <span className="memory-atoms__history-op">{row.op}</span>
                <code>{row.id}</code>
                <span className="memory-atoms__history-when">{String(row.at).slice(5, 16).replace("T", " ")} · {row.by}</span>
              </li>
            ))}
          </ul>
        ) : <p className="memory-atoms__hint">还没有变更记录。</p>}
      </details>
    </section>
  );
}

export default MemoryAtomsPanel;
