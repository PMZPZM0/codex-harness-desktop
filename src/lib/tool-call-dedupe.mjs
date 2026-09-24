// src/lib/tool-call-dedupe.mjs
//
// 同一个工具调用只执行一次（09-22 实测事故）。
//
// 事故形状：一次 `subagent_invoke` 产出 **7 个**子智能体会话
// （`D:\codexFBces\codex-home\sessions\2026\09\22\` 下 17:06:55~17:11:58 七个 rollout，
//   每个约 1MB，query 逐字相同），而会话自己的 rollout 里模型只发出 **1 条** function_call
//   （fc_0217…）、引擎只转出 **1 个** DynamicToolCall（call_00_wb4o…）。
// ⇒ 同一个 `item/tool/call` 事件被渲染层执行了 7 次（引擎重发 / 事件被重复订阅都会这样），
//   而每个副作用工具（subagent_invoke / memory_save / team_member_invoke / rpa_save …）
//   都会重新建会话、重新跑一遍：7 倍 token，侧栏被同名会话淹没。
//
// 判据：工具调用的语义是「同一个 id 只做一次」—— 重复到达必须复用同一份执行结果。
// ⛔ 不按「工具名 + 参数」去重：用户有意连跑两个相同任务时 id 不同，必须各跑各的。

/** 结果保留时长：引擎重发可能晚到几分钟（实测 7 次跨 5 分钟），窗口必须盖住它 */
export const TOOL_CALL_TTL_MS = 30 * 60_000;

/**
 * 建一个「按 id 去重」的执行器：同 id 的并发/重复调用只真正跑一次，其余复用同一 Promise。
 *  - 成功：结果保留 TTL（重发要复用），到期释放
 *  - 失败：立刻释放，允许重试（不然一次网络抖动会把该调用永久钉死）
 *  - 无 id：不去重（保守 —— 宁可重复执行，也不吞掉没有身份的调用）
 */
export function createToolCallDedupe(opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : TOOL_CALL_TTL_MS;
  const inflight = new Map();
  const run = (id, task) => {
    // ⛔ 不能用 `!id`：JSON-RPC 的 id 允许数字 0（`!0 === true` 会让那次调用完全逃逸去重）
    if (id === undefined || id === null || id === "") return Promise.resolve().then(task).then(() => false);
    const key = String(id);
    const existing = inflight.get(key);
    if (existing) return existing.then(() => true);   // true = 本次是重复到达，调用方必须补发响应
    const promise = Promise.resolve().then(task);
    inflight.set(key, promise);
    const release = () => { if (inflight.get(key) === promise) inflight.delete(key); };
    promise.then(() => setTimeout(release, ttlMs).unref?.(), release);
    return promise.then(() => false);
  };
  return { run, size: () => inflight.size, clear: () => inflight.clear() };
}
