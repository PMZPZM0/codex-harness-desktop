/**
 * 公司模式（company-mode 域，09-25 新增）。
 *
 * 把「专家团」呈现为一家公司：CEO（lead）→ 员工（members）的组织树，右侧员工卡片。
 * 组织树是 Marvis 风的动画可视化：运行中的成员节点呼吸发光、连线上有流动光点；
 * 空闲节点静态。点击「进入对话」= 打开该成员的长期会话（对话框就是主区正常聊天，零特判）。
 *
 * 数据面：全部复用既有通道，零新 IPC ——
 *   · 公司定义 = bag.expertTeams（teams:list）
 *   · 成员会话 id = team-threads:map 的 members（"teamId|memberId" → threadId）
 *   · 运行中 = bag.runningThreadIds
 *   · 最近活动 = bag.threads 的 preview / updatedAt
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, X, MessageSquare, Loader2, CircleDot, Users } from "lucide-react";
import { OfficeScene } from "./OfficeScene";

type TeamMember = { id: string; name: string; profession: { zh: string; en: string }; description: string };
type Team = { teamId: string; displayName: { zh: string; en: string }; profession: { zh: string; en: string }; description: { zh: string; en: string }; lead: TeamMember; members: TeamMember[]; enabled: boolean };
type MemberState = { member: TeamMember; threadId: string | null; running: boolean; preview: string; updatedAt: number };

/** ⛔ 域组件收**显式 props**（规则第 4 条，禁收 app / 禁深链 useHarnessApp）；
 *  壳层 AppView 负责从 bag 解构传入。类型就地声明（结构同 bag 对应字段）。 */
export function CompanyModeView({ open, onClose, teams, threads, runningThreadIds, openThread, onOpenTeamCenter }: {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  threads: { id: string; preview: string; name?: string | null; updatedAt: number }[];
  runningThreadIds: Set<string>;
  openThread: (threadId: string) => void | Promise<void>;
  onOpenTeamCenter: () => void;
}) {
  const [teamId, setTeamId] = useState<string>("");
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void window.codex.teamThreadsMap().then((map) => { if (alive) setMemberMap(map.members ?? {}); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  const team = useMemo(() => teams.find((t) => t.teamId === teamId) ?? teams[0], [teams, teamId]);

  const memberStates = useMemo<MemberState[]>(() => {
    if (!team) return [];
    return team.members.map((member) => {
      const threadId = memberMap[`${team.teamId}|${member.id}`.toLowerCase()] ?? null;
      const thread = threadId ? threads.find((t) => t.id === threadId) : undefined;
      return {
        member,
        threadId,
        running: Boolean(threadId && runningThreadIds.has(threadId)),
        preview: thread?.preview?.slice(0, 60) ?? "",
        updatedAt: thread?.updatedAt ?? 0,
      };
    });
  }, [team, memberMap, threads, runningThreadIds]);

  useEffect(() => {
    if (team && !teamId) setTeamId(team.teamId);
  }, [team, teamId]);

  const runningCount = memberStates.filter((m) => m.running).length;
  const activeCount = memberStates.filter((m) => m.threadId).length;

  if (!open) return null;

  return (
    <div className="company-mode-backdrop" role="dialog" aria-modal="true" aria-label="公司模式" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="company-mode-shell">
        <header className="company-mode-head">
          <span className="company-mode-head-icon"><Building2 size={19} /></span>
          <div className="company-mode-head-text">
            <h2>公司模式</h2>
            <p>专家团即公司 —— CEO 统筹、员工并行干活，运行状态实时可见</p>
          </div>
          {team && (
            <div className="company-mode-stats">
              <span><CircleDot size={12} /> 在编 {team.members.length + 1}</span>
              <span className={runningCount ? "is-running" : ""}><Loader2 size={12} className={runningCount ? "spin" : ""} /> 运行中 {runningCount}</span>
              <span><Users size={12} /> 已开工会话 {activeCount}</span>
            </div>
          )}
          <button type="button" className="company-mode-close" title="关闭公司模式" onClick={onClose}><X size={16} /></button>
        </header>

        {!teams.length ? (
          <div className="company-mode-empty">
            <Building2 size={40} />
            <strong>还没有公司</strong>
            <p>先到「专家 / 专家团」创建一个专家团（CEO + 成员），它就会以公司的形态出现在这里。</p>
            <button type="button" className="primary-setting" onClick={() => { onClose(); onOpenTeamCenter(); }}>去创建专家团</button>
          </div>
        ) : (
          <>
            {teams.length > 1 && (
              <nav className="company-mode-tabs" role="tablist" aria-label="选择公司">
                {teams.map((t) => (
                  <button key={t.teamId} role="tab" aria-selected={t.teamId === team?.teamId} className={`company-mode-tab ${t.teamId === team?.teamId ? "active" : ""}`} onClick={() => setTeamId(t.teamId)}>
                    {t.displayName.zh || t.teamId}
                  </button>
                ))}
              </nav>
            )}

            {team && (
              <div className="company-mode-body">
                <div className="company-mode-org">
                  <OfficeScene
                    ceoName={team.lead?.name || "CEO"}
                    ceoProfession={team.lead?.profession?.zh || "首席执行官"}
                    members={memberStates.map((state) => ({ id: state.member.id, name: state.member.name, profession: state.member.profession?.zh || "通用", running: state.running, hasThread: Boolean(state.threadId) }))}
                    onOpenThread={(memberId) => { const target = memberStates.find((s) => s.member.id === memberId); if (target?.threadId) { onClose(); openThread(target.threadId); } }}
                  />
                  <p className="company-mode-org-caption">公司：{team.displayName.zh || team.teamId} —— {team.profession?.zh || "综合事业部"} · CEO {team.lead?.name || "CEO"} 统筹 {memberStates.length} 名员工</p>
                </div>
                <aside className="company-mode-staff">
                  <div className="company-mode-staff-title">员工看板</div>
                  <div className="company-mode-cards">
                    {memberStates.map((state) => (
                      <div key={state.member.id} className={`company-mode-card ${state.running ? "is-running" : ""}${state.threadId ? "" : " is-idle-never"}`}>
                        <div className="company-mode-card-head">
                          <span className={`company-mode-avatar ${state.running ? "running" : ""}`}>{(state.member.name || "?").slice(0, 1)}</span>
                          <div className="company-mode-card-name">
                            <strong>{state.member.name}</strong>
                            <em>{state.member.profession?.zh || "员工"}</em>
                          </div>
                          <span className={`company-mode-state ${state.running ? "running" : state.threadId ? "idle" : "never"}`}>
                            {state.running ? "运行中" : state.threadId ? "空闲" : "未开工"}
                          </span>
                        </div>
                        {state.preview && <p className="company-mode-card-preview" title={state.preview}>{state.preview}</p>}
                        <div className="company-mode-card-actions">
                          <button type="button" className="secondary-setting" disabled={!state.threadId} onClick={() => { if (state.threadId) { onClose(); openThread(state.threadId); } }}>
                            <MessageSquare size={13} />进入对话
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="company-mode-hint">员工会话由 CEO 委派任务时自动创建并长期复用；「进入对话」打开的就是普通聊天界面。员工运行时，组织树上会有光点沿连线流动。</p>
                </aside>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

