/** MessageFooter（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { itemText } from "../../lib/item-text";
import { userDisplayText } from "../../lib/user-refs";
import { usageBucket } from "../../lib/usage-bucket";
import { usageInputTokens } from "../../lib/usage-input-tokens";
import { usageNumber } from "../../lib/usage-number";
import { usageCachedTokens } from "../../lib/usage-cached-tokens";
import { Quote, PenLine, Copy, GitBranch, Clock3, Star, Check } from "lucide-react";
import { requestFavorite } from "../../lib/favorite-bridge";
import { FeedbackIconButton } from "./FeedbackIconButton";

export function MessageFooter({ item, turn, usage, tokenUsage, fallbackWindow, onCopy, onQuote, onFork, onEdit, extraIcon }: { item: ThreadItem; turn?: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onEdit?: () => void; extraIcon?: any }) {
  const rawText = itemText(item);
  const isAgent = item.type === "agentMessage";
  // 用户消息对外文本：团队/成员会话首条的 SYSTEM TASK 段会被折叠，引用与复制只暴露用户原文
  const text = isAgent ? rawText : (rawText.trim() ? userDisplayText(rawText) : "");
  // 兼容引擎上报字段：inputTokens / input_tokens / promptTokens / prompt_tokens 等
  const num = (value: any) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  // 优先用回合级 usage；缺失时回落到 session 级 tokenUsage.last（最新一回合的用量）
  const u = usage ?? tokenUsage?.derivedLast ?? usageBucket(tokenUsage, "last") ?? usageBucket(tokenUsage, "total") ?? tokenUsage ?? null;
  const input = usageInputTokens(u);
  const output = usageNumber(u, "outputTokens", "output_tokens", "completionTokens", "completion_tokens");
  const cached = Math.min(input, usageCachedTokens(u));
  const total = num(u?.totalTokens ?? u?.total_tokens);
  const cacheRate = input > 0 ? Math.round((cached / input) * 100) : null;
  const showTokenInfo = isAgent && (input > 0 || output > 0 || total > 0);
  /* 每个动作都是同一个「两段反馈」按钮（按下 → 对勾/实心星 → 淡回原样），
     所以在这里一次建好，末尾按角色决定**摆放顺序** —— 不在两处写两份按钮。 */
  const quoteButton = text ? (
    <FeedbackIconButton key="quote" className="message-action-extra" title="引用" doneTitle="已放进输入框"
      icon={<Quote size={12} />} doneIcon={<Check size={12} />} onFire={() => { onQuote(text); }} />
  ) : null;
  const editButton = onEdit && text ? (
    <FeedbackIconButton key="edit" className="message-action-extra" title="编辑并重新发送" doneTitle="已进入编辑"
      icon={<PenLine size={12} />} doneIcon={<Check size={12} />} onFire={() => { onEdit(); }} />
  ) : null;
  const copyButton = text ? (
    <FeedbackIconButton key="copy" className="message-action-default" title="复制消息" doneTitle="已复制"
      icon={<Copy size={12} />} doneIcon={<Check size={12} />} onFire={() => { onCopy(text); }} />
  ) : null;
  const favoriteButton = text ? (
    // requestFavorite 返回"有没有人接住"（app 层没挂上 handler 时是 false）⇒ 接不住就不演成功。
    <FeedbackIconButton key="fav" className="message-action-extra" title="收藏这条消息" doneTitle="已加入收藏夹"
      icon={<Star size={12} />} doneIcon={<Star size={12} fill="currentColor" />}
      onFire={() => requestFavorite({
        kind: "text",
        content: text,
        title: text.replace(/\s+/g, " ").trim().slice(0, 40),
        source: { turnId: turn?.id, messageId: item.id, role: isAgent ? "assistant" : "user" },
      })} />
  ) : null;
  const forkButton = isAgent && onFork ? (
    <FeedbackIconButton key="fork" className="message-action-default" title="从此处分支" doneTitle="分支已发起"
      icon={<GitBranch size={12} />} doneIcon={<Check size={12} />} label="分支" onFire={() => { onFork(); }} />
  ) : null;
  const timeNode = isAgent && turn?.startedAt ? <span key="time"><Clock3 size={12} />{formatTimestamp(turn.completedAt ?? turn.startedAt)}</span> : null;
  const tokenNodes = isAgent && showTokenInfo ? [
    <span key="tokens" className="message-action-extra">{input.toLocaleString()} 入 / {output.toLocaleString()} 出{total > 0 ? ` · ${total.toLocaleString()} 总` : ""}</span>,
    cacheRate != null ? <span key="cache" className="message-action-extra">· {cacheRate}% 缓存</span> : null,
  ] : [];

  return (
    <div className="message-footer">
      {/* ⛔ 顺序按角色分岔（10-05 用户：「把用户消息下面的常驻复制靠右」）：
          hover 才现身的项**仍占着位**（见 03-messages-turns.css 里那条"避免撑高 footer"的注释），
          所以谁排在最后，谁就贴着右端 —— 用户消息只有复制是常驻的，必须排最后；
          agent 侧的常驻是 复制 + 分支 + 时间，保持原顺序不动。 */}
      {!isAgent ? <>{quoteButton}{editButton}{favoriteButton}{copyButton}</> : <>{copyButton}{forkButton}{timeNode}{tokenNodes}{quoteButton}{favoriteButton}</>}
      {extraIcon}
    </div>
  );
}

function formatTimestamp(value: unknown) {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
}
