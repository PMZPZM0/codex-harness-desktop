/**
 * BOSS 会话面板（右侧停靠浮层，2026-10-24；23:40 按用户令重做成**群对话框**）
 *
 * 「点击 BOSS 会话直接进入这个对话框，而不是新建回合」：
 *  - 底部输入框 = 你在群里说话（boss-groups:say → boss 线程，不新建会话/回合入口）；
 *  - 群流 = 聊天气泡（你右 / boss 右 / 成员左 / 系统事件居中小字）——回复发生在群里；
 *  - 成员展示移到顶栏图标（BossGroupMembersButton，仅 BOSS 会话显示），这里不再重复。
 * ⛔ 真相源不变：账本在 `boss-groups.json`；本面板只做「说话 + 置顶」，其余只读。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Crown, Pin, PinOff, SendHorizontal, X } from "lucide-react";
import { closeBossPanel, getBossPanelState, setBossPanelGroup, subscribeBossPanel, type BossPanelState } from "./panel-store.mjs";
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
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);   // 默认只看汇总消息
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
    if (!panel.open) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 4000);
    const off = window.codex.onEvent((event: any) => {
      if (event?.type === "boss-group") setTick((n) => n + 1);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [panel.open, refresh, tick]);

  // 新消息 → 贴底（只在已经接近底部时自动跟，避免打断你往上翻）
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [tick, snap]);

  // 打开时聚焦输入框（「直接进入对话框」的手感）
  useEffect(() => {
    if (panel.open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [panel.open, panel.groupId]);

  if (!panel.open) return null;

  const memberName = (id?: string) => snap?.group.members.find((m) => m.id === id)?.name ?? "成员";
  const pinnedIds = snap?.group.pinnedEventIds ?? [];
  const allEvents = snap?.events ?? [];
  const events = showAll ? allEvents : allEvents.filter((e) => e.kind === "chat-user" || e.kind === "chat-boss" || e.kind === "chat-member");
  const pinnedCards = pinnedIds.map((id) => allEvents.find((e) => e.id === id)).filter(Boolean) as typeof allEvents;
  const isChat = (kind: string) => kind === "chat-user" || kind === "chat-boss" || kind === "chat-member";

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
    <aside className="boss-panel" role="complementary" aria-label="BOSS 会话群对话框">
      <header className="boss-panel-head">
        <span className="boss-panel-title"><Crown size={14} aria-hidden="true" /> BOSS 会话</span>
        {groups.length > 1 ? (
          /* ⛔ 渲染层不许用原生 `<select>`（守卫【197】） */
          <AppSelect
            className="boss-panel-select"
            ariaLabel="切换群"
            value={groupId}
            onChange={(next) => setBossPanelGroup(next)}
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        ) : group ? (
          <span className="boss-panel-sub">{group.name}</span>
        ) : null}
        {/* 10-25 用户实测：「右侧群成员头像也没有」—— 群聊现场要能一眼看到成员在不在。 */}
        <div className="boss-member-strip" title="群成员">
          {(snap?.group.members ?? []).filter((m) => m.status !== "removed").map((m, i) => (
            <span key={m.id} className="boss-avatar" data-status={m.status} style={{ ["--boss-avatar-hue" as any]: `${(i * 47 + 210) % 360}` }} title={`${m.name}（${m.role}）`}>
              {String(m.name || "?").slice(0, 1)}
            </span>
          ))}
        </div>
        <button
          type="button"
          className={`boss-panel-mini boss-panel-dynamic${showAll ? " is-on" : ""}`}
          aria-pressed={showAll}
          title="群动态：中间过程事件（默认只看汇总消息）"
          onClick={() => setShowAll((v) => !v)}
        >动态</button>
        <button type="button" className="boss-panel-x" aria-label="关闭群对话框" onClick={() => closeBossPanel()}>
          <X size={14} />
        </button>
      </header>

      {!group ? (
        <div className="boss-panel-empty">
          <b>还没有群</b>
          在这里直接说：<code>建个群：写手 + 前端，把 XX 派下去，验收标准是……</code>
          <br />建好后这里就是群聊现场。
        </div>
      ) : (
        <>
          <div className="boss-panel-pins">
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

          <div className="boss-panel-feed" ref={feedRef}>
            {events.length === 0 ? <div className="boss-panel-sub">在下面说第一句话，把活派起来。</div> : null}
            {events.map((e) => {
              if (isChat(e.kind)) {
                const side = e.kind === "chat-user" ? "right" : "left";   // 正常群聊：只有你在右，BOSS/成员都在左
                const who = e.kind === "chat-user" ? "你" : e.kind === "chat-boss" ? "BOSS" : memberName(e.memberId);
                const member = e.kind === "chat-member" ? (snap?.group.members ?? []).find((m) => m.id === e.memberId) : undefined;
                return (
                  <div key={e.id} className={`boss-chat-row side-${side}`}>
                    {/* 成员气泡带头像（群聊现场感）；你/BOSS 不带。 */}
                    {e.kind === "chat-member" ? (
                      <span className="boss-avatar" data-status={member?.status} style={{ ["--boss-avatar-hue" as any]: `${(((snap?.group.members ?? []).findIndex((m) => m.id === e.memberId) + 1) * 47 + 210) % 360}` }} title={who}>{String(who || "?").slice(0, 1)}</span>
                    ) : null}
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

          <form
            className="boss-panel-composer"
            onSubmit={(ev) => { ev.preventDefault(); void send(); }}
          >
            <input
              ref={inputRef}
              className="boss-panel-input boss-panel-composer-input"
              aria-label="在群里说话"
              placeholder="对群说点什么（派活 / 追进度 / 审查指令）…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="boss-panel-mini boss-panel-send" aria-label="发送" disabled={!draft.trim() || sending}>
              <SendHorizontal size={13} />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
