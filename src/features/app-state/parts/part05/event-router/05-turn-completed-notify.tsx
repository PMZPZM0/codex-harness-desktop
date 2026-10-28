/**
 * handleEventRouter5 —— 01-seg 里那条事件总路由的第 5 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import { currentStreak, dayKey, formatTokens, lastDays, readUsageStats, recordTurnUsage, resetUsageStats, totalTokens } from "../../../../../lib/usage-stats";
import { usageBucket } from "../../../../../lib/usage-bucket";
import { loadThreadModel, modelName } from "../../../../app-view/helpers";
import { recordTurnCredit } from "../../../../../lib/cloud-credit-store";
import type { Bag } from "../../bag-types";

export function handleEventRouter5(bag: Bag, params: any): boolean {
        // 用本回合新增量累加（旧实现取的是 max，累计 Token 一直是错的）；拿不到增量时按上下文总量兜底
        try {
          const total = usageBucket(bag.tokenUsageRef.current, "total") ?? usageBucket(bag.tokenUsageRef.current, "last");
          const last = usageBucket(bag.tokenUsageRef.current, "last");
          const turnId = String(params?.turn?.id ?? "");
          const startedAt = turnId ? bag.turnStartedAtRef.current.get(turnId) : undefined;
          if (turnId) bag.turnStartedAtRef.current.delete(turnId);
          /* ⛔ 入/出各取一次，统计与积分估算**共用同一对数** —— 两处各写一遍那串四段兜底，必然漂移。 */
          const inputTokens = last?.input_tokens ?? last?.inputTokens ?? total?.input_tokens ?? total?.inputTokens ?? 0;
          const outputTokens = last?.output_tokens ?? last?.outputTokens ?? total?.output_tokens ?? total?.outputTokens ?? 0;
          bag.setUsageStats(recordTurnUsage({
            inputTokens,
            outputTokens,
            contextTokens: total?.total_tokens ?? total?.totalTokens ?? 0,
            durationMs: startedAt ? Date.now() - startedAt : undefined,
            model: bag.activeModelRef.current || undefined,
          }));
          /* 云端积分估算（10-18 新增）：页脚「本轮 ≈ N 积分」就靠这条记录。
             ⛔ 非云端模型 / 目录拿不到 / 模型不在目录 ⇒ 记录函数**自己什么都不存**，页脚据此不占位，
                所以这里不需要任何 if。
             ⛔ 模型归属照本仓既有口径（会话自己记的优先，没记过才用当前选择）—— 直接读
                `activeModelRef` 会把「切了全局模型、但本会话跑自己的模型」算成错的倍率。 */
          const threadId = String(params?.threadId ?? bag.threadRef.current?.id ?? "");
          const creditModel = (threadId ? modelName(loadThreadModel(threadId)) : "") || bag.activeModelRef.current || "";
          recordTurnCredit(turnId, creditModel, inputTokens, outputTokens);
        } catch { /* 统计失败不影响主流程 */ }
      
  return false;
}
