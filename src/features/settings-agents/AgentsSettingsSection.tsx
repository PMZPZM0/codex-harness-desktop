/**
 * 设置页 · agents（09-21 从 App.tsx 内联块搬出）。
 *
 * 10-31 用户令：「小卡片+预览模式就行，外面一张就简洁展示，身份证或者工作证一样」
 *   ⇒ 一级 = 子智能体工作证小卡（头像 + 名字 + 一句话），点开 = 预览弹窗
 *     （完整配置 / 启停 / 编辑 / 删除）。⛔ 元数据矩阵与动作按钮不再铺在列表上。
 *
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { useState } from "react";
import { ArrowLeft, Bot, Check, Code2, PenLine, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { AgentAvatar } from "../../components/AgentAvatar";
import { AgentBadge } from "../../components/AgentBadge";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { effortLabels } from "../../lib/effort-labels";
import { normalizeSubagentEffort } from "../../lib/effort";
import { SUBAGENT_APPROVAL_OPTIONS, SUBAGENT_SANDBOX_OPTIONS, subagentFieldLabel } from "../../lib/subagent-fields";
import { SubAgentEditorModal } from "../../features/experts-teams";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

export type AgentsSettingsSectionProps = { openNewSubAgent: any; refreshSubAgents: any; resourceLoading: any; subAgents: any; toggleSubAgentEnabled: any; openEditSubAgent: any; deleteSubAgent: any; subAgentEditorOpen: any; subAgentDraft: any; setSubAgentDraft: any; setSubAgentEditorOpen: any; saveSubAgent: any; setNotice: any; onBack?: any };

export function AgentsSettingsSection(props: AgentsSettingsSectionProps) {
  const { openNewSubAgent, refreshSubAgents, resourceLoading, subAgents, toggleSubAgentEnabled, openEditSubAgent, deleteSubAgent, subAgentEditorOpen, subAgentDraft, setSubAgentDraft, setSubAgentEditorOpen, saveSubAgent, setNotice, onBack } = props;
  const [previewId, setPreviewId] = useState("");
  const preview = subAgents.find((agent: any) => agent.id === previewId) ?? null;
  return (
    <>
      <section className="settings-section stack subagent-center">
                    {/* 10-27 用户令（三件事）：
                        ① 「这个子智能体，我删除了，又出来了…不要内置子智能体」⇒ 主进程不再种入内置评审
                           （electron/main/09-agents-plugins.ts 的 ensureBuiltinReviewer 已删）；
                        ② 「让 Codex 真正会叫子智能体干活」这张横幅卡删掉；
                        ③ 「返回智能体团队按键，跟新建子智能体放一排，靠左」⇒ 返回键从壳层的独立
                           一行挪进页头操作行，靠左；⛔ 所以 registry 那边这条页不再挂 `back`。 */}
                    <div className="settings-toolbar-row">
                      {onBack && <button className="secondary-setting subagent-back" onClick={() => onBack()}><ArrowLeft size={14} />返回智能体团队</button>}
                      <div className="settings-heading-actions subagent-head-actions"><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />新建子智能体</button><button className="icon-button" title="刷新子智能体" onClick={() => void refreshWithReceipt(setNotice, "刷新子智能体", () => refreshSubAgents())}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div>
                    </div>

                    <div className="agent-badge-grid">{subAgents.map((agent: any) => (
                      <AgentBadge
                        key={agent.id}
                        kind="subagent"
                        seed={agent.id || agent.name}
                        name={agent.name}
                        tag={agent.enabled ? undefined : "已停用"}
                        line={agent.description || "自定义角色 · 无描述"}
                        disabled={!agent.enabled}
                        onClick={() => setPreviewId(agent.id)}
                      />
                    ))}{!subAgents.length && <div className="subagent-empty"><Bot size={28} /><strong>还没有子智能体</strong><p>点击「新建子智能体」即可创建；模型 / 沙箱 / 审批默认跟随当前会话，子智能体默认可用 —— 建好之后 Codex 直接就能派活。</p><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />创建第一个子智能体</button></div>}</div>

                    {/* ★ 预览：工作证点开 = 完整配置 + 动作（10-31 用户令的「预览模式」） */}
                    {preview && (
                      <SettingsDialog
                        title={preview.name}
                        size="sm"
                        icon={<AgentAvatar kind="subagent" seed={preview.id || preview.name} size={24} />}
                        hint={preview.enabled ? "已启用 · 可被 @ 与 agent_invoke 派活" : "已停用"}
                        onClose={() => setPreviewId("")}
                      >
                        <div className="agent-preview">
                          <div className="agent-preview-hero">
                            <AgentAvatar kind="subagent" seed={preview.id || preview.name} size={72} />
                            <div>
                              <strong>{preview.name}</strong>
                              <p>{preview.description || "这个子智能体还没有写描述 —— 派活时模型只能靠名字猜。"}</p>
                            </div>
                          </div>
                          <div className="agent-preview-section">
                            <span className="agent-preview-label">运行配置</span>
                            <div className="agent-preview-meta">
                              <span title="推理强度"><Sparkles size={11} />{effortLabels[normalizeSubagentEffort(preview.effort)] ?? preview.effort}</span>
                              <span title="模型"><Code2 size={11} />{preview.inheritModel ? "跟随主对话" : (preview.model || "未指定")}</span>
                              <span title="沙箱"><ShieldCheck size={11} />{preview.inheritSandbox ? "跟随主对话" : subagentFieldLabel(SUBAGENT_SANDBOX_OPTIONS, preview.sandbox)}</span>
                              <span title="审批策略"><Check size={11} />{preview.inheritApproval ? "跟随主对话" : subagentFieldLabel(SUBAGENT_APPROVAL_OPTIONS, preview.approvalPolicy)}</span>
                              <span title="Codex 调用工具"><Bot size={11} />agent_invoke</span>
                            </div>
                          </div>
                          <label className="agent-preview-toggle">
                            <span>{preview.enabled ? "已接入 @ 与调度" : "已停用：不出现在 @ 候选里"}</span>
                            <input type="checkbox" checked={preview.enabled} onChange={() => void toggleSubAgentEnabled(preview)} />
                          </label>
                          <div className="agent-preview-actions">
                            <button className="secondary-setting agent-preview-danger" onClick={() => { void deleteSubAgent(preview.id); setPreviewId(""); }}><Trash2 size={12} />删除</button>
                            <button className="primary-setting" onClick={() => { openEditSubAgent(preview); setPreviewId(""); }}><PenLine size={12} />编辑</button>
                          </div>
                        </div>
                      </SettingsDialog>
                    )}

                    {subAgentEditorOpen && subAgentDraft && <SubAgentEditorModal draft={subAgentDraft} onChange={setSubAgentDraft} onClose={() => { setSubAgentEditorOpen(false); setSubAgentDraft(null); }} onSave={(draft) => void saveSubAgent(draft)} />}
                  </section>
    </>
  );
}
