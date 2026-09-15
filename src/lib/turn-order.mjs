// src/lib/turn-order.mjs
//
// 回合列表的时序规范化（09-15）：修「回合顺序错乱 + 更早消息按钮对不上」一类 bug 的纯逻辑层。
//
// 事故形状（用户真实会话 01a0a216 实测）：mergeLongerStreams 把「缓存有、resume 快照没带回」的
// 回合**盲目前插**，一旦某次 resume 只带回部分回合（如最旧的 [1,2]），状态变成
// [3,4,5,6,7,8,1,2] —— 最旧的贴到列表末尾、中间回合看似失踪，「显示更早的 N 条」按钮
// 与实际渲染完全对不上。修法：任何合并/渲染前，按回合 startedAt 做稳定排序 + 按 id 去重，
// 让乱序输入在唯一出口处被规范化。

/** 回合排序键：startedAt 缺失（刚 starts 尚未带时间戳的直播回合）视为最大 → 排在最后，保持相对顺序。 */
function sortKey(turn) {
  const started = Number(turn?.startedAt);
  return Number.isFinite(started) && started > 0 ? started : Number.MAX_SAFE_INTEGER;
}

/**
 * 按时间正序规范化回合列表（稳定排序：同时间戳/缺失者保持原相对顺序）。
 * 任何「往状态里合合并回合」的出口都应经过它，杜绝乱序渲染。
 */
export function orderTurnsByTime(turns) {
  const list = Array.isArray(turns) ? turns : [];
  return list
    .map((turn, index) => ({ turn, index, key: sortKey(turn) }))
    .sort((a, b) => (a.key - b.key) || (a.index - b.index))
    .map((entry) => entry.turn);
}

/**
 * 按 id 去重合并两份回合列表（后者是前者的补充；同 id 保留 primary 的一方），
 * 再做时序规范化。mergeLongerStreams 的 extraTurns+mergedTurns 用它收口。
 */
export function mergeTurnListsById(primary, secondary) {
  const a = Array.isArray(primary) ? primary : [];
  const b = Array.isArray(secondary) ? secondary : [];
  const seen = new Set(a.map((t) => String(t?.id)));
  const merged = [...a];
  for (const turn of b) {
    const id = String(turn?.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(turn);
  }
  return orderTurnsByTime(merged);
}

/**
 * 取「按时间排序后」的可见窗口（时间线上最后 windowSize 个回合）。
 * 返回 ordered（完整规范序列）与 visible（应渲染的切片），isLastTurn 等判定以 ordered 为准。
 */
export function visibleTurnWindow(turns, windowSize) {
  const ordered = orderTurnsByTime(turns);
  const size = Number(windowSize);
  const start = Number.isFinite(size) && size > 0 ? Math.max(0, ordered.length - Math.floor(size)) : 0;
  return { ordered, visible: ordered.slice(start) };
}
