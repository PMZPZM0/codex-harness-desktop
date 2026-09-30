import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, RotateCw, Trash2 } from "lucide-react";

/**
 * 工作日志管理（09-30 用户：「记忆，有记忆管理，会话有归档管理，现在就是工作日志这个没有地方管理懂吗」）。
 *
 * 管的是**项目里的工作日志与项目记忆**：`<项目>/.codex-harness/memory/**`
 *   · logs/YYYY-MM-DD.md   每日工作日志（需求 → 结论，记忆捕获链写入）
 *   · MEMORY.md / LESSONS.md / lessons/  长期记忆与坑
 *   · archive/ project/    归档与项目资料
 * ⛔ 与会话原档（数据管理页上方那块 / 归档管理页）**不是一回事**：这里是 Codex 在项目里
 *   写下的工作记录，不是对话记录。
 */

type WorkFile = { path: string; rel: string; kind: string; bytes: number; mtime: number };
type Project = { cwd: string; name: string; memoryDir: string; exists: boolean; bytes: number; files: WorkFile[] };
type Scan = { projects: Project[] };

const KIND_ORDER = ["工作日志", "长期记忆", "坑与纪律", "项目资料", "归档", "其它"];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function timeText(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function WorkLogsSection({ onNotice, openAppConfirm }: {
  onNotice: (message: string) => void;
  openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
}) {
  const [data, setData] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState("");

  const refresh = () => {
    window.codex.workLogsScan()
      .then((res) => setData(res as Scan))
      .catch((error: any) => onNotice("读取工作日志失败：" + (error?.message ?? error)));
  };
  useEffect(() => { refresh(); }, []);

  const withLogs = useMemo(() => (data?.projects ?? []).filter((p) => p.files.length), [data]);
  const total = useMemo(() => withLogs.flatMap((p) => p.files), [withLogs]);
  const allPaths = total.map((f) => f.path);
  const allPicked = allPaths.length > 0 && picked.size === allPaths.length;
  const pickedBytes = total.filter((f) => picked.has(f.path)).reduce((sum, f) => sum + f.bytes, 0);

  /* ⛔ 两个参数各司其职：第一个恒为 allPaths，第二个 !allPicked 决定 add/delete
     —— 把三元塞进第一个参数会让其中一个方向变成空循环（09-30 实测踩过）。 */
  const toggle = (paths: string[], on: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      for (const p of paths) { if (on) next.add(p); else next.delete(p); }
      return next;
    });
  };

  const openPreview = async (file: WorkFile) => {
    if (preview?.path === file.path) { setPreview(null); return; }
    setLoadingPreview(file.path);
    try {
      const res = await window.codex.workLogsRead({ path: file.path });
      setPreview({ path: file.path, text: String(res?.text ?? "") });
    } catch (error: any) {
      onNotice("打开失败：" + (error?.message ?? error));
    } finally { setLoadingPreview(""); }
  };

  const runDelete = async (paths: string[], label: string) => {
    const bytes = total.filter((f) => paths.includes(f.path)).reduce((sum, f) => sum + f.bytes, 0);
    const ok = await openAppConfirm(
      "删除工作日志",
      `确认删除${label}（${paths.length} 个文件，共 ${formatBytes(bytes)}）？\n\n` +
      "⚠️ 工作日志是 Codex 在项目里写过的工作记录，删掉不会重建、也无法恢复。\n" +
      "（想管理会话本身请用「归档管理」页；记忆的长期档案在「记忆管理」页。）",
      "确认删除",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.codex.workLogsDelete({ paths });
      if (res?.deleted) onNotice(`已删除 ${res.deleted} 个工作日志文件，释放 ${formatBytes(res.bytes)}`);
      if (res?.failed?.length) onNotice(`${res.failed.length} 个文件删除失败（可能被占用）`);
      setPicked(new Set());
      setPreview(null);
      refresh();
    } catch (error: any) {
      onNotice("删除失败：" + (error?.message ?? error));
    } finally { setBusy(false); }
  };

  return (
    <section className="settings-section stack is-settings-flow">
      <div className="settings-subhead"><FileText size={13} />工作日志（项目工作记录）</div>
      <p className="muted">
        Codex 在每个项目里写下的工作日志与项目记忆（<code>&lt;项目&gt;/.codex-harness/memory/</code>）：每日日志、长期记忆、坑与纪律。
        点一条看正文，勾选后可批量删除。
        <strong>⛔ 这是项目里的工作记录，不是对话记录</strong>——会话的归档 / 删除在「归档管理」页，记忆档案在「记忆管理」页。
      </p>

      <div className="codex-logs-bar">
        <span>
          共 <b>{total.length}</b> 个工作日志文件 · <b>{formatBytes(total.reduce((sum, f) => sum + f.bytes, 0))}</b>
          {data ? ` · ${withLogs.length} 个项目` : ""}
        </span>
        <div className="settings-actions">
          <button className="secondary-setting" disabled={busy} onClick={refresh}><RotateCw size={12} />重新扫描</button>
          <button className="secondary-setting" disabled={busy || !total.length} onClick={() => toggle(allPaths, !allPicked)}>
            {allPicked ? "取消全选" : "全选"}
          </button>
        </div>
      </div>

      {!data ? <p className="muted">正在扫描…</p> : null}
      {data && !withLogs.length ? (
        <p className="muted">还没有任何项目写过工作日志。（Codex 在项目里干活并留下结论时，会自动写进该项目 .codex-harness/memory/logs/）</p>
      ) : null}

      <div className="codex-logs-tree">
        {withLogs.map((project) => {
          const open = openProjects.has(project.cwd);
          const projPaths = project.files.map((f) => f.path);
          const projPicked = projPaths.filter((p) => picked.has(p)).length;
          const byKind = new Map<string, WorkFile[]>();
          for (const file of project.files) {
            if (!byKind.has(file.kind)) byKind.set(file.kind, []);
            byKind.get(file.kind)!.push(file);
          }
          return (
            <div className="codex-logs-project" key={project.cwd}>
              <div className="codex-logs-row is-project">
                <button className="codex-logs-caret" aria-expanded={open} onClick={() => setOpenProjects((cur) => { const next = new Set(cur); if (next.has(project.cwd)) next.delete(project.cwd); else next.add(project.cwd); return next; })}>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <input
                  type="checkbox"
                  checked={projPicked === projPaths.length && projPaths.length > 0}
                  ref={(el) => { if (el) el.indeterminate = projPicked > 0 && projPicked < projPaths.length; }}
                  onChange={(e) => toggle(projPaths, e.target.checked)}
                  aria-label={`选择项目 ${project.name}`}
                />
                <span className="codex-logs-name" title={project.cwd}>{project.name}</span>
                <small>{project.files.length} 个 · {formatBytes(project.bytes)}</small>
                <button className="codex-logs-del" disabled={busy || !projPicked} title="删除该项目下勾选的日志" onClick={() => void runDelete(projPaths.filter((p) => picked.has(p)), `「${project.name}」里勾选的文件`)}><Trash2 size={12} /></button>
              </div>
              {open ? [...byKind.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0])).map(([kind, files]) => (
                <div className="codex-logs-day" key={project.cwd + kind}>
                  <div className="codex-logs-row is-day">
                    <span className="codex-logs-caret" aria-hidden="true" />
                    <span className="codex-logs-name">{kind}</span>
                    <small>{files.length} 个 · {formatBytes(files.reduce((sum, f) => sum + f.bytes, 0))}</small>
                  </div>
                  {files.map((file) => (
                    <div className="codex-logs-row is-file" key={file.path}>
                      <input type="checkbox" checked={picked.has(file.path)} onChange={(e) => toggle([file.path], e.target.checked)} aria-label={`选择 ${file.rel}`} />
                      <button className="work-logs-open" onClick={() => void openPreview(file)} title="查看正文">
                        <span className="codex-logs-file">{file.rel}</span>
                      </button>
                      <small>{formatBytes(file.bytes)} · {timeText(file.mtime)}{loadingPreview === file.path ? " · 读取中…" : ""}</small>
                    </div>
                  ))}
                  {preview && files.some((f) => f.path === preview.path) ? (
                    <pre className="work-logs-preview">{preview.text.slice(0, 20000)}{preview.text.length > 20000 ? "\n…（已截断，完整内容请打开所在目录）" : ""}</pre>
                  ) : null}
                </div>
              )) : null}
            </div>
          );
        })}
      </div>

      {withLogs.length ? (
        <div className="settings-actions">
          <button className="danger-setting" disabled={busy || !picked.size} onClick={() => void runDelete([...picked], "勾选的工作日志")}>
            <Trash2 size={12} />删除选中（{picked.size} 个 · {formatBytes(pickedBytes)}）
          </button>
          <button className="secondary-setting" disabled={busy || !withLogs.length} onClick={() => { const dir = withLogs[0]?.memoryDir; if (dir) void window.codex.shellReveal(dir).catch(() => undefined); }}>
            <FolderOpen size={12} />打开该项目日志目录
          </button>
        </div>
      ) : null}
    </section>
  );
}
