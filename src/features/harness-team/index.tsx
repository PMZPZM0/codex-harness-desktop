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
import { MessagesSquare, X } from "lucide-react";
import { TeamGroupView } from "./04-team-group-view";
import { teamChatOpen, useTeamChatOpen } from "./00-open-store";
import { LOCAL_ACTOR_ID, useTeamGroups } from "./02-team-store";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

export function TeamModePanel() {
  const {
    groups, issues, blockers, limit, loading, error,
    rowsByGroup, busyByGroup, dispatchError,
    create, rename, addPartner, removePartner, mute, removeGroup, setMemory, saveFiles, setManagerOf,
    addNote, removeNote, saveMenu, ledger, loadLedger,
    loadMessages, dispatch,
  } = useTeamGroups();
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!activeId && groups.length) setActiveId(groups[0].id);
  }, [groups, activeId]);

  /* 切群即读这个群的群视图行（⛔ 主进程才是权威：不靠上一屏的残留在内存里拼） */
  useEffect(() => {
    if (activeId) {
      void loadMessages(activeId);
      void loadLedger(activeId, 7);
    }
  }, [activeId, loadMessages, loadLedger]);

  const active = useMemo(() => groups.find((g) => g.id === activeId) ?? null, [groups, activeId]);

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
          <strong>团队</strong>
          <span className="team-mode__rail-sub">{groups.length} 个群</span>
        </div>
        <ul className="team-mode__groups">
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className={`team-mode__group${g.id === activeId ? " is-active" : ""}`}
                onClick={() => setActiveId(g.id)}
              >
                <span className="team-mode__group-name">{g.name}</span>
                <span className="team-mode__group-sub">
                  {g.members.filter((m) => m.kind === "bot").length} 伙伴
                  {(rowsByGroup[g.id]?.length ?? 0) > 0 ? ` · ${rowsByGroup[g.id].length} 条` : ""}
                  {/* ⛔ 只有**结构性**问题才在侧栏报"待处理"：新群没伙伴是正常的 */}
                  {blockers[g.id]?.length ? " · 待处理" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="team-mode__new">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新群名字"
            onKeyDown={(e) => { if (e.key === "Enter") void newGroup(); }}
          />
          <button type="button" onClick={() => void newGroup()} disabled={creating || !name.trim()}>建群</button>
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
            notice={dispatchError}
            issues={issues[active.id]}
            limit={limit}
            onAddPartner={(p) => addPartner(active.id, p)}
            onRemovePartner={(id) => removePartner(active.id, id)}
            onMute={(id, m) => mute(active.id, id, m)}
            onSetManager={(memberId, managerId) => setManagerOf(active.id, memberId, managerId)}
            onSetMemory={(text) => setMemory(active.id, text)}
            onSetFiles={(files) => saveFiles(active.id, files)}
            onAddNote={(note) => addNote(active.id, note)}
            onRemoveNote={(noteId) => removeNote(active.id, noteId)}
            onSaveMenu={(items) => saveMenu(active.id, items as never)}
            ledger={ledger}
            onLoadLedger={(days) => void loadLedger(active.id, days)}
            onRename={(name) => rename(active.id, name)}
            onDeleteGroup={async () => {
              const r = await removeGroup(active.id);
              if (r.ok) setActiveId("");
              return r;
            }}
            /* 派活：@ 了谁就把这句话交给谁 —— 各自落各自的子会话，产出再投影回来 */
            onSend={(partnerIds, text) => dispatch(active, partnerIds, text)}
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
