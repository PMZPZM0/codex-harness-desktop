/** usageInputTokens（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { usageNumber } from "./usage-number";

export function usageInputTokens(usage: any): number {
  return usageNumber(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens");
}
