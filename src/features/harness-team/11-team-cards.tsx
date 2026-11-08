/**
 * 群聊 · 汇总消息下方的展示卡（11-06 用户令）
 *
 * 用户：「核对主对话框汇总消息下方的展示卡是否已同步最新内容、状态和样式，未同步的部分请补齐；
 *        根据群聊场景定制这些展示卡的呈现方式」。
 *
 * ⛔ 不另写一套：直接复用主对话的 `CompletedChanges`（已更改文件汇总 + 本轮产物）与
 *   `TurnMediaCard`（视频/音频），数据来自群消息对应的**真身子会话回合**
 *   （`useTeamTurn` 与运行过程共用一次 `thread/turns/list` 拉取）。
 * ⛔ `isLastTurn` 必须 false：true 会把群子会话的回合塞进右栏「本轮复查」，
 *   抢走主对话的右栏内容（Status.tsx 的 primeTurnReview）。
 * ⛔ 拿不到回合就不画空壳 —— 与过程折叠同一口径。
 */
import { CompletedChanges } from "../status";
import { collectTurnWebSources } from "../../lib/turn-web-sources.mjs";
import { TurnWebSources } from "../shared/TurnWebSources";
import { TurnMediaCard } from "../media";
import type { Turn } from "../../lib/turn";
import { useTeamTurn } from "./09-team-process";

export function TeamCards({ threadId, at, bodyText }: { threadId: string; at: number; bodyText: string }) {
  const { turn } = useTeamTurn(threadId, at, bodyText);
  if (!turn) return null;
  const turnId = String(turn.id ?? "");
  return (
    <div className="team-cards">
      <CompletedChanges turn={turn as unknown as Turn} isLastTurn={false} />
      {/* ⛔ 11-08 用户令「网页来源条也要一致」：与主对话 MessageFooter 同一个组件与提取函数。 */}
      <TurnWebSources sources={collectTurnWebSources(turn as never)} inline />
      {turnId && <TurnMediaCard threadId={threadId} turnId={turnId} />}
    </div>
  );
}
