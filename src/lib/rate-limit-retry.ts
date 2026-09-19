/**
 * 429 限流自动重试（应用层兜底）。
 *
 * ⛔⛔ 09-19 用户实测「429 触发太频繁，WorkBuddy 用同一供应商完全没问题」后的重新校准：
 *   引擎侧重试已退回**默认**（4 次 HTTP / 5 次流，见 electron/provider-retry.ts），
 *   应用层这里也必须**保守**——两层各自"多试几次"叠加起来是乘法：
 *     引擎 10 次 × 应用 10 次 = 最坏 100 倍请求放大 ⇒ 自己把自己打成限流。
 *   实测证据：单条消息在引擎侧产生 32 次 429（间隔 2~3 秒，未等 Retry-After）。
 *
 *   现在的策略（与 WorkBuddy 的做法对齐）：
 *     · 次数少：6 次（原来是 10）
 *     · 退避长：15s 起、顶格 5 分钟（原来 5s 起、顶格 2 分钟）
 *       —— 限流是**分钟级窗口**问题，靠"等"而不是靠"多试"；
 *       总覆盖约 12 分钟，比原来的 8.5 分钟更久但请求数少一半以上。
 */

export const RATE_LIMIT_MAX_ATTEMPTS = 6;

/** 退避序列（毫秒）：逐次放长，后段顶格 5 分钟。索引 = attempt - 1 */
const BACKOFF_MS = [15000, 30000, 60000, 120000, 240000, 300000];

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
