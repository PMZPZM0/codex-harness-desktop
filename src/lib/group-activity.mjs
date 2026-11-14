/**
 * 工作伙伴群「活跃度」（2026-11-14 Phase 3，抄 Pachat 群卡的「N talking today」）。
 *
 * ⛔ 只做**展示统计**：放群列表卡右上角/副行的小数字，**不占群头**——
 *   11-08 用户明确把群头那条「N 位成员 · 项目…」副标题当赘述删了，别变相加回去。
 * 纯函数、无副作用（守卫直接 import 跑真值表）。
 */

/** 某条群消息是否落在 `now` 所在的**本地自然日**。 */
function sameLocalDay(at, now) {
  const a = new Date(at);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 群活跃度：今日消息数 + 今日发过言的成员数。
 * @param rows 群消息行（至少含 `{ at?: number; authorId?: string }`）
 * @param now  当前时间（毫秒；调用方给，便于测试）
 * @returns `{ messagesToday, activeToday }`；空/坏数据一律 0。
 */
export function groupActivity(rows, now) {
  const list = Array.isArray(rows) ? rows : [];
  const at = Number(now) || Date.now();
  let messagesToday = 0;
  const authors = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const t = Number(raw.at ?? 0);
    if (!t || !sameLocalDay(t, at)) continue;
    messagesToday += 1;
    const author = String(raw.authorId ?? "");
    if (author) authors.add(author);
  }
  return { messagesToday, activeToday: authors.size };
}
