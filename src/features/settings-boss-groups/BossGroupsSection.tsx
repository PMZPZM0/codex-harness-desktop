/**
 * 创世 boss · 群编排看板（设置 → 自动化与智能体 → 群编排）
 *
 * ⛔ 自包含板块：不吃 app props（同 CloudAccountSection），状态自己拉（4s 轮询，挂载期间才拉）。
 * ⛔ 只读 + 三个动作（升级三选一 / 重新评审）：建群与派活在 boss 会话里用工具做，这里不重复入口 ——
 *    两个入口改同一份账本必然打架（真相源唯一，见 ARCHITECTURE-RULES §2.2）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Network, RefreshCw } from "lucide-react";

type GroupSummary = { id: string; name: string; paused: boolean; memberCount: number; taskCount: number };
type Snapshot = {
  group: { id: string; name: string; paused: boolean; policy: { maxRejects: number; stallMs: number; budgetMinutes: number }; members: { id: string; name: string; role: string; status: string; lockedTaskIds: string[] }[] };
  counts: Record<string, number>;
  tasks: { id: string; title: string; status: string; assignee: string; rejects: number; criteria: string; lockedAuthors: string[]; escalation?: { reasons: string[] } | null; attempts: { n: number; memberId: string; endedAt: number | null; verdict: string | null; reasons: string[] }[] }[];
  events: { id: string; kind: string; text: string; at: number }[];
};

const TASK_BADGE: Record<string, { text: string; tone: string }> = {
  queued: { text: "排队中", tone: "" },
  assigned: { text: "已派活", tone: "" },
  running: { text: "进行中", tone: "run" },
  submitted: { text: "已交活", tone: "warn" },
  reviewing: { text: "审查中", tone: "warn" },
  approved: { text: "已通过", tone: "ok" },
  rejected: { text: "已打回", tone: "bad" },
  escalated: { text: "待你决定", tone: "bad" },
  done: { text: "完成", tone: "ok" },
  failed: { text: "失败", tone: "bad" },
};
const MEMBER_TEXT: Record<string, string> = { idle: "空闲", busy: "正在做", reviewing: "交活待审", locked: "被锁" };

function clock(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function BossGroupsSection() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const loadedOnce = useRef(false);

  const refreshGroups = useCallback(async () => {
    try {
      const list = (await window.codex.listBossGroups()) as GroupSummary[];
      setGroups(list ?? []);
      if (!loadedOnce.current && list?.length) { setSelected((cur) => cur || list[0].id); loadedOnce.current = true; }
    } catch { /* 主进程没起好：下一轮再试 */ }
  }, []);

  useEffect(() => {
    void refreshGroups();
    const timer = setInterval(() => { void refreshGroups(); }, 4000);
    return () => clearInterval(timer);
  }, [refreshGroups]);

  useEffect(() => {
    if (!selected) { setSnap(null); return; }
    let alive = true;
    const pull = async () => {
      try {
        const next = (await window.codex.bossGroupStatus(selected)) as Snapshot;
        if (alive) setSnap(next);
      } catch { /* 下轮再试 */ }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [selected]);

  const escalate = async (taskId: string, choice: string, noteText: string) => {
    setBusy(taskId + choice);
    try {
      await window.codex.escalateBossTask({ taskId, choice, note: noteText });
      setNote("");
      const next = (await window.codex.bossGroupStatus(selected)) as Snapshot;
      setSnap(next);
    } finally { setBusy(""); }
  };

  const recheck = async (taskId: string) => {
    setBusy(taskId + "recheck");
    try {
      await window.codex.recheckBossTask(taskId);
      const next = (await window.codex.bossGroupStatus(selected)) as Snapshot;
      setSnap(next);
    } finally { setBusy(""); }
  };

  if (!groups.length) {
    return (
      <div className="boss-groups">
        <div className="boss-groups-empty">
          <b>还没有群</b>
          群由「boss 会话」创建：对任意会话说
          <br />
          <code>建个群：写手 + 前端，把 XX 任务派下去，验收标准是……</code>
          <br />
          建好后这里会显示成员状态、任务账本与审查结论；打回、换人重做都在账本里可查。
        </div>
      </div>
    );
  }

  return (
    <div className="boss-groups">
      <div className="boss-groups-layout">
        <div className="boss-groups-side">
          <div className="boss-groups-section-title">群（{groups.length}）</div>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className="boss-groups-group-item"
              aria-current={g.id === selected}
              onClick={() => setSelected(g.id)}
            >
              <span className="boss-groups-group-name">{g.name}</span>
              {g.paused ? <span className="boss-groups-paused">已暂停</span> : null}
              <span className="boss-groups-group-meta">{g.taskCount}</span>
            </button>
          ))}
        </div>

        <div className="boss-groups-card">
          {!snap ? (
            <div className="boss-groups-empty"><b>正在读取群账本…</b>如果一直停在这里，说明主进程还没起好。</div>
          ) : (
            <>
              <div className="boss-groups-head">
                <span className="boss-groups-title">{snap.group.name}</span>
                <span className="boss-groups-sub">
                  打回上限 {snap.group.policy.maxRejects} · 卡住阈值 {Math.round(snap.group.policy.stallMs / 1000)}s · 预算 {snap.group.policy.budgetMinutes} 分钟
                </span>
              </div>

              <div className="boss-groups-section-title">成员</div>
              <div className="boss-groups-members">
                {snap.group.members.map((m) => (
                  <span key={m.id} className="boss-groups-member" data-status={m.status} title={m.lockedTaskIds.length ? `锁在 ${m.lockedTaskIds.length} 条任务上` : undefined}>
                    <span className="dot" aria-hidden="true" />
                    {m.name} · {m.role} · {MEMBER_TEXT[m.status] ?? m.status}
                  </span>
                ))}
              </div>

              <div className="boss-groups-section-title">任务账本（进行 {snap.counts.running ?? 0} · 打回 {snap.counts.rejected ?? 0} · 完成 {snap.counts.done ?? 0}）</div>
              {snap.tasks.length === 0 ? (
                <div className="boss-groups-sub">还没有任务：在 boss 会话里用 group_assign 派活。</div>
              ) : (
                snap.tasks.map((t) => {
                  const badge = TASK_BADGE[t.status] ?? { text: t.status, tone: "" };
                  const last = t.attempts[t.attempts.length - 1];
                  const assigneeName = snap.group.members.find((m) => m.id === t.assignee)?.name ?? t.assignee;
                  return (
                    <div key={t.id} className="boss-groups-task">
                      <div className="boss-groups-task-head">
                        <span className="boss-groups-task-title">{t.title}</span>
                        <span className="boss-groups-badge" data-tone={badge.tone}>{badge.text}</span>
                        <span className="boss-groups-task-meta">{assigneeName} · 打回 {t.rejects}/{snap.group.policy.maxRejects}</span>
                      </div>
                      <p className="boss-groups-criteria">验收标准：{t.criteria}</p>
                      {last ? (
                        <p className="boss-groups-attempt">
                          尝试 {last.n} · {last.memberId === t.assignee ? assigneeName : snap.group.members.find((m) => m.id === last.memberId)?.name ?? last.memberId}
                          {last.endedAt ? ` · ${clock(last.endedAt)}` : " · 进行中"}
                          {t.lockedAuthors.length ? <> · <b>已锁</b>：{t.lockedAuthors.map((id) => snap.group.members.find((m) => m.id === id)?.name ?? id).join("、")}</> : null}
                        </p>
                      ) : null}
                      {last?.verdict === "rejected" && last.reasons.length ? (
                        <ul className="boss-groups-reasons">{last.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                      ) : null}
                      {t.status === "reviewing" || t.status === "submitted" ? (
                        <div className="boss-groups-actions">
                          <button type="button" className="boss-groups-btn" disabled={busy === t.id + "recheck"} onClick={() => void recheck(t.id)}>
                            <RefreshCw size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true" />重新评审
                          </button>
                          <button type="button" className="boss-groups-btn" disabled={busy === t.id + "approved"} onClick={() => void window.codex.reviewBossTask({ taskId: t.id, verdict: "approved", reasons: [], by: "user" }).then(() => void window.codex.bossGroupStatus(selected).then((s) => setSnap(s as Snapshot)))}>
                            直接通过
                          </button>
                        </div>
                      ) : null}
                      {t.status === "escalated" ? (
                        <div className="boss-groups-actions">
                          <button type="button" className="boss-groups-btn" data-kind="primary" disabled={busy === t.id + "retry-with-other-model"} onClick={() => void escalate(t.id, "retry-with-other-model", "")}>
                            换模型重做
                          </button>
                          <button type="button" className="boss-groups-btn" disabled={busy === t.id + "relax-criteria" || !note.trim()} title={note.trim() ? "" : "先在右侧输入放宽后的验收标准"} onClick={() => void escalate(t.id, "relax-criteria", note)}>
                            放宽标准
                          </button>
                          <input
                            className="boss-groups-note"
                            value={note}
                            placeholder="放宽后的验收标准（点「放宽标准」前先填）"
                            aria-label="放宽后的验收标准"
                            onChange={(e) => setNote(e.target.value)}
                          />
                          <button type="button" className="boss-groups-btn" disabled={busy === t.id + "user-takeover"} onClick={() => void escalate(t.id, "user-takeover", "")}>
                            我来接手
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}

              <div className="boss-groups-section-title">事件流（最近 {snap.events.length} 条）</div>
              {snap.events.length === 0 ? (
                <div className="boss-groups-sub">还没有事件。</div>
              ) : (
                <ul className="boss-groups-events">
                  {snap.events.slice().reverse().map((e) => (
                    <li key={e.id}><time>{clock(e.at)}</time><span className="text">{e.text}</span></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      <p className="boss-groups-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Network size={13} aria-hidden="true" /> 建群 / 派活 / 追加说明都在 boss 会话里用工具完成；这里只看账本与做决定。
        <Crown size={13} aria-hidden="true" /> 待你决定的任务会以红色徽标置顶提示。
      </p>
    </div>
  );
}
