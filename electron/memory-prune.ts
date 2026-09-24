/**
 * L3 记忆碎片池的生命周期判定（09-22）—— 纯逻辑、零依赖。
 *
 * 为什么单独成文件：主进程代码 CDP 测不到，而「过期该不该清 / pinned 能不能动 /
 * 容量超限淘汰谁」是最容易悄悄写错的一段 —— 写错了用户看不见，只会发现召回越来越差。
 * 预检【97】直接 require `dist-electron/memory-prune.js` 跑真实现（同 voice/wake-match 的做法）。
 *
 * 规则（对齐 UI 里 P0–P3 的承诺）：
 *  - 临时上下文（P3）：TTL 14 天未更新即过期；其余分类是长期记忆，不自动过期
 *  - 总容量上限 500 条：超出按「分类权重 × 时间衰减 × 置信度」淘汰尾部
 *  - pinned（P0）永不淘汰
 */

export const MEMORY_TTL_MS = 14 * 86_400_000;
export const MEMORY_MAX_RECORDS = 500;
export const EPHEMERAL_CATEGORY = "临时上下文";
/** 时间衰减半衰期（与召回打分同一口径） */
export const MEMORY_HALF_LIFE_MS = 7 * 86_400_000;

/** 分类价值权重：核心类别高于临时。
 *  ⛔ 09-22 新增「用户纠错」= 用户明确说你做错了 —— 最高权重（1.8，高于项目背景），
 *     它是最该被反复读到的纪律（用户点名要"单独一类"）。 */
export const MEMORY_CATEGORY_WEIGHT: Record<string, number> = { "用户纠错": 1.8, "项目背景": 1.5, "工作流/SOP": 1.4, "用户偏好": 1.3, "任务经验": 1.2, "临时上下文": 0.6 };

/** 任何自动淘汰都不许碰的分类（与 pinned 同级的保护；用户纠错一旦丢了就等着再犯同一个错） */
export const NEVER_PRUNE_CATEGORIES: readonly string[] = ["用户纠错"];

export function isProtected(entry: PrunableRecord): boolean {
  return Boolean(entry.pinned) || NEVER_PRUNE_CATEGORIES.includes(entry.category);
}

export type PrunableRecord = {
  id: string;
  category: string;
  content: string;
  confidence?: number;
  updatedAt: number;
  pinned?: boolean;
};

/** 保留价值：分类权重 × 时间衰减 × 置信度 */
export function memoryValue(entry: PrunableRecord, now: number): number {
  const weight = MEMORY_CATEGORY_WEIGHT[entry.category] ?? 1;
  const age = Math.max(0, Number.isFinite(now - entry.updatedAt) ? now - entry.updatedAt : 0);
  // ⛔ confidence 为 NaN 时 `?? 0.8` 兜不住（NaN 不是 null/undefined）⇒ 价值变 NaN ⇒ 容量淘汰排序全乱
  const confidence = Number.isFinite(entry.confidence) ? entry.confidence! : 0.8;
  return weight * Math.pow(0.5, age / MEMORY_HALF_LIFE_MS) * confidence;
}

/** 过期判定：只有临时上下文会过期，且 pinned 豁免 */
export function isExpired(entry: PrunableRecord, now: number, ttlMs = MEMORY_TTL_MS): boolean {
  return entry.category === EPHEMERAL_CATEGORY && !entry.pinned && now - entry.updatedAt > ttlMs;
}

/**
 * 选出要淘汰的记录（keep / dropped 都保持输入顺序）。
 * ⛔ 只淘汰**非保护项**：`pinned`（用户显式保护）与 `NEVER_PRUNE_CATEGORIES`（如「用户纠错」）
 *    都是 P0，任何自动流程都不许动它们。
 * ⛔ 契约：容量上限**只约束非保护项** —— 保护项全占满时 keep.length 会 > maxRecords（上限让位，不是 bug）。
 */
export function pickPrunable<T extends PrunableRecord>(records: T[], opts: { now?: number; ttlMs?: number; maxRecords?: number } = {}): { keep: T[]; dropped: T[] } {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? MEMORY_TTL_MS;
  const maxRecords = opts.maxRecords ?? MEMORY_MAX_RECORDS;
  const list = Array.isArray(records) ? records : [];
  const dropped = list.filter((entry) => isExpired(entry, now, ttlMs));
  let keep = list.filter((entry) => !isExpired(entry, now, ttlMs));
  if (keep.length > maxRecords) {
    const victims = keep
      .filter((entry) => !isProtected(entry))
      .slice()
      .sort((a, b) => memoryValue(a, now) - memoryValue(b, now))
      .slice(0, keep.length - maxRecords);
    const victimIds = new Set(victims.map((entry) => entry.id));
    dropped.push(...victims);
    keep = keep.filter((entry) => !victimIds.has(entry.id));
  }
  return { keep, dropped };
}
