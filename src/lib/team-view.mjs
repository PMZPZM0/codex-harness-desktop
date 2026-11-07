/**
 * 团队模式 · 群视图派生口径（纯函数，可单测）
 *
 * 11-07：只保留**已接线**的一处 —— 群消息流按天分组（飞书群同款）：
 * 连续几十条跨天消息只靠 `HH:MM` 看不出"这是哪天"。
 * ⛔ 这里不做任何 DOM / IPC；日期一律按**本地时区**（与消息 fmtTime 同口径）。
 * ⛔ 不预先堆放还没消费方的派生函数（写了没接 = 死代码，等要用了再加）。
 */
const pad2 = (n) => String(n).padStart(2, "0");

/** 本地日历日 key（YYYY-MM-DD）；at 无效 ⇒ 空串（调用方据此不画分隔线）。 */
export function dayKeyOf(at) {
  const ms = Number(at);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 日期分隔文案：今天 / 昨天 / 完整年月日。now 可注入，便于单测跨天边界。 */
export function dayLabelOf(at, now = Date.now()) {
  const key = dayKeyOf(at);
  if (!key) return "";
  if (key === dayKeyOf(now)) return "今天";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKeyOf(y.getTime())) return "昨天";
  const d = new Date(Number(at));
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
