/**
 * memory/fabric-rank.ts —— 记忆检索的**打分与裁剪**（纯函数）。
 *
 * 从 electron/memory-fabric.ts（740 行）切出（P2 批次 5）：衰减 × 相关性的排序、tokenize、
 * 以及按容量裁剪。这一段不碰 fs、不碰句柄 ⇒ 独立成模块后可单测（此前只能靠端到端间接验证）。
 * ⛔ 对外仍经 memory-fabric.ts 重导出 —— 调用方零改动。
 */
import type { MemoryEntry, RecallOptions } from "../memory-fabric";

/** 衰减半衰期（天）：记忆权重的指数衰减基准（原在 memory-fabric.ts，随 decayOf 一起搬来）。 */
export const FABRIC_HALF_LIFE_DAYS = 14;

export function clamp01(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

/* ── 检索打分 ───────────────────────────────────────────────────────────── */

/** 中文近似分词：逐字 + 双字 bigram（零依赖、完全离线）。 */
export function tokenize(text: string): string[] {
  const s = String(text ?? "").toLowerCase();
  const out = new Set<string>();
  for (const ch of s) if (/[a-z0-9]/.test(ch) || ch.charCodeAt(0) > 127) out.add(ch);
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    if (/[a-z0-9]/.test(a) || a.charCodeAt(0) > 127) {
      if (/[a-z0-9]/.test(b) || b.charCodeAt(0) > 127) out.add(a + b);
    }
  }
  return [...out];
}

/**
 * ⛔ 判定一条记忆是否与查询相关。
 * **为什么不能是"命中任意一个 token"**：tokenize 出了逐字 + bigram，
 * 查"蓝绿部署"会拆出"部""署""蓝绿"…，随便哪条含"部"就算命中 ⇒
 * 召回一堆不相关条目（实跑抓到：查一个项目里没有的词，召回了 6 条）。
 * ⇒ 双阈值：长短语命中任意一个即算；单字/双字 token 必须命中**足够比例**才算。
 */
export function isRelevant(content: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const lower = content.toLowerCase();
  let shortHits = 0, shortTotal = 0;
  for (const t of tokens) {
    /* 长 token（≥3 字）是有区分度的，命中即算相关。 */
    if (t.length >= 3) { if (lower.includes(t)) return true; continue; }
    shortTotal++;
    if (lower.includes(t)) shortHits++;
  }
  if (!shortTotal) return false;
  /* ⛔ 门槛 0.34：低于它基本是噪声（中文单字命中率天然偏高）。
     例外：查询很短（≤2 token）时要求至少命中 1 个。 */
  return shortTotal <= 2 ? shortHits >= 1 : shortHits / shortTotal >= 0.34;
}

export function decayOf(entry: MemoryEntry, now: number): number {
  const days = Math.max(0, now - entry.createdAt) / 86_400_000;
  return 1 / (1 + days / FABRIC_HALF_LIFE_DAYS);
}

/**
 * 排序：相关度 × 权重 × 时间衰减 × 钉住加成。
 * ⛔ 查询为空时**按重要度返回全部**（常驻注入要的是"重要且新"，不是"匹配"）。
 */
export function rankEntries(entries: MemoryEntry[], query: string, opts: RecallOptions = {}): MemoryEntry[] {
  const now = Date.now();
  const tokens = tokenize(query);
  const cats = opts.categories?.length ? new Set(opts.categories) : null;
  let pool = entries.filter((e) => !cats || cats.has(e.category));
  if (opts.includePinned === false) pool = pool.filter((e) => !e.pinned);

  /* ⛔⛔ **已归档的条目不参与召回**（只保留内容，不参与检索/注入）。
     ⛔ 归档必须真的有行为差异，否则那个标记就是装饰（"注释声称能力"的变体）：
     只写不读的字段等于没有。默认**过滤掉**；需要读历史时显式传 includeArchived。
     ⛔ 裁剪与清扫**不过滤**归档（归档不等于可删）。 */
  const live = opts.includeArchived ? pool : pool.filter((e) => e.archivedAt == null);
  /* ⛔ 带 query 时**不相关的条目一律不返回** —— 只把 score 排到后面是不够的：
     `limit` 默认全量 ⇒ 它们照样出现在结果里（实跑抓到：查"蓝绿部署"召回了
     一条零命中的 pnpm 记忆）。语义：召回 = 相关度过滤 + 排序，不是"全都给你看"。 */
  const kept = tokens.length ? live.filter((e) => isRelevant(e.content, tokens)) : live;
  kept.sort((a, b) => b.weight * decayOf(b, now) * (b.pinned ? 1.5 : 1) - a.weight * decayOf(a, now) * (a.pinned ? 1.5 : 1)
    || b.createdAt - a.createdAt);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : kept.length;
  return kept.slice(0, limit);
}

/** 裁剪到上限：⛔ pinned 永不裁；其余按"权重低 + 最久没用"优先淘汰。 */
export function pruneEntries(entries: MemoryEntry[], max: number): MemoryEntry[] {
  if (entries.length <= max) return entries;
  const keep = new Set(
    entries
      .filter((e) => e.pinned)
      .map((e) => e.id),
  );
  const rest = entries
    .filter((e) => !keep.has(e.id))
    .sort((a, b) => b.weight - a.weight || (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  for (const e of rest) {
    if (keep.size >= max) break;
    keep.add(e.id);
  }
  const order = new Map(entries.map((e, i) => [e.id, i] as const));
  return entries.filter((e) => keep.has(e.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/* ── 句柄获取（唯一的工厂）──────────────────────────────────────────────── */

/**
 * ⛔⛔ **所有智能体（主会话 / 子智能体 / 被调度专家 / 团成员）拿的都是这个工厂的产物**
 * —— 这是"共用同一套记忆实现"的字面含义。
 * ⛔ 一次返回**两个**句柄（session + project），调用方不能只要一个：
 *   "读得到项目记忆"是全体智能体的共同基线；写 project 另走写入闸。
 */
