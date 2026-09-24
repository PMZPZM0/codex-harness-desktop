/**
 * 设置页 · rpa（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Bot, Play, Trash2 } from "lucide-react";
import { basename } from "../../lib/basename";

export type RpaSettingsSectionProps = { rpaRecipes: any; rpaRunning: any; thread: any; setNotice: any; setRpaRunning: any; selectedModel: any; modelName: any; modelId: any; sandboxPolicy: any; sandbox: any; workspace: any; openAppConfirm: any; setRpaRecipes: any; taskList: any; setTaskList: any };

export function RpaSettingsSection(props: RpaSettingsSectionProps) {
  const { rpaRecipes, rpaRunning, thread, setNotice, setRpaRunning, selectedModel, modelName, modelId, sandboxPolicy, sandbox, workspace, openAppConfirm, setRpaRecipes, taskList, setTaskList } = props;
  return (
    <>
      <section className="settings-section stack">
                    <div className="settings-copy channel-heading"><div><h2>RPA 自动化<PageInfo text={<>Codex 引擎自主跑通一条流程后，会自动把步骤沉淀为配方；下次让 Codex 直接复现即可。</>} /></h2></div></div>
                    <div className="auto-card">
                      {rpaRecipes.length === 0 ? (
                        <div className="auto-empty"><p className="muted">还没有 RPA 配方。让 Codex 自主跑通一条流程后，它会自动把步骤沉淀成配方，无需手动创建。</p></div>
                      ) : (
                        <div className="auto-cards">
                          {rpaRecipes.map((recipe: any) => (
                            <div className="auto-card-item" key={recipe.id}>
                              <div className="auto-card-head">
                                <strong title={recipe.name}>{recipe.name}</strong>
                                <span className="auto-card-tag">{recipe.kind === "browser" ? "浏览器" : recipe.kind === "desktop" ? "桌面" : "混合"}</span>
                                {rpaRunning === recipe.id && <span className="subagent-badge"><Bot size={11} />执行中</span>}
                                {recipe.lastStatus === "ok" && <span className="rpa-status ok">上次成功</span>}
                                {recipe.lastStatus === "fail" && <span className="rpa-status fail" title={recipe.lastError ?? ""}>上次失败</span>}
                              </div>
                              {recipe.desc && <p className="auto-card-desc" title={recipe.desc}>{recipe.desc}</p>}
                              {recipe.steps?.length > 0 && <ol className="rpa-steps">{recipe.steps.map((step: string, index: number) => <li key={index}>{step}</li>)}</ol>}
                              <div className="auto-card-foot">
                                <span className="auto-card-next">{recipe.workspace ? basename(recipe.workspace) : "全局"} · 已存 {recipe.runCount ?? 0} 次运行</span>
                                <div className="auto-card-actions">
                                  <button className="icon-button" title="在当前会话执行" disabled={rpaRunning !== null} onClick={() => { if (!thread) { setNotice("请先打开或新建一个会话再执行配方"); return; } setRpaRunning(recipe.id); void window.codex.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: `请执行 RPA 配方「${recipe.name}」：\n${recipe.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`, text_elements: [] }], model: selectedModel?.model ?? modelName(modelId), sandboxPolicy: sandboxPolicy(sandbox, thread.cwd ?? workspace ?? "") }).catch((error: any) => setNotice("执行失败：" + error.message)).finally(() => setRpaRunning(null)); }}><Play size={13} /></button>
                                  <button className="icon-button danger" title="删除" onClick={async () => { if (!(await openAppConfirm("删除配方", `配方「${recipe.name}」将被删除，此操作无法撤销。`, "删除"))) return; void window.codex.deleteRpaRecipe(recipe.id).then(() => setRpaRecipes((current: any) => current.filter((entry: any) => entry.id !== recipe.id))).catch((error: any) => setNotice("删除失败：" + error.message)); }}><Trash2 size={13} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="auto-templates"><h3>任务清单 <span className="muted" style={{ fontWeight: 400 }}>（Codex 通过 task_add / task_update 自主维护）</span></h3>
                      <div className="rpa-task-panel">
                        <ul className="rpa-task-list">
                          {taskList.length === 0 && <li className="muted">清单为空。让 Codex 跑通流程时自主安排待办，无需手动添加。</li>}
                          {taskList.map((task: any) => (
                            <li key={task.id} className={task.status}>
                              <label className="auto-switch" title={task.status === "done" ? "标记待办" : "标记完成"}><input type="checkbox" checked={task.status === "done"} onChange={() => { const next = task.status === "done" ? "todo" : "done"; void window.codex.updateTask({ id: task.id, patch: { status: next } }).then((updated: any) => setTaskList((current: any) => current.map((entry: any) => entry.id === updated.id ? updated : entry))).catch(() => undefined); }} /><i /></label>
                              <span className="rpa-task-text">{task.text}</span>
                              <span className={`rpa-task-priority ${task.priority}`}>{task.priority === "high" ? "高" : task.priority === "low" ? "低" : "中"}</span>
                              <button className="icon-button" title="删除" onClick={() => { void window.codex.deleteTask(task.id).then(() => setTaskList((current: any) => current.filter((entry: any) => entry.id !== task.id))).catch(() => undefined); }}><Trash2 size={13} /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
    </>
  );
}
