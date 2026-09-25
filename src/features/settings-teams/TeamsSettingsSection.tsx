/**
 * 设置页 · teams（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { PageInfo } from "../../components/SettingsHead";
import { Briefcase, FolderOpen, MessageSquarePlus, PenLine, Plus, RefreshCw, Rocket, RotateCcw, Tag, Trash2, Users, Workflow, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { expertIconOf } from "../../lib/expert-icon-of";
import { expertRoleLabel } from "../../lib/expert-role-label";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";
import { ExpertTeamEditorModal } from "../../features/experts-teams";

export type TeamsSettingsSectionProps = { openNewExpertTeam: any; resetExpertTeams: any; refreshExpertTeams: any; resourceLoading: any; expertTeams: any; toggleExpertTeamEnabled: any; categoryLabel: any; expertTeamMemberRunning: any; expertTeamMemberDirect: any; startMemberDirectSession: any; teamCwdMap: any; workspace: any; chooseTeamCwd: any; clearTeamCwd: any; startTeamSession: any; expertTeamRunning: any; openEditExpertTeam: any; deleteExpertTeam: any; expertTeamEditorOpen: any; expertTeamDraft: any; setExpertTeamDraft: any; setExpertTeamEditorOpen: any; saveExpertTeam: any };

export function TeamsSettingsSection(props: TeamsSettingsSectionProps) {
  const { openNewExpertTeam, resetExpertTeams, refreshExpertTeams, resourceLoading, expertTeams, toggleExpertTeamEnabled, categoryLabel, expertTeamMemberRunning, expertTeamMemberDirect, startMemberDirectSession, teamCwdMap, workspace, chooseTeamCwd, clearTeamCwd, startTeamSession, expertTeamRunning, openEditExpertTeam, deleteExpertTeam, expertTeamEditorOpen, expertTeamDraft, setExpertTeamDraft, setExpertTeamEditorOpen, saveExpertTeam } = props;
  return (
    <>
      <section className="settings-section stack expert-team-center">
                    <div className="settings-copy channel-heading"><div><h2>专家团<PageInfo text={<>复刻 WorkBuddy 团队协作：主理人编排，成员按 SOP 分阶段独立产出，最终汇总交付。</>} helpKey="agentteam" label="专家团" /></h2></div><div className="settings-heading-actions"><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />新建专家团</button><button className="secondary-setting" onClick={() => void resetExpertTeams()}><RotateCcw size={13} />恢复内置</button><button className="icon-button" title="刷新专家团" onClick={() => void refreshExpertTeams()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

                    <div className="subagent-banner"><Users size={16} /><div><strong>让 Codex 真正会带团队协作</strong><p>发起会话后，主理人（lead）会在独立会话中通过 <code>team_member_invoke(memberId, query)</code> 按 SOP 调度成员，成员独立产出后回传，主理人最终汇总交付。</p></div></div>

                    <div className="expert-team-grid-list">{expertTeams.map((team: any) => <article className={`subagent-card ${team.enabled ? "enabled" : "disabled"}`} key={team.teamId}>
                      <div className="subagent-card-head"><span className="subagent-avatar expert-team-avatar"><Users size={16} /></span><label className="channel-enable" title={team.enabled ? "停用" : "启用"}><input type="checkbox" checked={team.enabled} onChange={() => void toggleExpertTeamEnabled(team)} /><span>{team.enabled ? "已启用" : "已停用"}</span></label></div>
                      <strong className="subagent-name">{team.profession.zh || team.displayName.zh}</strong>
                      <p className="subagent-desc">{team.description.zh || "暂无描述"}</p>
                      <div className="subagent-meta">
                        <span title="行业分类"><Briefcase size={11} />{categoryLabel(team.category)}</span>
                        <span title="成员数"><Users size={11} />主理人 + {team.members.length} 成员</span>
                        {team.tags.slice(0, 3).map((tag: any, index: any) => <span className="expert-team-tag" key={index} title="标签"><Tag size={11} />{tag.zh}</span>)}
                      </div>
                      <div className="subagent-meta"><span title="SOP"><Workflow size={11} />{team.sop ? "已配置 SOP" : "未配置 SOP"}</span></div>
                      <div className="expert-team-member-chips" title="点击角色可进入单独会话">
                        {[team.lead, ...team.members].map((member) => {
                          const ChipIcon = expertIconOf(member);
                          return (
                          <button key={member.id} className={`expert-team-member-chip${member.id === team.lead.id ? " is-lead" : ""}${expertTeamMemberRunning?.teamId === team.teamId && expertTeamMemberRunning.memberName === member.id ? " is-working" : ""}`}
                            title={`${expertRoleLabel(member, member.id === team.lead.id)}${member.description ? `：${member.description}` : ""}`}
                            disabled={expertTeamMemberDirect === `${team.teamId}:${member.id}`}
                            onClick={() => void startMemberDirectSession(team, member)}>
                            <span className="expert-team-member-chip-avatar" aria-hidden="true" style={member.id === team.lead.id ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}><ChipIcon size={12} /></span>
                            <span className="expert-team-member-chip-name">{expertRoleLabel(member, member.id === team.lead.id)}</span>
                            {expertTeamMemberDirect === `${team.teamId}:${member.id}` ? <Spinner /> : null}
                            {expertTeamMemberRunning?.teamId === team.teamId && expertTeamMemberRunning.memberName === member.id ? <span className="expert-member-working-dot" title="该成员正在执行子任务" /> : null}
                          </button>
                          );
                        })}
                      </div>
                      <div className="expert-team-cwd" title={teamCwdMap[team.teamId] ?? workspace ?? "未选择项目"}>
                        <FolderOpen size={12} />
                        <span className="expert-team-cwd-path">{teamCwdMap[team.teamId] ?? workspace ?? "选择项目地址"}</span>
                        <button className="expert-team-cwd-pick" title="选择该项目专家团的工作目录" onClick={() => void chooseTeamCwd(team.teamId)}><FolderOpen size={11} />{teamCwdMap[team.teamId] ? "更换" : "选择项目"}</button>
                        {teamCwdMap[team.teamId] && <button className="icon-button expert-team-cwd-clear" title="清除，回退到全局工作区" onClick={() => clearTeamCwd(team.teamId)}><X size={11} /></button>}
                      </div>
                      <div className="expert-team-quickprompts">{team.quickPrompts.slice(0, 3).map((prompt: any, index: any) => <button key={index} className="expert-team-quick" title={prompt.zh} onClick={() => void startTeamSession(team, prompt.zh)}><MessageSquarePlus size={11} />{prompt.zh}</button>)}</div>
                      <div className="subagent-card-actions">
                        <button className="primary-setting" disabled={expertTeamRunning === team.teamId} onClick={() => void startTeamSession(team, "")}><Rocket size={13} />{expertTeamRunning === team.teamId ? "创建中…" : "发起会话"}</button>
                        <button className="secondary-setting" onClick={() => openEditExpertTeam(team)}><PenLine size={12} />编辑</button>
                        <button className="icon-button" title="删除" onClick={() => void deleteExpertTeam(team.teamId)}><Trash2 size={13} /></button>
                      </div>
                    </article>)}{!expertTeams.length && <div className="subagent-empty"><Users size={28} /><strong>还没有专家团</strong><p>点击「新建专家团」创建，或「恢复内置」加载软件开发/交易分析示例团；发起会话后主理人会按 SOP 调度成员协作。</p><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />创建第一个专家团</button></div>}</div>

                    {expertTeamEditorOpen && expertTeamDraft && <ExpertTeamEditorModal draft={expertTeamDraft} onChange={setExpertTeamDraft} onClose={() => { setExpertTeamEditorOpen(false); setExpertTeamDraft(null); }} onSave={(draft) => void saveExpertTeam(draft)} />}
                  </section>
    </>
  );
}
