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
import { RECOMMENDED_EXPERTS } from "./recommended-experts.mjs";

export type ExpertCenterSectionProps = {
  expertTeams: any;
  EXPERT_CATEGORY_DEFS: any;
  expertTeamMemberDirect: any;
  startMemberDirectSession: any;
  onOpenMarket?: () => void;
  onBack?: () => void;
  /** 11-18：一键建「推荐专家」（筑基/掌控/通译/造物）。不传就不显示这一块。 */
  /* ⛔ 用 never 形参：宿主给的是 ExpertTeamConfig（比 Record 更窄），
     用 Record 会让"函数参数逆变"直接报错；调用处再转一次。 */
  saveExpertTeam?: (draft: never) => Promise<unknown>;
  refreshExpertTeams?: () => void;
};

/** 专家中心：按类别列专家团与专家，可预览、可直连成员。 */
export function ExpertCenterSection(props: ExpertCenterSectionProps) {
  const { expertTeams, EXPERT_CATEGORY_DEFS, expertTeamMemberDirect, startMemberDirectSession, onOpenMarket, onBack, saveExpertTeam, refreshExpertTeams } = props;
  const [previewKey, setPreviewKey] = useState("");
  const [creating, setCreating] = useState("");
  /* ⛔ 判据只看**主理人名是否已在专家表里**（用户改过配置也不该再提示创建）。 */
  const missingExperts = RECOMMENDED_EXPERTS.filter((r) => !((expertTeams ?? []) as { lead?: { name?: string } }[]).some((t) => String(t?.lead?.name ?? "") === r.leadName));
  const createRecommended = async (leadName: string) => {
    const hit = RECOMMENDED_EXPERTS.find((r) => r.leadName === leadName);
    const saver = saveExpertTeam ?? (window.codex as { saveExpertTeam?: (d: never) => Promise<unknown> }).saveExpertTeam;
    if (!hit || !saver) return;
    setCreating(leadName);
    try {
      await (saver as (draft: Record<string, unknown>) => Promise<unknown>)(hit.team);
      /* 建档即就位：把这位专家的配套技能启用（缺失的仍要用户处理，不假装有）。 */
      await ensureSkills((hit.team.skills as string[] | undefined) ?? []);
      refreshExpertTeams?.();
    } finally {
      setCreating("");
    }
  };
  /* ⛔⛔ 11-18：能力清单必须是**真实状态**（已装/缺），不是文案。
     数据只认两条既有通道：listRuntimes（组件是否已装）+ listLocalSkills（技能是否已装）。
     ⛔ 不新增第二份"专家能力状态"真相源；⛔ 不在这里伪造"已具备"。 */
  const [installedTools, setInstalledTools] = useState<Set<string>>(new Set());
  /* 技能不只「装没装」，还有「启没启用」——⛔ 装了没启用，引擎照样看不见（等于专家没这个技能）。 */
  const [skillMap, setSkillMap] = useState<Map<string, { folder: string; enabled: boolean }>>(new Map());
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
        const map = new Map<string, { folder: string; enabled: boolean }>();
        for (const k of skills ?? []) {
          const name = String(k?.name ?? k?.folder ?? "");
          if (!name) continue;
          map.set(name, { folder: String(k?.folder ?? name), enabled: k?.enabled !== false });
        }
        setSkillMap(map);
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
  const skillReady = (name: string) => skillMap.has(name);
  const skillEnabled = (name: string) => skillMap.get(name)?.enabled === true;
  /* 专家「自带」的落地：把它声明的技能**启用**（已启用则跳过）。⛔ 不装新技能、不改技能内容。 */
  const ensureSkills = async (names: string[]) => {
    const folders = names.filter((n) => skillMap.has(n) && !skillEnabled(n)).map((n) => skillMap.get(n)!.folder);
    if (!folders.length) return { changed: 0 };
    await window.codex.setEnabledSkillBatch({ folders, enabled: true }).catch(() => null);
    const skills = await window.codex.listLocalSkills().catch(() => []);
    const map = new Map<string, { folder: string; enabled: boolean }>();
    for (const k of skills ?? []) {
      const name = String(k?.name ?? k?.folder ?? "");
      if (name) map.set(name, { folder: String(k?.folder ?? name), enabled: k?.enabled !== false });
    }
    setSkillMap(map);
    return { changed: folders.length };
  };
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
    {/* 11-18：推荐专家 —— 与「专家工作证」同款小卡（⛔ 不再用一排 secondary-setting 按钮，
        用户反馈「推荐卡片真丑」）。点卡即建档；建完就是普通专家，可在「专家团」里改任何字段。 */}
    {missingExperts.length ? (
      <div className="expert-category">
        <div className="expert-category-head">
          <span className="expert-category-icon"><Package size={15} /></span>
          <strong>推荐专家</strong>
          <small>这四类还没有负责人：建一个，让它去管对应的工具与技能</small>
          <em>{missingExperts.length} 位可建</em>
        </div>
        <div className="agent-badge-grid">
          {missingExperts.map((r) => (
            <AgentBadge
              key={r.leadName}
              kind="expert"
              seed={r.leadName}
              name={r.leadName}
              tag={creating === r.leadName ? "建档中…" : "可建档"}
              line={[
                r.team.profession?.zh ?? "",
                `工具 ${r.team.tools?.length ?? 0}`,
                `技能 ${r.team.skills?.length ?? 0}`,
              ].filter(Boolean).join(" · ")}
              disabled={creating === r.leadName}
              onClick={() => void createRecommended(r.leadName)}
            />
          ))}
        </div>
      </div>
    ) : null}
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
                   ⛔ 数据只认主进程读好并补好的 team.tools / team.skills（前端不再自己一份）。 */
                const tools: string[] = preview.team?.tools ?? [];
                const skills: string[] = preview.team?.skills ?? [];
                if (!tools.length && !skills.length) return <p className="expert-cap-line muted">尚未声明专业工具与技能</p>;
                const missTools = tools.filter((t) => !toolReady(t));
                const missSkills = skills.filter((k) => !skillReady(k));
                const installable = missTools.filter((t) => !NON_INSTALLABLE.has(t));
                /* 装了但没启用：引擎看不见 ⇒ 对专家等于没有。 */
                const offSkills = skills.filter((k) => skillReady(k) && !skillEnabled(k));
                const installOne = async (id: string) => {
                  setBusyCap(id);
                  try {
                    const rid = (RUNTIME_ALIAS[id] ?? [id])[0];
                    const r = await window.codex.installRuntime(rid);
                    if (r?.ok) setInstalledTools((prev) => new Set([...prev, rid, id]));
                  } finally { setBusyCap(""); }
                };
                const Row = ({ label, ready, total, names, miss }: { label: string; ready: number; total: number; names: string; miss: number }) => (
                  <div className="expert-cap-row">
                    <span className="expert-cap-label">{label}</span>
                    <span className={`expert-cap-count${miss ? " is-miss" : " is-ok"}`}>{ready}/{total}</span>
                    <span className="expert-cap-names" title={names}>{names || "—"}</span>
                  </div>
                );
                return (
                  <div className="expert-cap-block">
                    <Row label="专业工具" ready={tools.length - missTools.length} total={tools.length} names={tools.join("、")} miss={missTools.length} />
                    <Row label="配套技能" ready={skills.length - missSkills.length} total={skills.length} names={[skills.join("、"), offSkills.length ? `（${offSkills.length} 个未启用）` : ""].filter(Boolean).join(" ")} miss={missSkills.length} />
                    {missTools.length || missSkills.length || offSkills.length ? (
                      <div className="expert-cap-miss">
                        <span>缺：{[...missTools, ...missSkills].join("、")}</span>
                        {installable.slice(0, 3).map((id) => (
                          <button key={id} type="button" className="expert-cap-fix" disabled={busyCap === id} onClick={() => void installOne(id)}>
                            {busyCap === id ? "安装中…" : `装 ${id}`}
                          </button>
                        ))}
                        {offSkills.length ? <button type="button" className="expert-cap-fix" onClick={() => void ensureSkills(skills)}>启用配套技能</button> : null}
                        {missSkills.length && onOpenMarket ? <button type="button" className="expert-cap-fix" title="专家技能应随专家包提供；市场里未必有同名技能" onClick={onOpenMarket}>去市场找找</button> : null}
                      </div>
                    ) : (
                      <div className="expert-cap-miss is-ok"><span>工具与技能都已就绪</span></div>
                    )}
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
