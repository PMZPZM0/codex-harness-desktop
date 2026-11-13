/**
 * RPA 运行态追踪（纯模块，渲染层单例）。
 *
 * ⛔ 为什么需要它：RPA 的「执行」是把 steps 交给模型、由模型在**同一个回合**里逐步复现，
 *    工具返回时并不代表流程跑完。旧实现一拿到工具回执就写 `ok: true` ⇒ 设置页「上次成功 /
 *    已存 N 次运行」是假的。现在只在 `turn/completed`（成功）或
 *    `turn/aborted|failed|interrupted`（失败）时结算一次。
 *
 * 键优先用 turnId（同一会话同时只有一个活动回合）；拿不到 turnId 时退回 threadId，
 * 但**只匹配同样没有 turnId 的登记**，避免把别的回合的完成事件误结算到这次运行。
 */

const pending = new Map();

function keyOf(entry) {
  return entry.turnId ? `turn:${entry.turnId}` : `thread:${entry.threadId}`;
}

/** 登记一条 RPA 运行的等待结算（同一配方重复登记时以最新一次为准）。 */
export function trackRpaRun(input) {
  const recipeId = String(input?.recipeId ?? "");
  if (!recipeId) return false;
  const entry = { recipeId, threadId: String(input?.threadId ?? ""), turnId: String(input?.turnId ?? "") };
  for (const [key, value] of pending) if (value.recipeId === recipeId) pending.delete(key);
  pending.set(keyOf(entry), entry);
  return true;
}

/** 回合结束：命中就移除并返回 `{ recipeId, ... }`，没命中返回 null（别的会话/回合不受影响）。 */
export function settleRpaRun(input) {
  const turnId = String(input?.turnId ?? "");
  const threadId = String(input?.threadId ?? "");
  let key = turnId ? `turn:${turnId}` : "";
  let entry = key ? pending.get(key) : undefined;
  if (!entry && threadId) {
    const fallbackKey = `thread:${threadId}`;
    const candidate = pending.get(fallbackKey);
    // ⛔ 只结算「登记时就没有 turnId」的条目；有 turnId 的必须等它自己的回合结束。
    if (candidate && !candidate.turnId) { entry = candidate; key = fallbackKey; }
  }
  if (!entry) return null;
  pending.delete(key);
  return { ...entry, ok: input?.ok === true, error: String(input?.error ?? "") };
}

/** 启动失败/工具回执失败时主动取消（避免永远挂着「执行中」）。 */
export function cancelRpaRun(input) {
  return settleRpaRun({ turnId: input?.turnId, threadId: input?.threadId, ok: false, error: input?.error });
}

/** 当前等待结算的配方 id（供守卫/验收断言；无则空串）。 */
export function pendingRpaRecipeId(input) {
  const turnId = String(input?.turnId ?? "");
  const threadId = String(input?.threadId ?? "");
  const entry = (turnId ? pending.get(`turn:${turnId}`) : undefined) ?? (threadId ? pending.get(`thread:${threadId}`) : undefined);
  return entry?.recipeId ?? "";
}

/** 清空（单测隔离用）。 */
export function resetRpaRuns() {
  pending.clear();
}
