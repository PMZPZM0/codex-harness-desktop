/**
 * 设置页 · schedule（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { emptyScheduleDraft } from "../../hooks/useScheduler";
import { Clock3, Info, ListFilter, MessageSquare, PenLine, Play, Plus, Trash2 } from "lucide-react";
import { basename } from "../../lib/basename";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type ScheduleSettingsSectionProps = { setScheduleDraft: any; workspace: any; setAutoFormVisible: any; scheduledTasks: any; toggleSchedule: any; describeSchedule: any; runSchedule: any; editSchedule: any; deleteSchedule: any; keepAwake: any; setKeepAwake: any; idleTemplates: any; cronTemplates: any; setScheduledTasks: any; setNotice: any };

export function ScheduleSettingsSection(props: ScheduleSettingsSectionProps) {
  const { setScheduleDraft, workspace, setAutoFormVisible, scheduledTasks, toggleSchedule, describeSchedule, runSchedule, editSchedule, deleteSchedule, keepAwake, setKeepAwake, idleTemplates, cronTemplates, setScheduledTasks, setNotice } = props;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-copy channel-heading"><div><h2>自动化</h2><p>创建定时任务，或排队在闲时算力空闲时后台执行。</p></div><button className="primary-setting" onClick={() => { setScheduleDraft({ ...emptyScheduleDraft(workspace || ""), name: "", prompt: "" }); setAutoFormVisible(true); }}><Plus size={14} />新增定时任务</button></div>
                    <div className="auto-card">
                      {scheduledTasks.length === 0 ? (
                        <div className="auto-empty">
                          <p className="muted">还没有定时任务</p>
                          <div className="auto-empty-actions"><button className="primary-setting" onClick={() => setAutoFormVisible(true)}><Plus size={14} />添加任务</button></div>
                        </div>
                      ) : (
                        <div className="auto-cards">
                          {scheduledTasks.map((task: any) => (
                            <div className={`auto-card-item ${task.enabled ? "" : "disabled"}`} key={task.id}>
                              <div className="auto-card-head">
                                <strong title={task.name}>{task.name}</strong>
                                <span className="auto-card-tag">{task.kind === "once" || task.scheduleType === "once" ? "一次性任务" : (task.kind === "interval" || task.kind === undefined && !task.rrule ? "循环任务" : "周期任务")}</span>
                                {/* ⛔ 拨动必须有回执（10-06 用户：「很多开发都没有通知提醒」）：
                                    失败也不许静默 —— 状态行长在对话区的任务面板上，人在设置页看不见。 */}
                                <ToggleSwitch checked={task.enabled} title={task.enabled ? "停用" : "启用"} onChange={() => void toggleSchedule(task).then((result: any) => setNotice(result?.ok
                                  ? `定时任务「${result.task.name}」已${result.task.enabled ? "启用" : "停用"}`
                                  : `定时任务「${task.name}」切换失败：${result?.error ?? "未知错误"}`))} />
                              </div>
                              <p className="auto-card-desc" title={task.prompt}>{task.prompt}</p>
                              <div className="auto-card-meta"><Clock3 size={13} /><span>运行计划</span><b>{describeSchedule(task)}</b></div>
                              <div className="auto-card-meta"><MessageSquare size={13} /><span>{basename(task.workspace)}</span></div>
                              <div className="auto-card-foot">
                                <span className="auto-card-next">下次 {new Date(task.nextRunAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                <div className="auto-card-actions">
                                  <button className="icon-button" title="立即运行" disabled={!task.enabled} onClick={() => void runSchedule(task.id)}><Play size={13} /></button>
                                  <button className="icon-button" title="编辑" onClick={() => editSchedule(task.id)}><PenLine size={13} /></button>
                                  <button className="icon-button" title="删除" onClick={() => void deleteSchedule(task.id)}><Trash2 size={13} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="auto-awake"><Info size={14} /><span>Codex 运行会话时保持电脑唤醒。</span><input type="checkbox" checked={keepAwake} onChange={(event) => { const on = event.target.checked; setKeepAwake(on); localStorage.setItem("keep-awake", String(on)); /* ⛔ 勾选也要回执（10-06 用户：开关没反馈）；失败更要说 —— 主进程没开成功时电脑照样会睡。 */ void window.codex.setAwake(on).then(() => setNotice(on ? "已开启：会话运行期间保持电脑唤醒" : "已关闭：不再阻止电脑休眠")).catch((error: any) => setNotice(`保持唤醒设置失败：${error?.message ?? error}`)); }} /></div>
                    <div className="auto-templates"><h3>闲时任务模板</h3><div className="template-grid">
                      {idleTemplates.map((tpl: any) => <button className="template-card" key={tpl.name} onClick={() => { setAutoFormVisible(true); setScheduleDraft({ ...emptyScheduleDraft(workspace || ""), name: tpl.name, prompt: tpl.prompt, effort: "high" }); }}><strong><ListFilter size={13} />{tpl.name}</strong><p>{tpl.desc}</p><small>最早可用时段</small></button>)}
                    </div></div>
                    <div className="auto-templates"><h3>定时任务模板</h3><div className="template-grid">
                      {cronTemplates.map((tpl: any) => <button className="template-card" key={tpl.name} onClick={() => { void window.codex.saveScheduledTask({ name: tpl.name, prompt: tpl.desc, workspace: workspace || "", intervalMinutes: tpl.intervalMinutes, enabled: true, kind: tpl.intervalMinutes === 1440 ? "daily" : "weekly", timeOfDay: tpl.intervalMinutes === 1440 ? "09:00" : "16:00", weekdays: tpl.intervalMinutes === 1440 ? undefined : [5] }).then((saved: any) => { setScheduledTasks((current: any) => [saved, ...current.filter((entry: any) => entry.id !== saved.id)]); setNotice("定时任务已创建：" + tpl.name); }).catch((error: any) => setNotice("创建失败：" + error.message)); }}><strong>{tpl.icon}{tpl.name}</strong><p>{tpl.desc}</p><small>{tpl.time}</small></button>)}
                    </div></div>

                  </section>
    </>
  );
}
