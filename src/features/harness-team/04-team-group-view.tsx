/**
 * 团队模式 · 群视图（P0）
 *
 * 结构照飞书群：群头（成员头像行）→ 消息流 → 输入框（@ 伙伴）。
 * ⛔ P0 阶段消息流只渲染**投影**（threadId + itemId），真身仍在各伙伴的原子会话；
 *    接入真实消息属于 P0b，这里不伪造任何一条假消息。
 */
import { useMemo, useState } from "react";
import type { GroupMessageRow, TeamGroup } from "./01-team-types";
import { TeamSettings } from "./03-team-settings";

type Props = {
  group: TeamGroup;
  rows: GroupMessageRow[];
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetGuard: (guard: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** 派活：P0 先只把「@了谁 + 说了什么」交给上层，上层接子会话（P0b） */
  onSend?: (partnerIds: string[], text: string) => void;
};

function fmtTime(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TeamGroupView({ group, rows, issues, limit, onAddPartner, onRemovePartner, onMute, onSetGuard, onSend }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState("");
  const [atTargets, setAtTargets] = useState<string[]>([]);
  const partners = useMemo(() => group.members.filter((m) => m.kind === "bot"), [group]);

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? id;

  const toggleAt = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    onSend?.(atTargets, body);
    setText("");
  };

  return (
    <div className="team-group">
      <header className="team-group__head">
        <div className="team-group__title">
          <h2>{group.name}</h2>
          <span className="team-group__sub">{group.members.length} 位成员 · {partners.length} 个伙伴</span>
        </div>
        <div className="team-group__avatars" aria-hidden>
          {group.members.slice(0, 6).map((m) => (
            <span key={m.id} className={`team-group__avatar${m.kind === "bot" ? " is-bot" : ""}${m.muted ? " is-muted" : ""}`} title={m.name}>
              {m.name.slice(0, 1)}
            </span>
          ))}
        </div>
        <button type="button" className="team-group__settings-btn" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? "返回群聊" : "群设置"}
        </button>
      </header>

      {showSettings ? (
        <TeamSettings
          group={group}
          issues={issues}
          limit={limit}
          onAddPartner={onAddPartner}
          onRemovePartner={onRemovePartner}
          onMute={onMute}
          onSetGuard={onSetGuard}
        />
      ) : (
        <>
          <div className="team-group__stream" role="log" aria-live="polite">
            {rows.length === 0 ? (
              <div className="team-group__empty">
                <p>还没有消息。</p>
                <p className="team-group__empty-hint">
                  在下面 @ 一个伙伴派活，它的回复会和这里其他伙伴的按时间排在一起。
                </p>
                {partners.length === 0 && (
                  <button type="button" className="team-group__empty-btn" onClick={() => setShowSettings(true)}>
                    先加一个伙伴
                  </button>
                )}
              </div>
            ) : (
              rows.map((row) => (
                <article key={row.key} className={`team-msg${row.authorKind === "bot" ? " is-bot" : ""}`} data-thread={row.threadId} data-item={row.itemId}>
                  <span className="team-msg__avatar">{nameOf(row.authorId).slice(0, 1)}</span>
                  <div className="team-msg__body">
                    <div className="team-msg__meta">
                      <strong>{nameOf(row.authorId)}</strong>
                      <time>{fmtTime(row.at)}</time>
                    </div>
                    {row.kind === "card" ? (
                      <pre className="team-msg__card">{JSON.stringify(row.card, null, 2)}</pre>
                    ) : (
                      <p className="team-msg__text">{row.text}</p>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>

          <footer className="team-group__composer">
            <div className="team-group__atbar">
              <span className="team-group__atlabel">@</span>
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`team-group__atchip${atTargets.includes(p.id) ? " is-on" : ""}${p.muted ? " is-muted" : ""}`}
                  onClick={() => toggleAt(p.id)}
                  aria-pressed={atTargets.includes(p.id)}
                >
                  {p.name}
                </button>
              ))}
              {!partners.length && <span className="team-group__atempty">还没有伙伴可 @</span>}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={atTargets.length ? `对 ${atTargets.map(nameOf).join("、")} 说…` : "说点什么（先点上面的 @ 派活）"}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="team-group__send-row">
              <span className="team-group__hint">{atTargets.length ? `将派给 ${atTargets.length} 个伙伴` : "未选择伙伴 ⇒ 仅记录在群内"}</span>
              <button type="button" onClick={send} disabled={!text.trim()}>发送</button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
