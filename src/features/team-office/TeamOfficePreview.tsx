/**
 * 专家团办公室预览（team-office 域，09-25 起；09-26 v4「活起来」）。
 *
 * ⛔ 09-25 用户定稿：「公司模式」独立菜单**删掉**（原话「这样没啥用，不方便」）——
 *    改成**专家团专属预览**：在「专家 / 专家团」页每个团队卡片上点「办公室预览」进入。
 *    （视觉形态仍是 Marvis 式拟人化办公室，见 OfficeScene.tsx。）
 *
 * ⛔ 09-26 v4：动画**导演在这里**（不是场景内部）——场景与右栏看板必须同源，
 *    否则会出现「画面里在喝咖啡、看板写着编码中」。导演每拍产出一份快照，
 *    场景画场景、看板写标签，两边读的是同一份数据。
 *
 * 数据面：全部复用既有通道，零新 IPC ——
 *   · 团队定义 = expertTeams（teams:list）
 *   · 成员会话 id = team-threads:map 的 members（"teamId|memberId" → threadId）
 *   · 运行中 = runningThreadIds（回退）/ runningByMember（准确来源）
 *   · 最近活动 = threads 的 preview / updatedAt
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, X, MessageSquare, Loader2, CircleDot, Users, Coffee, Footprints } from "lucide-react";
import { OfficeScene, type OfficeMember } from "./OfficeScene";
import { OfficeDirector, emptySnapshot, OFFICE_TICK_MS, type DirectorSnapshot } from "./office-director";

type TeamMember = { id: string; name: string; profession: { zh: string; en: string }; description: string };
type Team = { teamId: string; displayName: { zh: string; en: string }; profession: { zh: string; en: string }; description: { zh: string; en: string }; lead: TeamMember; members: TeamMember[]; enabled: boolean };
type MemberState = { member: TeamMember; threadId: string | null; running: boolean; preview: string };

/** ⛔ 域组件收**显式 props**（规则第 4 条，禁收 app / 禁深链 useHarnessApp）；壳层 AppView 传参。
 *  ⛔ 09-25 用户定稿：入口在**专家团会话右侧的成员流转轨末位**（不是设置页卡片），
 *     且角色状态要**映射真实成员运行**（runningByMember/lastByMember 优先于 runningThreadIds）。 */
