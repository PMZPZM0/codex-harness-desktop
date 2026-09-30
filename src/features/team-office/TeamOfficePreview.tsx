/**
 * 专家团办公室预览浮层（team-office 域，09-30 v18「Kenney CC0 资产版」）。
 *
 * ⛔ 与业务的关系（沿用 09-25 定稿、v17 验证过的形态）：**只读**会话/成员数据，不新增 IPC；
 *   业务侧只发事件，渲染层自己决定演什么。
 * ⛔ 类型说明：ExpertTeamConfig / ExpertTeamMember 是 vite-env.d.ts 的**全局声明**（IPC 契约生成物），
 *   ⛔ 不要 import；线程表也走**最小结构契约**（只取 id / memberId 两个字段），免得耦合线程模块。
 */
import { OfficeCanvas, type OfficeMember } from "./OfficeCanvas";

export type TeamOfficePreviewProps = {
  /** 非 null 时显示浮层 */
  teamId: string | null;
  onClose: () => void;
  teams: ExpertTeamConfig[];
  /** 只用到这两个字段（id / memberId）—— 显式收窄，别把整个线程类型拖进来 */
  threads: Array<{ id: string; memberId?: string | null }>;
  /** 正在跑的会话 id 集合（真实运行态 —— 屏幕/状态由它驱动） */
  runningThreadIds: Set<string> | string[];
  /** 成员 id → 运行记录（有记录即视为在跑，作 runningThreadIds 的回退） */
  runningByMember?: Record<string, unknown>;
  openThread: (threadId: string) => void;
};

export function TeamOfficePreview({ teamId, onClose, teams, threads, runningThreadIds, runningByMember, openThread }: TeamOfficePreviewProps) {
  const team = teams.find((t) => t.teamId === teamId) ?? null;
  if (!team) return null;
  const running = runningThreadIds instanceof Set ? runningThreadIds : new Set(runningThreadIds);

  const threadOf = (m: ExpertTeamMember): string | null => {
    const hit = threads.find((th) => th.memberId === (m.id || m.name));
    return hit?.id ?? null;
  };
  const list: OfficeMember[] = team.members.map((m: ExpertTeamMember) => {
    const threadId = threadOf(m);
    const isRunning = Boolean(threadId && running.has(threadId)) || Boolean(runningByMember?.[m.id]);
    return {
      id: m.id || m.name,
      name: m.name,
      profession: m.profession?.zh || m.profession?.en || "通用",
      running: isRunning,
      hasThread: Boolean(threadId),
    };
  });

  return (
    <div className="office-preview-backdrop" role="dialog" aria-label="办公室预览">
      <div className="office-preview">
        <header className="office-preview-head">
          <strong>{team.displayName?.zh || team.displayName?.en || "专家团"} · 办公室</strong>
          <span>{list.filter((m) => m.running).length} 人在工 / 共 {list.length} 人</span>
          <button type="button" className="office-preview-close" onClick={onClose} title="关闭">✕</button>
        </header>
        <OfficeCanvas
          ceoName={team.lead?.name || "CEO"}
          ceoProfession={team.lead?.profession?.zh || "首席执行官"}
          members={list}
          onOpenMember={(memberId) => {
            const m = team.members.find((x: ExpertTeamMember) => (x.id || x.name) === memberId);
            const threadId = m ? threadOf(m) : null;
            if (threadId) { onClose(); openThread(threadId); }
          }}
        />
      </div>
    </div>
  );
}
