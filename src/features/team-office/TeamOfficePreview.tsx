/**
 * 专家团像素办公室 · 整屏浮层（v19 像素版）
 *
 * 数据边界（⛔ 事件驱动的接法）：本组件**不订阅引擎** —— 成员运行态由宿主（AppView）
 * 传入，宿主的 railRuns 本身就是引擎事件流归约出来的，所以这里的画面会随任务
 * 开始/结束**实时变化**（开始 → 坐下敲键盘 + 气泡；结束 → 完成气泡 → 待机）。
 * 交互只有一条：点角色 → 打开该成员会话。
 */
import { useMemo } from "react";
import { OfficeCanvas } from "./OfficeCanvas";
import type { OfficeMemberState } from "./office-format";

export type TeamOfficePreviewProps = {
  teamId: string | null;
  onClose: () => void;
  teams: ExpertTeamConfig[];
  runningByMember: Record<string, TeamMemberRunRecord>;
  lastByMember: Record<string, TeamMemberRunRecord>;
  openThread: (threadId: string) => void;
};

export function TeamOfficePreview({ teamId, onClose, teams, runningByMember, lastByMember, openThread }: TeamOfficePreviewProps) {
  const team = useMemo(() => teams.find((t) => t.teamId === teamId) ?? null, [teams, teamId]);

  const members: OfficeMemberState[] = useMemo(() => {
    if (!team) return [];
    const roster = [team.lead, ...team.members].slice(0, 6);
    return roster.map((m) => {
      const run = runningByMember[m.id];
      const last = lastByMember[m.id];
      return {
        id: m.id,
        name: m.name,
        profession: m.profession?.zh ?? "",
        running: Boolean(run),
        hasThread: Boolean(run || last),
      };
    });
  }, [team, runningByMember, lastByMember]);

  /** 点角色 → 该成员最近的会话（跑过才有；没跑过不开）。 */
  const openMember = (memberId: string) => {
    const rec = lastByMember[memberId] ?? runningByMember[memberId];
    if (rec?.memberThreadId) {
      onClose();
      openThread(rec.memberThreadId);
    }
  };

  if (!teamId || !team) return null;

  return (
    <div className="office-overlay" role="dialog" aria-label="专家团像素办公室">
      <header className="office-overlay-bar">
        <div className="office-overlay-title">
          <span className="office-overlay-name">{team.displayName?.zh || team.displayName?.en || "办公室"}</span>
          <span className="office-overlay-sub">成员状态实时联动 · 点角色打开会话</span>
        </div>
        <button type="button" className="office-overlay-close" onClick={onClose} aria-label="关闭办公室预览">
          ✕
        </button>
      </header>
      <div className="office-overlay-body">
        <OfficeCanvas members={members} onOpenMember={openMember} />
        {members.length === 0 && <p className="office-overlay-empty">这个团队还没有成员。</p>}
      </div>
    </div>
  );
}
