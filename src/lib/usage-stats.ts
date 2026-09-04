/**
 * 本机使用统计。数据存在 localStorage，随每回合完成累加。
 * 只记录聚合量（不保存任何对话内容），用于「设置 → 使用统计」的图表展示。
 */
const STORAGE_KEY = "usage-stats";

export type UsageDay = { input: number; output: number; turns: number };

export type UsageStats = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** 单回合上下文占用的峰值 */
  peakTokens: number;
  /** 最长一回合的持续时间（毫秒） */
  longestTurnMs: number;
  days: Record<string, UsageDay>;
  /** 模型 -> 消耗 token 总量 */
  models: Record<string, number>;
};

const EMPTY: UsageStats = { turns: 0, inputTokens: 0, outputTokens: 0, peakTokens: 0, longestTurnMs: 0, days: {}, models: {} };

export function dayKey(at: number | Date = Date.now()) {
  const date = at instanceof Date ? at : new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function normalize(value: any): UsageStats {
  return {
    turns: Number(value?.turns ?? 0) || 0,
    inputTokens: Number(value?.inputTokens ?? 0) || 0,
    outputTokens: Number(value?.outputTokens ?? 0) || 0,
    peakTokens: Number(value?.peakTokens ?? 0) || 0,
    longestTurnMs: Number(value?.longestTurnMs ?? 0) || 0,
    days: value?.days && typeof value.days === "object" ? value.days : {},
    models: value?.models && typeof value.models === "object" ? value.models : {},
  };
}

export function readUsageStats(): UsageStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, days: {}, models: {} };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...EMPTY, days: {}, models: {} };
  }
}

export function writeUsageStats(stats: UsageStats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* 存储不可用时静默降级 */ }
}

export type TurnUsageInput = {
  /** 本回合新增的输入 token；拿不到增量时传 0 */
  inputTokens?: number;
  outputTokens?: number;
  /** 本回合上下文总占用（用于峰值） */
  contextTokens?: number;
  durationMs?: number;
  model?: string;
};

/** 记录一个完成回合的消耗。localStorage 不可用时整体静默失败，不影响主流程。 */
export function recordTurnUsage(input: TurnUsageInput): UsageStats {
  const stats = readUsageStats();
  const key = dayKey();
  const day = stats.days[key] ?? { input: 0, output: 0, turns: 0 };
  const addInput = Math.max(0, Math.round(input.inputTokens ?? 0));
  const addOutput = Math.max(0, Math.round(input.outputTokens ?? 0));
  stats.turns += 1;
  stats.inputTokens += addInput;
  stats.outputTokens += addOutput;
  day.input += addInput;
  day.output += addOutput;
  day.turns += 1;
  stats.days[key] = day;
  if (input.contextTokens) stats.peakTokens = Math.max(stats.peakTokens, Math.round(input.contextTokens));
  if (input.durationMs) stats.longestTurnMs = Math.max(stats.longestTurnMs, Math.round(input.durationMs));
  if (input.model) stats.models[input.model] = (stats.models[input.model] ?? 0) + addInput + addOutput;
  writeUsageStats(stats);
  return stats;
}

export function resetUsageStats() {
  writeUsageStats({ ...EMPTY, days: {}, models: {} });
}

/** 连续活跃天数（从今天或昨天往前数，今天还没用则从昨天起算） */
export function currentStreak(stats: UsageStats, today = dayKey()) {
  const active = new Set(Object.keys(stats.days).filter((key) => (stats.days[key]?.turns ?? 0) > 0));
  if (!active.size) return 0;
  const cursor = new Date();
  if (!active.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (;;) {
    if (!active.has(dayKey(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function totalTokens(stats: UsageStats) {
  return stats.inputTokens + stats.outputTokens;
}

/** 最近 N 天的明细，前后补零，便于画趋势与热力图 */
export function lastDays(stats: UsageStats, count: number): { key: string; date: Date; input: number; output: number; turns: number }[] {
  const out: { key: string; date: Date; input: number; output: number; turns: number }[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (count - 1));
  for (let i = 0; i < count; i += 1) {
    const key = dayKey(cursor);
    const day = stats.days[key] ?? { input: 0, output: 0, turns: 0 };
    out.push({ key, date: new Date(cursor), input: day.input, output: day.output, turns: day.turns });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function formatDuration(ms: number) {
  if (!ms) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatTokens(value: number) {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
