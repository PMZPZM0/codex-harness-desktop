/**
 * RPA 运行态追踪（与 rpa-run-tracker.mjs 成对；只声明运行时真有的接口）。
 */

/** 登记/结算的键：turnId 优先，没有时用 threadId 兜底。 */
export type RpaRunKey = { recipeId?: string; threadId?: string; turnId?: string };

/** 结算结果：带回配方 id 与回合终态。 */
export type RpaRunSettled = { recipeId: string; threadId: string; turnId: string; ok: boolean; error: string };

/** 登记一条等待回合结束结算的 RPA 运行。 */
export function trackRpaRun(input: RpaRunKey): boolean;

/** 回合结束（完成/失败/中断）时结算；没命中返回 null。 */
export function settleRpaRun(input: RpaRunKey & { ok?: boolean; error?: string }): RpaRunSettled | null;

/** 启动/回执失败时主动取消，返回被取消的条目（没有则 null）。 */
export function cancelRpaRun(input: RpaRunKey & { error?: string }): RpaRunSettled | null;

/** 当前等待结算的配方 id；没有则空串。 */
export function pendingRpaRecipeId(input: RpaRunKey): string;

/** 清空全部等待项（单测隔离用）。 */
export function resetRpaRuns(): void;
