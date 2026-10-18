/**
 * 压缩线的**锚点**（纯函数，10-18 抽出；用户两次实测：
 *   ①「每次发新消息他都在上面，没有跟着历史消息往上顶」；②「我刚刚压缩的，压缩完成就不见了」）。
 *
 * 语义：线落在「压缩发生的位置」，且**是历史项** —— 新消息到来时线不动、随后续内容被顶上去。
 *
 * ⛔⛔ 三个边界：
 *   ① 压缩所在回合在可见窗口里 ⇒ 插在**它自己**之前（它自带 userMessage 时 = 用户消息正上方；
 *      它是空回合（手动压缩新建的那种）时 = 最后一条真实消息之后）。
 *   ② 压缩所在回合**不在窗口**（大会话只加载最近几页；或手动压缩的空回合被「空推进回合整组不渲染」过滤掉）
 *      ⇒ 用**压缩记录的时间**定位：落在「最后一个 `completedAt <= 压缩时间` 的回合」**之后**。
 *      · 刚手动压缩完：那个回合就是当前最后一回合 ⇒ 线在**末尾**（压缩发生处、看得见）；
 *      · 之后再来新消息：锚点仍固定在那同一个回合之后 ⇒ 线**不跟着新消息往下跑**（用户要的"往上顶"）。
 *      旧代码在这里回退「最后一回合」或「窗口顶部」⇒ 前者把线钉在最新消息上方、后者让刚压缩完的线直接消失。
 *   ③ 压缩所在回合**未知且没时间**（只有 toast / 老记录）⇒ 最后一回合（压缩就发生在当下）。
 *
 * ⛔ 只吃 `visible`（窗口内、时间正序）：`ordered` 是全部已加载回合，其元素常常不在 `visible` 里，
 *   用 `ordered` 找会得到 `visible.indexOf(...) === -1`（线凭空消失）。
 * @returns 插入位置：`visible` 的下标；`-1` = 不插；`visible.length` = 末尾（在最后一回合**之后**）
 */

/** 回合的“最后活动时刻”（毫秒）：优先 completedAt，退化到 startedAt；取不到 = 0。 */
function turnTimeMs(turn) {
  const n = Number(turn?.completedAt ?? 0) || Number(turn?.startedAt ?? 0) || 0;
  return Number.isFinite(n) ? n : 0;
}

export function resolveCompactionAnchor(visible, boundaryTurnId, options = {}) {
  const list = Array.isArray(visible) ? visible : [];
  if (!list.length) return -1;
  const id = String(boundaryTurnId ?? "");
  const at = id ? list.findIndex((turn) => String(turn?.id ?? "") === id) : -1;
  if (at >= 0) return at; // ① 压缩所在回合在窗口 ⇒ 插在它自己之前
  const when = Number(options?.compactionAt ?? 0);
  if (when > 0) {
    // ② 不在窗口（或被过滤）⇒ 按时间落在最后一个「先于压缩」的回合之后
    for (let i = list.length - 1; i >= 0; i--) {
      const t = turnTimeMs(list[i]);
      if (t > 0 && t <= when) return i + 1;
    }
    return 0; // 压缩比窗口里所有回合都早 ⇒ 窗口顶部（历史项）
  }
  return id ? 0 : list.length - 1; // ③ 无时间信息：有时是更早的历史（顶部）；完全没有（toast）⇒ 最后一回合
}
