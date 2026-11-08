/**
 * 群聊「过程块有新事件」的计数器（11-08 用户令：「跟主对话完全一致」）。
 *
 * 主对话的过程是**事件驱动**的（引擎每来一条 item/turn 事件就更一条）；
 * 群里的过程块数据要按 threadId 拉 `thread/turns/list`，原来靠 2.5 秒定时轮询
 * ⇒ 最多慢 2.5 秒，观感与主对话不一致。
 * ⇒ 主进程在成员回合运行期间广播 `group-talk-tick`（任何 item/turn 事件，200ms 合并），
 *   渲染层 bump 这里的计数器；`TeamProcess` 订阅计数器，变化时（150ms 防抖）重拉一次。
 * ⛔ 计数器只表示「可能变了」，不做数据合并 —— 单一真相源仍是 `thread/turns/list`。
 */
const ticks = new Map();
const listeners = new Set();

export function bumpTeamProcessTick(threadId) {
  const id = String(threadId ?? "");
  if (!id) return;
  ticks.set(id, (ticks.get(id) ?? 0) + 1);
  for (const fn of listeners) {
    try { fn(); } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

export function getTeamProcessTick(threadId) {
  return ticks.get(String(threadId ?? "")) ?? 0;
}

export function subscribeTeamProcessTicks(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
