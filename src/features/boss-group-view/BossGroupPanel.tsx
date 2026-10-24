/**
 * BOSS 会话面板（右侧停靠浮层，2026-10-24）
 *
 * 群聊形态的「看与管」层：成员状态 / 拉人移人 / 置顶更新 / 群事件流。
 * ⛔ 真相源不变：账本在 `boss-groups.json`，建群/派活/审查仍只在 boss 会话的工具里做；
 *    本面板只做「成员增删 + 置顶」这两个用户直接操作，其余只读。
 * ⛔ 不吃 app props（同设置看板），数据自拉（4s 轮询）+ `codex:event` 的 boss-group 事件即时刷新。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Crown, Pin, PinOff, Plus, UserMinus, X } from "lucide-react";
import { closeBossPanel, getBossPanelState, setBossPanelGroup, subscribeBossPanel, type BossPanelState } from "./panel-store.mjs";

type GroupSummary = { id: string; name: string; paused: boolean; memberCount: number; taskCount: number };
type Snapshot = {
  group: {
    id: string; name: string; paused: boolean; bossThreadId: string;
    policy: { maxRejects: number; stallMs: number; budgetMinutes: number };
    members: { id: string; name: string; role: string; status: string; lockedTaskIds: string[] }[];
    pinnedEventIds: string[];
  };
  tasks: { id: string; title: string; status: string }[];
  events: { id: string; kind: string; text: string; at: number }[];
};

const MEMBER_TEXT: Record<string, string> = { idle: "空闲", busy: "正在做", reviewing: "交活待审", locked: "被锁", removed: "已移出" };

function clock(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BossGroupPanel() {
  const panel = useSyncExternalStore(subscribeBossPanel, getBossPanelState) as BossPanelState;
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const [tick, setTick] = useState(0);

  const groupId = panel.groupId || groups[0]?.id || "";
  const group = groups.find((g) => g.id === groupId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const list = (await window.codex.listBossGroups()) as GroupSummary[];
      setGroups(list ?? []);
      const id = panel.groupId || list?.[0]?.id || "";
      if (id) setSnap((await window.codex.bossGroupStatus(id)) as Snapshot);
      else setSnap(null);
    } catch { /* 主进程没起好：下一轮再试 */ }
  }, [panel.groupId]);

  useEffect(() => {
    if (!panel.open) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 4000);
    const off = window.codex.onEvent((event: any) => {
      if (event?.type === "boss-group") setTick((n) => n + 1);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [panel.open, refresh, tick]);

  if (!panel.open) return null;

  const members = snap?.group.members ?? [];
  const active = members.filter((m) => m.status !== "removed");
  const removed = members.filter((m) => m.status === "removed");
  const pinnedIds = snap?.group.pinnedEventIds ?? [];
  const events = snap?.events ?? [];
  const pinnedCards = pinnedIds.map((id) => events.find((e) => e.id === id)).filter(Boolean) as typeof events;

  const act = async (fn: () => Promise<unknown>) => { await fn(); await refresh(); };

  return (
    <aside className="boss-panel" role="complementary" aria-label="BOSS 会话群面板">
      <header className="boss-panel-head">
        <span className="boss-panel-title"><Crown size={14} aria-hidden="true" /> BOSS 会话</span>
        {groups.length > 1 ? (
          <select
            className="boss-panel-select"
            aria-label="切换群"
            value={groupId}
            onChange={(e) => setBossPanelGroup(e.target.value)}
          >
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : group ? (
          <span className="boss-panel-sub">{group.name}</span>
        ) : null}
        <button type="button" className="boss-panel-x" aria-label="关闭群面板" onClick={() => closeBossPanel()}>
          <X size={14} />
        </button>
      </header>

      {!group ? (
        <div className="boss-panel-empty">
          <b>还没有群</b>
          在任意会话里对 Codex 说：<code>建个群：写手 + 前端，把 XX 派下去，验收标准是……</code>
          <br />建好后这里就是群动态与成员管理。
        </div>
      ) : (
        <>
          <div className="boss-panel-sec-title">成员（{active.length}）</div>
          <div className="boss-panel-members">
            {active.map((m) => (
              <span key={m.id} className="boss-groups-member" data-status={m.status} title={m.lockedTaskIds.length ? `锁在 ${m.lockedTaskIds.length} 条任务上` : undefined}>
                {m.name} · {MEMBER_TEXT[m.status] ?? m.status}
                <button
                  type="button"
                  className="boss-panel-mini"
                  aria-label={`移出 ${m.name}`}
                  title="移出群（会话与轨迹保留，正在跑的任务不打断）"
                  onClick={() => void act(() => window.codex.bossGroupMember({ groupId: group.id, action: "remove", memberId: m.id }))}
                >
                  <UserMinus size={11} />
                </button>
              </span>
            ))}
            {!adding ? (
              <button type="button" className="boss-panel-mini boss-panel-add" aria-label="拉人进群" onClick={() => setAdding(true)}>
                <Plus size={12} /> 拉人
              </button>
            ) : (
              <span className="boss-panel-addform">
                <input className="boss-panel-input" aria-label="成员名" placeholder="名字" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                <input className="boss-panel-input" aria-label="岗位" placeholder="岗位" value={draftRole} onChange={(e) => setDraftRole(e.target.value)} />
                <button
                  type="button"
                  className="boss-panel-mini"
                  disabled={!draftName.trim() || !draftRole.trim()}
                  onClick={() => {
                    void act(() => window.codex.bossGroupMember({ groupId: group.id, action: "add", name: draftName, role: draftRole }));
                    setDraftName(""); setDraftRole(""); setAdding(false);
                  }}
                >加入</button>
                <button type="button" className="boss-panel-mini" aria-label="取消拉人" onClick={() => setAdding(false)}><X size={11} /></button>
              </span>
            )}
          </div>
          {removed.length ? <div className="boss-panel-removed">已移出：{removed.map((m) => m.name).join("、")}</div> : null}

          <div className="boss-panel-sec-title">置顶更新（{pinnedCards.length}/3）</div>
          {pinnedCards.length === 0 ? (
            <div className="boss-panel-sub">在下方事件上点 📌，把要盯的更新钉在这里（跨重启保留）。</div>
          ) : (
            <div className="boss-panel-pins">
              {pinnedCards.map((e) => (
                <div key={e.id} className="boss-panel-pin">
                  <span className="text">{e.text}</span>
                  <button
                    type="button"
                    className="boss-panel-mini"
                    aria-label="取消置顶"
                    onClick={() => void act(() => window.codex.bossGroupPin({ groupId: group.id, eventId: e.id, pinned: false }))}
                  ><PinOff size={11} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="boss-panel-sec-title">群动态</div>
          <ul className="boss-panel-feed">
            {events.slice().reverse().map((e) => {
              const isPinned = pinnedIds.includes(e.id);
              return (
                <li key={e.id}>
                  <time>{clock(e.at)}</time>
                  <span className="text">{e.text}</span>
                  <button
                    type="button"
                    className="boss-panel-mini"
                    aria-label={isPinned ? "取消置顶" : "置顶这条更新"}
                    onClick={() => void act(() => window.codex.bossGroupPin({ groupId: group.id, eventId: e.id, pinned: !isPinned }))}
                  >
                    {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
