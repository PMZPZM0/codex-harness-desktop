import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FolderOpen, RefreshCw, Search, Trash2, Undo2, X } from "lucide-react";
import { BatchActions, CheckCard, SearchField, SelectAllToggle } from "./SettingsWidgets";
import { cleanThreadDisplayTitle } from "../lib/user-refs";

type ArchiveThread = {
  id: string;
  name?: string | null;
  preview?: string;
  cwd: string;
  updatedAt: number;
  status: any;
  turns?: any[];
  archived?: boolean;
};

function basename(value: string) {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}
function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

export default function ArchivePage({
  onNotice,
  onOpenThread,
  onThreadRestored,
}: {
  onNotice: (msg: string) => void;
  onOpenThread?: (id: string) => void;
  onThreadRestored?: (id: string) => void;
}) {
  const [items, setItems] = useState<ArchiveThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<"restore" | "delete" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.codex.request("thread/list", { limit: 200, sortKey: "updated_at", sortDirection: "desc", archived: true });
      // 双重门禁：即使主进程或上游返回异常，也绝不把活动会话放进永久删除页面。
      setItems((result.data ?? []).filter((entry: ArchiveThread) => entry.archived === true));
    } catch (error: any) {
      onNotice(`读取归档任务失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((item) => (item.name || "").toLowerCase().includes(q) || (item.preview || "").toLowerCase().includes(q) || (item.cwd || "").toLowerCase().includes(q))
      : items;
  }, [items, query]);

  const checkedList = useMemo(() => items.filter((item) => checked.has(item.id)), [items, checked]);
  const checkedIds = useMemo(() => checkedList.map((item) => item.id), [checkedList]);
  const totalCount = visible.length;
  const selectedCount = checkedIds.length;

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setChecked(new Set(visible.map((item) => item.id)));
  const clearAll = () => setChecked(new Set());

  async function verifyArchived(ids: string[]) {
    const result = await window.codex.request("thread/list", { limit: 500, sortKey: "updated_at", sortDirection: "desc", archived: true });
    const archivedIds = new Set((result.data ?? []).filter((entry: ArchiveThread) => entry.archived === true).map((entry: ArchiveThread) => entry.id));
    const invalid = ids.filter((id) => !archivedIds.has(id));
    if (invalid.length) throw new Error("所选任务已不在归档区，列表已刷新；未执行删除");
  }

  async function restore(id: string) {
    setBusy(id);
    try {
      await window.codex.request("thread/unarchive", { threadId: id });
      setItems((current) => current.filter((entry) => entry.id !== id));
      setChecked((prev) => { const n = new Set(prev); n.delete(id); return n; });
      onThreadRestored?.(id);
      onNotice("已恢复任务");
    } catch (error: any) {
      onNotice(`恢复失败：${error.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("永久删除这条归档任务？此操作无法撤销。")) return;
    setBusy(id);
    try {
      await verifyArchived([id]);
      await window.codex.request("thread/delete", { threadId: id });
      setItems((current) => current.filter((entry) => entry.id !== id));
      setChecked((prev) => { const n = new Set(prev); n.delete(id); return n; });
      onNotice("已永久删除任务");
    } catch (error: any) {
      if (/不在归档区/.test(String(error?.message))) void load();
      onNotice(`删除失败：${error.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function batch(mode: "restore" | "delete") {
    if (!checkedIds.length) return;
    if (mode === "delete" && !window.confirm(`永久删除选中的 ${checkedIds.length} 条归档任务？此操作无法撤销。`)) return;
    setBatchBusy(mode);
    try {
      const restoredIds: string[] = [];
      if (mode === "delete") await verifyArchived(checkedIds);
      for (const id of checkedIds) {
        await window.codex.request(mode === "restore" ? "thread/unarchive" : "thread/delete", { threadId: id });
        if (mode === "restore") restoredIds.push(id);
      }
      setItems((current) => current.filter((entry) => !checkedIds.includes(entry.id)));
      setChecked(new Set());
      if (mode === "restore") {
        restoredIds.forEach((id) => onThreadRestored?.(id));
      }
      onNotice(mode === "restore" ? `已恢复 ${checkedIds.length} 条任务` : `已永久删除 ${checkedIds.length} 条任务`);
    } catch (error: any) {
      if (/不在归档区/.test(String(error?.message))) void load();
      onNotice(`批量${mode === "restore" ? "恢复" : "删除"}失败：${error.message}`);
    } finally {
      setBatchBusy(null);
    }
  }

  return (
    <section className="settings-section stack archive-page">
      <div className="settings-copy channel-heading">
        <div><h2>归档管理</h2><p>被归档的任务集中在这里，可恢复回侧边栏或永久删除。</p></div>
        <span className="archive-total">{items.length} 条归档</span>
      </div>

      <div className="archive-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="搜索归档任务名称、内容或项目" width={260} />
        <span className="archive-toolbar-spacer" />
        <BatchActions
          hint={selectedCount ? `已选 ${selectedCount} 条` : undefined}
          actions={[
            { label: "恢复选中", icon: <Undo2 size={13} />, disabled: !selectedCount || !!batchBusy, busy: batchBusy === "restore", onClick: () => void batch("restore") },
            { label: "永久删除", icon: <Trash2 size={13} />, tone: "danger", disabled: !selectedCount || !!batchBusy, busy: batchBusy === "delete", onClick: () => void batch("delete") },
          ]}
        />
      </div>

      {loading ? (
        <div className="archive-loading">正在读取归档…</div>
      ) : items.length === 0 ? (
        <div className="archive-empty"><Archive size={32} /><strong>没有归档任务</strong><span>在侧边栏把任务归档后，会出现在这里。</span></div>
      ) : (
        <div className="archive-list">
          <div className="archive-list-head">
            <SelectAllToggle total={totalCount} selected={selectedCount} onSelectAll={selectAll} onClear={clearAll} unit="条" />
          </div>
          {visible.length === 0 ? (
            <div className="archive-empty"><Search size={26} /><strong>没有匹配的归档</strong><span>换个关键词试试。</span></div>
          ) : (
            visible.map((item) => (
              <article className={`archive-row ${checked.has(item.id) ? "is-checked" : ""}`} key={item.id}>
                <CheckCard checked={checked.has(item.id)} label={`选择 ${cleanThreadDisplayTitle(item.name, { preview: item.preview })}`} onChange={() => toggle(item.id)} />
                <button className="archive-row-main" title="打开任务" onClick={() => onOpenThread?.(item.id)}>
                  <strong>{cleanThreadDisplayTitle(item.name, { preview: item.preview })}</strong>
                  <span><FolderOpen size={11} />{basename(item.cwd) || "未知项目"} · {timeAgo(item.updatedAt)}</span>
                </button>
                <div className="archive-row-actions">
                  <button className="secondary-setting" disabled={busy === item.id} onClick={() => void restore(item.id)}><Undo2 size={13} />恢复</button>
                  <button className="icon-button danger" title="永久删除" disabled={busy === item.id} onClick={() => void remove(item.id)}><Trash2 size={15} /></button>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
