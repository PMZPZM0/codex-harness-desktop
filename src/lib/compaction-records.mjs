/**
 * compaction-records.mjs —— 宿主侦测到的「引擎真压缩」记录（渲染层侧，2026-10-07 立）。
 *
 * 背景（10-07 实测取证）：当前引擎对压缩**不发 item 事件**（只有一条空 turn），压缩 item 只落
 * rollout ⇒ 主进程 `compaction-watch` 用「非渲染层发起的回合 + rollout 尾巴对账」侦测，广播
 * `thread-compacted-host`（resume 时由 codex-ipc 重播存量）。本模块是渲染层那份镜像：
 * 事件到了记一条，时间线渲染压缩线时按 threadId 取**最新一条**（与 prune「只留最新」同口径）。
 *
 * ⛔ 只存内存：持久化在宿主侧（<userData>/compaction-records），重启后由 resume 重播回来 ——
 *    渲染层自己存 localStorage 会在多窗口（popout）下分叉（同 whats-new 的教训）。
 */
const byThread = new Map();
const MAX_PER_THREAD = 30;

/* 订阅面（10-07）：广播/重播到达时若恰好没有其它 state 更新，压缩线要等下一次被动重渲染
   才出现（竞态）。时间线用 useSyncExternalStore 订阅这个版本号 ⇒ 记录一变立刻重渲染。 */
const listeners = new Set();
let version = 0;

export function noteCompactionRecord(threadId, turnId, at) {
  const tid = String(threadId ?? "");
  const id = String(turnId ?? "");
  if (!tid || !id) return;
  const list = byThread.get(tid) ?? [];
  if (list.some((record) => record.turnId === id)) return; // 重播与实时可能重复到达
  list.push({ turnId: id, at: Number(at) || 0 });
  while (list.length > MAX_PER_THREAD) list.shift();
  byThread.set(tid, list);
  version += 1;
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* 单个监听器异常不影响其余 */ }
  }
}

/** 该线程最新一条压缩记录（没有则 null）。时间线据此定锚 + 画线。 */
export function compactionRecordFor(threadId) {
  const list = byThread.get(String(threadId ?? "")) ?? [];
  return list.length ? list[list.length - 1] : null;
}

export function subscribeCompactions(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function compactionVersion() {
  return version;
}
