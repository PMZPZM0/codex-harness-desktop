/**
 * 设置页 · expert-center（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX / 体内语句与原块逐字一致（仅去掉外层缩进与 IIFE 包装）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { ArrowRight, Users } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { expertIconOf } from "../../lib/expert-icon-of";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";
import { Spinner } from "../../components/CardShell";

export type ExpertCenterSectionProps = { expertTeams: any; EXPERT_CATEGORY_DEFS: any; expertTeamMemberDirect: any; startMemberDirectSession: any };

export function ExpertCenterSection(props: ExpertCenterSectionProps) {
  const { expertTeams, EXPERT_CATEGORY_DEFS, expertTeamMemberDirect, startMemberDirectSession } = props;
  // 专家中心：全部专家按领域分类陈列，点卡直达单人会话；
  // 内置团队按 EXPERT_CATEGORY_DEFS 归类，自定义团队落「更多专家」。
  const expertCards = expertTeams.flatMap((team: any) => [team.lead, ...team.members].map((member) => ({ team, member, isLead: member.id === team.lead.id })));
  const groups = EXPERT_CATEGORY_DEFS.map(({ title, blurb, icon, teamIds }: any) => ({ title, blurb, icon, cards: expertCards.filter((c: any) => teamIds.includes(c.team.teamId)) })).filter((g: any) => g.cards.length);
  const known = new Set(EXPERT_CATEGORY_DEFS.flatMap((d: any) => d.teamIds));
  const rest = expertCards.filter((c: any) => !known.has(c.team.teamId));
  if (rest.length) groups.push({ title: "更多专家", blurb: "自定义团队与外部导入的专家", icon: Users, cards: rest });
  return (
  <section className="settings-section stack expert-center-page">
    <div className="settings-copy"><h2>专家中心<PageInfo text={<>按领域分类的全部专家——点击任意专家卡片，直接进入与 TA 的一对一会话。</>} helpKey="agentteam" label="专家中心" /></h2></div>
    {groups.map((g: any) => (
      <div className="expert-category" key={g.title}>
        <div className="expert-category-head">
          <span className="expert-category-icon"><g.icon size={15} /></span>
          <strong>{g.title}</strong>
          <small>{g.blurb}</small>
          <em>{g.cards.length} 位</em>
        </div>
        <div className="expert-center-grid">
          {g.cards.map(({ team, member, isLead }: any) => {
            const Icon = expertIconOf(member);
            return (
            <button key={team.teamId + ":" + member.id} className={`expert-center-card${expertTeamMemberDirect === `${team.teamId}:${member.id}` ? " is-working" : ""}`}
              title={member.description || member.profession.zh}
              disabled={expertTeamMemberDirect === `${team.teamId}:${member.id}`}
              onClick={() => void startMemberDirectSession(team, member)}>
              <span className="expert-center-avatar" style={isLead ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}><Icon size={17} /></span>
              <span className="expert-center-main">
                <strong>{member.name}{isLead && <i className="expert-lead-badge">主理人</i>}</strong>
                <small>{member.profession.zh}</small>
                <em>{member.description || team.displayName.zh}</em>
              </span>
              {expertTeamMemberDirect === `${team.teamId}:${member.id}` ? <Spinner /> : <ArrowRight size={14} />}
            </button>
            );
          })}
        </div>
      </div>
    ))}
    {!expertCards.length && <p className="muted">还没有专家——先在「专家团」里创建。</p>}
  </section>
  );
}
