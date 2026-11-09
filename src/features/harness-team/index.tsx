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
import { MessagesSquare, X, Plus, Search, MoreHorizontal, Pencil, Eraser, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { TeamCreateDialog } from "./12-team-create";
import type { TeamCreateInput } from "./12-team-create";
import { TeamGroupView } from "./04-team-group-view";
import { teamChatOpen, useTeamChatOpen } from "./00-open-store";
import { useTeamGroups } from "./02-team-store";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import type { HarnessAppApi } from "../app-state";

type TeamPanelProps = {
  onOpenModelSettings?: () => void;
  /** 正向联动（11-07 用户令）：点群消息的「来源」打开那条会话；宿主关掉设置页再打开。 */
  onOpenThread?: (threadId: string) => void;
  /** 11-07 用户令「输入框侧边粗条同步」：群输入框里的 ComposerRail 需要宿主 app。 */
  app?: HarnessAppApi;
  /** 11-08 独立窗口：关闭键改为关本窗口（不是把浮层收起来变成空白）。 */
  onCloseWindow?: () => void;
};

/** 团队模式面板：群列表 + 群视图 + 设置，所有群级操作从这里下发。 */
export function TeamModePanel({ onOpenModelSettings, onOpenThread, app }: TeamPanelProps = {}) {
  const {
    groups, issues, blockers, limit, loading, error,
    rowsByGroup, busyByGroup, liveByGroup, dispatchError, goneThreads,
    create, rename, addPartner, removePartner, mute, setAvatar, renameMember, removeGroup, setMemory, setWorkspace, saveFiles, setManagerOf,
    addNote, removeNote, saveMessageLayout, saveReplyMode, saveSchedules, runSchedule, saveMessageForm, saveDialogFlow,
    stopPartner, stopAll, threadsOf,
    loadMessages, loadRunning, dispatch, clearMessages,
  } = useTeamGroups();
  const [activeId, setActiveId] = useState("");
  const [notice, setNotice] = useState("");
  /* 左栏（11-06 用户：「群列表功能太少，新建群还在底部」）：新建移到顶部 + 搜索 + 每群操作菜单。
     ⛔ 11-06 二次（用户：「这个新建群里展示也不好看，做成弹窗，功能丰富一点」）：
       `createOpen` 现在只表示**弹窗开没开**，名字/简介/项目地址/初始伙伴全部搬进弹窗填一次。 */
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameText, setRenameText] = useState("");
  /* 解散群确认（11-07 用户：「删除帮我做成弹窗」）：
     不再在菜单里要求「再点一次」，点解散直接开确认弹窗（⛔ 不用 window.confirm，守卫【191】）。 */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  /* ⛔ 11-08 用户：「两边侧边栏都没有展开折叠按键」⇒ 左栏可收起成 48px 迷你条。
     落 localStorage（与输入框高度同口径）：关掉面板再开、重启应用都保持上次的状态。 */
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem("harness-team:rail-collapsed") === "1"; } catch { return false; }
  });
  const toggleRail = (next: boolean) => {
    setRailCollapsed(next);
    try { localStorage.setItem("harness-team:rail-collapsed", next ? "1" : "0"); } catch { /* 存储不可用：本次会话内有效 */ }
  };

  useEffect(() => {
    if (!activeId && groups.length) setActiveId(groups[0].id);
  }, [groups, activeId]);

  /* 点菜单外面就收起（⛔ 不用原生弹窗，也不留一个关不掉的浮层） */
  /* 解散确认弹窗：Esc 只关这一层（走全局 ESC 栈，⛔ 不自己挂 keydown） */
  useEscapeLayer(!!deleteTarget, () => setDeleteTarget(null));

  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: PointerEvent) => {
      const hit = (e.target as HTMLElement | null)?.closest?.(".team-mode__group-menu, .team-mode__more");
      if (!hit) setMenuId("");
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

  /* 解散群（确认弹窗的回调）：群聊派出的会话跟着删，主进程返回删了几条，这里如实说出来。 */
  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    const r = await removeGroup(target.id);
    if (!r.ok) { setNotice(r.error || "解散失败"); return; }
    setNotice(
      r.totalThreads
        ? `已解散「${target.name}」，连同 ${r.removedThreads}/${r.totalThreads} 条群会话${r.failed.length ? `（${r.failed.length} 条删不掉）` : ""}`
        : `已解散「${target.name}」`,
    );
    if (activeId === target.id) setActiveId("");
  };

  /* 弹窗负责收集 input（名字/简介/项目地址/初始伙伴），这里只管落库并回报结果。 */
  const createFromDialog = async (input: TeamCreateInput) => {
    const r = await create(input);
    if (!r.ok) return { ok: false, error: r.error ?? "建群失败" };
    setNotice("");
    return { ok: true, id: r.id };
  };

  return (
    <div className={`team-mode${railCollapsed ? " is-rail-collapsed" : ""}`}>
      <aside className="team-mode__rail">
        {railCollapsed ? (
          /* 收起态：只留两个图标（展开 / 新建），群列表整块不渲染 —— 主列因此多出 128px */
          <div className="team-mode__rail-mini">
            <button
              type="button"
              className="team-mode__add"
              title="展开群列表"
              aria-label="展开群列表"
              onClick={() => toggleRail(false)}
            ><PanelLeftOpen size={15} /></button>
            <button
              type="button"
              className="team-mode__add"
              title="新建群"
              aria-label="新建群"
              aria-haspopup="dialog"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen(true)}
            ><Plus size={15} /></button>
          </div>
        ) : (
        <>
        <div className="team-mode__rail-head">
          <div className="team-mode__rail-title">
            <strong>团队</strong>
            <span className="team-mode__rail-sub" title={`${groups.length} / ${limit} 个群`}>{groups.length}/{limit}</span>
          </div>
          <div className="team-mode__rail-actions">
            <button
              type="button"
              className="team-mode__add"
              title="新建群"
              aria-label="新建群"
              aria-haspopup="dialog"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen(true)}
            ><Plus size={15} /></button>
            <button
              type="button"
              className="team-mode__add"
              title="收起群列表"
              aria-label="收起群列表"
              onClick={() => toggleRail(true)}
            ><PanelLeftClose size={15} /></button>
          </div>
        </div>
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
                onClick={() => setMenuId((prev) => (prev === g.id ? "" : g.id))}
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
                    className="is-danger"
                    title="解散会同时删除这个群里派出去的会话（11-07 用户令：删群后外面不该还留着）"
                    onClick={() => {
                      /* 11-07 用户：「删除帮我做成弹窗」——不再在菜单里要求二次点击。 */
                      setMenuId("");
                      setDeleteTarget({ id: g.id, name: g.name });
                    }}
                  ><Trash2 size={13} /> 解散群</button>
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
        </>
        )}
      </aside>

      <main className="team-mode__main">
        {loading ? (
          <div className="team-mode__blank">正在读取团队…</div>
        ) : active ? (
          <TeamGroupView
            app={app}
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
            onSetMessageLayout={(next) => void saveMessageLayout(active.id, next)}
            /* 回复模式（11-08 用户令：群设置里加选项）
               ⛔⛔ 必须同时传**读值**：只传写入回调时视图永远用默认 process
               ⇒ 点「占位模式」写进了群 JSON，界面却纹丝不动（用户：「选不了，点不过来」）。 */
            replyMode={active.replyMode === "placeholder" ? "placeholder" : "process"}
            onSetReplyMode={(next) => void saveReplyMode(active.id, next)}
            /* 群消息形式：独立选项（用户「话题模式不要放在回复模式一排」） */
            messageForm={active.messageForm === "topic" ? "topic" : "chat"}
            onSetMessageForm={(next) => void saveMessageForm(active.id, next)}
            /* 群对话流（11-09 用户令）：默认折叠；打开后运行中铺开过程 */
            dialogFlow={active.dialogFlow === "detail" ? "detail" : "simple"}
            onSetDialogFlow={(next) => void saveDialogFlow(active.id, next)}
            onSaveSchedules={(list) => saveSchedules(active.id, list)}
            onRunSchedule={(scheduleId) => runSchedule(active.id, scheduleId)}
            onStopPartner={(memberId) => stopPartner(active, memberId)}
            /* 11-08 用户令「点停止是群里所有运行状态都停止掉」：候选由视图数（群内会话 id），
               store 负责发通道 + 立刻清 busy/live。 */
            onStopAll={(threadIds) => stopAll(active.id, threadIds)}
            /* 运行中的伙伴要拿会话 id 才能把消息塞进它的引擎队列（见 23-team-queue） */
            threadsOfMember={(memberId) => threadsOf(active.id, memberId)}
            /* 群内成员头像（11-07）：点成员栏那些小头像就能换，只影响这个群 */
            onSetAvatar={(memberId: string, avatar: string) => setAvatar(active.id, memberId, avatar)}
            onRenameMember={(memberId: string, name: string) => renameMember(active.id, memberId, name)}
            onRename={(name) => rename(active.id, name)}
            onClearMessages={() => clearMessages(active.id)}
            onDeleteGroup={async () => {
              const r = await removeGroup(active.id);
              if (r.ok) setActiveId("");
              return r;
            }}
            /* 派活：@ 了谁就把这句话交给谁 —— 各自落各自的子会话，产出再投影回来 */
            onSend={(partnerIds, text, params) => dispatch(active, partnerIds, text, params)}
            onOpenModelSettings={onOpenModelSettings}
            /* 正反向联动（11-07 用户令）：来源 → 打开会话；已删的会话标「已删除」不可点 */
            onOpenThread={onOpenThread}
            goneThreads={goneThreads}
          />
        ) : (
          <div className="team-mode__blank">
            <p>还没有团队群。</p>
            <p>左边输入名字建一个，然后加伙伴、@ 它派活。</p>
          </div>
        )}
      </main>

      {/* 解散群确认弹窗（11-07 用户：「删除帮我做成弹窗」）——覆盖整块面板，ESC / 点背景 / 取消都能退 */}
      {deleteTarget && (
        <div
          className="team-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="解散群"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}
        >
          <div className="team-sheet__card team-sheet__card--confirm">
            <header className="team-sheet__head">
              <div className="team-sheet__title">
                <Trash2 size={15} className="ic-pink" />
                <strong>解散群</strong>
                <span className="esc-hint" title="按 ESC 关闭">ESC</span>
              </div>
              <button type="button" className="icon-button" title="关闭（Esc）" aria-label="关闭" onClick={() => setDeleteTarget(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="team-sheet__body">
              <p className="team-sheet__hint">确定解散「{deleteTarget.name}」？这个群里派出去的会话会一起删除，删除后无法恢复。</p>
            </div>
            <footer className="team-sheet__foot">
              <span className="team-sheet__foot-hint">群消息与群内会话都会删除</span>
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="is-primary is-danger" onClick={() => void confirmDelete()}>解散并删除</button>
            </footer>
          </div>
        </div>
      )}

      {/* 新建群弹窗：覆盖整块面板（不离开群聊上下文），ESC 只关这一层 */}
      <TeamCreateDialog
        open={createOpen}
        count={groups.length}
        limit={limit}
        onClose={() => setCreateOpen(false)}
        onCreate={createFromDialog}
        onCreated={(id) => {
          if (!id) return;
          setActiveId(id);
          void loadMessages(id);
        }}
      />
    </div>
  );
}

