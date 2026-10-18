/**
 * 压缩线的**锚点**（纯函数，10-18 抽出来；用户报「每次发新消息压缩线都在上面，没跟着历史往上顶」）。
 *
 * 语义：线落在「压缩发生所在回合（含）之前最近一条用户消息回合」的正上方 —— 它是**历史项**，
 *       新消息到来时线不动、随内容被顶上去；再次压缩时锚点随新边界下移。
 *
 * ⛔⛔ 三个边界（第二个是旧代码的真 bug，用户 10-18 截图实证）：
 *   ① 边界回合在可见窗口里 ⇒ 从它往上找最近一条**含 userMessage** 的回合，插在该回路上方；
 *   ② 边界**已知但不在窗口/没加载** ⇒ **插在窗口最顶部**。
 *      为什么会不在：大会话只加载最近几页回合（`resumeThreadWithTurns` 每页 200、最多 3 页，desc 取），
 *      而压缩常常发生在更早的历史里。旧代码在这里回退到「最后一回合」⇒ 线被钉在最新消息上方，
 *      每发一条新消息都跟着往下跑 = 用户看到的「每次都在上面」。
 *   ③ 边界**未知**（只有 toast，没有任何回合信息）⇒ 才用「最后一回合」（压缩就发生在当下）。
 *
 * ⛔ 只吃 `visible`（窗口内、时间正序）：`ordered` 是全部已加载回合，其元素常常不在 `visible` 里，
 *   用 `ordered` 找会得到 `visible.indexOf(...) === -1`（线凭空消失）。
 */

/** @param visible 可见回合（窗口内，时间正序）@param boundaryTurnId 压缩所在回合 id（空串 = 未知） */
export function resolveCompactionAnchor(visible, boundaryTurnId) {
  const list = Array.isArray(visible) ? visible : [];
  if (!list.length) return -1;
  const id = String(boundaryTurnId ?? "");
  if (!id) return list.length - 1; // ③ 边界未知 ⇒ 最后一回合（压缩就发生在当下）
  const at = list.findIndex((turn) => String(turn?.id ?? "") === id);
  if (at < 0) return 0; // ② 边界比窗口更早 ⇒ 顶部（⛔ 不是最后一回合）
  for (let i = at; i >= 0; i--) {
    const items = Array.isArray(list[i]?.items) ? list[i].items : [];
    if (items.some((item) => item?.type === "userMessage")) return i; // ①
  }
  // 边界回合里没有 userMessage（罕见：引擎侧的空回合）⇒ 就插在该回合本身之前
  return at;
}
