/** usageCachedTokens（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { usageNumber } from "./usage-number";

export function usageCachedTokens(usage: any): number {
  const direct = usageNumber(usage, "cachedInputTokens", "cached_input_tokens", "cacheReadInputTokens", "cache_read_input_tokens");
  if (direct > 0) return direct;
  return usageNumber(
    usage?.inputTokensDetails ?? usage?.input_tokens_details ?? usage?.promptTokensDetails ?? usage?.prompt_tokens_details,
    "cachedTokens",
    "cached_tokens",
  );
}