export default TeamModePanel;

/** 群聊面板（侧栏「群聊」打开）。⛔ 关闭有三条退路：卡片头 X / ESC / 点背景空白。 */
export function TeamChatOverlay({ onOpenModelSettings, onOpenThread, app, onCloseWindow }: TeamPanelProps = {}) {
  const open = useTeamChatOpen();
  const close = () => (onCloseWindow ? onCloseWindow() : teamChatOpen.set(false));
  /* ⛔ 走全局 ESC 栈（只让最上层消费），⛔ 不要自己挂 window keydown —— 那样一次 Esc 会关掉多层 */
  /* ⛔ 独立窗口里按 ESC 不该把窗口关掉（用户要挂后台），只留头部关闭键。 */
  useEscapeLayer(!onCloseWindow && open, close);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop team-backdrop"
      onMouseDown={(event) => { if (!onCloseWindow && event.target === event.currentTarget) close(); }}
    >
      <div className="team-modal" role="dialog" aria-modal="true" aria-label="群聊">
        <header className="team-modal__head">
          <div className="team-modal__title">
            <MessagesSquare size={16} className="ic-violet" />
            <strong>工作伙伴</strong>
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
        <TeamModePanel
          app={app}
          onOpenModelSettings={onOpenModelSettings ? () => { close(); onOpenModelSettings(); } : undefined}
          /* ⛔ 开那条会话之前先关群聊浮层，否则新会话被压在浮层后面（用户会以为"点了没反应"）。 */
          onOpenThread={onOpenThread ? (id) => { close(); onOpenThread(id); } : undefined}
        />
      </div>
    </div>
  );
}

/* 11-09：伙伴会话在**外面会话的回合头**也要用群里那张脸 —— 头像组件的唯一实现留给群板块，
 * 外面经 barrel 取用（⛔ 不许深链 `13-team-avatar`，也不许另写一套 preset/图集映射）。 */
export { MemberAvatar } from "./13-team-avatar";