export function TeamOfficePreview({ teamId, onClose, teams, threads, runningThreadIds, runningByMember, openThread }: {
  teamId: string | null;
  onClose: () => void;
  teams: Team[];
  threads: { id: string; preview: string; name?: string | null; updatedAt: number }[];
  runningThreadIds: Set<string>;
  /** 真实成员运行记录（01-timeline 的 railRunningByMember）：有它就以它为准确来源 */
  runningByMember?: Record<string, { status: string }>;
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
      // ⛔ 真实运行态优先：runningByMember 是主进程落盘的委托记录（成员级），
      //    比「按会话 id 猜运行」准确 —— 同一成员会话可能空闲但刚被委派过任务。
      const byMember = runningByMember ? Boolean(runningByMember[member.id]) : undefined;
      const running = byMember ?? Boolean(threadId && runningThreadIds.has(threadId));
      return {
        member,
        threadId,
        running,
        preview: thread?.preview?.slice(0, 60) ?? "",
      };
    });
  }, [team, memberMap, threads, runningThreadIds, runningByMember]);

  const sceneMembers = useMemo<OfficeMember[]>(() => memberStates.map((state) => ({
    id: state.member.id,
    name: state.member.name,
    profession: state.member.profession?.zh || "通用",
    running: state.running,
    hasThread: Boolean(state.threadId),
  })), [memberStates]);

  /* ── 动画导演（唯一快照源：场景 + 右栏看板都读它）── */
  const directorRef = useRef<OfficeDirector | null>(null);
  const [snapshot, setSnapshot] = useState<DirectorSnapshot>(() => emptySnapshot(0));
  const membersRef = useRef<OfficeMember[]>(sceneMembers);
  membersRef.current = sceneMembers;

  const memberSig = sceneMembers.map((m) => m.id).join("|");
  const runningKey = sceneMembers.map((m) => m.running ? "1" : "0").join("");

  useEffect(() => {
    if (!teamId) return;
    const director = new OfficeDirector();
    directorRef.current = director;
    const list = membersRef.current;
    director.observe(list.map((m) => m.running), list.map((m) => m.hasThread));
    setSnapshot(director.step(list.map((m) => m.running), list.map((m) => m.hasThread)));
    const timer = window.setInterval(() => {
      const cur = membersRef.current;
      setSnapshot(director.step(cur.map((m) => m.running), cur.map((m) => m.hasThread)));
    }, OFFICE_TICK_MS);
    return () => { window.clearInterval(timer); directorRef.current = null; };
  }, [teamId, memberSig]);

  // 真实运行态变化 ⇒ observe（只有它派发真实交接：派任务 / 交成果）
  useEffect(() => {
    const director = directorRef.current;
    if (!director || !teamId) return;
    const list = membersRef.current;
    director.observe(list.map((m) => m.running), list.map((m) => m.hasThread));
    setSnapshot(director.step(list.map((m) => m.running), list.map((m) => m.hasThread)));
  }, [runningKey, teamId]);

  const runningCount = memberStates.filter((m) => m.running).length;
  const activeCount = memberStates.filter((m) => m.threadId).length;

  if (!teamId || !team) return null;

  /** 当前动作标签（visit 用被访者名字，比「去同事工位」具体）。 */
  const activityOf = (index: number): string => {
    const pose = snapshot.poses[index];
    if (!pose) return "";
    if (pose.kind === "visit" && pose.visitIndex !== undefined) {
      const host = sceneMembers[pose.visitIndex];
      return host ? `去找 ${host.name || "同事"}` : pose.label;
    }
    return pose.label;
  };
  const awayOf = (index: number): boolean => {
    const kind = snapshot.poses[index]?.kind;
    return kind === "visit" || kind === "errand";
  };

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
              members={sceneMembers}
              snapshot={snapshot}
              onOpenThread={(memberId) => { const target = memberStates.find((s) => s.member.id === memberId); if (target?.threadId) { onClose(); void openThread(target.threadId); } }}
            />
            <p className="team-office-org-caption">CEO {team.lead?.name || "—"} 统筹 {team.members.length} 名成员；成员会话由 CEO 委派任务时创建并长期复用。</p>
          </div>
          <aside className="team-office-staff">
            <div className="team-office-staff-title">成员看板</div>
            <div className="team-office-cards">
              {memberStates.map((state, index) => {
                const activity = activityOf(index);
                const away = awayOf(index);
                return (
                  <div key={state.member.id} className={`team-office-card ${state.running ? "is-running" : ""}${state.threadId ? "" : " is-idle-never"}${away ? " is-away" : ""}`}>
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
                    {activity && state.threadId ? (
                      <span className="team-office-card-activity" key={activity}>
                        {away ? <Footprints size={12} /> : <Coffee size={12} />}
                        {activity}
                      </span>
                    ) : null}
                    {state.preview && <p className="team-office-card-preview" title={state.preview}>{state.preview}</p>}
                    <div className="team-office-card-actions">
                      <button type="button" className="secondary-setting" disabled={!state.threadId} onClick={() => { if (state.threadId) { onClose(); void openThread(state.threadId); } }}>
                        <MessageSquare size={13} />进入对话
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="team-office-hint">办公室里的角色随成员状态变化：工作中敲键盘（屏幕滚动、气泡跳动），空闲时喝咖啡 / 伸懒腰 / 打盹，还会串门递资料；接到任务与交成果时会有卡片在两人之间飞过。没有会话则显示空工位。</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
