/**
 * 产物归档面板（11-11 独立板块）—— 设置 → 数据 →「产物归档」一屏。
 *
 * 逆向豆包工作伙伴时看到：它的「文件」区是全量台账（按 日期-任务短名 分目录、
 * 文件按内容语义命名、多版迭代 -r94/-low/-final）。我们这边以前只在提示词里写了约定，
 * 模型不照做就什么都没有 ⇒ 现在有真实落盘 + 这里能查。
 *
 * ⛔ 只读：归档动作由模型经 harness_tools 网关完成，界面不写文件。
 */
import { useCallback, useEffect, useState } from "react";
import { Archive, FolderSearch, RefreshCw } from "lucide-react";

type ArchiveFile = { name: string; from: string; bytes: number };
type ArchiveRow = {
  dir: string; task: string; at: number; source?: string; note?: string;
  files: ArchiveFile[]; path?: string;
};
type ListResult = { ok: boolean; rows?: ArchiveRow[]; error?: string };

/**
 * 产物归档面板：按「日期-任务短名」列出每次任务的成品与文件清单。
 *
 * ⛔ 只读：数据只从 `artifact:list` 通道来，归档动作由模型经网关工具完成，
 *    界面不拼路径、不写文件（绝对路径由主进程回传）。
 */
export function ArtifactPanel({ workspace }: { workspace?: string }) {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!workspace) { setRows([]); setError(""); return; }
    setLoading(true);
    try {
      const res = (await window.codex.listArtifactArchives(workspace)) as ListResult;
      if (!res?.ok) { setError(res?.error ?? "读取失败"); setRows([]); return; }
      setRows(Array.isArray(res.rows) ? res.rows : []);
      setError("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void reload(); }, [reload]);

  const fileCount = rows.reduce((n, r) => n + r.files.length, 0);
  return (
    <section className="artifact-panel">
      <header className="artifact-panel__head">
        <span className="artifact-panel__title"><Archive size={14} /> 产物归档</span>
        <span className="artifact-panel__stats">{rows.length} 次任务 · {fileCount} 个文件</span>
        <button type="button" className="memory-atoms__ghost" onClick={() => void reload()} disabled={loading} title="重新读取">
          <RefreshCw size={13} /> 刷新
        </button>
      </header>
      <p className="artifact-panel__hint">
        按 <code>artifacts/YYYYMMDD-任务短名/</code> 归档；同名自动加 <code>-r2</code> 迭代后缀，原文件保留不动。
        模型做完东西会自己归档，历史散落文件可用 <code>scripts/artifacts-migrate.mjs</code> 归位。
      </p>
      {error ? <p className="memory-atoms__error">{error}</p> : null}
      {!workspace ? (
        <p className="memory-atoms--empty">先打开一个项目 —— 产物跟着工作区走。</p>
      ) : rows.length === 0 && !error ? (
        <p className="memory-atoms--empty">这个工作区还没有归档产物。</p>
      ) : (
        <ul className="artifact-panel__list">
          {rows.map((r) => (
            <li key={r.dir} className="artifact-panel__row">
              <div className="artifact-panel__row-head">
                <code>{r.dir}</code>
                {r.note ? <span className="artifact-panel__note">{r.note}</span> : null}
                <span className="artifact-panel__meta">
                  {r.files.length} 个文件{r.at ? ` · ${new Date(r.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                  {r.source ? ` · ${r.source}` : ""}
                </span>
                {r.path ? (
                  <button type="button" className="memory-atoms__ghost" onClick={() => void window.codex.revealInFolder(r.path!).catch(() => {})} title="在系统资源管理器中打开">
                    <FolderSearch size={12} /> 打开
                  </button>
                ) : null}
              </div>
              <div className="artifact-panel__files">
                {r.files.map((f) => (
                  <span key={f.name} title={`${f.name} · ${Math.max(1, Math.round(f.bytes / 1024))} KB`}>{f.name}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
