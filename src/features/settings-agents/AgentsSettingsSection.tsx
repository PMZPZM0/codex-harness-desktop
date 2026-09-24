/**
 * 设置页 · agents（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Bot, Check, Code2, PenLine, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { effortLabels } from "../../lib/effort-labels";
import { SubAgentEditorModal } from "../../features/experts-teams";

export type AgentsSettingsSectionProps = { openNewSubAgent: any; refreshSubAgents: any; resourceLoading: any; subAgents: any; toggleSubAgentEnabled: any; openEditSubAgent: any; deleteSubAgent: any; subAgentEditorOpen: any; subAgentDraft: any; setSubAgentDraft: any; setSubAgentEditorOpen: any; saveSubAgent: any };

export function AgentsSettingsSection(props: AgentsSettingsSectionProps) {
  const { openNewSubAgent, refreshSubAgents, resourceLoading, subAgents, toggleSubAgentEnabled, openEditSubAgent, deleteSubAgent, subAgentEditorOpen, subAgentDraft, setSubAgentDraft, setSubAgentEditorOpen, saveSubAgent } = props;
  return (
    <>
      <section className="settings-section stack subagent-center">
                    <div className="settings-copy channel-heading"><div><h2>子智能体<PageInfo text={<>用户自定义角色；Codex 可以通过 <code>subagent_invoke</code> 真正调用它们完成子任务。</>} /></h2></div><div className="settings-heading-actions"><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />新建子智能体</button><button className="icon-button" title="刷新子智能体" onClick={() => void refreshSubAgents()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

                    <div className="subagent-banner"><Sparkles size={16} /><div><strong>让 Codex 真正会叫子智能体干活</strong><p>每个子智能体保存后，会被注册为 <code>subagent_invoke(name, query)</code> 函数；Codex 在主对话中可以直接调用，返回结构化结果。</p></div></div>

                    <div className="subagent-grid">{subAgents.map((agent: any) => <article className={`subagent-card ${agent.enabled ? "enabled" : "disabled"}`} key={agent.id}>
                      <div className="subagent-card-head"><span className="subagent-avatar"><Bot size={16} /></span><label className="channel-enable" title={agent.enabled ? "停用" : "启用"}><input type="checkbox" checked={agent.enabled} onChange={() => void toggleSubAgentEnabled(agent)} /><span>{agent.enabled ? "已启用" : "已停用"}</span></label></div>
                      <strong className="subagent-name">{agent.name}</strong>
                      <p className="subagent-desc">{agent.description || "暂无描述"}</p>
                      <div className="subagent-meta">
                        <span title="推理强度"><Sparkles size={11} />{effortLabels[agent.effort] ?? agent.effort}</span>
                        <span title="模型"><Code2 size={11} />{agent.inheritModel ? "跟随主对话" : (agent.model || "未指定")}</span>
                        <span title="沙箱"><ShieldCheck size={11} />{agent.inheritSandbox ? "跟随主对话" : (agent.sandbox ?? "未指定")}</span>
                      </div>
                      <div className="subagent-meta">
                        <span title="审批策略"><Check size={11} />{agent.inheritApproval ? "跟随主对话" : (agent.approvalPolicy ?? "未指定")}</span>
                        <span title="工具名"><Bot size={11} />subagent_invoke</span>
                      </div>
                      <div className="subagent-card-actions"><button className="secondary-setting" onClick={() => openEditSubAgent(agent)}><PenLine size={12} />编辑</button><button className="icon-button" title="删除" onClick={() => void deleteSubAgent(agent.id)}><Trash2 size={13} /></button></div>
                    </article>)}{!subAgents.length && <div className="subagent-empty"><Bot size={28} /><strong>还没有子智能体</strong><p>点击「新建子智能体」即可创建；它会跟随当前会话配置（模型、推理强度、沙箱、审批），并被 Codex 通过 dynamicTools 调用。</p><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />创建第一个子智能体</button></div>}</div>

                    {subAgentEditorOpen && subAgentDraft && <SubAgentEditorModal draft={subAgentDraft} onChange={setSubAgentDraft} onClose={() => { setSubAgentEditorOpen(false); setSubAgentDraft(null); }} onSave={(draft) => void saveSubAgent(draft)} />}
                  </section>
    </>
  );
}
