/**
 * scheduler/jitter.ts —— 定时任务的**抖动削峰**（纯函数）。
 *
 * 从 electron/scheduler.ts 切出（P2 批次 1）：对齐 WorkBuddy 的「整点错峰」，按 automationId
 * 稳定散列把触发时刻摊到峰时/非峰时两个抖动窗口内；`removeJitter` 负责从已打散的时刻反解基准。
 * ⛔ 纯函数（只依赖 Date 与常量），可单测；对外仍经 scheduler.ts 重导出。
 */

export const DEFAULT_JITTER_CONFIG = { peakHours: [8, 9, 10], peakJitterMs: 600_000, nonPeakJitterMs: 300_000 };
const BEIJING_OFFSET_MS = 480 * 60 * 1_000;

// ---------- jitter（削峰打散，对齐 WorkBuddy） ----------
export function stableFractionFromString(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function getBeijingHour(timestampMs: number): number {
  const beijingMs = timestampMs + new Date(timestampMs).getTimezoneOffset() * 60 * 1_000 + BEIJING_OFFSET_MS;
  return new Date(beijingMs).getHours();
}

export function isPeakHour(timestampMs: number, config = DEFAULT_JITTER_CONFIG): boolean {
  return config.peakHours.includes(getBeijingHour(timestampMs));
}

export function applyJitter(scheduledTimeMs: number, automationId: string, _periodMs: number, config = DEFAULT_JITTER_CONFIG): number {
  const fraction = stableFractionFromString(automationId);
  const signed = (fraction - 0.5) * 2;
  const jitterMs = isPeakHour(scheduledTimeMs, config) ? signed * config.peakJitterMs : signed * config.nonPeakJitterMs;
  return scheduledTimeMs + jitterMs;
}

/** 从已打散的 nextRunAt 反解「用于 missed 判定的计划基准」（对负偏移任务取最宽容原像） */
export function removeJitter(jitteredTimeMs: number, automationId: string, config = DEFAULT_JITTER_CONFIG): number {
  const signed = (stableFractionFromString(automationId) - 0.5) * 2;
  if (signed >= 0) return jitteredTimeMs;
  const candidatePeak = jitteredTimeMs - signed * config.peakJitterMs;
  const candidateNonPeak = jitteredTimeMs - signed * config.nonPeakJitterMs;
  const preimages: number[] = [];
  if (isPeakHour(candidatePeak, config)) preimages.push(candidatePeak);
  if (!isPeakHour(candidateNonPeak, config)) preimages.push(candidateNonPeak);
  if (preimages.length === 0) return jitteredTimeMs;
  return Math.max(...preimages);
}
