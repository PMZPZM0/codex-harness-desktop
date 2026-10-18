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
import { useTurnCredit } from "../../lib/cloud-credit-store";
import type { TurnCreditRecord } from "../../lib/cloud-credit-store";
import { FeedbackIconButton } from "./FeedbackIconButton";
import { TurnWebSources } from "./TurnWebSources";

export function MessageFooter({ item, turn, usage, tokenUsage, fallbackWindow, onCopy, onQuote, onFork, onEdit, extraIcon, webSources }: { item: ThreadItem; turn?: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onEdit?: () => void; extraIcon?: any; webSources?: Array<{ url: string; host: string }> }) {
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
  /* 本轮积分（10-18 用户令）：只对**云端目录里有、且倍率非空**的模型显示 —— 记录由回合完成事件写入，
     非云端供应商 / 目录没拿到 / 模型不在目录 ⇒ 这里拿到 null ⇒ **不占位**（不写死的 0，也不猜）。
     ⛔ 纯展示估算，账本以服务端为准；口径见 lib/credit-estimate.mjs（与服务端同一公式）。 */
  const turnCredit = useTurnCredit(turn?.id);
  const creditNode = isAgent && turnCredit ? (
    <span key="credit" className="message-action-extra" title={creditTitle(turnCredit)}>
      {turnCredit.free ? "免费" : `≈ ${turnCredit.credit} 积分`}
    </span>
  ) : null;
  const tokenNodes = isAgent ? [
    /* 10-17 用户令：页脚展示**最新回合**的 输入/输出/缓存输入（缓存命中括注）；
       ⛔ 不再展示累计「总」—— 累计口径在「上下文容量」弹层里看（那里用户要的就是总）。 */
    ...(showTokenInfo ? [
      <span key="tokens" className="message-action-extra">{input.toLocaleString()} 入 / {output.toLocaleString()} 出 / 缓存 {cached.toLocaleString()}{cacheRate != null ? ` · 命中 ${cacheRate}%` : ""}</span>,
    ] : []),
    ...(creditNode ? [creditNode] : []),
  ] : [];

  return (
    <div className="message-footer">
      {/* ⛔ 顺序按角色分岔（10-05 用户：「把用户消息下面的常驻复制靠右」）：
          hover 才现身的项**仍占着位**（见 03-messages-turns.css 里那条"避免撑高 footer"的注释），
          所以谁排在最后，谁就贴着右端 —— 用户消息只有复制是常驻的，必须排最后；
          agent 侧的常驻是 复制 + 分支 + 时间，保持原顺序不动。 */}
      {!isAgent ? <>{quoteButton}{editButton}{favoriteButton}{copyButton}</> : <>{copyButton}{forkButton}{timeNode}{tokenNodes}{quoteButton}{favoriteButton}</>}
      {extraIcon}
      {/* 回合网页来源（10-12 用户令「放到下面吧，跟下面这个在一行」）：贴操作条最右端。
          ⛔ TurnWebSources 空数组自己返回 null —— 无来源的消息 footer 形态不变。 */}
      {isAgent && webSources && webSources.length > 0 && <TurnWebSources sources={webSources} inline />}
    </div>
  );
}

function formatTimestamp(value: unknown) {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
}

/** 页脚积分徽标的 tooltip：把"这个数字是怎么算出来的"摊开（模型 / 倍率 / 闲时 / tokens）。
 *  ⛔ 末尾必须声明"以服务端为准" —— 页脚是估算，用户拿它对账会差（目录 TTL 内管理员改过倍率时必差）。 */
function creditTitle(rec: TurnCreditRecord) {
  const parts = [`模型 ${rec.model}`, `倍率 ×${rec.rate}`];
  if (rec.window) parts.push(`闲时「${rec.window.label || "时段"}」${rec.window.start}–${rec.window.end}点 ×${rec.window.rate}`);
  parts.push(`${rec.tokens.toLocaleString()} tokens`);
  const head = rec.free ? `${parts.join(" · ")}\n该模型倍率为 0 ⇒ 免费（服务端只留痕不扣分）` : `${parts.join(" · ")}\n≈ ${rec.credit} 积分`;
  return `${head}\n\n以服务端积分账本为准，本地仅为估算`;
}
