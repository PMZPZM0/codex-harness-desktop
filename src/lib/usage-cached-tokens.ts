/** usageCachedTokens（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { usageNumber } from "./usage-number";

/** 取「命中缓存的输入 token 数」：先认直接字段，再从 inputTokensDetails 里兜底，兼容两套命名。
 *  ⛔⛔ 11-08 用户实测（群聊页脚「缓存 0 · 命中 0%」一直不变）：群聊用的是**归一化**用量
 *  （`team-usage.mjs` 输出 `{ inputTokens, outputTokens, cachedTokens, totalTokens }`），
 *  这里只认引擎原始字段名（cachedInputTokens 等）⇒ 归一化后的 `cachedTokens` 被漏掉、恒为 0。
 *  ⇒ 直接字段表必须同时含 `cachedTokens` / `cached_tokens`（原始桶没有这两个键，加了不冲突）。 */
export function usageCachedTokens(usage: any): number {
  const direct = usageNumber(usage, "cachedInputTokens", "cached_input_tokens", "cachedTokens", "cached_tokens", "cacheReadInputTokens", "cache_read_input_tokens");
  if (direct > 0) return direct;
  return usageNumber(
    usage?.inputTokensDetails ?? usage?.input_tokens_details ?? usage?.promptTokensDetails ?? usage?.prompt_tokens_details,
    "cachedTokens",
    "cached_tokens",
  );
}
