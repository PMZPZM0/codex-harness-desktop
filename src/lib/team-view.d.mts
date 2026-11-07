/** `team-view.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */

/** 本地日历日 key（YYYY-MM-DD）；无效时间 ⇒ 空串。 */
export function dayKeyOf(at: unknown): string;

/** 日期分隔文案：今天 / 昨天 / 完整年月日。 */
export function dayLabelOf(at: unknown, now?: number): string;
