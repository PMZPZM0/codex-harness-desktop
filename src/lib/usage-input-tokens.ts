/** usageInputTokens（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { usageNumber } from "./usage-number";

/** 取输入 token 数（兼容 inputTokens / input_tokens / promptTokens 等多种字段名）。 */
export function usageInputTokens(usage: any): number {
  return usageNumber(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens");
}
