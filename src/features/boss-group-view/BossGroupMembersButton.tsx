/**
 * 顶栏「群成员」入口（10-25 群聊重构：**正常对话框也能看群成员列表** —— 有群就显示，不限于 BOSS 会话）。
 * - 选中群：当前线程是某群 boss 线程 ⇒ 自动选它；否则沿用上次选择（panel store 的 groupId）；
 * - popover：群选择器 + 成员列表 + 拉人（专家/本机 CLI agent）/移人，与面板同一条 `boss-groups:member` 通道；
 * - ⛔ portal 到 body + fixed（`.topbar{overflow:hidden}` 会裁掉栏内绝对定位弹层，实测）；
 * - 窄屏由 CSS media query 收起。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Network, Plus, UserMinus, X } from "lucide-react";
import { getBossPanelState, setBossPanelGroup, subscribeBossPanel } from "./panel-store.mjs";

type GroupLite = { id: string; name: string; bossThreadId?: string };
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
  const store = useStoreGroupId();

  const groupId = (groups.find((g) => g.bossThreadId === threadId)?.id) || store.groupId || groups[0]?.id || "";

  const refresh = useCallback(async () => {
    try {
      const list = (await window.codex.listBossGroups()) as GroupLite[];
      setGroups(list ?? []);
      const id = (list ?? []).find((g) => g.bossThreadId === threadId)?.id || getBossPanelState().groupId || (list ?? [])[0]?.id || "";
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

  /* 10-25 用户令：图标**常驻**（没群也在，点开给「还没有群」的指引），不再静默消失 */
  const members = snap?.group?.members ?? [];
  const active = members.filter((m) => m.status !== "removed");
  const removed = members.filter((m) => m.status === "removed");

  const act = async (fn: () => Promise<unknown>) => { await fn(); await refresh(); setTick((n) => n + 1); };

  const popStyle: CSSProperties = (() => {
    const r = btnRef.current?.getBoundingClientRect();
    return r
      ? { top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }
      : { top: 60, right: 12 };
  })();

  return (
    <div className="boss-members-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`icon-button ic-amber boss-members-btn${open ? " boss-members-btn-open" : ""}`}
        title={`群成员（${groups.length} 个群）`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Network size={16} />
      </button>
      {open
        ? createPortal(
          <div className="boss-members-pop" role="dialog" aria-label="群成员列表" style={popStyle}>
            <div className="boss-members-pop-head">
              {groups.length > 1 ? (
                <select className="boss-panel-select boss-members-pop-select" aria-label="切换群" value={groupId} onChange={(e) => { setBossPanelGroup(e.target.value); void refresh(); }}>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              ) : (
                <b>{snap?.group?.name ?? groups[0]?.name}</b>
              )}
              <span>成员 {active.length}</span>
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
            <div className="boss-members-pop-hint">拉专家 / 本机 CLI agent（zcode、豆包…）走群里对 BOSS 说「拉 XX 进群」，或用 group_add_member。</div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

/** store groupId 的订阅（跨开合记住上次选择的群）。 */
function useStoreGroupId(): { groupId: string } {
  return useSyncExternalStore(subscribeBossPanel, getBossPanelState);
}
