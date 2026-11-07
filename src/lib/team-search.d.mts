/** `team-search.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */

export interface GroupSearchHit {
  /** 与消息 row.key 一致（React key / 去重用） */
  key: string;
  /** 与消息 DOM 的 data-item-id 一致（跳转定位用） */
  itemId: string;
  at: number;
  authorId: string;
  /** 原文（高亮时由消费方自己切） */
  text: string;
  /** 命中处上下文片段（已压掉换行） */
  snippet: string;
}

export function searchGroupRows(
  rows: unknown,
  query: unknown,
  options?: { limit?: number },
): GroupSearchHit[];
