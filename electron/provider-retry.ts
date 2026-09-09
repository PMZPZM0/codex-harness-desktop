/**
 * 模型供应商 429 限流重试调优（对所有模型强制生效）。
 *
 * 写进每个 [model_providers.X]（config.toml 与 thread/start 的临时 config 覆盖）：
 * - request_max_retries = 10      HTTP 请求失败（含 429 限流）最多重试 10 次
 * - stream_max_retries = 10       SSE 流断开重连最多重试 10 次
 * - stream_idle_timeout_ms = 600000  流空闲判定超时从默认 5 分钟放长到 10 分钟
 *
 * 已用真实 app-server 探针实证引擎 0.150.1 接受且真正解析这三个键，
 * 见 scripts/probe-provider-retries.cjs（config/read 回读确认）。
 */
export const PROVIDER_RETRY_TUNING = {
  request_max_retries: 10,
  stream_max_retries: 10,
  stream_idle_timeout_ms: 600000,
} as const;
