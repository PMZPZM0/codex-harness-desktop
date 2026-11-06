/**
 * 团队模式 · 调度会话运行时桥（11-06）
 *
 * ⛔ 纯模块：不 import React、不 import app-state 的 bag。两边都通过它对话：
 *   · app-state（事件路由 / 限流重试）登记「哪些 threadId 是宿主派活起的调度会话」，
 *     并注册「取消某会话重试链」的能力；
 *   · harness-team（群聊弹窗 / 设置页团队面板）点「停止」时清理重试链。
 *
 * 为什么要有桥：群聊是独立板块（AGENTS.md §2.2），⛔ 不许直接摸全局 bag；
 * 但 429 自动重试链是**渲染层全局状态**，且主进程的 `runDelegatedTask` 是同步等回传的
 * —— 重试出来的产出没有任何接收方，纯烧 token。用户看到的就是
 * 「【调度·X】限流重试已发出：第 1/3 次…」一直刷，而群聊里找不到停止的地方。
 *
 * ⛔⛔ 两套状态别混：`running` 是「此刻还在跑」（UI 计数 / 停止清理的对象），
 *   `known` 是「这个 threadId 本窗口见过是调度会话」（限流总闸的**身份判据**）。
 *   超时转后台时主进程先广播 `delegate-run finished`、后转发 `turn/completed(429)`
 *   ⇒ finished 一到就从 running 摘掉，若总闸查 running 会漏拦并重新刷屏。
 *   所以身份是粘性的：finished 只摘 running，⛔ 不许从 known 删。
 */
const running = new Map();
const known = new Set();
const MAX_KNOWN = 400;
let cancelRetry = null;
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) { try { fn(); } catch { /* 单个订阅者出错不影响其余 */ } }
};

/** 粘性登记：最近用过的排后面，超限淘汰最老的一条（⛔ 不许无限长）。 */
function noteDelegateSession(id) {
  known.delete(id);
  known.add(id);
  if (known.size > MAX_KNOWN) {
    const oldest = known.values().next().value;
    if (oldest !== undefined) known.delete(oldest);
  }
}

/** 登记一次宿主派活（delegate-run started / 启动时从 listDelegates 的 running 记录补种）。 */
export function markDelegateThread(threadId) {
  const id = String(threadId ?? "").trim();
  if (!id) return;
  const isNew = !running.has(id);
  running.set(id, { startedAt: Date.now() });
  noteDelegateSession(id);
  if (isNew) emit();
}

/** 派活结束（delegate-run finished）。⛔ 只摘 running；身份留在 known，见文件头注释。 */
export function unmarkDelegateThread(threadId) {
  const id = String(threadId ?? "").trim();
  if (id && running.delete(id)) emit();
}

/** 事件路由判据：调度会话不排「无接收方」的自动重试（主对话多开会话不受影响）。 */
export function isDelegateThread(threadId) {
  return known.has(String(threadId ?? ""));
}

/** 仍在跑的调度会话 id（群聊停止键的清理范围）。 */
export function delegateThreadIds() { return [...running.keys()]; }

/** app-state 注册 `bag.cancelRateLimitRetry`。返回反注册函数。 */
export function registerRateLimitCancel(fn) {
  cancelRetry = typeof fn === "function" ? fn : null;
  emit();
  return () => {
    if (cancelRetry === fn) { cancelRetry = null; emit(); }
  };
}

/**
 * 群聊「停止」：清理仍在跑的调度会话残留的重试状态。
 * ⛔ silent=true：不再弹「已停止限流重试」——用户明确说「一直刷那个提醒很烦」。
 * ⛔ 注册函数还没接上时返回 0（不许把「调用了空函数」虚报成已取消 N 条）。
 */
export function cancelDelegateRetries() {
  if (typeof cancelRetry !== "function") return 0;
  let cleared = 0;
  for (const id of delegateThreadIds()) {
    try { cancelRetry(id, true); cleared += 1; } catch { /* 单个失败不影响其余 */ }
  }
  return cleared;
}

export function subscribeTeamRuntime(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** useSyncExternalStore 的快照：必须是稳定值（数字），不能每次返回新对象。 */
export function teamRuntimeSnapshot() { return running.size; }
