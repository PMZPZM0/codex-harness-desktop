import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database, FolderOpen, RotateCw, Trash2 } from "lucide-react";

/**
 * Codex 日志管理（09-29 用户：「加一个 Codex 日志管理功能，在数据管理里面，就是平时 Codex
 * 写的那些日志，按项目分类，项目里面再按时间分类，可以批量删除和清空」）。
 *
 * 管的是 Codex 引擎自己写的**会话记录**（rollout 原档，含对话全文）：
 *   `<codex-home>/sessions/YYYY/MM/DD/rollout-*.jsonl`（+ `archived_sessions/**`）
 * 项目归属取每个文件首行的 `cwd`（这条会话在哪个项目跑的）——所以能按项目分组、日期再分组。
 *
 * ⛔⛔ 删除是**销毁性**的：删掉的对话记录引擎不会重建，对应会话会从列表消失。
 *   确认框必须把这句话说清楚（数量 + 体积 + 不可恢复），并说明索引条目也会一并剔除。
 */

type LogFile = {
  path: string; rel: string; bytes: number; mtime: number;
  cwd: string; project: string; id: string; archived: boolean;
};
type Scan = { files: LogFile[]; sessionsDir: string; archivedDir: string };

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/** 从 rel 路径里取日期（sessions/2026/08/29/… → 2026-08-29）；取不到就用 mtime */
function dateOf(file: LogFile): string {
  const m = /(\d{4})\/(\d{2})\/(\d{2})\//.exec(file.rel);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(file.mtime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortName(rel: string): string {
  const base = rel.split("/").pop() || rel;
  return base.replace(/^rollout-/, "").replace(/\.jsonl$/i, "");
}

