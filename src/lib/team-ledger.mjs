/**
 * 团队模式 · 用量账本（纯函数，11-06）
 *
 * 豆包实测口径：计费维度是 **`(agent, 触发来源)`**，不是 `(用户)`。
 * 报告原话：「这张表要早点建，否则后期没法做成本归因」「事后补等于重跑历史」。
 * ⇒ 每次派活一落盘就记一条，**哪怕失败也记**（失败也烧了 token，且失败率本身是重要指标）。
 *
 * ⛔ 这里没有真实 token 数（引擎没回 usage）：记的是**可观测代理量**（字符数、耗时、成败）。
 *    代理量能回答"谁在烧、烧给谁、哪条线最贵"，⛔ 不要假装它是精确计费。
 * ⛔ 纯函数：不读盘、不发 IPC。落盘在主进程（`harness-team:log-usage`）。
 */

/** 账本上限（条）。超了丢最老的 —— 归因看的是趋势，不是全量审计。 */
export const MAX_LEDGER_ENTRIES = 2000;

/** 触发来源的中文标签（界面与汇总共用一份）。 */
export const LEDGER_SOURCE_LABELS = Object.freeze({
  human: "我（手动 @）",
  partner: "伙伴派活",
  automation: "自动化",
});

const SOURCES = Object.freeze(["human", "partner", "automation"]);

/** 一条用量记录：谁（memberId）、从哪来（source）、花多少（chars/ms）、成没成（ok）。 */
export function normalizeLedgerEntry(entry) {
  const memberId = String(entry?.memberId ?? "").trim();
  if (!memberId) return null;
  const source = SOURCES.includes(entry?.source) ? String(entry.source) : "human";
  return {
    at: Number(entry?.at ?? 0) || 0,
    groupId: String(entry?.groupId ?? ""),
    groupName: String(entry?.groupName ?? ""),
    memberId,
    partnerName: String(entry?.partnerName ?? ""),
    source,
    threadId: String(entry?.threadId ?? ""),
    chars: Math.max(0, Number(entry?.chars ?? 0) || 0),
    /* 真实 token（引擎 `thread/tokenUsage/updated` 的 last 桶）；拿不到就是 0 ——
       ⛔ 与"真的用了 0"要能区分：界面里 token 为 0 时显示「—」而不是「0 tok」。 */
    inputTokens: Math.max(0, Number(entry?.inputTokens ?? 0) || 0),
    outputTokens: Math.max(0, Number(entry?.outputTokens ?? 0) || 0),
    totalTokens: Math.max(0, Number(entry?.totalTokens ?? 0) || 0),
    ms: Math.max(0, Number(entry?.ms ?? 0) || 0),
    ok: entry?.ok !== false,
    /* ⛔ 失败原因要留：只看"失败了 3 次"没法排查，"因为专家团未开"才是信息 */
    error: String(entry?.error ?? "").slice(0, 200),
  };
}

/** 追加一条（返回新数组，⛔ 不就地 push）。 */
export function appendLedger(list, entry, max = MAX_LEDGER_ENTRIES) {
  const e = normalizeLedgerEntry(entry);
  const base = Array.isArray(list) ? list : [];
  if (!e) return base;
  const next = [...base, e];
  const cap = Number(max) > 0 ? Number(max) : MAX_LEDGER_ENTRIES;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * 汇总（按 (agent, 来源) 两个维度拆）。
 * @param entries 账本数组
 * @param options { sinceMs?: number, groupId?: string, nowMs?: number, days?: number }
 * @returns { window: {since, days}, total, byPartner, bySource }
 */
export function summarizeLedger(entries, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const days = Number(options.days ?? 7);
  const since = Number(options.sinceMs ?? (days > 0 ? nowMs - days * 24 * 3600 * 1000 : 0));
  const groupId = String(options.groupId ?? "");

  const rows = (Array.isArray(entries) ? entries : [])
    .map(normalizeLedgerEntry)
    .filter(Boolean)
    .filter((e) => e.at >= since)
    .filter((e) => (groupId ? e.groupId === groupId : true));

  const total = { count: 0, chars: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, ms: 0, failed: 0, partners: 0 };
  const byPartner = new Map();
  const bySource = new Map();

  for (const e of rows) {
    total.count += 1;
    total.chars += e.chars;
    total.inputTokens += e.inputTokens;
    total.outputTokens += e.outputTokens;
    total.totalTokens += e.totalTokens;
    total.ms += e.ms;
    if (!e.ok) total.failed += 1;

    const pk = e.memberId;
    const p = byPartner.get(pk) ?? { memberId: pk, name: e.partnerName || pk, count: 0, chars: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, ms: 0, failed: 0 };
    p.count += 1;
    p.chars += e.chars;
    p.inputTokens += e.inputTokens;
    p.outputTokens += e.outputTokens;
    p.totalTokens += e.totalTokens;
    p.ms += e.ms;
    if (!e.ok) p.failed += 1;
    if (!p.name && e.partnerName) p.name = e.partnerName;
    byPartner.set(pk, p);

    const sk = e.source;
    const s = bySource.get(sk) ?? { source: sk, count: 0, chars: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, ms: 0, failed: 0 };
    s.count += 1;
    s.chars += e.chars;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    s.totalTokens += e.totalTokens;
    s.ms += e.ms;
    if (!e.ok) s.failed += 1;
    bySource.set(sk, s);
  }

  total.partners = byPartner.size;
  const avg = (x) => (x.count > 0 ? Math.round(x.ms / x.count) : 0);

  return {
    window: { since, days, groupId },
    total: { ...total, avgMs: avg(total) },
    byPartner: [...byPartner.values()]
      .map((x) => ({ ...x, avgMs: avg(x) }))
      .sort((a, b) => b.chars - a.chars || b.count - a.count),
    bySource: [...bySource.values()].map((x) => ({ ...x, avgMs: avg(x) })).sort((a, b) => b.chars - a.chars),
  };
}

/** 把字符数写得像人话（1.2 万 / 860）。⛔ 不要在这里算钱 —— 单价我们没有。 */
export function formatChars(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)} 万`;
  return String(Math.round(v));
}

/** token 写得像人话（860 / 12.4k / 0.9M）。⛔ 0 显示「—」：那是"没拿到"不是"没用"。 */
export function formatTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v <= 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

/** 耗时写得像人话（0.8s / 12s / 1m20s）。 */
export function formatMs(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 60000) return `${(v / 1000).toFixed(1)}s`;
  const m = Math.floor(v / 60000);
  const s = Math.round((v % 60000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}
