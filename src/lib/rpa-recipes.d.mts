/**
 * RPA 配方名称匹配（与 rpa-recipes.mjs 成对；只声明运行时真有的接口）。
 */

/** 配方最小形状：至少要有名字；其余字段原样透传。 */
export type RpaRecipeName = { name: string };

/** 按名称找唯一配方；精确 → 忽略大小写精确 → 唯一部分匹配，多条部分匹配回 ambiguous。 */
export function matchRpaRecipe<T extends RpaRecipeName>(
  recipes: readonly T[] | null | undefined,
  query: string | null | undefined,
): { recipe: T | null; ambiguous: string[] };
