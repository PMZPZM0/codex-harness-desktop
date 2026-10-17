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
  if (type === COMPACTION_TYPE) return true;
  /* 10-17 实测补充：进行中的压缩项在渲染层收到的形状与完成态**不同**——
     type 不是 contextCompaction，工具名挂在 name/toolName 上（用户截图：通用工具卡
     显示原始类型名 + 转圈，整条压缩链对它不命中 ⇒ 既没有运行中压缩线，也不被 foldItems 排除）。
     ⛔ 兜底按 name 判定（只认明确含 compaction 的名字，不误伤普通工具）。 */
  const name = String(item && (item.name ?? item.toolName ?? item.tool) != null ? (item.name ?? item.toolName ?? item.tool) : "").toLowerCase();
  return name.length > 0 && name.includes("compaction");
}
