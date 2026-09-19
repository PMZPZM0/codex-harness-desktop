// 类型声明：concurrency.mjs 是运行时实现，tsconfig 关着 allowJs，故类型单独声明。
// 改实现时同步这里（预检【69】的纯函数断言会跑真实实现，漏改会立刻红）。

/** 并发上限默认值（1~10 之外一律回落它）。 */
export const DEFAULT_MAX_CONCURRENCY: number;

/** 把任意输入收敛成 1~10 的整数；非法/缺失回落默认值。 */
export function normalizeMaxConcurrency(value: unknown): number;

export interface ConcurrencyGateInput {
  /** 除本会话外，当前正在运行的会话数 */
  runningCount?: number;
  /** 该供应商配置的上限（非法值回落默认） */
  maxConcurrency?: number | string;
  /** 本会话自己是否已在跑（在跑 → 追加消息不增加并发路数） */
  threadAlreadyRunning?: boolean;
}

/** 是否应拦截这次发送（true = 拦）。 */
export function concurrencyExceeded(input?: ConcurrencyGateInput): boolean;
