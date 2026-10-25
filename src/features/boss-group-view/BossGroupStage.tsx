/**
 * BOSS 会话专属界面（10-25 用户令：点击侧栏「BOSS 会话」要**切换主界面**进群聊，
 * 不是只弹侧边小面板）。由 AppViewMainStage 在 store.stage 为真时整块渲染，替代普通会话时间线。
 *
 * - 退出：右上 ✕（回普通会话）；点任何其它会话 / 新会话也会自动退出（见 02-main-stage 的接线）。
 * - 数据与右侧面板同源：boss-groups.json 唯一真相源，4s 轮询 + `boss-group` 事件即时刷新。
 * - 聊天气泡语义与面板一致：你/BOSS 右、成员左、系统事件居中小字；置顶带、底部输入框同款。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Crown, Network, Pin, PinOff, SendHorizontal, X } from "lucide-react";
import { closeBossStage, getBossPanelState, setBossPanelGroup, subscribeBossPanel, type BossPanelState } from "./panel-store.mjs";
import { AppSelect } from "../../components/AppSelect";

type GroupSummary = { id: string; name: string; paused: boolean; memberCount: number; taskCount: number };
type Snapshot = {
  group: {
    id: string; name: string; paused: boolean; bossThreadId: string;
    policy: { maxRejects: number; stallMs: number; budgetMinutes: number };
    members: { id: string; name: string; role: string; status: string; lockedTaskIds: string[]; source?: string }[];
    pinnedEventIds: string[];
  };
  tasks: { id: string; title: string; status: string }[];
  events: { id: string; kind: string; text: string; at: number; memberId?: string; taskId?: string }[];
};

const MEMBER_TEXT: Record<string, string> = { idle: "空闲", busy: "正在做", reviewing: "交活待审", locked: "被锁", removed: "已移出" };

/** 汇总消息 = 群聊正文；其余 kind 是过程事件（只在「群动态」里看）。 */
export function isChatKind(kind: string): boolean {
  return kind === "chat-user" || kind === "chat-boss" || kind === "chat-member";
}