export function CodexLogsSection({ onNotice, openAppConfirm }: {
  onNotice: (message: string) => void;
  openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
}) {
  const [data, setData] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  const refresh = () => {
    window.codex.codexLogsScan()
      .then((res) => setData(res as Scan))
      .catch((error: any) => onNotice("读取 Codex 日志失败：" + (error?.message ?? error)));
  };
  useEffect(() => { refresh(); }, []);

  /** 项目 → 日期 → 文件（两级分组；项目按体积降序，日期按新到旧） */
  const tree = useMemo(() => {
    const byProject = new Map<string, { project: string; cwd: string; bytes: number; dates: Map<string, LogFile[]> }>();
    for (const file of data?.files ?? []) {
      const key = file.project || "（未知项目）";
      if (!byProject.has(key)) byProject.set(key, { project: key, cwd: file.cwd, bytes: 0, dates: new Map() });
      const entry = byProject.get(key)!;
      entry.bytes += file.bytes;
      if (!entry.cwd && file.cwd) entry.cwd = file.cwd;
      const date = dateOf(file);
      if (!entry.dates.has(date)) entry.dates.set(date, []);
      entry.dates.get(date)!.push(file);
    }
    return [...byProject.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .map((entry) => ({
        ...entry,
        dates: [...entry.dates.entries()]
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .map(([date, files]) => ({ date, files: files.slice().sort((a, b) => b.mtime - a.mtime), bytes: files.reduce((sum, f) => sum + f.bytes, 0) })),
      }));
  }, [data]);

  const total = data?.files ?? [];
  const pickedBytes = total.filter((f) => picked.has(f.path)).reduce((sum, f) => sum + f.bytes, 0);

  const toggle = (paths: string[], on: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      for (const p of paths) { if (on) next.add(p); else next.delete(p); }
      return next;
    });
  };
  const allPaths = total.map((f) => f.path);
  const allPicked = allPaths.length > 0 && picked.size === allPaths.length;

  const runDelete = async (paths: string[], label: string) => {
    const bytes = total.filter((f) => paths.includes(f.path)).reduce((sum, f) => sum + f.bytes, 0);
    const ok = await openAppConfirm(
      "删除引擎会话原档",
      `确认删除${label}（${paths.length} 个会话原档，共 ${formatBytes(bytes)}）？\n\n` +
      "⚠️ 这是对话全文原档，删掉不可恢复：对应会话会从会话列表消失，之后也无法再打开或导出。\n" +
      "（会话索引里的条目会一并清理，不会留下打不开的死条目。）\n" +
      "要管理会话本身（归档 / 删除）请用「归档管理」页。",
      "确认删除",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.codex.codexLogsDelete({ paths });
      if (res?.deleted) {
        onNotice(`已删除 ${res.deleted} 个会话原档，释放 ${formatBytes(res.bytes)}${res.indexCleaned ? `（清理索引 ${res.indexCleaned} 条）` : ""}`);
      }
      if (res?.failed?.length) onNotice(`${res.failed.length} 个文件删除失败（可能被占用）`);
      setPicked(new Set());
      refresh();
    } catch (error: any) {
      onNotice("删除失败：" + (error?.message ?? error));
    } finally { setBusy(false); }
  };

  return (
    <section className="settings-section stack is-settings-flow">
      <div className="settings-subhead"><Database size={13} />引擎会话原档</div>
      <p className="muted">
        引擎每次会话都会写一份原档（<code>codex-home/sessions/日期/rollout-*.jsonl</code>），按项目分组、项目内按日期分组，可勾选批量删除或整库清空。
        要管理<strong>会话本身</strong>（归档 / 删除）请去「归档管理」页。<strong>⛔ 删除即永久丢失对应会话的完整记录</strong>，平时建议整目录备份而非删除。
        （这是**对话记录**；项目里的工作日志在下方「工作日志」区块。）
      </p>

      <div className="codex-logs-bar">
        <span>
          共 <b>{total.length}</b> 个会话原档文件 · <b>{formatBytes(total.reduce((sum, f) => sum + f.bytes, 0))}</b>
          {data ? ` · ${tree.length} 个项目` : ""}
        </span>
        <div className="settings-actions">
          <button className="secondary-setting" disabled={busy} onClick={refresh}><RotateCw size={12} />重新扫描</button>
          {/* ⛔ 两个参数各司其职：**第一个恒为 allPaths**（要操作的全集），第二个 !allPicked 决定
              add / delete。原实现第一个参数写成 `allPicked ? [] : allPaths` ⇒ 取消全选传空数组
              = 空循环（「取消全选没用」）；09-30 我第一次修又写反成 `allPicked ? allPaths : []`
              ⇒ 变成全选无效 —— 靠 CDP 真实点击实测才抓到。 */}
          <button className="secondary-setting" disabled={busy || !total.length} onClick={() => toggle(allPaths, !allPicked)}>
            {allPicked ? "取消全选" : "全选"}
          </button>
          {/* ⛔ 用 shellReveal（shell:reveal，目录用 openPath 打开）；之前用的 revealInFolder
              （fs:reveal）**只接受文件**（handler 里 stat.isFile() 校验），传目录必抛
              「文件不存在」并被 catch 吞掉 ⇒ 点了没反应（用户实测）。 */}
          {data ? <button className="secondary-setting" onClick={() => void window.codex.shellReveal(data.sessionsDir).catch(() => undefined)}><FolderOpen size={12} />打开日志目录</button> : null}
        </div>
      </div>

      {!data ? <p className="muted">正在扫描…</p> : null}
      {data && !total.length ? <p className="muted">没有会话原档文件。</p> : null}

      <div className="codex-logs-tree">
        {tree.map((entry) => {
          const projOpen = openProjects.has(entry.project);
          const projPaths = entry.dates.flatMap((d) => d.files.map((f) => f.path));
          const projPicked = projPaths.filter((p) => picked.has(p)).length;
          return (
            <div className="codex-logs-project" key={entry.project}>
              <div className="codex-logs-row is-project">
                <button className="codex-logs-caret" aria-expanded={projOpen} onClick={() => setOpenProjects((cur) => { const next = new Set(cur); if (next.has(entry.project)) next.delete(entry.project); else next.add(entry.project); return next; })}>
                  {projOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <input
                  type="checkbox"
                  checked={projPicked === projPaths.length && projPaths.length > 0}
                  ref={(el) => { if (el) el.indeterminate = projPicked > 0 && projPicked < projPaths.length; }}
                  onChange={(e) => toggle(projPaths, e.target.checked)}
                  aria-label={`选择项目 ${entry.project}`}
                />
                <span className="codex-logs-name" title={entry.cwd || entry.project}>{entry.project}</span>
                <small>{entry.dates.length} 天 · {projPaths.length} 个 · {formatBytes(entry.bytes)}</small>
                <button className="codex-logs-del" disabled={busy || !projPicked} title="删除该项目下选中的会话原档" onClick={() => void runDelete(projPaths.filter((p) => picked.has(p)), `「${entry.project}」里选中的日志`)}><Trash2 size={12} /></button>
              </div>
              {projOpen ? entry.dates.map((day) => {
                const dayKey = `${entry.project}:${day.date}`;
                const dayOpen = openDates.has(dayKey);
                const dayPicked = day.files.filter((f) => picked.has(f.path)).length;
                return (
                  <div className="codex-logs-day" key={dayKey}>
                    <div className="codex-logs-row is-day">
                      <button className="codex-logs-caret" aria-expanded={dayOpen} onClick={() => setOpenDates((cur) => { const next = new Set(cur); if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey); return next; })}>
                        {dayOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <input
                        type="checkbox"
                        checked={dayPicked === day.files.length}
                        ref={(el) => { if (el) el.indeterminate = dayPicked > 0 && dayPicked < day.files.length; }}
                        onChange={(e) => toggle(day.files.map((f) => f.path), e.target.checked)}
                        aria-label={`选择 ${day.date} 的日志`}
                      />
                      <span className="codex-logs-name">{day.date}</span>
                      <small>{day.files.length} 个 · {formatBytes(day.bytes)}</small>
                      <button className="codex-logs-del" disabled={busy || !dayPicked} title="删除这一天选中的会话原档" onClick={() => void runDelete(day.files.map((f) => f.path).filter((p) => picked.has(p)), `${day.date} 选中的日志`)}><Trash2 size={12} /></button>
                    </div>
                    {dayOpen ? day.files.map((file) => (
                      <div className="codex-logs-row is-file" key={file.path}>
                        <input type="checkbox" checked={picked.has(file.path)} onChange={(e) => toggle([file.path], e.target.checked)} aria-label={`选择 ${file.rel}`} />
                        <span className="codex-logs-file" title={file.rel}>{shortName(file.rel)}{file.archived ? "（已归档）" : ""}</span>
                        <small>{formatBytes(file.bytes)} · {new Date(file.mtime).toLocaleString("zh-CN", { hour12: false })}</small>
                      </div>
                    )) : null}
                  </div>
                );
              }) : null}
            </div>
          );
        })}
      </div>

      <div className="settings-actions">
        <button className="danger-setting" disabled={busy || !picked.size} onClick={() => void runDelete([...picked], "选中的日志")}>
          <Trash2 size={12} />删除选中（{picked.size} 个 · {formatBytes(pickedBytes)}）
        </button>
        <button className="danger-setting" disabled={busy || !total.length} onClick={() => void runDelete(allPaths, "全部会话原档")}>
          清空全部（{total.length} 个 · {formatBytes(total.reduce((sum, f) => sum + f.bytes, 0))}）
        </button>
      </div>
    </section>
  );
}
