/**
 * 团队模式 · 调度会话运行时桥（11-06）
 *
 * ⛔ 纯模块：不 import React、不 import app-state 的 bag。两边都通过它对话：
 *   · app-state（事件路由 / 限流重试）登记「哪些 threadId 是宿主派活起的调度会话」，
 *     并注册「取消某会话重试链」的能力；
 *   · harness-team（群聊弹窗 / 设置页团队面板）点「停止」时取消这些重试链。
 *
 * 为什么要有桥：群聊是独立板块（AGENTS.md §2.2），⛔ 不许直接摸全局 bag；
 * 但 429 自动重试链是**渲染层全局状态**，且主进程的 `runDelegatedTask` 是同步等回传的
 * —— 重试出来的产出没有任何接收方，纯烧 token。用户看到的就是
 * 「【调度·X】限流重试已发出：第 1/3 次…」一直刷，而群聊里找不到停止的地方。
 */
const running = new Map();
let cancelRetry = null;
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) { try { fn(); } catch { /* 单个订阅者出错不影响其余 */ } }
};

/** 登记一次宿主派活（delegate-run started）。groupId 只用于按群清理，空串 = 不限群。 */
export function markDelegateThread(threadId, groupId = "") {
  const id = String(threadId ?? "").trim();
  if (!id) return;
  running.set(id, { groupId: String(groupId ?? ""), startedAt: Date.now() });
  emit();
}

/** 派活结束（delegate-run finished）。⛔ 结束即摘，别让集合无限长。 */
export function unmarkDelegateThread(threadId) {
  const id = String(threadId ?? "").trim();
  if (id && running.delete(id)) emit();
}

/** 事件路由判据：调度会话不排「无接收方」的自动重试（主对话多开会话不受影响）。 */
export function isDelegateThread(threadId) {
  return running.has(String(threadId ?? ""));
}

export function delegateThreadIds(groupId = "") {
  if (!groupId) return [...running.keys()];
  return [...running.entries()].filter(([, v]) => v.groupId === groupId).map(([k]) => k);
}

export function delegateRunningCount() { return running.size; }

/** app-state 注册 `bag.cancelRateLimitRetry`。返回反注册函数。 */
export function registerRateLimitCancel(fn) {
  cancelRetry = typeof fn === "function" ? fn : null;
  emit();
  return () => {
    if (cancelRetry === fn) { cancelRetry = null; emit(); }
  };
}

/**
 * 群聊「停止」：把登记中的调度会话已排的重试链一并取消。
 * ⛔ silent=true：不再弹「已停止限流重试」——用户明确说「一直刷那个提醒很烦」。
 */
export function cancelDelegateRetries(groupId = "") {
  const ids = delegateThreadIds(groupId);
  let cancelled = 0;
  for (const id of ids) {
    try { cancelRetry?.(id, true); cancelled += 1; } catch { /* 单个失败不影响其余 */ }
  }
  return cancelled;
}

export function subscribeTeamRuntime(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** useSyncExternalStore 的快照：必须是稳定值（数字），不能每次返回新对象。 */
export function teamRuntimeSnapshot() { return running.size; }