function clock(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BossGroupStage() {
  const panel = useSyncExternalStoreWithStage();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);   // 群动态开关：默认只看汇总消息（10-25 用户令）
  const [railOpen, setRailOpen] = useState<boolean | null>(null);  // null = 跟随（有成员就显示）
  const feedRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    if (!panel.stage) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 4000);
    const off = window.codex.onEvent((event: any) => {
      if (event?.type === "boss-group") setTick((n) => n + 1);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [panel.stage, refresh, tick]);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [tick, snap]);

  useEffect(() => {
    if (panel.stage) setTimeout(() => inputRef.current?.focus(), 80);
  }, [panel.stage, panel.groupId]);

  if (!panel.stage) return null;

  const memberName = (id?: string) => snap?.group.members.find((m) => m.id === id)?.name ?? "成员";
  const pinnedIds = snap?.group.pinnedEventIds ?? [];
  const allEvents = snap?.events ?? [];
  /* ⛔ 10-25 用户令：群聊只显示**汇总消息**（你说的话/BOSS 回复/成员交活汇总）；
     派活、开始做、审查过、打回这些中间过程不进对话框（防刷屏），收进「群动态」开关里。 */
  const events = showAll ? allEvents : allEvents.filter((e) => isChatKind(e.kind));
  const pinnedCards = pinnedIds.map((id) => allEvents.find((e) => e.id === id)).filter(Boolean) as typeof allEvents;
  const activeMembers = (snap?.group.members ?? []).filter((m) => m.status !== "removed");
  const railShown = railOpen === null ? activeMembers.length > 0 : railOpen;

  const send = async () => {
    const text = draft.trim();
    if (!text || !groupId || sending) return;
    setSending(true);
    try {
      await window.codex.bossGroupSay({ groupId, text });
      setDraft("");
      setTick((n) => n + 1);
      await refresh();
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="boss-stage" aria-label="BOSS 会话群聊">
      <header className="boss-stage-head">
        <span className="boss-stage-title"><Crown size={16} aria-hidden="true" /> BOSS 会话</span>
        {groups.length > 1 ? (
          /* ⛔ 渲染层不许用原生 `<select>`（守卫【197】）：系统 option 弹层无法样式化 */
          <AppSelect
            className="boss-panel-select"
            ariaLabel="切换群"
            value={groupId}
            onChange={(next) => setBossPanelGroup(next)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        ) : (
          <b className="boss-stage-group">{snap?.group.name ?? group?.name ?? ""}</b>
        )}
        {/* 10-25 用户令：头部给**成员图标**，点击展开/收起右侧成员轨（图标始终在，0 人也能点开看提示） */}
        <button
          type="button"
          className={`boss-stage-members-btn${railShown ? " boss-stage-members-btn-on" : ""}`}
          aria-expanded={railShown}
          title="群成员列表"
          onClick={() => setRailOpen((v) => (v === null ? !(activeMembers.length > 0) : !v))}
        >
          <Network size={14} />
          <span>成员 {activeMembers.length}</span>
        </button>
        {snap?.group.paused ? <span className="boss-stage-paused">已暂停</span> : null}
        <button
          type="button"
          className={`boss-panel-mini boss-stage-dynamic${showAll ? " boss-stage-dynamic-on" : ""}`}
          aria-pressed={showAll}
          title="群动态：派活/审查/打回等中间过程（默认只看汇总消息，防刷屏）"
          onClick={() => setShowAll((v) => !v)}
        >群动态</button>
        <button type="button" className="boss-panel-x" aria-label="退出 BOSS 界面（回普通会话）" onClick={() => closeBossStage()}>
          <X size={15} />
        </button>
      </header>

      {!group ? (
        /* ⛔ 空态不许只给文字：原文案「在下面说第一句话」下面并没有输入框（没有群就没法 say）
           ⇒ 死路。这里给一个明确的出口，回普通会话里建群。 */
        <div className="boss-stage-empty">
          <b>还没有群</b>
          <span>在普通会话里说一句：<code>建个群：写手 + 前端，把 XX 派下去，验收标准是……</code></span>
          <button type="button" className="boss-panel-mini" onClick={() => closeBossStage()}>
            回普通会话去建群
          </button>
        </div>
      ) : (
        <>
          {pinnedCards.length ? (
            <div className="boss-stage-pins">
              {pinnedCards.map((e) => (
                <div key={e.id} className="boss-panel-pin">
                  <Pin size={11} aria-hidden="true" />
                  <span className="text">{e.text}</span>
                  <button
                    type="button"
                    className="boss-panel-mini"
                    aria-label="取消置顶"
                    onClick={() => void window.codex.bossGroupPin({ groupId: group.id, eventId: e.id, pinned: false }).then(refresh)}
                  ><PinOff size={11} /></button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="boss-stage-body">
          <div className="boss-stage-main">
          <div className="boss-stage-feed" ref={feedRef}>
            {events.length === 0 ? <div className="boss-panel-sub">在下面说第一句话，把活派起来。</div> : null}
            {events.map((e) => {
              if (isChatKind(e.kind)) {
                const side = e.kind === "chat-user" ? "right" : "left";   // 正常群聊：只有你在右，BOSS/成员都在左
                const who = e.kind === "chat-user" ? "你" : e.kind === "chat-boss" ? "BOSS" : memberName(e.memberId);
                return (
                  <div key={e.id} className={`boss-chat-row side-${side}`}>
                    <div className="boss-chat-bubble" data-kind={e.kind}>
                      <span className="who">{who}</span>
                      <span className="text">{e.text}</span>
                    </div>
                    <time>{clock(e.at)}</time>
                  </div>
                );
              }
              const isPinned = pinnedIds.includes(e.id);
              return (
                <div key={e.id} className="boss-chat-sys">
                  <time>{clock(e.at)}</time>
                  <span className="text">{e.text}</span>
                  <button
                    type="button"
                    className="boss-panel-mini"
                    aria-label={isPinned ? "取消置顶" : "置顶这条更新"}
                    title={isPinned ? "取消置顶" : "置顶到顶部"}
                    onClick={() => void window.codex.bossGroupPin({ groupId: group.id, eventId: e.id, pinned: !isPinned }).then(refresh)}
                  >
                    {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                  </button>
                </div>
              );
            })}
          </div>

          </div>
          {railShown ? <aside className="boss-stage-rail" aria-label="群成员">
            {!activeMembers.length ? <div className="boss-rail-empty">还没有成员<br />在下面说话拉人</div> : null}
            {activeMembers.map((m) => (
              <div key={m.id} className="boss-rail-node" data-status={m.status} title={`${m.name} · ${MEMBER_TEXT[m.status] ?? m.status}${m.source === "cli" ? " · 本机 CLI agent" : ""}`}>
                <span className="boss-rail-avatar" data-status={m.status}>{m.name.slice(0, 1)}</span>
                <small>{m.name}</small>
              </div>
            ))}
          </aside> : null}
          </div>
          <form className="boss-stage-composer" onSubmit={(ev) => { ev.preventDefault(); void send(); }}>
            <input
              ref={inputRef}
              className="boss-panel-input boss-stage-composer-input"
              aria-label="在群里说话"
              placeholder="对群说点什么（派活 / 追进度 / 审查指令）…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="boss-panel-mini boss-stage-send" aria-label="发送" disabled={!draft.trim() || sending}>
              <SendHorizontal size={14} />
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/** 面板 store 的订阅收口（stage 字段加上后这里统一读）。 */
function useSyncExternalStoreWithStage(): BossPanelState {
  return useSyncExternalStore(subscribeBossPanel, getBossPanelState) as BossPanelState;
}
