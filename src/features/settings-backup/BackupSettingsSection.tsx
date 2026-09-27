/**
 * 设置页 · backup（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 *
 * 09-27 追加（非搬迁部分）：「选择会话导出」卡 —— 勾选任意多条会话导出
 * （exportThreadsMarkdown/Backup 本来就收 id 数组，缺的只是选择 UI）。
 */
import { useMemo, useState } from "react";
import { PageInfo } from "../../components/SettingsHead";
import { Archive, FileText, FileUp, Info, ListChecks, MessageSquare, Upload } from "lucide-react";
import { cleanThreadDisplayTitle } from "../../lib/user-refs";
import { Spinner } from "../../components/CardShell";

export type BackupSettingsSectionProps = { thread: any; backupBusy: any; exportThreadsMarkdown: any; exportThreadsBackup: any; threads: any; importThreadsBackup: any; importConversationMarkdown: any };

export function BackupSettingsSection(props: BackupSettingsSectionProps) {
  const { thread, backupBusy, exportThreadsMarkdown, exportThreadsBackup, threads, importThreadsBackup, importConversationMarkdown } = props;
  /* 选择会话导出（09-27）：勾选任意多条 → 一次导出。按更新时间新→旧排，勾选状态跨搜索保留 */
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const sortedThreads = useMemo(
    () => [...threads].sort((a: any, b: any) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    [threads],
  );
  const visibleThreads = useMemo(() => {
    const keyword = pickerQuery.trim().toLowerCase();
    if (!keyword) return sortedThreads;
    return sortedThreads.filter((t: any) => `${t.name ?? ""} ${t.preview ?? ""} ${t.cwd ?? ""}`.toLowerCase().includes(keyword));
  }, [sortedThreads, pickerQuery]);
  const togglePicked = (id: string) => setPicked((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  const allVisiblePicked = visibleThreads.length > 0 && visibleThreads.every((t: any) => picked.includes(t.id));
  return (
    <>
      <section className="settings-section stack backup-page">
                    <div className="settings-copy"><h2>会话备份<PageInfo text={<>Markdown 用于阅读和交给其他 AI；JSON 用于完整迁移与恢复。</>} /></h2></div>
                    <div className="backup-grid">
                      <article className="backup-card backup-card--current">
                        <div className="backup-card-head"><span><MessageSquare size={16} /></span><div><strong>当前会话</strong><small>{thread ? cleanThreadDisplayTitle(thread.name, { preview: thread.preview }) : "尚未打开会话"}</small></div></div>
                        <p>导出正在查看的这一条会话。默认使用通用 Markdown 格式。</p>
                        <div className="backup-card-actions">
                          <button className="primary-setting" disabled={backupBusy !== "" || !thread} onClick={() => { if (thread) void exportThreadsMarkdown([thread.id]); }}>{backupBusy === "export-md" ? <Spinner /> : <FileText size={14} />}导出 Markdown</button>
                          <button className="secondary-setting" disabled={backupBusy !== "" || !thread} onClick={() => { if (thread) void exportThreadsBackup([thread.id]); }}><Archive size={14} />完整 JSON</button>
                        </div>
                      </article>
                      <article className="backup-card">
                        <div className="backup-card-head"><span><MessageSquare size={16} /></span><div><strong>全部会话</strong><small>{threads.length} 条未归档会话</small></div></div>
                        <p>一次导出当前列表里的全部会话，适合存档或迁移到另一台电脑。</p>
                        <div className="backup-card-actions">
                          <button className="primary-setting" disabled={backupBusy !== "" || !threads.length} onClick={() => void exportThreadsMarkdown()}>{backupBusy === "export-md" ? <Spinner /> : <FileText size={14} />}导出 Markdown</button>
                          <button className="secondary-setting" disabled={backupBusy !== "" || !threads.length} onClick={() => void exportThreadsBackup()}>{backupBusy === "export" ? <Spinner /> : <Archive size={14} />}完整 JSON</button>
                        </div>
                      </article>
                      <article className="backup-card backup-card--picker">
                        <div className="backup-card-head"><span><ListChecks size={16} /></span><div><strong>选择会话导出</strong><small>已选 {picked.length} / {threads.length} 条</small></div></div>
                        <div className="backup-picker-toolbar">
                          <input className="backup-picker-search" placeholder="搜索会话（名称 / 内容 / 项目）" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} />
                          <button className="secondary-setting" disabled={!visibleThreads.length} onClick={() => setPicked(allVisiblePicked ? picked.filter((id) => !visibleThreads.some((t: any) => t.id === id)) : [...new Set([...picked, ...visibleThreads.map((t: any) => t.id)])])}>{allVisiblePicked ? "取消全选" : "全选（当前可见）"}</button>
                          <button className="secondary-setting" disabled={!picked.length} onClick={() => setPicked([])}>清空</button>
                        </div>
                        <div className="backup-picker-list">
                          {visibleThreads.length ? visibleThreads.map((t: any) => (
                            <label key={t.id} className={`backup-picker-row ${picked.includes(t.id) ? "is-picked" : ""}`}>
                              <input type="checkbox" checked={picked.includes(t.id)} onChange={() => togglePicked(t.id)} />
                              <span className="backup-picker-title">{cleanThreadDisplayTitle(t.name, { preview: t.preview })}</span>
                              <span className="backup-picker-meta">{t.cwd ? t.cwd.split(/[\\/]/).pop() : ""} · {new Date(Number(t.updatedAt) || 0).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                            </label>
                          )) : <div className="backup-picker-empty">没有匹配的会话</div>}
                        </div>
                        <div className="backup-card-actions">
                          <button className="primary-setting" disabled={backupBusy !== "" || !picked.length} onClick={() => void exportThreadsMarkdown(picked)}>{backupBusy === "export-md" ? <Spinner /> : <FileText size={14} />}导出 Markdown（{picked.length}）</button>
                          <button className="secondary-setting" disabled={backupBusy !== "" || !picked.length} onClick={() => void exportThreadsBackup(picked)}>{backupBusy === "export" ? <Spinner /> : <Archive size={14} />}完整 JSON（{picked.length}）</button>
                        </div>
                      </article>
                      <article className="backup-card">
                        <div className="backup-card-head"><span><Upload size={16} /></span><div><strong>导入与恢复</strong><small>不会覆盖同 ID 的已有会话</small></div></div>
                        <p>JSON 恢复完整记录；Markdown 会创建一条可继续提问的新会话。</p>
                        <div className="backup-card-actions">
                          <button className="secondary-setting" disabled={backupBusy !== ""} onClick={() => void importThreadsBackup()}>{backupBusy === "import" ? <Spinner /> : <Upload size={14} />}导入 JSON</button>
                          <button className="secondary-setting" disabled={backupBusy !== ""} onClick={() => void importConversationMarkdown()}>{backupBusy === "import-md" ? <Spinner /> : <FileUp size={14} />}导入 Markdown</button>
                        </div>
                      </article>
                    </div>
                    <div className="backup-footnote"><Info size={14} /><span><strong>JSON</strong> 保留工具调用和引擎原始记录；<strong>Markdown</strong> 自动移除系统注入，适合阅读、分享和带入其他 AI。</span></div>
                  </section>
    </>
  );
}
