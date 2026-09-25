/**
 * 专家团办公室预览（team-office 域，09-25）。
 *
 * ⛔ 09-25 用户定稿：「公司模式」独立菜单**删掉**（原话「这样没啥用，不方便」）——
 *    改成**专家团专属预览**：在「专家 / 专家团」页每个团队卡片上点「办公室预览」进入。
 *    （视觉形态仍是 Marvis 式拟人化办公室，见 OfficeScene.tsx。）
 *
 * 数据面：全部复用既有通道，零新 IPC ——
 *   · 团队定义 = expertTeams（teams:list）
 *   · 成员会话 id = team-threads:map 的 members（"teamId|memberId" → threadId）
 *   · 运行中 = runningThreadIds
 *   · 最近活动 = threads 的 preview / updatedAt
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, X, MessageSquare, Loader2, CircleDot, Users } from "lucide-react";
import { OfficeScene } from "./OfficeScene";

type TeamMember = { id: string; name: string; profession: { zh: string; en: string }; description: string };
type Team = { teamId: string; displayName: { zh: string; en: string }; profession: { zh: string; en: string }; description: { zh: string; en: string }; lead: TeamMember; members: TeamMember[]; enabled: boolean };
type MemberState = { member: TeamMember; threadId: string | null; running: boolean; preview: string };

/** ⛔ 域组件收**显式 props**（规则第 4 条，禁收 app / 禁深链 useHarnessApp）；壳层 AppView 传参。 */
export function TeamOfficePreview({ teamId, onClose, teams, threads, runningThreadIds, openThread }: {
  teamId: string | null;
  onClose: () => void;
  teams: Team[];
  threads: { id: string; preview: string; name?: string | null; updatedAt: number }[];
  runningThreadIds: Set<string>;
  openThread: (threadId: string) => void | Promise<void>;
}) {
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    void window.codex.teamThreadsMap().then((map) => { if (alive) setMemberMap(map.members ?? {}); }).catch(() => undefined);
    return () => { alive = false; };
  }, [teamId]);

  const team = useMemo(() => teams.find((t) => t.teamId === teamId) ?? null, [teams, teamId]);

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
      };
    });
  }, [team, memberMap, threads, runningThreadIds]);

  const runningCount = memberStates.filter((m) => m.running).length;
  const activeCount = memberStates.filter((m) => m.threadId).length;

  if (!teamId || !team) return null;

  return (
    <div className="team-office-backdrop" role="dialog" aria-modal="true" aria-label="专家团办公室预览" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="team-office-shell">
        <header className="team-office-head">
          <span className="team-office-head-icon"><Building2 size={19} /></span>
          <div className="team-office-head-text">
            <h2>{team.displayName.zh || team.teamId} · 办公室</h2>
            <p>{team.profession?.zh || "团队"} · CEO 统筹、成员并行干活，运行状态实时可见</p>
          </div>
          <div className="team-office-stats">
            <span><CircleDot size={12} /> 在编 {team.members.length + 1}</span>
            <span className={runningCount ? "is-running" : ""}><Loader2 size={12} className={runningCount ? "spin" : ""} /> 运行中 {runningCount}</span>
            <span><Users size={12} /> 已开工会话 {activeCount}</span>
          </div>
          <button type="button" className="team-office-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="team-office-body">
          <div className="team-office-org">
            <OfficeScene
              ceoName={team.lead?.name || "CEO"}
              ceoProfession={team.lead?.profession?.zh || "首席执行官"}
              members={memberStates.map((state) => ({ id: state.member.id, name: state.member.name, profession: state.member.profession?.zh || "通用", running: state.running, hasThread: Boolean(state.threadId) }))}
              onOpenThread={(memberId) => { const target = memberStates.find((s) => s.member.id === memberId); if (target?.threadId) { onClose(); void openThread(target.threadId); } }}
            />
            <p className="team-office-org-caption">CEO {team.lead?.name || "—"} 统筹 {team.members.length} 名成员；成员会话由 CEO 委派任务时创建并长期复用。</p>
          </div>
          <aside className="team-office-staff">
            <div className="team-office-staff-title">成员看板</div>
            <div className="team-office-cards">
              {memberStates.map((state) => (
                <div key={state.member.id} className={`team-office-card ${state.running ? "is-running" : ""}${state.threadId ? "" : " is-idle-never"}`}>
                  <div className="team-office-card-head">
                    <span className={`team-office-avatar ${state.running ? "running" : ""}`}>{(state.member.name || "?").slice(0, 1)}</span>
                    <div className="team-office-card-name">
                      <strong>{state.member.name}</strong>
                      <em>{state.member.profession?.zh || "成员"}</em>
                    </div>
                    <span className={`team-office-state ${state.running ? "running" : state.threadId ? "idle" : "never"}`}>
                      {state.running ? "工作中" : state.threadId ? "空闲" : "未开工"}
                    </span>
                  </div>
                  {state.preview && <p className="team-office-card-preview" title={state.preview}>{state.preview}</p>}
                  <div className="team-office-card-actions">
                    <button type="button" className="secondary-setting" disabled={!state.threadId} onClick={() => { if (state.threadId) { onClose(); void openThread(state.threadId); } }}>
                      <MessageSquare size={13} />进入对话
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="team-office-hint">办公室里的角色随成员状态变化：工作中敲键盘（屏幕发光、气泡跳动）、空闲打盹喝咖啡、没有会话则显示空工位。</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
