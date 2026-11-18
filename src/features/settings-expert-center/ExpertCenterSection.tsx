/**
 * 设置页 · expert-center（09-21 从 App.tsx 内联块搬出）。
 *
 * 10-31 用户令：「小卡片+预览模式就行，外面一张就简洁展示，身份证或者工作证一样」
 *   ⇒ 一级 = 专家工作证小卡（人物头像 + 名字 + 职业），按领域分组；点开 = 预览弹窗
 *     （大图 + 完整介绍 + 所属团队 + 「打开对话」）。⛔ 不再在列表卡里塞两行小字。
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageSquare, Package, Users, X } from "lucide-react";
import { AgentAvatar } from "../../components/AgentAvatar";
import { AgentBadge } from "../../components/AgentBadge";
import { SettingsDialog } from "../../components/SettingsDialog";
import { Spinner } from "../../components/CardShell";

export type ExpertCenterSectionProps = { expertTeams: any; EXPERT_CATEGORY_DEFS: any; expertTeamMemberDirect: any; startMemberDirectSession: any; onOpenMarket?: () => void; onBack?: () => void };

/** 专家中心：按类别列专家团与专家，可预览、可直连成员。 */
export function ExpertCenterSection(props: ExpertCenterSectionProps) {
  const { expertTeams, EXPERT_CATEGORY_DEFS, expertTeamMemberDirect, startMemberDirectSession, onOpenMarket, onBack } = props;
  const [previewKey, setPreviewKey] = useState("");
  /* ⛔⛔ 11-18：能力清单必须是**真实状态**（已装/缺），不是文案。
     数据只认两条既有通道：listRuntimes（组件是否已装）+ listLocalSkills（技能是否已装）。
     ⛔ 不新增第二份"专家能力状态"真相源；⛔ 不在这里伪造"已具备"。 */
  const [installedTools, setInstalledTools] = useState<Set<string>>(new Set());
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set());
  const [capsLoaded, setCapsLoaded] = useState(false);
  const [busyCap, setBusyCap] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [rows, skills] = await Promise.all([
          window.codex.listRuntimes().catch(() => []),
          window.codex.listLocalSkills().catch(() => []),
        ]);
        if (!alive) return;
        setInstalledTools(new Set((rows ?? []).filter((r) => r?.installed).map((r) => String(r.id))));
        setInstalledSkills(new Set((skills ?? []).map((k) => String(k?.name ?? k?.folder ?? "")).filter(Boolean)));
      } finally { if (alive) setCapsLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);
  /* 工具 id（update-registry）→ 运行时 id（runtime:list）：只有对得上的才显示"可安装"。 */
  const RUNTIME_ALIAS: Record<string, string[]> = {
    "bundled-tool": ["python", "node", "git"],
    "lark-cli": ["feishu-cli"],
    "kb-embedding": ["kb-embedding"],
    "computer-use": ["computer-use"],
  };
  /* 这两样不是「运行时组件」而是应用自带能力：⛔ 不能因为 listRuntimes 里没有就报缺。 */
  const NON_INSTALLABLE = new Set(["engine", "image-lab"]);
  const toolReady = (id: string) => NON_INSTALLABLE.has(id) || installedTools.has(id) || (RUNTIME_ALIAS[id] ?? []).some((x) => installedTools.has(x));
  const skillReady = (name: string) => installedSkills.has(name);
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
              {(() => {
                /* 11-18 用户令：专家要「技能齐全、专业工具齐全」⇒ 卡上直接给数量与清单，缺了看得见。
                   ⛔ 数据只认主进程读入时补好的 team.tools / team.skills（⛔ 前端不再自己一份）。 */
                const tools: string[] = preview.team?.tools ?? [];
                const skills: string[] = preview.team?.skills ?? [];
                if (!tools.length && !skills.length) return <p className="expert-cap-line muted">尚未声明专业工具与技能</p>;
                const missTools = tools.filter((t) => !toolReady(t));
                const missSkills = skills.filter((k) => !skillReady(k));
                const installable = missTools.filter((t) => !NON_INSTALLABLE.has(t));
                const installOne = async (id: string) => {
                  setBusyCap(id);
                  try {
                    const rid = (RUNTIME_ALIAS[id] ?? [id])[0];
                    const r = await window.codex.installRuntime(rid);
                    if (r?.ok) setInstalledTools((prev) => new Set([...prev, rid, id]));
                  } finally { setBusyCap(""); }
                };
                return (
                  <div className="expert-cap-block">
                    <p className="expert-cap-line">
                      <span title={tools.join("、")} data-miss={missTools.length}>工具 {tools.length - missTools.length}/{tools.length}</span>
                      <span title={skills.join("、")} data-miss={missSkills.length}>技能 {skills.length - missSkills.length}/{skills.length}</span>
                      {!capsLoaded ? <small>读取中…</small> : null}
                    </p>
                    {missTools.length ? (
                      <p className="expert-cap-miss">缺工具：{missTools.join(" / ")}
                        {installable.slice(0, 3).map((id) => (
                          <button key={id} type="button" className="expert-cap-fix" disabled={busyCap === id} onClick={() => void installOne(id)}>
                            {busyCap === id ? "安装中…" : `装 ${id}`}
                          </button>
                        ))}
                      </p>
                    ) : null}
                    {missSkills.length ? (
                      <p className="expert-cap-miss">缺技能：{missSkills.join(" / ")}
                        {onOpenMarket ? <button type="button" className="expert-cap-fix" onClick={onOpenMarket}>去技能市场</button> : null}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
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
