/**
 * queued-local-input.mjs —— 队列条目的**本地原始 input**（2026-11-23 立）。
 *
 * ── 为什么需要（用户：「插队消息带了图片，codex 看不到图片」）──────────────────
 *  插队入队时宿主明明带了 `localImage`，但队列条目是从引擎回读的（`thread/queue/list`），
 *  `entry.input` 里只剩文本 ⇒ `turn/steer` 发出去的也就只有文本，模型看不到图。
 *  探针实测引擎**接受** localImage：同一个不存在的 threadId 下，
 *  「只有 text」与「text + localImage」返回的错误**完全一致**（都是 `thread not found`）
 *  ⇒ part 反序列化通过，缺的是宿主手里那份带图的 input。
 *
 * ── 做法 ──────────────────────────────────────────────────────────────────
 *  入队时按 `clientUserMessageId` 记一份原始 input；派发 steer 时优先用它。
 *  ⛔ 只存内存（会话级临时数据，重启即丢，不需要持久化）；容量封顶、先进先出。
 */

/** 上限：正常人手速下挂着十来条已封顶，50 足够防呆（⛔ 别无限长，这是内存里的 Map）。 */
const MAX = 50;

/** clientUserMessageId → 入队时的原始 input[]（含 localImage）。 */
const byClientId = new Map();

/**
 * 记下入队时的原始 input（含 localImage）。
 * ⛔ clientId 为空 / input 为空一律忽略 —— 宁可回落到引擎回传版，也不要存一份空壳。
 */
export function rememberQueuedInput(clientId, input) {
  const key = String(clientId ?? "");
  if (!key || !Array.isArray(input) || !input.length) return;
  byClientId.set(key, input);
  while (byClientId.size > MAX) byClientId.delete(byClientId.keys().next().value);
}

/**
 * 取回该条目的原始 input；没有记录 ⇒ null（调用方回落到 `entry.input`）。
 * ⛔ 取用**不删**：同一 clientId 可能被重试派发（steer 失败退化成新回合那条路）。
 */
export function localQueuedInput(clientId) {
  const key = String(clientId ?? "");
  return key && byClientId.has(key) ? byClientId.get(key) : null;
}

/** 条目彻底结束（已发出 / 用户删除）⇒ 释放，别在内存里留尸体。 */
export function forgetQueuedInput(clientId) {
  const key = String(clientId ?? "");
  if (key) byClientId.delete(key);
}
