/**
 * 顶栏「群成员」入口（10-25 群聊重构：**正常对话框也能看群成员列表** —— 有群就显示，不限于指挥中枢）。
 * - 选中群：当前线程是某群 boss 线程 ⇒ 自动选它；否则用**本会话自己**上次选的群
 *   （panel store 的 groupIdByThread，⛔ 按会话隔离：指挥中枢可以创建多个，A 会话选的群
 *    不会跑到 B 会话上 ⇒ 成员列表不串项）；
 * - popover：群选择器 + 成员列表 + 拉人（专家/本机 CLI agent）/移人，与面板同一条 `boss-groups:member` 通道；
 * - ⛔ portal 到 body + fixed（`.topbar{overflow:hidden}` 会裁掉栏内绝对定位弹层，实测）；
 * - 窄屏由 CSS media query 收起。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Network, Plus, UserMinus, X } from "lucide-react";
import { bossPanelGroupFor, getBossPanelState, setBossPanelGroup, subscribeBossPanel } from "./panel-store.mjs";
import { AppSelect } from "../../components/AppSelect";

type GroupLite = { id: string; name: string; bossThreadId?: string; memberCount?: number; removedCount?: number };
type MemberLite = { id: string; name: string; role: string; status: string; lockedTaskIds: string[]; source?: string };
type SnapLite = { group: { id: string; name: string; members: MemberLite[] } };

const MEMBER_TEXT: Record<string, string> = { idle: "空闲", busy: "正在做", reviewing: "交活待审", locked: "被锁", removed: "已移出" };

export function BossGroupMembersButton({ threadId }: { threadId: string }) {
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [snap, setSnap] = useState<SnapLite | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const [tick, setTick] = useState(0);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const store = useStoreGroupId(threadId);

  /* ⛔ 群选择**按会话**解析（10-25 用户令：指挥中枢可以创建多个，各会话互不干扰）：
     ① 本会话是某群的 boss 线程 ⇒ 选那个群；
     ② 否则用**本会话自己**上次选的群（groupIdByThread[threadId]）；
     ③ 都没有 ⇒ 空（⛔ **不回落**到别的会话/任意群 —— 那就是成员列表串项）。
   */
  const groupId = (groups.find((g) => g.bossThreadId === threadId)?.id) || store.groupId || "";

  const refresh = useCallback(async () => {
    try {
      const list = (await window.codex.listBossGroups()) as GroupLite[];
      setGroups(list ?? []);
      const id = (list ?? []).find((g) => g.bossThreadId === threadId)?.id || bossPanelGroupFor(threadId);
      if (id) setSnap((await window.codex.bossGroupStatus(id)) as SnapLite);
      else setSnap(null);
    } catch { setSnap(null); }
  }, [threadId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    const off = window.codex.onEvent((event: any) => {
      if (event?.type === "boss-group") setTick((n) => n + 1);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [refresh, tick]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(".boss-members-pop")) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  /* 10-25 用户令：图标**常驻**（没群也在，点开给「还没有群」的指引），不再静默消失
     ⛔ 10-25 用户要求第二轮：**未开始对话时置灰不可点击**（灰着、点了没反应），
        开始对话（这个指挥中枢已经有成员）后才可点开看成员列表。
        ⇒ 判据 = **当前会话自己的群**里有活跃成员（不是任意群 —— 别的群的成员跟这条会话无关）。
        置灰用 `disabled`（原生 disabled 不可聚焦 ⇒ 键盘用户也拿不到）⇒ 这里用 aria-disabled
        + 自己拦点击，保留键盘可达性，同时视觉上明确「现在不可用」。 */
  const members = snap?.group?.members ?? [];
  const active = members.filter((m) => m.status !== "removed");
  const removed = members.filter((m) => m.status === "removed");
  /** 当前会话自己的群（bossThreadId 匹配）—— 空态时压根没有 ⇒ 置灰。 */
  const ownGroup = groups.find((g) => g.bossThreadId === threadId);
  /** 这个指挥中枢已经「开始对话」了吗？（自己的群里有活跃成员） */
  const started = Boolean(ownGroup) && active.length > 0;

  const act = async (fn: () => Promise<unknown>) => { await fn(); await refresh(); setTick((n) => n + 1); };

  const popStyle: CSSProperties = (() => {
    const r = btnRef.current?.getBoundingClientRect();
    const width = 300;
    return r
      ? { top: r.bottom + 8, left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)), right: "auto" }
      : { top: 60, left: Math.max(8, (window.innerWidth - width) / 2), right: "auto" };
  })();

  return (
    <div className="boss-members-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`icon-button ic-amber boss-members-btn${open ? " boss-members-btn-open" : ""}${started ? "" : " boss-members-btn-idle"}`}
        title={started ? `群成员（${active.length} 位）` : "还没开始对话 —— 先说需求，指挥中枢拉人建群后这里就能看成员了"}
        aria-expanded={open}
        aria-disabled={!started}
        onClick={() => { if (!started) return; setOpen((v) => !v); }}
      >
        <Network size={16} />
      </button>
      {open
        ? createPortal(
          <div className="boss-members-pop" role="dialog" aria-label="群成员列表" style={popStyle}>
            <div className="boss-members-pop-head">
              {groups.length > 1 ? (
                /* ⛔ 渲染层不许用原生 `<select>`（守卫【197】）；popover 里的下拉同样走 AppSelect */
                <AppSelect
                  className="boss-panel-select boss-members-pop-select"
                  ariaLabel="切换群"
                  value={groupId}
                  onChange={(next) => { setBossPanelGroup(next, threadId); void refresh(); }}
                  /* 10-25：下拉里直接显示每个群的**在群人数**（不含已移出）——
                     否则用户在一个群里拉了人、弹窗停在另一个群，就以为「没实时更新」。 */
                  options={groups.map((g) => ({ value: g.id, label: `${g.name}（${g.memberCount ?? 0} 人${g.removedCount ? ` · 已移出 ${g.removedCount}` : ""}）` }))}
                />
              ) : (
                <b>{snap?.group?.name ?? groups[0]?.name}</b>
              )}
              <span>成员 {active.length}{removed.length ? ` · 已移出 ${removed.length}` : ""}</span>
              <button type="button" className="boss-panel-mini" aria-label="关闭" onClick={() => setOpen(false)}><X size={11} /></button>
            </div>
            {!groups.length ? (
              <div className="boss-members-pop-hint">还没有群。对 Codex 说「建个群：写手 + 前端，把 XX 派下去，验收标准是……」即可建群拉人。</div>
            ) : null}
            <div className="boss-members-pop-list">
              {active.map((m) => (
                <span key={m.id} className="boss-groups-member" data-status={m.status} title={`${m.role}${m.source === "cli" ? " · 本机 CLI agent" : ""}${m.lockedTaskIds.length ? ` · 锁在 ${m.lockedTaskIds.length} 条任务上` : ""}`}>
                  {m.name} · {MEMBER_TEXT[m.status] ?? m.status}
                  <button
                    type="button"
                    className="boss-panel-mini"
                    aria-label={`移出 ${m.name}`}
                    title="移出群（会话与轨迹保留，正在跑的任务不打断）"
                    onClick={() => void act(() => window.codex.bossGroupMember({ groupId, action: "remove", memberId: m.id }))}
                  >
                    <UserMinus size={11} />
                  </button>
                </span>
              ))}
              {!adding ? (
                <button type="button" className="boss-panel-mini boss-panel-add" onClick={() => setAdding(true)}>
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
                      void act(() => window.codex.bossGroupMember({ groupId, action: "add", name: draftName, role: draftRole }));
                      setDraftName(""); setDraftRole(""); setAdding(false);
                    }}
                  >加入</button>
                  <button type="button" className="boss-panel-mini" aria-label="取消拉人" onClick={() => setAdding(false)}><X size={11} /></button>
                </span>
              )}
            </div>
            {removed.length ? <div className="boss-panel-removed">已移出：{removed.map((m) => m.name).join("、")}</div> : null}
            <div className="boss-members-pop-hint">拉专家 / 本机 CLI agent（zcode、豆包…）走群里对中枢说「拉 XX 进群」，或用 group_add_member。</div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

/** 本会话选中的群 id 的订阅（⛔ 按会话隔离：指挥中枢可创建多个，各会话各选各的）。 */
function useStoreGroupId(threadId: string): { groupId: string } {
  const state = useSyncExternalStore(subscribeBossPanel, getBossPanelState);
  return { groupId: state.groupIdByThread?.[threadId] ?? "" };
}
