/**
 * 团队模式 · 面板入口（P0）
 *
 * 左：群列表（+ 新建）；右：选中的群（群视图 / 群设置）。
 * ⛔ 独立板块：只依赖本目录 + `src/lib/team-models.mjs`，不 import 任何既有业务域组件。
 *
 * ⛔⛔ 11-06 事故（用户：「这是干嘛啊，我都关不掉呢这个界面」）：
 *   第一版把全屏壳做成 `position: fixed; inset: 0; z-index: 400`，关闭按钮放在面板头最右侧。
 *   窗口是 `frame: false`，三个窗口钮由渲染层自绘、`position: fixed; right: 14px;
 *   z-index: 1000`（必须永远可点，见 components/WindowControls.tsx）。于是：
 *     ① 我的「关闭」正好落在窗口钮那 96×44 的区域里 ⇒ 被 z 1000 盖住，**点不到**；
 *     ② inset:0 顺带盖掉顶栏（应用唯一的窗口拖拽区），窗口既不能拖也没有关闭入口。
 *   ⇒ 改成**应用既有的模态约定**（`.modal-backdrop` + 卡片）：卡片从窗口钮下方开始
 *     （backdrop 上内边距 56px > 窗口钮底部 50px），关闭键放卡片头右侧，三条退路齐备
 *     （卡片头 X / ESC / 点背景）。⛔ 不要再把面板做回 inset:0。
 */
import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, X, Plus, Search, MoreHorizontal, Pencil, Eraser, Trash2 } from "lucide-react";
import { TeamGroupView } from "./04-team-group-view";
import { teamChatOpen, useTeamChatOpen } from "./00-open-store";
import { LOCAL_ACTOR_ID, useTeamGroups } from "./02-team-store";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

