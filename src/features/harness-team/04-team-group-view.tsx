/**
 * 团队模式 · 群视图（P0）
 *
 * 结构照飞书群：群头（成员头像行）→ 消息流 → 输入框（@ 伙伴）。
 * ⛔ 消息流只渲染**投影**（threadId + itemId），真身仍在各伙伴的原子会话；
 *    ⛔ 一条假消息都不造 —— 派活失败时这里什么都不加，错误走上面那条提示。
 */
import { useMemo, useState } from "react";
import type { GroupMessageRow, TeamGroup } from "./01-team-types";
import { TeamSettings } from "./03-team-settings";
import { stripVoiceScript } from "../../lib/voice-script.mjs";

type Props = {
  group: TeamGroup;
  rows: GroupMessageRow[];
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetGuard: (guard: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
  /** 正在跑活的伙伴（id）：显示「正在处理…」，⛔ 不是消息 */
  busy?: string[];
  /** 上次派活的失败说明（⛔ 与消息流分开） */
  notice?: string;
  /** 派活：@ 了谁就把这句话交给谁，各自落各自子会话（P0b 真链路） */
  onSend?: (partnerIds: string[], text: string) => Promise<{ ok: boolean; error?: string }> | void;
};

function fmtTime(at: number): string {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TeamGroupView({ group, rows, issues, busy, notice, limit, onAddPartner, onRemovePartner, onMute, onSetGuard, onDeleteGroup, onSend }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState("");
  const [atTargets, setAtTargets] = useState<string[]>([]);
  const partners = useMemo(() => group.members.filter((m) => m.kind === "bot"), [group]);

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? id;

  const toggleAt = (id: string) => {
    setAtTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSendError("");
    setSending(true);
    try {
      const r = await onSend?.(atTargets, body);
      if (r && !r.ok) {
        setSendError(r.error || "派活失败");
        return; // ⛔ 失败保留原文，别把用户打的字清掉
      }
      setText("");
    } finally {
      setSending(false);
    }
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
          onDeleteGroup={onDeleteGroup}
        />
      ) : (
        <>
          <div className="team-group__stream" role="log" aria-live="polite">
            {rows.length === 0 ? (
              <div className="team-group__empty">
                <p>还没有消息。</p>
                <p className="team-group__empty-hint">
                  在下面 @ 一个伙伴派活，它的回复会和这里其他伙伴的按时间排在一起。
                  <br />
                  每个伙伴都有自己独立的会话，这里只是它们的合影。
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
                      /* ⛔ 播报稿是**给耳朵的**（` ```voice ` 围栏块）：对话里由 Markdown 整块剥掉，
                         群视图也得剥 —— 否则伙伴的回复里会漏出"反引号 voice …"那一坨。
                         口径只有一处（src/lib/voice-script.mjs），⛔ 不在这里手写正则。 */
                      <p className="team-msg__text">{stripVoiceScript(row.text)}</p>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>

          {(busy?.length ?? 0) > 0 && (
            <div className="team-group__running" role="status" aria-live="polite">
              <span className="team-group__dot" aria-hidden />
              {busy!.map(nameOf).join("、")} 正在处理…
            </div>
          )}
          {(sendError || notice) && (
            <p className="team-group__notice" role="status">{sendError || notice}</p>
          )}

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
                  {!p.targetKind && <em className="team-group__atchip-warn" title="这个伙伴没绑定智能体，派不了活">未绑定</em>}
                </button>
              ))}
              {!partners.length && <span className="team-group__atempty">还没有伙伴可 @</span>}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={atTargets.length ? `对 ${atTargets.map(nameOf).join("、")} 说…` : "说点什么（先点上面的 @ 选伙伴）"}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="team-group__send-row">
              <span className="team-group__hint">
                {sending ? "正在派活…" : atTargets.length ? `将派给 ${atTargets.map(nameOf).join("、")}` : "先点上面的 @ 选伙伴"}
              </span>
              <button type="button" onClick={() => void send()} disabled={sending || !text.trim() || !atTargets.length}>发送</button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
