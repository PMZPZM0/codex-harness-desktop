/**
 * 设置页 · expert-center（09-21 从 App.tsx 内联块搬出）。
 *
 * 10-31 用户令：「小卡片+预览模式就行，外面一张就简洁展示，身份证或者工作证一样」
 *   ⇒ 一级 = 专家工作证小卡（人物头像 + 名字 + 职业），按领域分组；点开 = 预览弹窗
 *     （大图 + 完整介绍 + 所属团队 + 「打开对话」）。⛔ 不再在列表卡里塞两行小字。
 */
import { useState } from "react";
import { ArrowLeft, MessageSquare, Package, Users, X } from "lucide-react";
import { AgentAvatar } from "../../components/AgentAvatar";
import { AgentBadge } from "../../components/AgentBadge";
import { SettingsDialog } from "../../components/SettingsDialog";
import { Spinner } from "../../components/CardShell";

export type ExpertCenterSectionProps = { expertTeams: any; EXPERT_CATEGORY_DEFS: any; expertTeamMemberDirect: any; startMemberDirectSession: any; onOpenMarket?: () => void; onBack?: () => void };

export function ExpertCenterSection(props: ExpertCenterSectionProps) {
  const { expertTeams, EXPERT_CATEGORY_DEFS, expertTeamMemberDirect, startMemberDirectSession, onOpenMarket, onBack } = props;
  const [previewKey, setPreviewKey] = useState("");
  // 专家中心：全部专家按领域分类陈列，点卡先看预览，再从预览进单人会话；
  // 内置团队按 EXPERT_CATEGORY_DEFS 归类，自定义团队落「更多专家」。
  const expertCards = expertTeams.flatMap((team: any) => [team.lead, ...team.members].map((member) => ({ team, member, isLead: member.id === team.lead.id })));
  const groups = EXPERT_CATEGORY_DEFS.map(({ title, blurb, icon, teamIds }: any) => ({ title, blurb, icon, cards: expertCards.filter((c: any) => teamIds.includes(c.team.teamId)) })).filter((g: any) => g.cards.length);
  const known = new Set(EXPERT_CATEGORY_DEFS.flatMap((d: any) => d.teamIds));
  const rest = expertCards.filter((c: any) => !known.has(c.team.teamId));
  if (rest.length) groups.push({ title: "更多专家", blurb: "自定义团队与外部导入的专家", icon: Users, cards: rest });
  const preview = expertCards.find((c: any) => `${c.team.teamId}:${c.member.id}` === previewKey) ?? null;
  return (
  <section className="settings-section stack expert-center-page">
    <div className="settings-toolbar-row expert-center-head">
      {onBack && <button type="button" className="settings-back-row" onClick={onBack}><ArrowLeft size={14} />返回智能体团队</button>}
      <div className="settings-heading-actions">{onOpenMarket && <button className="secondary-setting" title="SkillHub 专家市场包：一键安装整套专家工作流，装完自动出现在这里" onClick={onOpenMarket}><Package size={14} />专家市场</button>}</div>
    </div>
    {groups.map((g: any) => (
      <div className="expert-category" key={g.title}>
        <div className="expert-category-head">
          <span className="expert-category-icon"><g.icon size={15} /></span>
          <strong>{g.title}</strong>
          <small>{g.blurb}</small>
          <em>{g.cards.length} 位</em>
        </div>
        <div className="agent-badge-grid">
          {g.cards.map(({ team, member, isLead }: any) => (
            <AgentBadge
              key={team.teamId + ":" + member.id}
              kind="expert"
              seed={member.id || member.name}
              name={member.name}
              tag={isLead ? "主理人" : undefined}
              line={member.profession.zh || team.displayName.zh}
              lead={isLead}
              disabled={expertTeamMemberDirect === `${team.teamId}:${member.id}`}
              onClick={() => setPreviewKey(`${team.teamId}:${member.id}`)}
            />
          ))}
        </div>
      </div>
    ))}
    {!expertCards.length && <p className="muted">还没有专家——先在「专家团」里创建。</p>}

    {preview && (
      <SettingsDialog
        title={preview.member.name}
        size="sm"
        icon={<AgentAvatar kind="expert" seed={preview.member.id || preview.member.name} size={24} lead={preview.isLead} />}
        hint={preview.member.profession.zh || preview.team.displayName.zh}
        onClose={() => setPreviewKey("")}
      >
        <div className="agent-preview">
          <div className="agent-preview-hero">
            <AgentAvatar kind="expert" seed={preview.member.id || preview.member.name} size={72} lead={preview.isLead} />
            <div>
              <strong>{preview.member.name}{preview.isLead && <i className="expert-lead-badge">主理人</i>}</strong>
              <p>{preview.member.description || preview.member.profession.zh || "这位专家还没有写介绍。"}</p>
            </div>
          </div>
          <div className="agent-preview-section">
            <span className="agent-preview-label">所属团队</span>
            <div className="agent-preview-meta">
              <span><Users size={11} />{preview.team.displayName.zh}</span>
              <span>{preview.isLead ? "主理人" : "成员"}</span>
              <span>{preview.team.members.length + 1} 人</span>
            </div>
          </div>
          <div className="agent-preview-actions">
            <button className="secondary-setting" onClick={() => setPreviewKey("")}><X size={12} />关闭</button>
            <button
              className="primary-setting"
              disabled={expertTeamMemberDirect === `${preview.team.teamId}:${preview.member.id}`}
              onClick={() => { void startMemberDirectSession(preview.team, preview.member); setPreviewKey(""); }}
            >
              {expertTeamMemberDirect === `${preview.team.teamId}:${preview.member.id}` ? <Spinner /> : <MessageSquare size={12} />}打开对话
            </button>
          </div>
        </div>
      </SettingsDialog>
    )}
  </section>
  );
}
