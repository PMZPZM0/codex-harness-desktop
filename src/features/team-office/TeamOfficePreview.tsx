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

  /* ── 10-04 事件驱动（用户选「跟真实事件挂钩」）──
   * ⛔ 不订阅引擎、不读引擎的"思考"事件 —— `TeamMemberRunRecord.query` 是**主进程轨道里
   *   记录的真实派发任务**，比订阅便宜得多，且天然与成员一一对应。
   * ⚠️ 关键词命中是**降级**方案：将来轨道若补上 `kind` 字段，优先用它（本函数留了接口）。 */
  const activityOf = (query: string): null | "book" | "water" | "toilet" | "run" | "gym" => {
    const q = (query ?? "").toLowerCase();
    if (/查|找资料|搜索|search|调研|读一下|看看文档/.test(q)) return "book";
    if (/洗手间|厕所|toilet|wc|restroom/.test(q)) return "toilet";
    if (/跑|run|跑步/.test(q)) return "run";
    if (/举铁|哑铃|健身|gym|力量/.test(q)) return "gym";
    if (/喝|water|倒水|接水/.test(q)) return "water";
    return null;
  };

  /** 每成员的真实事件状态（供显示器画内容 + sim 派单）。 */
  const eventStateOf = (memberId: string) => {
    const run = runningByMember[memberId];
    if (!run) return null;
    const act = activityOf(run.query);
    return {
      activity: act,
      /** 轨道里没有"思考"这个字段 ⇒ 派了查资料任务就算在"翻资料"（搜索屏）；
       *  其余在跑 ⇒ 敲代码屏；跑完（不在 runningByMember 里）⇒ 熄屏。 */
      thinking: act === "book",
      waiting: false,
      reporting: act === null,
    };
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
        <OfficeCanvas members={members} onOpenMember={openMember} eventStateOf={eventStateOf} />
        {members.length === 0 && <p className="office-overlay-empty">这个团队还没有成员。</p>}
      </div>
    </div>
  );
}
