/**
 * 设置页 · agents（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { ArrowLeft, Bot, Check, Code2, PenLine, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { effortLabels } from "../../lib/effort-labels";
import { normalizeSubagentEffort } from "../../lib/effort";
import { SUBAGENT_APPROVAL_OPTIONS, SUBAGENT_SANDBOX_OPTIONS, subagentFieldLabel } from "../../lib/subagent-fields";
import { SubAgentEditorModal } from "../../features/experts-teams";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

export type AgentsSettingsSectionProps = { openNewSubAgent: any; refreshSubAgents: any; resourceLoading: any; subAgents: any; toggleSubAgentEnabled: any; openEditSubAgent: any; deleteSubAgent: any; subAgentEditorOpen: any; subAgentDraft: any; setSubAgentDraft: any; setSubAgentEditorOpen: any; saveSubAgent: any; setNotice: any; onBack?: any };

export function AgentsSettingsSection(props: AgentsSettingsSectionProps) {
  const { openNewSubAgent, refreshSubAgents, resourceLoading, subAgents, toggleSubAgentEnabled, openEditSubAgent, deleteSubAgent, subAgentEditorOpen, subAgentDraft, setSubAgentDraft, setSubAgentEditorOpen, saveSubAgent, setNotice, onBack } = props;
  return (
    <>
      <section className="settings-section stack subagent-center">
                    {/* 10-27 用户令（三件事）：
                        ① 「这个子智能体，我删除了，又出来了…不要内置子智能体」⇒ 主进程不再种入内置评审
                           （electron/main/09-agents-plugins.ts 的 ensureBuiltinReviewer 已删）；
                        ② 「让 Codex 真正会叫子智能体干活」这张横幅卡删掉；
                        ③ 「返回智能体团队按键，跟新建子智能体放一排，靠左」⇒ 返回键从壳层的独立
                           一行挪进页头操作行，靠左；⛔ 所以 registry 那边这条页不再挂 `back`。 */}
                    <div className="settings-copy channel-heading"><div><h2>子智能体<PageInfo text={<>用户自定义角色；Codex 通过统一调度工具 <code>agent_invoke</code>（kind=subagent）调用它们完成子任务 —— 需在会话顶栏「调度」面板里勾选「子智能体」。</>} /></h2></div><div className="settings-heading-actions subagent-head-actions">{onBack && <button className="secondary-setting subagent-back" onClick={() => onBack()}><ArrowLeft size={14} />返回智能体团队</button>}<button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />新建子智能体</button><button className="icon-button" title="刷新子智能体" onClick={() => void refreshWithReceipt(setNotice, "刷新子智能体", () => refreshSubAgents())}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

                    <div className="subagent-grid">{subAgents.map((agent: any) => <article className={`subagent-card ${agent.enabled ? "enabled" : "disabled"}`} key={agent.id}>
                      <div className="subagent-card-head"><span className="subagent-avatar"><Bot size={16} /></span><label className="channel-enable" title={agent.enabled ? "停用" : "启用"}><input type="checkbox" checked={agent.enabled} onChange={() => void toggleSubAgentEnabled(agent)} /><span>{agent.enabled ? "已启用" : "已停用"}</span></label></div>
                      <strong className="subagent-name">{agent.name}</strong>
                      <p className="subagent-desc">{agent.description || "暂无描述"}</p>
                      <div className="subagent-meta">
                        <span title="推理强度"><Sparkles size={11} />{effortLabels[normalizeSubagentEffort(agent.effort)] ?? agent.effort}</span>
                        <span title="模型"><Code2 size={11} />{agent.inheritModel ? "跟随主对话" : (agent.model || "未指定")}</span>
                        <span title="沙箱"><ShieldCheck size={11} />{agent.inheritSandbox ? "跟随主对话" : subagentFieldLabel(SUBAGENT_SANDBOX_OPTIONS, agent.sandbox)}</span>
                      </div>
                      <div className="subagent-meta">
                        <span title="审批策略"><Check size={11} />{agent.inheritApproval ? "跟随主对话" : subagentFieldLabel(SUBAGENT_APPROVAL_OPTIONS, agent.approvalPolicy)}</span>
                        <span title="Codex 调用工具"><Bot size={11} />agent_invoke</span>
                      </div>
                      <div className="subagent-card-actions"><button className="secondary-setting" onClick={() => openEditSubAgent(agent)}><PenLine size={12} />编辑</button><button className="icon-button" title="删除" onClick={() => void deleteSubAgent(agent.id)}><Trash2 size={13} /></button></div>
                    </article>)}{!subAgents.length && <div className="subagent-empty"><Bot size={28} /><strong>还没有子智能体</strong><p>点击「新建子智能体」即可创建；模型 / 沙箱 / 审批默认跟随当前会话，也可以在会话顶栏「调度」面板勾选「子智能体」后派活。</p><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />创建第一个子智能体</button></div>}</div>

                    {subAgentEditorOpen && subAgentDraft && <SubAgentEditorModal draft={subAgentDraft} onChange={setSubAgentDraft} onClose={() => { setSubAgentEditorOpen(false); setSubAgentDraft(null); }} onSave={(draft) => void saveSubAgent(draft)} />}
                  </section>
    </>
  );
}
