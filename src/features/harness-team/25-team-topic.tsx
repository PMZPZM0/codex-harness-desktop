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
import { useEffect, useRef } from "react";
import { MessagesSquare, X } from "lucide-react";
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
  /* 头像栈按作者去重、最多 3 个；缩略取最后一条回复的开头。 */
  const faces: string[] = [];
  for (const r of replies) {
    if (!faces.includes(r.authorId)) faces.push(r.authorId);
    if (faces.length >= 3) break;
  }
  const last = previewOf(replies[replies.length - 1]).slice(0, 46);
  return (
    <button
      type="button"
      className="team-msg__topic"
      onClick={onOpen}
      title="点开预览这个话题的全部回复"
      aria-label={`${replies.length} 条回复，点开预览`}
    >
      <span className="team-msg__topic-faces" aria-hidden>
        {faces.map((id) => (
          <MemberAvatar key={id} member={faceOfId(id)} size={18} className="team-msg__topic-face" />
        ))}
      </span>
      <span className="team-msg__topic-main">
        <strong><MessagesSquare size={11} /> {replies.length} 条回复</strong>
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
}: Common & { thread: TopicThread; onClose: () => void }) {
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
              className={`team-topic__row${index === 0 ? " is-root" : ""}`}
            >
              <span className="team-topic__avatar">
                <MemberAvatar member={faceOfId(row.authorId)} size={24} />
              </span>
              <div className="team-topic__body">
                <div className="team-topic__meta">
                  <strong>{nameOf(row.authorId)}</strong>
                  {index === 0 ? <em>发起</em> : row.via ? <em>由 {row.via.name} 叫来</em> : null}
                </div>
                <p className="team-topic__text">{previewOf(row)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
