/**
 * RPA 配方查找（纯函数，可被守卫/验收直接真跑）。
 *
 * ⛔ 为什么不再用 `includes` 一把梭：配方名很短时（「日报」「日报2」），用户说「跑日报」
 *    也能命中「日报2」—— 静默跑错配方的代价比报错大得多。这里只在**唯一匹配**时返回，
 *    多条部分匹配一律回 `ambiguous`，由调用方让用户补全名称。
 */

/** 从配方列表按名称找唯一配方；精确 → 忽略大小写精确 → 唯一部分匹配。 */
export function matchRpaRecipe(recipes, query) {
  const list = (Array.isArray(recipes) ? recipes : []).filter((r) => r && typeof r.name === "string");
  const q = String(query ?? "").trim();
  if (!q) return { recipe: null, ambiguous: [] };

  const exact = list.filter((r) => r.name === q);
  if (exact.length === 1) return { recipe: exact[0], ambiguous: [] };
  if (exact.length > 1) return { recipe: null, ambiguous: exact.map((r) => r.name) };

  const qLower = q.toLowerCase();
  const ci = list.filter((r) => r.name.toLowerCase() === qLower);
  if (ci.length === 1) return { recipe: ci[0], ambiguous: [] };
  if (ci.length > 1) return { recipe: null, ambiguous: ci.map((r) => r.name) };

  const partial = list.filter((r) => r.name.includes(q) || q.includes(r.name));
  if (partial.length === 1) return { recipe: partial[0], ambiguous: [] };
  return { recipe: null, ambiguous: partial.map((r) => r.name) };
}
