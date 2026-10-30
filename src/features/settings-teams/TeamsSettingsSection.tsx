/**
 * 设置页 · teams（09-21 从 App.tsx 内联块搬出）。
 *
 * 10-31 用户令：「小卡片+预览模式就行，外面一张就简洁展示，身份证或者工作证一样」
 *   ⇒ 一级 = 专家团工作证小卡（团队合影头像 + 名称 + 一行介绍），点开 = 预览弹窗：
 *     成员 chips / SOP / 工作目录 / 快捷指令 / 发起会话 / 编辑 / 删除 / 启停。
 *     ⛔ 这些细节不再铺在列表卡上（上一版一张卡能占到半屏）。
 */
import { useState } from "react";
import { Briefcase, FolderOpen, MessageSquarePlus, PenLine, Plus, RefreshCw, Rocket, RotateCcw, Trash2, Users, Workflow, X, ArrowLeft } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { AgentAvatar } from "../../components/AgentAvatar";
import { AgentBadge } from "../../components/AgentBadge";
import { SettingsDialog } from "../../components/SettingsDialog";
import { expertRoleLabel } from "../../lib/expert-role-label";
import { ExpertTeamEditorModal } from "../../features/experts-teams";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

export type TeamsSettingsSectionProps = { openNewExpertTeam: any; resetExpertTeams: any; refreshExpertTeams: any; resourceLoading: any; expertTeams: any; toggleExpertTeamEnabled: any; categoryLabel: any; expertTeamMemberRunning: any; expertTeamMemberDirect: any; startMemberDirectSession: any; teamCwdMap: any; workspace: any; chooseTeamCwd: any; clearTeamCwd: any; startTeamSession: any; expertTeamRunning: any; openEditExpertTeam: any; deleteExpertTeam: any; expertTeamEditorOpen: any; expertTeamDraft: any; setExpertTeamDraft: any; setExpertTeamEditorOpen: any; saveExpertTeam: any; setNotice: any; onBack?: () => void };

