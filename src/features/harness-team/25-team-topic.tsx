/**
 * 工作伙伴 · 话题回复模式（11-08 用户令：「加一个话题回复模式吧，弹窗预览，在用户消息气泡里面更新」）
 *
 * 独立板块：视图只负责把 `buildTopicThreads()` 的结果接线进来，⛔ 不在 04 里再写一套分组/弹窗。
 *   · `TopicBadge` —— 挂在**用户消息气泡里**的话题条：头像栈 + N 条回复 + 最后一句缩略，点开预览；
 *   · `TopicPreview` —— 点开后的弹窗：原消息 + 按时间排好的全部回复（头像/名字/正文），
 *     ESC 或点遮罩关闭，⛔ 复用项目全局 ESC 栈（不要自己挂 window keydown）。
 *
 * ⛔ 这里只做"收起来看"的展示层：消息照常落群日志，切换到别的回复模式消息一条不少。
 * ⛔ 头像/名字一律由调用方注入 `faceOfId` / `nameOf`（唯一口径），本板块不自己查目录。
 */
import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, X } from "lucide-react";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import { MemberAvatar } from "./13-team-avatar";

/* ⛔ 类型只从 team-fold.d.mts 来（单一真相源）：本地再定义一份会造成
   `buildTopicThreads()` 返回值与本板块 props 类型不兼容（TS2322 实测）。 */
import type { TopicRow, TopicThread } from "../../lib/team-fold.d.mts";
export type { TopicThread };

type Face = { id: string; kind?: string; name?: string; targetKind?: string; targetKey?: string; avatar?: string };

type Common = {
  faceOfId: (id: string) => Face;
  nameOf: (id: string) => string;
};

const previewOf = (row: TopicRow) =>
  String(row?.text ?? "").replace(/```voice[\s\S]*?```/g, "").replace(/\s+/g, " ").trim();

/** 话题条：挂在用户消息气泡里。没有回复时返回 null（空话题不占地方）。 */
export function TeamTopicBadge({
  thread,
  faceOfId,
  nameOf,
  onOpen,
}: Common & { thread: TopicThread | undefined; onOpen: () => void }) {
  const replies = thread?.replies ?? [];
  if (!replies.length) return null;
  /* ⛔ 11-09：话题 = 迷你群聊（用户原话），所以 replies 里**也有用户自己的追问**。
     头像栈与缩略只取**伙伴**的（自己的话不该出现在"谁回复了"里）；
     ⛔ 计数用全部条数（含自己的追问），文案写「条消息」而不是「条回复」。 */
  const partners = replies.filter((r) => r.authorKind === "bot");
  const pool = partners.length ? partners : replies;
  const faces: string[] = [];
  for (const r of pool) {
    if (!faces.includes(r.authorId)) faces.push(r.authorId);
    if (faces.length >= 3) break;
  }
  const last = previewOf(pool[pool.length - 1]).slice(0, 46);
  return (
    <button
      type="button"
      className="team-msg__topic"
      onClick={onOpen}
      title="点开预览这个话题的全部回复"
      aria-label={`${replies.length} 条消息，点开预览`}
    >
      <span className="team-msg__topic-faces" aria-hidden>
        {faces.map((id) => (
          <MemberAvatar key={id} member={faceOfId(id)} size={18} className="team-msg__topic-face" />
        ))}
      </span>
      <span className="team-msg__topic-main">
        <strong><MessagesSquare size={11} /> {replies.length} 条消息</strong>
        {last && <small>{last}</small>}
      </span>
      <span className="team-msg__topic-arrow" aria-hidden>›</span>
    </button>
  );
}

/** 弹窗预览：原消息 + 全部回复（每条都带头像与署名，互 @ 的也照实显示）。 */
export function TeamTopicPreview({
  thread,
  faceOfId,
  nameOf,
  onClose,
  onReply,
  replyHint,
}: Common & {
  thread: TopicThread;
  onClose: () => void;
  /** ⛔ 11-09 用户：「话题展示那个，没有在话题中沟通的功能啊」——
   *  在话题里接着说。上下文（这条话题的原消息）由**调用方**拼进正文，本板块不碰派活通道。
   *  `ok:false` 时把 error 显示在输入框下面（⛔ 不要静默吞掉）。 */
  onReply?: (text: string) => Promise<{ ok: boolean; error?: string } | void | undefined> | void;
  /** 没有可派活对象时的说明（禁用发送并写原因，⛔ 不用 disabled 装哑巴）。 */
  replyHint?: string;
}) {
  useEscapeLayer(true, onClose);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /* ⓵ 遮罩点击关闭：点在卡片外面才算外部（⛔ 之前群聊 @ 面板漏过这条）。 */
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const rows = [thread.root, ...thread.replies];
  /* 话题内对话（11-09）：发出去是一条**带话题引用的新消息**，走群同一条派活通道。 */
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const blocked = !onReply || Boolean(replyHint);
  const canSend = !blocked && draft.trim().length > 0 && !sending;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const r = await onReply?.(draft.trim());
      if (r && r.ok === false) { setError(r.error || "发送失败"); return; }
      setDraft("");
      onClose(); // 新消息会作为群里的下一条出现（话题弹窗只是这条话题的快照，留着会像"没发出去"）
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="team-topic-layer" role="presentation">
      <div className="team-topic" ref={rootRef} role="dialog" aria-modal="true" aria-label="话题回复预览">
        <header className="team-topic__head">
          <MessagesSquare size={14} className="ic-violet" />
          <strong>话题回复</strong>
          <small>{thread.replies.length} 条</small>
          <button type="button" className="team-topic__close" aria-label="关闭话题预览" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="team-topic__list">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className={`team-topic__row${index === 0 ? " is-root" : ""}${row.authorKind !== "bot" ? " is-self" : ""}`}
            >
              <span className="team-topic__avatar">
                <MemberAvatar member={faceOfId(row.authorId)} size={24} />
              </span>
              <div className="team-topic__body">
                <div className="team-topic__meta">
                  <strong>{nameOf(row.authorId)}</strong>
                  {index === 0 ? <em>发起</em> : row.authorKind !== "bot" ? <em>在话题里说的</em> : row.via ? <em>由 {row.via.name} 叫来</em> : null}
                </div>
                <p className="team-topic__text">{previewOf(row)}</p>
              </div>
            </div>
          ))}
        </div>
        {/* 话题内输入：⛔ 只有能派活（有伙伴）时才可发；没有对象就写清原因，不装死。 */}
        <div className="team-topic__composer">
          {replyHint ? (
            <p className="team-topic__blocked">{replyHint}</p>
          ) : (
            <>
              <input
                className="team-topic__input"
                value={draft}
                placeholder={`在「${previewOf(thread.root).slice(0, 18)}」里接着说…`}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  /* Enter 发送；Shift+Enter 不拦（单行输入框也不需要换行）。⛔ 输入法组字中不发送。 */
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
                  if (event.key === "Escape") { event.preventDefault(); onClose(); }
                }}
                aria-label="在话题里接着说"
              />
              <button type="button" className="team-topic__send" disabled={!canSend} onClick={() => void submit()} title="发送到这个话题">
                <Send size={13} />{sending ? "发送中…" : "发送"}
              </button>
            </>
          )}
          {error && <p className="team-topic__error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
