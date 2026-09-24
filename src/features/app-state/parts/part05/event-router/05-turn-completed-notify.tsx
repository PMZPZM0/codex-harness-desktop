/**
 * handleEventRouter5 —— 01-seg 里那条事件总路由的第 5 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { currentStreak, dayKey, formatTokens, lastDays, readUsageStats, recordTurnUsage, resetUsageStats, totalTokens } from "../../../../../lib/usage-stats";
import { usageBucket } from "../../../../../lib/usage-bucket";
import type { Bag } from "../../bag-types";

export function handleEventRouter5(bag: Bag, params: any): boolean {
        // 用本回合新增量累加（旧实现取的是 max，累计 Token 一直是错的）；拿不到增量时按上下文总量兜底
        try {
          const total = usageBucket(bag.tokenUsageRef.current, "total") ?? usageBucket(bag.tokenUsageRef.current, "last");
          const last = usageBucket(bag.tokenUsageRef.current, "last");
          const turnId = String(params?.turn?.id ?? "");
          const startedAt = turnId ? bag.turnStartedAtRef.current.get(turnId) : undefined;
          if (turnId) bag.turnStartedAtRef.current.delete(turnId);
          bag.setUsageStats(recordTurnUsage({
            inputTokens: last?.input_tokens ?? last?.inputTokens ?? total?.input_tokens ?? total?.inputTokens ?? 0,
            outputTokens: last?.output_tokens ?? last?.outputTokens ?? total?.output_tokens ?? total?.outputTokens ?? 0,
            contextTokens: total?.total_tokens ?? total?.totalTokens ?? 0,
            durationMs: startedAt ? Date.now() - startedAt : undefined,
            model: bag.activeModelRef.current || undefined,
          }));
        } catch { /* 统计失败不影响主流程 */ }
      
  return false;
}
