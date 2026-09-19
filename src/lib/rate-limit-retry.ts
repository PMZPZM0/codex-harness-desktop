/**
 * 429 限流自动重试（应用层兜底）。
 *
 * 引擎侧已有 request_max_retries/stream_max_retries（见 electron/provider-retry.ts），
 * 但引擎重试耗尽后 turn 仍会以限流错误结束——这里在渲染层把该输入自动重发，
 * 最多 RATE_LIMIT_MAX_ATTEMPTS 次，退避时间放长（5s → 120s，累计约 8.5 分钟），
 * 让分钟级限流窗口自然过去。对所有模型生效（不做任何 provider 区分）。
 */

export const RATE_LIMIT_MAX_ATTEMPTS = 10;

/** 退避序列（毫秒）：逐次放长，最后三次顶格 120 秒。索引 = attempt - 1 */
const BACKOFF_MS = [5000, 8000, 12000, 20000, 30000, 45000, 60000, 90000, 120000, 120000];

/** 第 attempt 次（1 起）重试前等待的毫秒数；越界取最后一档 */
export function rateLimitBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return BACKOFF_MS[0];
  return BACKOFF_MS[Math.min(Math.round(attempt), BACKOFF_MS.length) - 1];
}

/**
 * 判定错误文本是否为限流类错误（429 / rate limit / too many requests / 配额超限）。
 * 覆盖中英文与常见改写；包含状态码、短语、以及中文「请求过于频繁/稍后再试」类提示。
 */
export function isRateLimitError(message: unknown): boolean {
  const text = String(message ?? "");
  if (!text) return false;
  // ⛔⛔ 09-19 真机实测（mock 供应商 429 + 引擎日志打点）：引擎把限流包成
  //   `Reconnecting... 7/10` … `Reconnecting... 10/10` 上报，**文案里没有任何 429 /
  //   rate limit 字样** ⇒ 旧词表全部落空 ⇒ 用户看到的是「429 重试机制都没有了，直接中止」。
  //   语义：Reconnecting N/M = 引擎正在自己重连/重试。**达到上限（N ≥ M）才算引擎放弃**，
  //   那时交给应用层兜底；还没到上限时由引擎自己继续，应用不插手（避免重复投递）。
  const exhausted = text.match(/Reconnecting\s*\.\.\.\s*(\d+)\s*\/\s*(\d+)/i);
  if (exhausted) return Number(exhausted[1]) >= Number(exhausted[2]);
  return /(^|\D)429(\D|$)|rate.?limit|too many requests|请求过多|过于频繁|限流|稍后再试|try again later|quota.{0,24}(exceed|exhausted)|usage.?limit/i.test(text);
}
