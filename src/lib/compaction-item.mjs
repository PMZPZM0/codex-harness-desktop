/**
 * compaction-item.mjs —— 压缩 item 的类型判定（纯函数，唯一口径）。
 *
 * ⛔ 为什么需要它（09-26 真机取证）：引擎落盘/事件流里的压缩 item 类型是
 * **PascalCase `ContextCompaction`**（rollout `event_msg.item_completed` 实证：
 * `{"item":{"type":"ContextCompaction","id":"01a0dc5..."}}`），而宿主各处按 camelCase
 * `contextCompaction` 判定 ⇒ **全链路静默不命中**：item 不进 thread（线渲染不出来，
 * 只剩时间线尾部的 toast 兜底 = 用户三次截图「线一直在下面」）、prune 不清理旧线、
 * 压缩期运行态不结算（状态条挂住）。大小写必须在一处归一，禁止各处硬写字符串。
 */
export const COMPACTION_TYPE = "contextCompaction";

/** 是否压缩 item（类型名大小写不敏感：camelCase / PascalCase 都认）。 */
export function isCompactionItem(item) {
  const type = String(item && item.type != null ? item.type : "").toLowerCase();
  return type === COMPACTION_TYPE;
}