export function TeamModePanel() {
  const {
    groups, issues, blockers, limit, loading, error,
    rowsByGroup, busyByGroup, liveByGroup, dispatchError,
    create, rename, addPartner, removePartner, mute, removeGroup, setMemory, setWorkspace, saveFiles, setManagerOf,
    addNote, removeNote, saveMenu, saveMenuPlacement, saveSchedules, runSchedule,
    stopPartner,
    loadMessages, loadRunning, dispatch, clearMessages,
  } = useTeamGroups();
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  /* 左栏（11-06 用户：「群列表功能太少，新建群还在底部」）：新建移到顶部 + 搜索 + 每群操作菜单 */
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameText, setRenameText] = useState("");
  /* 解散群二次确认：⛔ 不用 window.confirm（守卫【191】：原生模态会吞焦点） */
  const [confirmDeleteId, setConfirmDeleteId] = useState("");

  useEffect(() => {
    if (!activeId && groups.length) setActiveId(groups[0].id);
  }, [groups, activeId]);

  /* 点菜单外面就收起（⛔ 不用原生弹窗，也不留一个关不掉的浮层） */
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: PointerEvent) => {
      const hit = (e.target as HTMLElement | null)?.closest?.(".team-mode__group-menu, .team-mode__more");
      if (!hit) { setMenuId(""); setConfirmDeleteId(""); }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuId]);

  /* 切群即读这个群的群视图行（⛔ 主进程才是权威：不靠上一屏的残留在内存里拼）。
     同时拉一次「谁正在跑」—— 面板关掉再打开时，正在处理的伙伴要立刻回到屏幕上，
     ⛔ 不能等它回完才突然冒出整段（用户 11-06 实测的正是这个）。 */
  useEffect(() => {
    if (activeId) {
      void loadMessages(activeId);
      void loadRunning(activeId);
    }
  }, [activeId, loadMessages, loadRunning]);

  const active = useMemo(() => groups.find((g) => g.id === activeId) ?? null, [groups, activeId]);
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase())),
    [groups, query],
  );
  const saveRename = async (groupId: string) => {
    const next = renameText.trim();
    if (next) await rename(groupId, next);
    setRenamingId("");
  };

  const newGroup = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    const r = await create({
      name: n,
      leadId: LOCAL_ACTOR_ID,
      members: [{ id: LOCAL_ACTOR_ID, kind: "human", name: "我" }],
    });
    setCreating(false);
    if (r.ok) {
      setName("");
      setNotice("");
      void (async () => {
        await loadMessages(r.id ?? "");
      })();
    } else {
      setNotice(r.error ?? "建群失败");
    }
  };

  return (
    <div className="team-mode">
      <aside className="team-mode__rail">
        <div className="team-mode__rail-head">
          <div className="team-mode__rail-title">
            <strong>团队</strong>
            <span className="team-mode__rail-sub">{groups.length} / {limit} 个群</span>
          </div>
          <button
            type="button"
            className={`team-mode__add${createOpen ? " is-on" : ""}`}
            title="新建群"
            aria-label="新建群"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((v) => !v)}
          ><Plus size={16} /></button>
        </div>
        {createOpen && (
          <div className="team-mode__create">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="新群名字"
              onKeyDown={(e) => { if (e.key === "Enter") void newGroup(); }}
            />
            <button type="button" onClick={() => void newGroup()} disabled={creating || !name.trim()} title="创建"><Plus size={14} /> 创建</button>
          </div>
        )}
        <div className="team-mode__search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索群名字" aria-label="搜索群" />
        </div>
        <ul className="team-mode__groups">
          {visibleGroups.map((g) => (
            <li key={g.id} className="team-mode__group-row">
              {renamingId === g.id ? (
                <input
                  className="team-mode__rename"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenameText(g.name);
                  }}
                  onBlur={() => { void saveRename(g.id); }}
                  aria-label="群名"
                />
              ) : (
                <button
                  type="button"
                  className={`team-mode__group${g.id === activeId ? " is-active" : ""}`}
                  onClick={() => { setActiveId(g.id); setMenuId(""); }}
                >
                  <i className="team-mode__group-icon"><MessagesSquare size={14} /></i>
                  <span className="team-mode__group-text">
                    <span className="team-mode__group-name">{g.name}</span>
                    <span className="team-mode__group-sub">
                      {g.members.filter((m) => m.kind === "bot").length} 伙伴
                      {(rowsByGroup[g.id]?.length ?? 0) > 0 ? ` · ${rowsByGroup[g.id].length} 条` : ""}
                      {blockers[g.id]?.length ? " · 待处理" : ""}
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="team-mode__more"
                title="群操作"
                aria-label={`${g.name} 的操作`}
                aria-expanded={menuId === g.id}
                onClick={() => { setConfirmDeleteId(""); setMenuId((prev) => (prev === g.id ? "" : g.id)); }}
              ><MoreHorizontal size={14} /></button>
              {menuId === g.id && (
                <div className="team-mode__group-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setRenamingId(g.id); setRenameText(g.name); setMenuId(""); }}>
                    <Pencil size={13} /> 重命名
                  </button>
                  <button type="button" role="menuitem" onClick={() => { void clearMessages(g.id); setMenuId(""); }}>
                    <Eraser size={13} /> 清空聊天记录
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`is-danger${confirmDeleteId === g.id ? " is-armed" : ""}`}
                    title="解散只删群和群记录，伙伴的子会话不动"
                    onClick={() => {
                      if (confirmDeleteId !== g.id) { setConfirmDeleteId(g.id); return; }
                      setConfirmDeleteId("");
                      setMenuId("");
                      void removeGroup(g.id);
                      if (activeId === g.id) setActiveId("");
                    }}
                  ><Trash2 size={13} /> {confirmDeleteId === g.id ? "再点一次确认解散" : "解散群"}</button>
                </div>
              )}
            </li>
          ))}
          {!visibleGroups.length && (
            <li className="team-mode__group-none">{query ? "没有匹配的群" : "还没有群，点右上角 + 新建"}</li>
          )}
        </ul>
        <div className="team-mode__rail-foot">
          <span>最多 {limit} 个群</span>
          <span>@ 伙伴派活</span>
        </div>
        {notice && <p className="team-mode__error" role="status">{notice}</p>}
        {error && <p className="team-mode__error" role="status">{error}</p>}
      </aside>

      <main className="team-mode__main">
        {loading ? (
          <div className="team-mode__blank">正在读取团队…</div>
        ) : active ? (
          <TeamGroupView
            group={active}
            rows={rowsByGroup[active.id] ?? []}
            busy={busyByGroup[active.id] ?? []}
            live={Object.values(liveByGroup[active.id] ?? {})}
            notice={dispatchError}
            issues={issues[active.id]}
            limit={limit}
            onAddPartner={(p) => addPartner(active.id, p)}
            onRemovePartner={(id) => removePartner(active.id, id)}
            onMute={(id, m) => mute(active.id, id, m)}
            onSetManager={(memberId, managerId) => setManagerOf(active.id, memberId, managerId)}
            onSetMemory={(text) => setMemory(active.id, text)}
            onSetWorkspace={(workspace) => setWorkspace(active.id, workspace)}
            onSetFiles={(files) => saveFiles(active.id, files)}
            onAddNote={(note) => addNote(active.id, note)}
            onRemoveNote={(noteId) => removeNote(active.id, noteId)}
            onSaveMenu={(items) => saveMenu(active.id, items as never)}
            onSaveMenuPlacement={(placement) => saveMenuPlacement(active.id, placement)}
            onSaveSchedules={(list) => saveSchedules(active.id, list)}
            onRunSchedule={(scheduleId) => runSchedule(active.id, scheduleId)}
            onStopPartner={(memberId) => stopPartner(active, memberId)}
            onRename={(name) => rename(active.id, name)}
            onClearMessages={() => clearMessages(active.id)}
            onDeleteGroup={async () => {
              const r = await removeGroup(active.id);
              if (r.ok) setActiveId("");
              return r;
            }}
            /* 派活：@ 了谁就把这句话交给谁 —— 各自落各自的子会话，产出再投影回来 */
            onSend={(partnerIds, text, params) => dispatch(active, partnerIds, text, params)}
          />
        ) : (
          <div className="team-mode__blank">
            <p>还没有团队群。</p>
            <p>左边输入名字建一个，然后加伙伴、@ 它派活。</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default TeamModePanel;

/** 群聊面板（侧栏「群聊」打开）。⛔ 关闭有三条退路：卡片头 X / ESC / 点背景空白。 */
export function TeamChatOverlay() {
  const open = useTeamChatOpen();
  const close = () => teamChatOpen.set(false);
  /* ⛔ 走全局 ESC 栈（只让最上层消费），⛔ 不要自己挂 window keydown —— 那样一次 Esc 会关掉多层 */
  useEscapeLayer(open, close);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop team-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="team-modal" role="dialog" aria-modal="true" aria-label="群聊">
        <header className="team-modal__head">
          <div className="team-modal__title">
            <MessagesSquare size={16} className="ic-violet" />
            <strong>群聊</strong>
            <span className="team-modal__sub">把伙伴拉进一个群，@ 它就派活</span>
            <span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span>
          </div>
          {/* ⛔ 关闭键**必须留在卡片内**：卡片从窗口钮下方开始（backdrop 上内边距 56px），
              这一行永远不会落进窗口钮那 96×44 的点击区 —— 11-06 就栽在这里。 */}
          <button
            type="button"
            className="icon-button team-modal__close"
            title="关闭（Esc）"
            aria-label="关闭群聊"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <TeamModePanel />
      </div>
    </div>
  );
}
