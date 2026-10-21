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

/** 回合排序键（与 orderTurnsByTime 同口径：缺失 startedAt 视为最后）。 */
function orderValue(turn) {
  const started = Number(turn?.startedAt);
  return Number.isFinite(started) && started > 0 ? started : Number.MAX_SAFE_INTEGER;
}

/**
 * 虚拟滚动条的历史计数（10-21）。
 *
 * 数据面：`stubs` = `thread/turns/list itemsView:"notLoaded"` 拉回来的**全部回合元数据**
 * （只有 id/startedAt，没有 items），按时间升序。它让滚动条能按「总回合数」撑出高度，
 * 而不是只按当前挂载的 5 个回合。
 *
 * 计入「视口上方还有多少回合」的两部分：
 *  · hiddenLoaded：已在内存、但被渲染窗口截掉的回合（本地展开即可，零网络）；
 *  · hiddenStubs：元数据里比当前窗口更早、且还没进内存的回合（需要按游标续拉）。
 * ⛔ 只在 `hasMore`（还有游标）时统计 hiddenStubs：全部历史都已加载时游标为空，
 *    此时残留的旧元数据（例如 revert 之后）不能再撑出一段永远加载不出来的空白。
 */
export function turnHistoryPlan(stubs, loadedOrdered, windowSize, hasMore) {
  const ordered = Array.isArray(loadedOrdered) ? loadedOrdered : [];
  const size = Number(windowSize);
  const start = Number.isFinite(size) && size > 0 ? Math.max(0, ordered.length - Math.floor(size)) : 0;
  const visible = ordered.slice(start);
  const hiddenLoaded = start;
  let hiddenStubs = 0;
  const first = visible[0];
  if (hasMore && first && Array.isArray(stubs)) {
    const loadedIds = new Set(ordered.map((turn) => String(turn?.id ?? "")));
    const firstKey = orderValue(first);
    const firstId = String(first?.id ?? "");
    for (const stub of stubs) {
      if (!stub || stub.id == null) continue;
      const key = orderValue(stub);
      if (key > firstKey) break;
      if (key === firstKey && String(stub.id) >= firstId) continue;
      if (!loadedIds.has(String(stub.id))) hiddenStubs += 1;
    }
  }
  return { visible, hiddenLoaded, hiddenStubs, hiddenCount: hiddenLoaded + hiddenStubs };
}
