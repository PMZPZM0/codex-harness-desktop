/** 群聊 token 用量的纯判定（事件解析 / 该补到哪条消息）。 */

export interface GroupUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export const GROUP_USAGE_TTL_MS: number;

export function usageFromTokenEvent(event: unknown): { threadId: string; usage: GroupUsage } | null;

export function pickUsagePatchIndex(
  rows: unknown,
  threadId: string,
  now?: number,
  ttlMs?: number,
): number;

export function usageUsableFor(
  entry: { usage?: GroupUsage | null; at?: number } | null | undefined,
  since: number,
): GroupUsage | null;
