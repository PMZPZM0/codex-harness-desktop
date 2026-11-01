/**
 * 会话行「多标签切换」的显示索引（11-01 用户令：「标签最多就只能显示一个，多了就在标签上加一个切换显示标签功能」）。
 *
 * ⛔ 为什么是一个独立 store、而不是组件里的 useState：
 *   `renderThreadRow` 是 `usePart02b12()` 里的**普通函数**（由侧栏组件 map 调用，不是组件），
 *   里面不能调 hook —— 上一版就是在里面调 `useSyncExternalStore` 直接把界面搞成 React #310 白屏。
 *   ⇒ 状态放这里，订阅在 hook 顶层做一次（`usePart02b12` 的 aliasState 旁边）。
 *
 * 语义：每个会话记一个「当前显示第几个标签」的下标；点标签循环 `index + 1`。
 * 标签数量变化（比如"需审批"消失）后下标取模，不会越界。
 */

let state = { index: {} };
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

/** 点一下：切到下一个（`len` 是当前标签总数，避免依赖外部再算一遍）。 */
export function cycleThreadBadge(threadId, len) {
  const id = String(threadId ?? "");
  if (!id || !Number.isFinite(len) || len <= 1) return;
  const current = state.index[id] ?? 0;
  state = { index: { ...state.index, [id]: (current + 1) % len } };
  emit();
}

export function getBadgeCycleState() {
  return state;
}

export function subscribeBadgeCycle(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 取当前下标（按 len 取模，标签数量变了也不越界）。 */
export function badgeCycleIndexOf(badgeState, threadId, len) {
  const id = String(threadId ?? "");
  const raw = badgeState?.index?.[id] ?? 0;
  if (!Number.isFinite(len) || len <= 0) return 0;
  return ((raw % len) + len) % len;
}
