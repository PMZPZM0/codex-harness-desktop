/**
 * 设置页 · backup（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Archive, FileText, FileUp, Info, MessageSquare, Upload } from "lucide-react";
import { cleanThreadDisplayTitle } from "../../lib/user-refs";
import { Spinner } from "../../components/CardShell";

export type BackupSettingsSectionProps = { thread: any; backupBusy: any; exportThreadsMarkdown: any; exportThreadsBackup: any; threads: any; importThreadsBackup: any; importConversationMarkdown: any };

export function BackupSettingsSection(props: BackupSettingsSectionProps) {
  const { thread, backupBusy, exportThreadsMarkdown, exportThreadsBackup, threads, importThreadsBackup, importConversationMarkdown } = props;
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