export function TeamsSettingsSection(props: TeamsSettingsSectionProps) {
  const { openNewExpertTeam, resetExpertTeams, refreshExpertTeams, resourceLoading, expertTeams, toggleExpertTeamEnabled, categoryLabel, expertTeamMemberRunning, expertTeamMemberDirect, startMemberDirectSession, teamCwdMap, workspace, chooseTeamCwd, clearTeamCwd, startTeamSession, expertTeamRunning, openEditExpertTeam, deleteExpertTeam, expertTeamEditorOpen, expertTeamDraft, setExpertTeamDraft, setExpertTeamEditorOpen, saveExpertTeam, setNotice, onBack } = props;
  const [previewId, setPreviewId] = useState("");
  const preview = expertTeams.find((team: any) => team.teamId === previewId) ?? null;
  return (
    <>
      <section className="settings-section stack expert-team-center">
                    <div className="settings-toolbar-row">
                      {onBack && <button type="button" className="settings-back-row teams-back" onClick={onBack}><ArrowLeft size={14} />返回智能体团队</button>}
                      <div className="settings-heading-actions"><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />新建专家团</button><button className="secondary-setting" onClick={() => void resetExpertTeams()}><RotateCcw size={13} />恢复内置</button><button className="icon-button" title="刷新专家团" onClick={() => void refreshWithReceipt(setNotice, "刷新专家团", () => refreshExpertTeams())}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div>
                    </div>

                    <div className="agent-badge-grid">{expertTeams.map((team: any) => (
                      <AgentBadge
                        key={team.teamId}
                        kind="team"
                        seed={team.teamId}
                        name={team.displayName.zh}
                        tag={team.enabled ? undefined : "已停用"}
                        line={`${categoryLabel(team.category)} · ${team.members.length ? `主理人 + ${team.members.length}` : "独立专家"}`}
                        disabled={!team.enabled}
                        onClick={() => setPreviewId(team.teamId)}
                      />
                    ))}{!expertTeams.length && <div className="subagent-empty"><Users size={28} /><strong>还没有专家团</strong><p>点击「新建专家团」创建，或「恢复内置」加载软件开发/交易分析示例团；发起会话后主理人会按 SOP 调度成员协作。</p><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />创建第一个专家团</button></div>}</div>

                    {/* ★ 预览：团队合影 + 介绍 + 成员 + 工作目录 + 快捷指令 + 动作 */}
                    {preview && (
                      <SettingsDialog
                        title={preview.displayName.zh}
                        size="sm"
                        icon={<AgentAvatar kind="team" seed={preview.teamId} size={24} />}
                        hint={`${categoryLabel(preview.category)} · ${preview.members.length ? `主理人 + ${preview.members.length}` : "独立专家"}`}
                        onClose={() => setPreviewId("")}
                      >
                        <div className="agent-preview">
                          <div className="agent-preview-hero">
                            <AgentAvatar kind="team" seed={preview.teamId} size={72} />
                            <div>
                              <strong>{preview.displayName.zh}</strong>
                              <p>{preview.description.zh || "这个专家团还没有写介绍。"}</p>
                            </div>
                          </div>
                          {/* 动作放在介绍下方：预览内容是长列表时也一眼能点到「发起会话」 */}
                          <div className="agent-preview-actions">
                            <button className="secondary-setting agent-preview-danger" onClick={() => { void deleteExpertTeam(preview.teamId); setPreviewId(""); }}><Trash2 size={12} />删除</button>
                            <button className="secondary-setting" onClick={() => { openEditExpertTeam(preview); setPreviewId(""); }}><PenLine size={12} />编辑</button>
                            <button className="primary-setting" disabled={expertTeamRunning === preview.teamId} onClick={() => { void startTeamSession(preview, ""); setPreviewId(""); }}><Rocket size={13} />{expertTeamRunning === preview.teamId ? "创建中…" : "发起会话"}</button>
                          </div>
                          <div className="agent-preview-section">
                            <span className="agent-preview-label">团队</span>
                            <div className="agent-preview-meta">
                              <span title="行业分类"><Briefcase size={11} />{categoryLabel(preview.category)}</span>
                              <span title="成员数"><Users size={11} />主理人 + {preview.members.length} 成员</span>
                              <span title="SOP"><Workflow size={11} />{preview.sop ? "已配置 SOP" : "未配置 SOP"}</span>
                            </div>
                            <div className="expert-team-member-chips" title="点击角色可进入单独会话">
                              {[preview.lead, ...preview.members].map((member: any) => (
                                <button key={member.id} className={`expert-team-member-chip${member.id === preview.lead.id ? " is-lead" : ""}${expertTeamMemberRunning?.teamId === preview.teamId && expertTeamMemberRunning.memberName === member.id ? " is-working" : ""}`}
                                  title={`${expertRoleLabel(member, member.id === preview.lead.id)}${member.description ? `：${member.description}` : ""}`}
                                  disabled={expertTeamMemberDirect === `${preview.teamId}:${member.id}`}
                                  onClick={() => void startMemberDirectSession(preview, member)}>
                                  <AgentAvatar kind="expert" seed={member.id || member.name} size={18} lead={member.id === preview.lead.id} className="expert-team-member-chip-avatar" />
                                  <span className="expert-team-member-chip-name">{expertRoleLabel(member, member.id === preview.lead.id)}</span>
                                  {expertTeamMemberDirect === `${preview.teamId}:${member.id}` ? <Spinner /> : null}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="agent-preview-section">
                            <span className="agent-preview-label">工作目录</span>
                            <div className="expert-team-cwd" title={teamCwdMap[preview.teamId] ?? workspace ?? "未选择项目"}>
                              <FolderOpen size={12} />
                              <span className="expert-team-cwd-path">{teamCwdMap[preview.teamId] ?? workspace ?? "选择项目地址"}</span>
                              <button className="expert-team-cwd-pick" title="选择该项目专家团的工作目录" onClick={() => void chooseTeamCwd(preview.teamId)}><FolderOpen size={11} />{teamCwdMap[preview.teamId] ? "更换" : "选择项目"}</button>
                              {teamCwdMap[preview.teamId] && <button className="icon-button expert-team-cwd-clear" title="清除，回退到全局工作区" onClick={() => clearTeamCwd(preview.teamId)}><X size={11} /></button>}
                            </div>
                          </div>
                          {preview.quickPrompts.length > 0 && (
                            <div className="agent-preview-section">
                              <span className="agent-preview-label">快捷指令</span>
                              <div className="expert-team-quickprompts">{preview.quickPrompts.slice(0, 3).map((prompt: any, index: number) => <button key={index} className="expert-team-quick" title={prompt.zh} onClick={() => void startTeamSession(preview, prompt.zh)}><MessageSquarePlus size={11} />{prompt.zh}</button>)}</div>
                            </div>
                          )}
                          <label className="agent-preview-toggle">
                            <span>{preview.enabled ? "已接入 @ 与调度" : "已停用：不出现在 @ 候选里"}</span>
                            <input type="checkbox" checked={preview.enabled} onChange={() => void toggleExpertTeamEnabled(preview)} />
                          </label>
                        </div>
                      </SettingsDialog>
                    )}

                    {expertTeamEditorOpen && expertTeamDraft && <ExpertTeamEditorModal draft={expertTeamDraft} onChange={setExpertTeamDraft} onClose={() => { setExpertTeamEditorOpen(false); setExpertTeamDraft(null); }} onSave={(draft) => void saveExpertTeam(draft)} />}
                  </section>
    </>
  );
}
