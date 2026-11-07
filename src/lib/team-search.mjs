/**
 * 团队模式 · 群内搜索（纯函数，可单测）
 *
 * 11-07 用户令：补「群内搜索」。豆包那边的实测口径是**群消息天然 append-only 日志**：
 * 搜索只是对已投影的行做过滤，⛔ 不新建索引、⛔ 不落盘、⛔ 不改群日志形状。
 *
 * 结果要能**跳转**：每条结果的 `key` / `itemId` 与消息 DOM 的 `data-item-id` 一一对应，
 * 渲染层据此补分页 + 滚动定位（见 `04-team-group-view.tsx` 的 `jumpToRow`）。
 *
 * ⛔ 纯函数：不读 DOM、不发 IPC；大小写折叠只用于比较，返回的仍是**原文**。
 */

/** 片段前后各留多少字符（够看出上下文，又不会把整条消息塞进结果列表）。 */
const SNIPPET_RADIUS = 34;

function snippetOf(text, at) {
  const src = String(text ?? "");
  if (at < 0) return src.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(src.length, at + SNIPPET_RADIUS);
  const body = src.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < src.length ? "…" : ""}`;
}

/**
 * 在群消息投影里搜。
 * @param rows `GroupMessageRow[]`（全量，不是分页后的）
 * @param query 查询词：按空白切成多个词，**全部命中**才算匹配（AND）
 * @param options { limit?: number } 默认 50
 * @returns [{ key, itemId, at, authorId, text, snippet }] 按时间倒序（新的在前）
 *
 * ⛔ 卡片消息不参与（`kind=card` 的正文是 JSON，搜它只会搜到一堆字段名）。
 * ⛔ 空查询返回空数组（不是返回全部 —— 那会让面板一打开就刷 400 条）。
 */
export function searchGroupRows(rows, query, options = {}) {
  const q = String(query ?? "").trim();
  if (!q) return [];
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const limit = Math.max(1, Number(options?.limit ?? 50) || 50);

  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.kind === "card") continue;
    const text = String(row.text ?? "");
    if (!text) continue;
    const hay = text.toLowerCase();
    if (!terms.every((term) => hay.includes(term))) continue;
    const first = hay.indexOf(terms[0]);
    out.push({
      key: String(row.key ?? ""),
      itemId: String(row.itemId ?? ""),
      at: Number(row.at ?? 0) || 0,
      authorId: String(row.authorId ?? ""),
      text,
      snippet: snippetOf(text, first),
    });
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}
