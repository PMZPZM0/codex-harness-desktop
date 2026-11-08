/** usageCachedTokens（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { usageNumber } from "./usage-number";

/** 取「命中缓存的输入 token 数」：先认直接字段，再从 inputTokensDetails 里兜底，兼容两套命名。 */
export function usageCachedTokens(usage: any): number {
  const direct = usageNumber(usage, "cachedInputTokens", "cached_input_tokens", "cacheReadInputTokens", "cache_read_input_tokens");
  if (direct > 0) return direct;
  return usageNumber(
    usage?.inputTokensDetails ?? usage?.input_tokens_details ?? usage?.promptTokensDetails ?? usage?.prompt_tokens_details,
    "cachedTokens",
    "cached_tokens",
  );
}
