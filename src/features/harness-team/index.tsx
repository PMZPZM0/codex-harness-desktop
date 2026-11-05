/**
 * 团队模式 · 面板入口（P0）
 *
 * 左：群列表（+ 新建）；右：选中的群（群视图 / 群设置）。
 * ⛔ 独立板块：只依赖本目录 + `src/lib/team-models.mjs`，不 import 任何既有业务域组件。
 */
import { useEffect, useMemo, useState } from "react";
import { TeamGroupView } from "./04-team-group-view";
import { teamChatOpen, useTeamChatOpen } from "./00-open-store";
import { LOCAL_ACTOR_ID, useTeamGroups } from "./02-team-store";

export function TeamModePanel({ onClose }: { onClose?: () => void } = {}) {
  const { groups, issues, limit, loading, error, create, addPartner, removePartner, mute, setGuard } = useTeamGroups();
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!activeId && groups.length) setActiveId(groups[0].id);
  }, [groups, activeId]);

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
    } else {
      setNotice(r.error ?? "建群失败");
    }
  };

  return (
    <div className="team-mode">
      {onClose && (
        <header className="team-mode__head">
          <strong>群聊</strong>
          <button type="button" className="team-mode__close" onClick={onClose} aria-label="关闭群聊">关闭</button>
        </header>
      )}
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
                  {issues[g.id]?.length ? " · 待处理" : ""}
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
            rows={[]}
            issues={issues[active.id]}
            limit={limit}
            onAddPartner={(p) => addPartner(active.id, p)}
            onRemovePartner={(id) => removePartner(active.id, id)}
            onMute={(id, m) => mute(active.id, id, m)}
            onSetGuard={(g) => setGuard(active.id, g)}
            onSend={() => setNotice("P0 阶段：派活链路（接子会话）在下一步接入")}
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

/** 全屏壳：侧栏「群聊」打开它；关闭走右上角（⛔ 不依赖设置面板）。 */
export function TeamChatOverlay() {
  const open = useTeamChatOpen();
  if (!open) return null;
  return (
    <div className="team-chat-overlay" role="dialog" aria-modal="true" aria-label="群聊">
      <TeamModePanel onClose={() => teamChatOpen.set(false)} />
    </div>
  );
}

export { teamChatOpen };
