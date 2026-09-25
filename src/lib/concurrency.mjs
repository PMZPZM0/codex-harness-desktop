/**
 * 并发闸门（09-19 用户要求加；09-25 用户要求默认值改为 10）。
 *
 * 背景（实测取证）：限流是**同一个 API Key 的共享配额**——引擎 TRACE 日志显示 6 分钟内
 * 4 个会话同时打上游 **333 次**请求，配额瞬间打满 ⇒ 429 爆发 + 越重试越限流。
 * 所以把"同时运行的任务数"限制在该供应商配置的上限内。
 *
 * 与「会话完全独立」的关系：会话的**状态**依然各自独立（互不读写、互不影响）；
 * 这里约束的是**共享资源（Key 配额）的调度** —— 属于物理约束，不是状态耦合。
 *
 * ⛔ 抽成纯函数是为了能被离线预检确定性覆盖（毫秒级、不起应用）：
 *   边界（正好到上限 / 未到 / 已在跑的会话追加 / 上限非法）都是"想当然会写错"的地方。
 */

/**
 * 并发上限的默认值与收敛范围（1~10）：非法值一律回落默认，避免 0/负数把发送彻底卡死。
 *
 * ⛔ 默认值 = 上限 10（09-25 用户要求：「并发默认 10」）。原为 3（09-19 定的，理由是
 *    「同一个 Key 的配额共享，并发越高越容易 429」）—— 用户实测更看重并行度，故放开到顶。
 *    仍然保留 1~10 的可调范围：撞限流的用户能自己调小（那个理由本身没错，只是不该由默认值代言）。
 * ⛔ 同源副本：主进程侧 `electron/features/model-custom-ipc/04-custom-model-read.ts` 里
 *    也有一个默认值（electron/ 与 src/ 独立打包、不互相 import），守卫【159】逐字比对。
 */
export const DEFAULT_MAX_CONCURRENCY = 10;

export function normalizeMaxConcurrency(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CONCURRENCY;
  return Math.min(10, n);
}

/**
 * 是否应当拦截这次发送。
 *
 * @param {object} input
 * @param {number} input.runningCount  除本会话外，当前正在运行的会话数
 * @param {number|string} [input.maxConcurrency] 该供应商配置的上限（非法值回落默认）
 * @param {boolean} [input.threadAlreadyRunning] 本会话自己是否已在跑
 * @returns {boolean} true = 拦截（不放行）
 *
 * 规则：
 *  · 本会话**已在跑** → 不拦（追加消息/排队释放/插队都不增加并发路数）；
 *  · 否则 runningCount >= 上限 → 拦（新增一路会超限）。
 */
export function concurrencyExceeded({ runningCount, maxConcurrency, threadAlreadyRunning } = {}) {
  if (threadAlreadyRunning) return false;
  const limit = normalizeMaxConcurrency(maxConcurrency);
  const used = Number(runningCount);
  if (!Number.isFinite(used) || used < 0) return false;   // 计数异常时不拦（宁可放行也不要卡死用户）
  return used >= limit;
}
