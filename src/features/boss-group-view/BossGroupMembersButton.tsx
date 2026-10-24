/**
 * 顶栏「群成员」按钮（10-24 用户令：做成在搜索历史图标**左边**，只有 BOSS 会话显示，
 * 自适应多尺寸下展示/隐藏 —— 窄屏由 CSS media query 收起）。
 *
 * 数据口径：当前会话 threadId 命中某个群的 bossThreadId 才渲染；成员增删与右侧面板走同一条
 * `boss-groups:member` 通道（真相源唯一）。点击弹成员 popover：chips + 拉人表单。
 *
 * ⛔ popover 必须 portal 到 body + fixed：`.topbar { overflow: hidden }`（10-04 防溢出裁剪）
 *    会把栏内绝对定位弹层整个切掉 —— 弹了也看不见（与当前会话搜索面板同坑，实测复现）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Network, Plus, UserMinus, X } from "lucide-react";

type GroupLite = { id: string; name: string; bossThreadId?: string };
type MemberLite = { id: string; name: string; role: string; status: string; lockedTaskIds: string[] };
type SnapLite = { group: { id: string; name: string; members: MemberLite[] } };

const MEMBER_TEXT: Record<string, string> = { idle: "空闲", busy: "正在做", reviewing: "交活待审", locked: "被锁", removed: "已移出" };

export function BossGroupMembersButton({ threadId }: { threadId: string }) {
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const [tick, setTick] = useState(0);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    if (!threadId) { setGroupId(""); setOpen(false); return; }
    try {
      const list = (await window.codex.listBossGroups()) as GroupLite[];
      const hit = (list ?? []).find((g) => g.bossThreadId === threadId);
      if (!hit) { setGroupId(""); setOpen(false); return; }
      setGroupId(hit.id);
      setGroupName(hit.name);
      const snap = (await window.codex.bossGroupStatus(hit.id)) as SnapLite;
      setMembers(snap?.group?.members ?? []);
    } catch { setGroupId(""); }
  }, [threadId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    const off = window.codex.onEvent((event: any) => {
      if (event?.type === "boss-group") setTick((n) => n + 1);
    });
    return () => { clearInterval(timer); off?.(); };
  }, [refresh, tick]);

  // 点外面收起（portal 在 body 上，window 级 mousedown 才罩得住；按钮本身与弹层内部点击除外）
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

  if (!groupId) return null;
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
        title={`群成员（${groupName}）`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Network size={16} />
      </button>
      {open
        ? createPortal(
          <div className="boss-members-pop" role="dialog" aria-label="群成员管理" style={popStyle}>
            <div className="boss-members-pop-head">
              <b>{groupName}</b>
              <span>成员 {active.length}</span>
              <button type="button" className="boss-panel-mini" aria-label="关闭" onClick={() => setOpen(false)}><X size={11} /></button>
            </div>
            <div className="boss-members-pop-list">
              {active.map((m) => (
                <span key={m.id} className="boss-groups-member" data-status={m.status} title={m.lockedTaskIds.length ? `锁在 ${m.lockedTaskIds.length} 条任务上` : undefined}>
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
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
