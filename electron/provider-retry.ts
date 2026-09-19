/**
 * ⛔⛔ 09-19 用户实测「429 触发太频繁，WorkBuddy 用同一个供应商完全没问题」——**根因在这里**。
 *
 * 09-16 曾把这三个键调成 `10 / 10 / 600000`（当时的想法是"多试几次能扛过限流"），
 * 实测是**反效果**：引擎默认 `request_max_retries = 4`、`stream_max_retries = 5`
 * （源码常量 DEFAULT_REQUEST_MAX_RETRIES / DEFAULT_STREAM_MAX_RETRIES），
 * 我们把它提到 10 ⇒ 引擎在限流时会以 2~3 秒的间隔**连续重打上游**，
 * 而限流是"窗口内配额"，密集重打只会把窗口填满 ⇒ 更严重的 429 + `exceeded retry limit`。
 *
 * 实测证据（本机 engine-debug.log + 引擎 TRACE 日志 logs_2.sqlite）：
 *   · 单个 turn 内部出现 **32 次 429**（同一 submission），全部集中在 `op.dispatch.turn_input`；
 *   · 429 间隔 2~3 秒（= 引擎内部快速重试，未等待 Retry-After）；
 *   · 应用层再叠 10 次退避重试 ⇒ 最坏 10 × 10 ≈ **100 倍请求放大**，自己把自己打成限流。
 *
 * ⇒ 现在**一个键都不写**，完全用引擎默认（与 WorkBuddy 行为对齐）。
 *   引擎将来调整默认值时我们也自动跟随，不会再出现"配置比引擎更激进"的偏差。
 *   `stream_idle_timeout_ms` 同样不写（默认 5 分钟足够；长思考靠流事件而非空闲等待）。
 */
export const PROVIDER_RETRY_TUNING = {} as const;
