/**
 * 群聊 · token 用量（11-08 Optional 收口）
 *
 * 主对话的用量来自引擎 `thread/tokenUsage/updated` 的 **last 桶**；群聊同一份口径。
 * 这里只放**纯判定**（事件解析 + 「该补到哪条消息」），IO / 落盘 / 广播仍在主进程板块里：
 *   · 事件可能在消息落盘之前或之后到达 ⇒ 调用方先按解析结果缓存，再按索引决定是否补写；
 *   · 补写只认「最近一条同会话、还没带用量、且不超时的伙伴消息」——
 *     ⛔ 运行中不补（会把本轮用量挂到中间那条 group_say 上，最终回复自己也带一份 = 显示两遍）。
 */

/** 用量缓存 / 迟到补写的时间窗（10 分钟）：超过就不再回头改历史消息。 */
export const GROUP_USAGE_TTL_MS = 10 * 60_000;

const num = (bucket, ...keys) => {
  for (const key of keys) {
    const value = Number(bucket?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

/** 引擎事件 → `{ threadId, usage }`；不是用量事件 / 缺 threadId / 缺 last 桶 ⇒ null。 */
export function usageFromTokenEvent(event) {
  if (!event || event.kind !== "notification") return null;
  if (String(event.method ?? "") !== "thread/tokenUsage/updated") return null;
  const threadId = String(event.params?.threadId ?? "");
  if (!threadId) return null;
  const raw = event.params?.tokenUsage;
  /* ⛔ 与 `src/lib/usage-bucket.ts` 同一取值顺序 —— 引擎几个版本字段名不同，别只认一个。 */
  const bucket = raw?.last ?? raw?.lastTokenUsage ?? raw?.last_token_usage ?? raw?.info?.last_token_usage ?? null;
  if (!bucket) return null;
  return {
    threadId,
    usage: {
      inputTokens: num(bucket, "inputTokens", "input_tokens", "input"),
      outputTokens: num(bucket, "outputTokens", "output_tokens", "output"),
      cachedTokens: num(bucket, "cachedInputTokens", "cached_input_tokens", "cached"),
      totalTokens: num(bucket, "totalTokens", "total_tokens", "total"),
    },
  };
}

/**
 * 该把用量补到哪条消息（只读判定）。
 * @param rows 群消息（新的在后）
 * @returns 下标；`-1` = 不补（没有该会话的消息 / 最新那条已有用量 / 已超时）
 */
export function pickUsagePatchIndex(rows, threadId, now = Date.now(), ttlMs = GROUP_USAGE_TTL_MS) {
  const list = Array.isArray(rows) ? rows : [];
  const id = String(threadId ?? "");
  if (!id) return -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    if (String(row?.threadId ?? "") !== id) continue;
    /* 找到**最新**一条同会话消息就停：已有用量 ⇒ 无需补；太旧 ⇒ 不补（别改历史）。 */
    if (row?.usage) return -1;
    const at = Number(row?.at ?? 0) || now;
    return now - at > ttlMs ? -1 : i;
  }
  return -1;
}

/** 缓存是否可用于本轮（⛔ 早于本轮开跑的缓存一律不算，免得把上一轮用量挂到新消息上）。 */
export function usageUsableFor(entry, since) {
  if (!entry || !entry.usage) return null;
  if (Number(entry.at ?? 0) < Number(since ?? 0)) return null;
  return entry.usage;
}
