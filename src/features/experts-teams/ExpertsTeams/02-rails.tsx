/**
 * ExpertsTeams 的「rails」部分（09-22 从同目录 ExpertsTeams.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Users, X, Plus, Trash2, Info, Check, Bot, Building2, Sparkles, LoaderCircle, Clock3 } from "lucide-react";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../../lib/entity-avatar";
import { useRefObject } from "../../../lib/use-ref-object";
import { expertIconOf } from "../../../lib/expert-icon-of";
import { expertRoleLabel } from "../../../lib/expert-role-label";
import { useAvatarAnchor } from "./04-avatar-anchor";
export function TeamMemberRail({ team, containerRef, runningByMember, lastByMember, activeMemberId, onOpenMember, onOpenOffice }: {
  team: ExpertTeamConfig;
  containerRef: useRefObject;
  runningByMember: Record<string, TeamMemberRunRecord>;
  lastByMember: Record<string, TeamMemberRunRecord>;
  activeMemberId: string;
  onOpenMember: (memberId: string) => void;
  /** 办公室预览入口（09-25 用户要求：加在这列流转图标的末位，映射真实成员状态）。 */
  onOpenOffice?: () => void;
}) {
  const [mode, setMode] = useState<"full" | "compact" | "hidden">("full");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const check = () => {
      const width = container.clientWidth;
      // 900/1120 是「消息区还读得下去」的经验下限：低于 900 时头像轨会让正文可读性变差
      setMode(width >= 1120 ? "full" : width >= 900 ? "compact" : "hidden");
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  if (mode === "hidden") return null;
  const roster: { member: ExpertTeamMember; isLead: boolean }[] = [{ member: team.lead, isLead: true }, ...team.members.map((member) => ({ member, isLead: false }))];
  const anyRunning = roster.some(({ member }) => Boolean(runningByMember[member.id]));
  return (
    <aside className={`team-rail mode-${mode}${anyRunning ? " is-flowing" : ""}`} aria-label="专家团成员">
      <div className="team-rail-track">
        <i className="team-rail-line" aria-hidden />
        {roster.map(({ member, isLead }) => {
          const running = runningByMember[member.id];
          const last = lastByMember[member.id];
          const state = running ? "running" : last ? (last.status === "failed" ? "failed" : "done") : "idle";
          const Icon = expertIconOf(member);
          const label = expertRoleLabel(member, isLead);
          return (
            <button key={member.id} type="button" data-member-id={member.id} className={`team-rail-node is-${state}${isLead ? " is-lead" : ""}${activeMemberId === member.id ? " is-active" : ""}`}
              title={`${label}${running ? "（执行中）" : last ? (last.status === "done" ? "（已完成最近一次委托）" : "（最近一次失败）") : "（尚未接过活）"}｜点击查看工作记录`}
              onClick={() => onOpenMember(member.id)}>
              <span className="team-rail-avatar" style={isLead ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}><Icon size={14} /></span>
              {running ? <i className="team-rail-ring" aria-hidden /> : null}
              {!running && state === "done" ? <span className="team-rail-badge" aria-hidden><Check size={9} /></span> : null}
              {state === "failed" ? <span className="team-rail-badge is-failed" aria-hidden><X size={9} /></span> : null}
              <span className="team-rail-name">{label}</span>
            </button>
          );
        })}
        {/* 办公室预览：轨道末位的独立节点（用户 09-25：加在这列流转图标里，不进设置页卡片） */}
        {onOpenOffice && (
          <button type="button" className="team-rail-node team-rail-office" title="办公室预览：把成员状态映射成虚拟办公室（工作中敲键盘 / 空闲打盹 / 未开工空位）" onClick={onOpenOffice}>
            <span className="team-rail-avatar team-rail-office-avatar"><Building2 size={14} /></span>
            <span className="team-rail-name">办公室</span>
          </button>
        )}
      </div>
    </aside>
  );
}

export function TeamMemberHistory({ team, memberId, runs, onClose }: {
  team: ExpertTeamConfig;
  memberId: string;
  runs: TeamMemberRunRecord[];
  onClose: () => void;
}) {
  const member = [team.lead, ...team.members].find((entry) => entry.id === memberId) ?? null;
  const isLead = Boolean(member && member.id === team.lead.id);
  const label = member ? expertRoleLabel(member, isLead) : memberId;
  const Icon = member ? expertIconOf(member) : Bot;
  const anchorTop = useAvatarAnchor(memberId);
  return (
    <div className={`team-panel-anchor${anchorTop == null ? " is-floating" : ""}`} style={anchorTop == null ? undefined : { top: anchorTop }}>
    <section className="team-run-popup" role="dialog" aria-label={`${label} 的历史工作记录`}>
      <header>
        <span className="team-run-popup-avatar" style={member && !isLead ? { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] } : undefined}><Icon size={13} /></span>
        <div className="team-run-popup-title"><strong>{label}</strong><small>{runs.length ? `历史工作记录 · 共 ${runs.length} 次委托` : "还没有接过活"}</small></div>
        <button type="button" className="icon-button" title="关闭" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="team-history-list">
        {runs.map((run, index) => {
          const seconds = Math.max(0, Math.round((((run.endedAt || Date.now()) - (run.startedAt || Date.now())) / 1000)));
          return (
            <details key={run.runId} className="team-history-item" open={index === 0}>
              <summary>
                <span className={`team-history-dot is-${run.status}`} aria-hidden />
                <strong>{new Date(run.startedAt).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong>
                <small>{run.status === "done" ? `完成 · ${seconds}s` : run.status === "failed" ? "失败" : "进行中"}</small>
              </summary>
              <div className="team-history-label">子任务</div>
              <div className="team-history-query">{run.query}</div>
              <div className="team-history-label">产出</div>
              <div className="team-run-popup-text">{run.output || "（无产出）"}</div>
            </details>
          );
        })}
        {!runs.length && <p className="team-history-empty">该成员还没有历史工作记录。</p>}
      </div>
    </section>
    </div>
  );
}

export function DelegatedRail({ containerRef, runs, onOpen, activeId }: {
  containerRef: useRefObject;
  runs: { threadId: string; kind: string; name: string; status: "running" | "done" | "failed" }[];
  onOpen: (threadId: string) => void;
  activeId: string;
}) {
  const [mode, setMode] = useState<"full" | "compact" | "hidden">("full");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 与 TeamMemberRail 同一套自适应阈值（900/1120）：窗口窄了自动收起，不遮正文
    const check = () => setMode(container.clientWidth >= 1120 ? "full" : container.clientWidth >= 900 ? "compact" : "hidden");
    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  if (mode === "hidden" || !runs.length) return null;
  const kindIcon = (kind: string) => (kind === "team" ? Users : kind === "subagent" ? Bot : Sparkles);
  const kindLabel = (kind: string) => (kind === "team" ? "专家团" : kind === "subagent" ? "子智能体" : "专家");
  return (
    <aside className="team-rail is-flowing" aria-label="调度中的对象">
      <div className="team-rail-track">
        <i className="team-rail-line" aria-hidden />
        {runs.map((run) => {
          const Icon = kindIcon(run.kind);
          const state = run.status === "running" ? "running" : run.status === "failed" ? "failed" : "done";
          const stateHint = state === "running" ? "执行中" : state === "failed" ? "执行失败" : "已完成";
          return (
            <button
              key={run.threadId}
              type="button"
              data-member-id={run.threadId}
              className={`team-rail-node is-${state}${activeId === run.threadId ? " is-active" : ""}`}
              title={`${kindLabel(run.kind)} · ${run.name}（${stateHint}）｜点击查看工作内容`}
              onClick={() => onOpen(run.threadId)}
            >
              <span className="team-rail-avatar"><Icon size={14} /></span>
              <i className="team-rail-ring" aria-hidden />
              <span className="team-rail-name">{run.name}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
