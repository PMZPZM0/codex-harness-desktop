/**
 * 播放记录（11-01 用户令：「在汇总消息下面加播放组件卡片，叉掉了也能点回来重新看」）。
 *
 * 只在内存里记本轮打开过的媒体（按会话 → 回合归类）；刷新/重启不保留 ——
 * 片源地址会过期，留一堆点开就报错的死卡片比没有更糟。
 *
 * ⛔ 触发点只有一个：MediaPreviewBridge 收到打开事件时记录（running turn id 由宿主传入）。
 *   从卡片再次打开时通常没有 running turn ⇒ 只更新已有条目的时间，不新造条目（不会无限复制）。
 */

const byThread = new Map();
const listeners = new Set();
/* getTurnMedia 会被 useSyncExternalStore 每帧调用 ⇒ 同一个 key 必须返回**同一个数组引用**，
   否则「新数组 ≠ 旧数组」会无限重渲染。任何变更只清缓存，下次读再算。 */
const turnCache = new Map();

function emit() {
  turnCache.clear();
  for (const listener of listeners) {
    try { listener(); } catch { /* 单个订阅者出错不影响其它 */ }
  }
}

export function subscribeMediaPlayback(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 打开媒体时记录。turnId 为空 = 不是回合内打开的（例如从卡片重开）⇒ 只刷新已有条目。 */
export function recordMediaPlayback({ threadId, turnId, source, title, kind }) {
  const thread = String(threadId ?? "");
  const src = String(source ?? "").trim();
  if (!thread || !src) return;
  const list = byThread.get(thread) ?? [];
  const existing = list.find((item) => item.source === src);
  if (existing) {
    existing.at = Date.now();
    if (title) existing.title = String(title);
    if (kind) existing.kind = String(kind);
    if (turnId) existing.turnId = String(turnId);
    byThread.set(thread, list);
    emit();
    return;
  }
  if (!turnId) return;
  const next = [{ threadId: thread, turnId: String(turnId), source: src, title: String(title ?? ""), kind: String(kind ?? ""), at: Date.now() }, ...list].slice(0, 8);
  byThread.set(thread, next);
  emit();
}

export function getTurnMedia(threadId, turnId) {
  const key = `${threadId ?? ""}\u0000${turnId ?? ""}`;
  const cached = turnCache.get(key);
  if (cached) return cached;
  const list = byThread.get(String(threadId ?? "")) ?? [];
  const filtered = list.filter((item) => item.turnId === String(turnId ?? ""));
  turnCache.set(key, filtered);
  return filtered;
}

export function clearThreadMedia(threadId) {
  if (byThread.delete(String(threadId ?? ""))) emit();
}