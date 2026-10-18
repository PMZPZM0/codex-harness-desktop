/** credit-estimate.mjs 的类型面（实现是未检查的 .mjs，见 src/lib/*.mjs 范式）。 */

/** 闲时倍率配置（服务端 `GET /models` 的 `offPeak` 快照原样透传）。 */
export type OffPeakConfig = {
  enabled?: boolean;
  windows?: Array<{ id?: string; label?: string; start?: number; end?: number; rate?: number }>;
  active?: { label?: string; start?: number; end?: number; rate?: number } | null;
  /** 服务端 `getTimezoneOffset()`：时段判定按**服务器本地时间**，客户端靠它换算 */
  tzOffsetMinutes?: number;
};

/** 本轮积分估算结果。
 *  · `baseRate` = 高峰（基准）倍率；`rate` = **实际生效倍率**（闲时命中且配了 ⇒ 换成闲时倍率，
 *    否则等于 `baseRate`）。
 *  · `factor` = `rate / baseRate`，**仅供展示**（"相当于高峰的几折"），⛔ 不参与计价。
 *  · `free` = 实际生效倍率为 0（服务端只留痕不扣分）。 */
export type TurnCreditEstimate = {
  credit: number;
  rate: number;
  baseRate: number;
  factor: number;
  tokens: number;
  free: boolean;
  window: { label: string; start: number; end: number; rate?: number | null } | null;
};

/** 模型倍率 → 数字（空/0/非法 ⇒ 0 = 免费）。 */
export declare function creditRate(credits?: unknown): number;

/** 客户端的"现在" → 服务器本地小时数（含小数）；服务端没给时区偏移 ⇒ null。 */
export declare function serverHourAt(offPeak?: OffPeakConfig | null, now?: number): number | null;

/** 命中哪个闲时窗口（未启用/没命中 ⇒ null）。
 *  `opts.ignoreEnabled` = **只判时段、不看总闸** —— 每模型单独配了系数的，
 *  总闸关着也要能探到命中（否则就是"配了没用"，与服务端同一取舍）。 */
export declare function offPeakWindowAt(
  offPeak?: OffPeakConfig | null,
  now?: number,
  opts?: { ignoreEnabled?: boolean },
): TurnCreditEstimate["window"];

/** 计费系数：命中闲时 ⇒ 窗口系数，否则 1。 */
export declare function offPeakFactorAt(offPeak?: OffPeakConfig | null, now?: number): number;

/** 每模型单独配的闲时系数：`null` = 没配（跟随全局默认），数字 = 该模型自己的系数。 */
export declare function offPeakRateValue(value?: unknown): number | null;

/** 本轮积分估算；没有 token ⇒ null（调用方据此不显示）。 */
export declare function estimateTurnCredit(args?: {
  credits?: unknown;
  /** 该模型**单独**配的闲时系数（缺省/空 ⇒ 跟随全局默认系数） */
  modelOffPeakRate?: unknown;
  offPeak?: OffPeakConfig | null;
  input?: unknown;
  output?: unknown;
  now?: number;
}): TurnCreditEstimate | null;
