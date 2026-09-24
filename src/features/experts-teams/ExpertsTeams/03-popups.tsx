/**
 * ExpertsTeams 的「popups」部分（09-22 从同目录 ExpertsTeams.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Users, X, Plus, Trash2, Info, Check, Bot, Sparkles, LoaderCircle, Clock3 } from "lucide-react";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../../lib/entity-avatar";
import { expertIconOf } from "../../../lib/expert-icon-of";
import { expertRoleLabel } from "../../../lib/expert-role-label";
import { useAvatarAnchor } from "./04-avatar-anchor";
export function TeamRunPopup({ team, run, onClose, onOpenHistory }: {
  team: ExpertTeamConfig;
  run: TeamMemberRunRecord;
  onClose: () => void;
  onOpenHistory: (memberId: string) => void;
}) {
  const member = [team.lead, ...team.members].find((entry) => entry.id === run.memberId) ?? null;
  const isLead = Boolean(member && member.id === team.lead.id);
  const label = member ? expertRoleLabel(member, isLead) : run.profession || run.memberName;
  const Icon = member ? expertIconOf(member) : Bot;
  const running = run.status === "running";
  const anchorTop = useAvatarAnchor(run.memberId);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 底部跟随：产出增长时若用户本来就在底部（或从未滚过），贴到最新；上滑即让位，回底恢复
  const followRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = () => { followRef.current = false; };
    const onTouchMove = () => { followRef.current = false; };
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 12) followRef.current = true;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  // 产出变化时跟随（rAF 对齐帧：等 DOM 提交后再量 scrollHeight）
  useEffect(() => {
    if (!followRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el && followRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [run.output]);
  return (
    <div className={`team-panel-anchor${anchorTop == null ? " is-floating" : ""}`} style={anchorTop == null ? undefined : { top: anchorTop }}>
    <section className={`team-run-popup${running ? " is-running" : run.status === "failed" ? " is-failed" : " is-settled"}`} role="dialog" aria-label={`成员 ${label} 的工作会话`}>
      <header>
        <span className="team-run-popup-avatar" style={member && !isLead ? { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] } : undefined}><Icon size={13} /></span>
        <div className="team-run-popup-title"><strong>{label}</strong><small>{running ? "正在执行子任务…" : run.status === "done" ? "子任务已完成" : "子任务失败"}</small></div>
        <button type="button" className="icon-button" title="查看该成员的历史工作记录" onClick={() => onOpenHistory(run.memberId)}><Clock3 size={13} /></button>
        <button type="button" className="icon-button" title="关闭" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="team-run-popup-query"><span>子任务</span><p>{run.query}</p></div>
      <div className="team-run-popup-body" ref={bodyRef}>
        {run.output
          ? <div className="team-run-popup-text">{run.output}</div>
          : <div className="team-run-popup-empty"><LoaderCircle size={14} className="spin" />等待成员产出…</div>}
      </div>
      {run.error ? <p className="request-error">{run.error}</p> : null}
    </section>
    </div>
  );
}

export function DelegatedRunPopup({ run, onClose }: {
  run: { threadId: string; kind: string; name: string; status: "running" | "done" | "failed"; output?: string; error?: string };
  onClose: () => void;
}) {
  const anchorTop = useAvatarAnchor(run.threadId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = () => { followRef.current = false; };
    const onTouchMove = () => { followRef.current = false; };
    const onScroll = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight <= 12) followRef.current = true; };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  useEffect(() => {
    if (!followRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el && followRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [run.output]);
  const Icon = run.kind === "team" ? Users : run.kind === "subagent" ? Bot : Sparkles;
  const running = run.status === "running";
  return (
    <div className={`team-panel-anchor${anchorTop == null ? " is-floating" : ""}`} style={anchorTop == null ? undefined : { top: anchorTop }}>
      <section className={`team-run-popup${running ? " is-running" : run.status === "failed" ? " is-failed" : " is-settled"}`} role="dialog" aria-label={`调度 ${run.name} 的工作会话`}>
        <header>
          <span className="team-run-popup-avatar"><Icon size={13} /></span>
          <div className="team-run-popup-title"><strong>{run.name}</strong><small>{running ? "正在执行委派任务…" : run.status === "failed" ? "委派任务失败" : "委派任务完成"}</small></div>
          <button type="button" className="icon-button" title="关闭" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="team-run-popup-body" ref={bodyRef}>
          {run.output
            ? <div className="team-run-popup-text">{run.output}</div>
            : <div className="team-run-popup-empty"><LoaderCircle size={14} className="spin" />等待产出…</div>}
        </div>
        {run.error ? <p className="request-error">{run.error}</p> : null}
      </section>
    </div>
  );
}
