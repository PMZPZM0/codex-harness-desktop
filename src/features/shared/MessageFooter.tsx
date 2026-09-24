/** MessageFooter（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "../../lib/thread-item";
import { Turn } from "../../lib/turn";
import { itemText } from "../../lib/item-text";
import { userDisplayText } from "../../lib/user-refs";
import { usageBucket } from "../../lib/usage-bucket";
import { usageInputTokens } from "../../lib/usage-input-tokens";
import { usageNumber } from "../../lib/usage-number";
import { usageCachedTokens } from "../../lib/usage-cached-tokens";
import { Quote, PenLine, Copy, GitBranch, Clock3, Star } from "lucide-react";
import { requestFavorite } from "../../lib/favorite-bridge";

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
  return (
    <div className="message-footer">
      {/* 用户消息：引用 → 编辑 → 复制（hover 项在前，常驻项在后） */}
      {!isAgent && text && <button className="message-action-extra" title="引用" onClick={() => onQuote(text)}><Quote size={12} /></button>}
      {!isAgent && onEdit && <button className="message-action-extra" title="编辑并重新发送" onClick={onEdit}><PenLine size={12} /></button>}
      {/* 复制：agent/用户消息都常驻，纯图标 */}
      {text && <button className="message-action-default" title="复制消息" onClick={() => onCopy(text)}><Copy size={12} /></button>}
      {/* agent 常驻：分支 → 时间（上下文进度图标只在输入框下方的 ContextUsageBadge 展示） */}
      {isAgent && onFork && <button className="message-action-default" title="从此处分支" onClick={onFork}><GitBranch size={12} />分支</button>}
      {isAgent && turn?.startedAt && <span><Clock3 size={12} />{formatTimestamp(turn.completedAt ?? turn.startedAt)}</span>}
      {/* agent hover：输入/输出 Token + 缓存命中率 + 引用 */}
      {isAgent && showTokenInfo && <span className="message-action-extra">{input.toLocaleString()} 入 / {output.toLocaleString()} 出{total > 0 ? ` · ${total.toLocaleString()} 总` : ""}</span>}
      {isAgent && cacheRate != null && <span className="message-action-extra">· {cacheRate}% 缓存</span>}
      {isAgent && text && <button className="message-action-extra" title="引用" onClick={() => onQuote(text)}><Quote size={12} /></button>}
      {/* 收藏（09-24）：用户/agent 消息都能收；hover 项，不占常驻位置。
          经 favorite-bridge 交给 app 状态层（不逐层传 prop，见该模块注释）。 */}
      {text && <button className="message-action-extra" title="收藏这条消息" onClick={() => {
        requestFavorite({
          kind: "text",
          content: text,
          title: text.replace(/\s+/g, " ").trim().slice(0, 40),
          source: { turnId: turn?.id, messageId: item.id, role: isAgent ? "assistant" : "user" },
        });
      }}><Star size={12} /></button>}
      {extraIcon}
    </div>
  );
}

function formatTimestamp(value: unknown) {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
}
