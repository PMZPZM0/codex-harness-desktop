/**
 * scheduler：自动化调度引擎 —— 域文件。
 *
 * 09-22 从 electron/harness-services.ts 拆出（纯搬迁，原文逐字未动）。
 * 生效逻辑见下方原始注释块（对齐 WorkBuddy 5.4.5 的决策链）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { safeProviderId } from "./provider-id";
import { randomUUID } from "node:crypto";
import type { CodexServer } from "./codex-server";
import { PROVIDER_RETRY_TUNING } from "./provider-retry";

// ============================================================================
// 自动化调度引擎 —— 对齐 WorkBuddy 的生效逻辑与工作逻辑
// （逆向自 WorkBuddy 5.4.5 的 scheduler-engine.ts / schedule-utils.ts /
//   LocalAutomationScheduler / AutomationMainService 决策链）
//
// 生效逻辑：
//  - RRULE 表达调度（HOURLY / DAILY / WEEKLY / MONTHLY / YEARLY + INTERVAL +
//    BYDAY / BYHOUR / BYMINUTE / BYMONTH / BYMONTHDAY），once 用 scheduledAt
//  - 30s tick 轮询所有 ACTIVE 任务的 nextRunAt，tickInProgress 锁防重入
//  - decide() 决策矩阵：skip（停用 / 未来 / 运行中 / lastRunAt>=nextRunAt）→
//    expire（validUntil 过期 / once 超窗）→ skip_missed（超 24h 窗口 / 熔断）→
//    run（runKind = scheduled | missed）
//  - nextRunAt 严格 > base 的逐格搜索（相位守恒，INTERVAL>1 不漂移），
//    完成时刻（finishedAt）推进，而不是启动时刻
//  - missed 补跑：24h 窗口内 recovery jitter 二次打散（recoveryDispatchAt
//    单调不后延），连续 5 次中断熔断
//  - 运行中去重（running 集合 + 持久化 running 标志，冷启动清残留）、
//    canonical 去重（同 identity 只跑最老一条）、并发上限 3
// ============================================================================

export type ScheduleKind = "interval" | "daily" | "weekly" | "monthly" | "yearly" | "once";

export type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  workspace: string;
  model?: string;
  effort: string;
  /** 兼容旧字段：interval 类的间隔分钟数（HOURLY 由它换算，60 = 每 1 小时） */
  intervalMinutes: number;
  /** ACTIVE/PAUSED 的等价物（WorkBuddy 用 status 字段，这里保留 enabled） */
  enabled: boolean;
  /** 指定在哪个会话执行；缺省新建会话 */
  threadId?: string;
  /** 下一次运行的计划时刻（已带 jitter 打散）；null 表示序列已结束 */
  nextRunAt: number | null;
  lastRunAt?: number;
  lastError?: string;
  kind?: ScheduleKind;
  timeOfDay?: string;
  weekdays?: number[];
  /** WorkBuddy 风格调度字段 */
  rrule?: string;
  scheduleType?: "recurring" | "once";
  scheduledAt?: string;
  validFrom?: string;
  validUntil?: string;
  /** 表单扩展字段 */
  monthDay?: number;
  month?: number;
  biweekly?: boolean;
  createdAt?: number;
  /** 最近一次运行的类别：scheduled / missed / manual */
  runKind?: "scheduled" | "missed" | "manual";
  /** 连续中断次数（turn/aborted / 运行异常），>= 5 触发熔断跳过 missed 补跑 */
  consecutiveInterruptCount?: number;
  /** 运行态（持久化以跨重启恢复；冷启动清除 running） */
  running?: boolean;
  displayStatus?: string;
  recoveryDispatchAt?: number;
  recoveryOccurrenceMs?: number;
  recoveryDelayMs?: number;
};

// ---------- 常量（对齐 WorkBuddy） ----------
const RUN_TICK_MS = 30_000;
const MISSED_RUN_WINDOW_MS = 1440 * 60 * 1_000;
const SCHEDULED_RUN_GRACE_MS = 35_000;
const AUTOMATION_RUN_TIMEOUT_MS = 90 * 60 * 1_000;
const MAX_CONCURRENT_RUNS = 3;
const AUTOMATION_RECOVERY_INTERRUPT_CIRCUIT_MAX = 5;
const MAX_RECURRING_LOOKAHEAD_DAYS = 366 * 5;
const FULL_WEEK = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_TO_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const INDEX_TO_DAY: Record<number, string> = { 0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA" };
const DEFAULT_JITTER_CONFIG = { peakHours: [8, 9, 10], peakJitterMs: 600_000, nonPeakJitterMs: 300_000 };
const BEIJING_OFFSET_MS = 480 * 60 * 1_000;

type RruleFreq = "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
type ParsedRRule = {
  freq: RruleFreq;
  interval: number;
  intervalHours: number;
  byday: string[];
  bymonthday: number[];
  bymonth: number[];
  byhour: number;
  byminute: number;
};

function parseIsoTimestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: string | undefined, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function parseByDay(value: string | undefined): string[] {
  const values = (value || "").split(",").map((day) => day.trim().toUpperCase()).filter(Boolean).filter((day) => day in DAY_TO_INDEX);
  return [...new Set(values)].sort((left, right) => DAY_TO_INDEX[left] - DAY_TO_INDEX[right]);
}

function parseByNumberList(value: string | undefined, min: number, max: number): number[] {
  const values = (value || "").split(",").map((part) => Number.parseInt(part.trim(), 10)).filter((num) => Number.isFinite(num) && num >= min && num <= max);
  return [...new Set(values)].sort((left, right) => left - right);
}

export function parseRRule(rrule: string): ParsedRRule {
  const map = new Map<string, string>();
  for (const pair of (rrule || "").split(";")) {
    const [key, value] = pair.split("=");
    if (key && value) map.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  const rawFreq = map.get("FREQ") || "DAILY";
  const interval = parsePositiveInteger(map.get("INTERVAL"), 1);
  const byhour = clampNumber(map.get("BYHOUR"), 0, 23);
  const byminute = clampNumber(map.get("BYMINUTE"), 0, 59);
  const byday = parseByDay(map.get("BYDAY"));
  const bymonthday = parseByNumberList(map.get("BYMONTHDAY"), 1, 31);
  const bymonth = parseByNumberList(map.get("BYMONTH"), 1, 12);
  if (rawFreq === "DAILY") return { freq: "DAILY", interval, intervalHours: 1, byday: FULL_WEEK.slice(), bymonthday: [], bymonth: [], byhour, byminute };
  if (rawFreq === "HOURLY") return { freq: "HOURLY", interval, intervalHours: interval, byday: byday.length > 0 ? byday : FULL_WEEK.slice(), bymonthday: [], bymonth: [], byhour, byminute };
  if (rawFreq === "WEEKLY") {
    if (byday.length === 0) throw new Error("WEEKLY RRULE requires BYDAY");
    return { freq: "WEEKLY", interval, intervalHours: 1, byday, bymonthday: [], bymonth: [], byhour, byminute };
  }
  if (rawFreq === "MONTHLY") {
    if (bymonthday.length === 0) throw new Error("MONTHLY RRULE requires BYMONTHDAY");
    return { freq: "MONTHLY", interval, intervalHours: 1, byday: [], bymonthday, bymonth: [], byhour, byminute };
  }
  if (rawFreq === "YEARLY") {
    if (bymonth.length === 0) throw new Error("YEARLY RRULE requires BYMONTH");
    if (bymonthday.length === 0) throw new Error("YEARLY RRULE requires BYMONTHDAY");
    return { freq: "YEARLY", interval, intervalHours: 1, byday: [], bymonthday, bymonth, byhour, byminute };
  }
  throw new Error(`Unsupported RRULE frequency: ${rawFreq || "UNKNOWN"}`);
}

/** 由表单字段构造 RRULE（对齐 WorkBuddy buildRRule） */
export function buildRRuleFromInput(kind: ScheduleKind, timeOfDay?: string, weekdays?: number[], intervalMinutes?: number, monthDay?: number, month?: number, biweekly?: boolean): string {
  const [h, m] = (timeOfDay ?? "09:00").split(":").map(Number);
  const hour = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 9;
  const minute = Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0;
  if (kind === "once") return "";
  if (kind === "interval") {
    const hours = Math.max(1, Math.ceil((Number(intervalMinutes) || 60) / 60));
    return `FREQ=HOURLY;INTERVAL=${hours}`;
  }
  if (kind === "daily") return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`;
  if (kind === "weekly") {
    const days = (weekdays && weekdays.length ? weekdays : [1]).map((day) => INDEX_TO_DAY[day % 7]).filter(Boolean);
    return `FREQ=WEEKLY${biweekly ? ";INTERVAL=2" : ""};BYDAY=${days.join(",")};BYHOUR=${hour};BYMINUTE=${minute}`;
  }
  if (kind === "monthly") return `FREQ=MONTHLY;BYMONTHDAY=${Math.max(1, Math.min(31, monthDay ?? 1))};BYHOUR=${hour};BYMINUTE=${minute}`;
  return `FREQ=YEARLY;BYMONTH=${Math.max(1, Math.min(12, month ?? 1))};BYMONTHDAY=${Math.max(1, Math.min(31, monthDay ?? 1))};BYHOUR=${hour};BYMINUTE=${minute}`;
}

// ---------- jitter（削峰打散，对齐 WorkBuddy） ----------
function stableFractionFromString(seed: string): number {
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

function isPeakHour(timestampMs: number, config = DEFAULT_JITTER_CONFIG): boolean {
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

// ---------- 区间锚点（相位守恒） ----------
function startOfDayMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeekMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  const weekdayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekdayOffset);
  return date.getTime();
}

function getMonthIndex(timestampMs: number): number {
  const date = new Date(timestampMs);
  return date.getFullYear() * 12 + date.getMonth();
}

function matchesDayInterval(candidateMs: number, anchorDayMs: number, intervalDays: number): boolean {
  const dayDiff = Math.floor((startOfDayMs(candidateMs) - anchorDayMs) / (24 * 60 * 60 * 1_000));
  return dayDiff >= 0 && dayDiff % Math.max(1, intervalDays) === 0;
}

function matchesWeekInterval(candidateMs: number, anchorWeekStartMs: number, intervalWeeks: number): boolean {
  const weekDiff = Math.floor((startOfWeekMs(candidateMs) - anchorWeekStartMs) / (7 * 24 * 60 * 60 * 1_000));
  return weekDiff >= 0 && weekDiff % Math.max(1, intervalWeeks) === 0;
}

function matchesMonthInterval(candidateMs: number, anchorMonthIndex: number, intervalMonths: number): boolean {
  const monthDiff = getMonthIndex(candidateMs) - anchorMonthIndex;
  return monthDiff >= 0 && monthDiff % Math.max(1, intervalMonths) === 0;
}

function matchesYearInterval(candidateYear: number, anchorYear: number, intervalYears: number): boolean {
  const yearDiff = candidateYear - anchorYear;
  return yearDiff >= 0 && yearDiff % Math.max(1, intervalYears) === 0;
}

function getJitterLookbackBufferMs(): number {
  return Math.max(DEFAULT_JITTER_CONFIG.peakJitterMs, DEFAULT_JITTER_CONFIG.nonPeakJitterMs);
}

function getSearchStartMs(baseMs: number, lastRunAt: number | undefined, validFromMs: number | undefined): number {
  const lowerBound = typeof lastRunAt === "number" ? lastRunAt + getJitterLookbackBufferMs() + 1 : baseMs + 1;
  return Math.max(lowerBound, validFromMs ?? Number.NEGATIVE_INFINITY);
}

function getIntervalAnchorMs(task: Pick<ScheduledTask, "createdAt">, validFromMs: number | undefined, fallbackMs: number): number {
  const createdAtMs = typeof task.createdAt === "number" ? task.createdAt : fallbackMs;
  return Math.max(validFromMs ?? createdAtMs, createdAtMs);
}

function shiftToAllowedHourlyDay(candidateMs: number, byday: string[]): number | null {
  if (byday.length === 0) return candidateMs;
  const allowedDays = new Set(byday);
  let candidate = candidateMs;
  for (let attempt = 0; attempt < 336; attempt += 1) {
    const dayCode = INDEX_TO_DAY[new Date(candidate).getDay()];
    if (dayCode && allowedDays.has(dayCode)) return candidate;
    candidate += 3_600_000;
  }
  return null;
}

// ---------- 五个频率的 nextRunAt 计算（严格 > base，相位守恒） ----------
function computeOnceNextRunAt(task: ScheduledTask, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const scheduledAtMs = parseIsoTimestamp(task.scheduledAt);
  if (scheduledAtMs === undefined) return null;
  if (validFromMs !== undefined && scheduledAtMs < validFromMs) return null;
  if (validUntilMs !== undefined && scheduledAtMs > validUntilMs) return null;
  if (typeof lastRunAt === "number" && lastRunAt >= scheduledAtMs) return null;
  return scheduledAtMs;
}

function computeHourlyNextRunAt(parsed: ParsedRRule, automationId: string, baseMs: number, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const intervalMs = parsed.intervalHours * 3_600_000;
  let candidate = typeof lastRunAt === "number" ? lastRunAt + intervalMs : baseMs + intervalMs;
  if (validFromMs !== undefined && candidate < validFromMs) candidate = validFromMs;
  const shifted = shiftToAllowedHourlyDay(candidate, parsed.byday);
  if (shifted === null) return null;
  if (validUntilMs !== undefined && shifted > validUntilMs) return null;
  return applyJitter(shifted, automationId, intervalMs);
}

function computeDailyNextRunAt(parsed: ParsedRRule, automationId: string, baseMs: number, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const searchStartMs = getSearchStartMs(baseMs, lastRunAt, validFromMs);
  const searchStart = new Date(searchStartMs);
  const anchorDayMs = startOfDayMs(validFromMs ?? baseMs);
  for (let offset = 0; offset <= MAX_RECURRING_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = new Date(searchStart);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(parsed.byhour, parsed.byminute, 0, 0);
    if (candidate.getTime() < searchStartMs) continue;
    if (!matchesDayInterval(candidate.getTime(), anchorDayMs, parsed.interval)) continue;
    const candidateMs = candidate.getTime();
    if (validUntilMs !== undefined && candidateMs > validUntilMs) return null;
    return applyJitter(candidateMs, automationId, 24 * 60 * 60 * 1_000 * parsed.interval);
  }
  return null;
}

function computeWeeklyNextRunAt(parsed: ParsedRRule, task: ScheduledTask, baseMs: number, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const searchStartMs = getSearchStartMs(baseMs, lastRunAt, validFromMs);
  const searchStart = new Date(searchStartMs);
  const allowedDays = parsed.byday.length > 0 ? new Set(parsed.byday) : new Set(FULL_WEEK);
  const anchorWeekStartMs = startOfWeekMs(getIntervalAnchorMs(task, validFromMs, baseMs));
  for (let offset = 0; offset <= MAX_RECURRING_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = new Date(searchStart);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(parsed.byhour, parsed.byminute, 0, 0);
    if (candidate.getTime() < searchStartMs) continue;
    const dayCode = INDEX_TO_DAY[candidate.getDay()];
    if (!dayCode || !allowedDays.has(dayCode)) continue;
    if (!matchesWeekInterval(candidate.getTime(), anchorWeekStartMs, parsed.interval)) continue;
    const candidateMs = candidate.getTime();
    if (validUntilMs !== undefined && candidateMs > validUntilMs) return null;
    return applyJitter(candidateMs, task.id, 7 * 24 * 60 * 60 * 1_000 * parsed.interval);
  }
  return null;
}

function computeMonthlyNextRunAt(parsed: ParsedRRule, task: ScheduledTask, baseMs: number, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const searchStartMs = getSearchStartMs(baseMs, lastRunAt, validFromMs);
  const searchStart = new Date(searchStartMs);
  const allowedDays = new Set(parsed.bymonthday);
  const anchorMonthIndex = getMonthIndex(getIntervalAnchorMs(task, validFromMs, baseMs));
  for (let offset = 0; offset <= MAX_RECURRING_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = new Date(searchStart);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(parsed.byhour, parsed.byminute, 0, 0);
    if (candidate.getTime() < searchStartMs) continue;
    if (!allowedDays.has(candidate.getDate())) continue;
    if (!matchesMonthInterval(candidate.getTime(), anchorMonthIndex, parsed.interval)) continue;
    const candidateMs = candidate.getTime();
    if (validUntilMs !== undefined && candidateMs > validUntilMs) return null;
    return applyJitter(candidateMs, task.id, 30 * 24 * 60 * 60 * 1_000 * parsed.interval);
  }
  return null;
}

function computeYearlyNextRunAt(parsed: ParsedRRule, task: ScheduledTask, baseMs: number, validFromMs: number | undefined, validUntilMs: number | undefined, lastRunAt: number | undefined): number | null {
  const searchStartMs = getSearchStartMs(baseMs, lastRunAt, validFromMs);
  const searchStart = new Date(searchStartMs);
  const allowedMonths = new Set(parsed.bymonth);
  const allowedMonthDays = new Set(parsed.bymonthday);
  const anchorYear = new Date(getIntervalAnchorMs(task, validFromMs, baseMs)).getFullYear();
  for (let offset = 0; offset <= MAX_RECURRING_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = new Date(searchStart);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(parsed.byhour, parsed.byminute, 0, 0);
    if (candidate.getTime() < searchStartMs) continue;
    if (!allowedMonths.has(candidate.getMonth() + 1)) continue;
    if (!allowedMonthDays.has(candidate.getDate())) continue;
    if (!matchesYearInterval(candidate.getFullYear(), anchorYear, parsed.interval)) continue;
    const candidateMs = candidate.getTime();
    if (validUntilMs !== undefined && candidateMs > validUntilMs) return null;
    return applyJitter(candidateMs, task.id, 365 * 24 * 60 * 60 * 1_000 * parsed.interval);
  }
  return null;
}

/** 依调度重算 nextRunAt（严格 > baseMs；返回 null 表示序列结束）。lastRunAt 只在 missed 场景传入 */
export function computeNextRunAt(task: ScheduledTask, baseMs: number, lastRunAt?: number): number | null {
  const normalizedBaseMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  const validFromMs = parseIsoTimestamp(task.validFrom);
  const validUntilMs = parseIsoTimestamp(task.validUntil);
  if (validFromMs !== undefined && validUntilMs !== undefined && validFromMs > validUntilMs) return null;
  if (task.scheduleType === "once") return computeOnceNextRunAt(task, validFromMs, validUntilMs, lastRunAt);
  let parsed: ParsedRRule;
  try {
    parsed = parseRRule(task.rrule ?? "");
  } catch {
    return null;
  }
  if (parsed.freq === "HOURLY") return computeHourlyNextRunAt(parsed, task.id, normalizedBaseMs, validFromMs, validUntilMs, lastRunAt);
  if (parsed.freq === "DAILY") return computeDailyNextRunAt(parsed, task.id, normalizedBaseMs, validFromMs, validUntilMs, lastRunAt);
  if (parsed.freq === "WEEKLY") return computeWeeklyNextRunAt(parsed, task, normalizedBaseMs, validFromMs, validUntilMs, lastRunAt);
  if (parsed.freq === "MONTHLY") return computeMonthlyNextRunAt(parsed, task, normalizedBaseMs, validFromMs, validUntilMs, lastRunAt);
  return computeYearlyNextRunAt(parsed, task, normalizedBaseMs, validFromMs, validUntilMs, lastRunAt);
}

// ---------- missed 判定 / 恢复打散 / 熔断 ----------
function isWithinMissedRunWindow(nextRunAt: number, now: number): boolean {
  return now - nextRunAt <= MISSED_RUN_WINDOW_MS;
}

function getRecoveryWindowMs(occurrenceMs: number): number {
  return isPeakHour(occurrenceMs) ? 1200 * 1_000 : 600 * 1_000;
}

function computeRecoveryDelayMs(automationId: string, occurrenceMs: number, windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 0;
  const fraction = stableFractionFromString(`${automationId}:${occurrenceMs}`);
  return Math.floor(fraction * windowMs);
}

/** 恢复期补跑延迟不能顶到 24h 窗口最后一毫秒，预留一个 scheduler grace/tick */
function getSafeRecoveryDelayMs(automationId: string, occurrenceMs: number, windowMs: number, now: number): number {
  const delayMs = computeRecoveryDelayMs(automationId, occurrenceMs, windowMs);
  if (delayMs <= 0) return 0;
  const maxDelayMs = occurrenceMs + MISSED_RUN_WINDOW_MS - SCHEDULED_RUN_GRACE_MS - now;
  if (maxDelayMs <= 0) return 0;
  return Math.min(delayMs, maxDelayMs);
}

// ---------- canonical 去重（同 identity 只跑最老一条） ----------
function normalizeText(value?: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function getAutomationRunIdentity(task: ScheduledTask): string {
  return JSON.stringify({
    prompt: normalizeText(task.prompt),
    scheduleType: task.scheduleType ?? "recurring",
    schedule: task.scheduleType === "once" ? normalizeText(task.scheduledAt) : (task.rrule ?? "").toUpperCase(),
    validFrom: normalizeText(task.validFrom),
    validUntil: normalizeText(task.validUntil),
    workspace: path.resolve(task.workspace),
    model: normalizeText(task.model),
    effort: normalizeText(task.effort),
  });
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private loaded = false;
  private timer?: NodeJS.Timeout;
  private tickInProgress = false;
  private running = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly server: CodexServer,
    private readonly getModel: () => Promise<{ model: string; provider: string; name: string; baseUrl: string } | null>,
    private readonly log: (message: string) => void,
  ) {}

  async start() {
    await this.load();
    // 启动信息是技术性心跳：只在 DevTools 控制台打印，不发给 UI，避免污染用户对话。
    // 业务事件（保存/运行/失败/恢复）继续走 this.log → IPC → 系统卡。
    console.log(`[Scheduler] 启动调度器（每 ${RUN_TICK_MS / 1000}s tick，对齐 WorkBuddy SchedulerEngine）`);
    this.timer = setInterval(() => this.runTickSafely(), RUN_TICK_MS);
    this.runTickSafely();
  }

  /** tick 的安全包装（09-24，评估报告 §4.4 复核后的**降级结论**）：
   *  tick() 内是 try/finally、**没有 catch** ⇒ 一次抛出会变成 unhandled rejection
   *  （Electron 里表现为控制台噪音/进程警告）。⛔ 但它**不会**让调度停摆：
   *  finally 已复位 tickInProgress、定时器也不受影响，下一轮照常跑。
   *  所以这条是卫生问题而非"调度器会静默死掉"（审计原判过重，此处按实测降级）。
   *  仍然兜住：unhandled rejection 是 Electron 未来版本可能收紧的形态。 */
  private runTickSafely() {
    void this.tick().catch((error) => console.warn("[Scheduler] tick 抛出（已捕获，下一轮继续）:", error));
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  async list() { await this.load(); return this.tasks; }

  async save(input: Partial<ScheduledTask>) {
    await this.load();
    if (!input.name?.trim() || !input.prompt?.trim() || !input.workspace?.trim()) throw new Error("定时任务需要名称、提示词和工作区");
    const kind: ScheduleKind = input.kind ?? (input.scheduleType === "once" ? "once" : "interval");
    const current = input.id ? this.tasks.find((entry) => entry.id === input.id) : undefined;
    const rrule = input.rrule?.trim() || (kind !== "once" ? buildRRuleFromInput(kind, input.timeOfDay, input.weekdays, input.intervalMinutes, input.monthDay, input.month, input.biweekly) : "");
    if (kind !== "once") parseRRule(rrule); // 非法 RRULE 直接抛错，避免静默错配
    const now = Date.now();
    const task: ScheduledTask = {
      id: current?.id ?? input.id ?? randomUUID(),
      name: input.name.trim(), prompt: input.prompt.trim(), workspace: path.resolve(input.workspace),
      model: input.model?.trim() || undefined, effort: input.effort || "ultra",
      intervalMinutes: kind === "interval" ? Math.max(1, Math.ceil((Number(input.intervalMinutes) || 60) / 60) * 60) : kind === "daily" ? 1440 : kind === "weekly" ? 10080 : kind === "monthly" ? 43200 : 525600,
      enabled: input.enabled !== false,
      threadId: input.threadId || undefined,
      nextRunAt: null,
      lastRunAt: current?.lastRunAt, lastError: undefined,
      kind, timeOfDay: input.timeOfDay, weekdays: input.weekdays,
      rrule: rrule || undefined,
      scheduleType: input.scheduleType ?? (kind === "once" ? "once" : "recurring"),
      scheduledAt: input.scheduledAt, validFrom: input.validFrom, validUntil: input.validUntil,
      monthDay: input.monthDay, month: input.month, biweekly: input.biweekly,
      createdAt: current?.createdAt ?? now,
      consecutiveInterruptCount: current?.consecutiveInterruptCount ?? 0,
    };
    task.nextRunAt = input.enabled === false ? (current?.nextRunAt ?? computeNextRunAt(task, now)) : computeNextRunAt(task, now);
    this.tasks = current ? this.tasks.map((entry) => entry.id === task.id ? task : entry) : [task, ...this.tasks];
    await this.write();
    this.log(`[Scheduler] 已保存「${task.name}」 nextRunAt=${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString("zh-CN") : "无（序列已结束）"}${task.rrule ? ` rrule=${task.rrule}` : ""}`);
    return task;
  }

  async remove(id: string) { await this.load(); this.tasks = this.tasks.filter((entry) => entry.id !== id); await this.write(); }

  async runNow(id: string) {
    await this.load();
    const task = this.tasks.find((entry) => entry.id === id);
    if (!task) throw new Error("定时任务不存在");
    if (!task.enabled) throw new Error("定时任务已停用");
    if (this.running.has(task.id)) throw new Error("该任务正在运行中");
    void this.run(task, "manual").catch(() => undefined);
  }

  // ---------- tick：30s 轮询 + 决策矩阵 ----------
  private async tick() {
    if (this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const now = Date.now();
      const engineReady = (await this.getModel()) !== null; // 对齐 WorkBuddy wait_login：引擎未就绪不推进
      const actives = this.tasks.filter((entry) => entry.enabled);
      const canonicalIds = this.getCanonicalAutomationIds(actives);
      for (const task of actives) {
        if (this.running.has(task.id)) continue;
        const identity = getAutomationRunIdentity(task);
        if (canonicalIds.get(identity) !== task.id) {
          this.log(`[Scheduler] 跳过重复自动化「${task.name}」(${task.id})`);
          continue;
        }
        const decision = this.decide(task, now, engineReady);
        if (decision.action === "skip") continue;
        if (decision.action === "wait") {
          task.displayStatus = "waiting_model";
          continue;
        }
        if (decision.action === "expire") {
          this.log(`[Scheduler] 「${task.name}」已过期（${decision.reasonCode}），停用`);
          task.enabled = false;
          task.displayStatus = "expired";
          task.nextRunAt = null;
          await this.write();
          continue;
        }
        if (decision.action === "skip_missed") {
          this.log(`[Scheduler] 「${task.name}」错过补跑窗口（${decision.reasonCode}），推进到下一计划点`);
          this.advanceMissedNextRunAt(task, now);
          await this.write();
          continue;
        }
        if (this.running.size >= MAX_CONCURRENT_RUNS) continue; // 并发满：留待下个 tick
        void this.run(task, decision.runKind ?? "scheduled", decision.missedScheduledAt).catch(() => undefined);
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  /** 决策矩阵（对齐 WorkBuddy LocalAutomationScheduler.decide + AutomationMainService.decideDueAutomation） */
  private decide(task: ScheduledTask, now: number, engineReady: boolean): { action: "skip" | "wait" | "expire" | "skip_missed" | "run"; reasonCode?: string; runKind?: "scheduled" | "missed"; missedScheduledAt?: number } {
    if (!task.enabled) return { action: "skip", reasonCode: "paused" };
    if (task.running) return { action: "skip", reasonCode: "running" };
    const nextRunAt = task.nextRunAt;
    if (typeof nextRunAt !== "number" || !Number.isFinite(nextRunAt)) return { action: "skip", reasonCode: "no_next_run" };
    if (nextRunAt > now) return { action: "skip", reasonCode: "future" };
    if (typeof task.lastRunAt === "number" && task.lastRunAt >= nextRunAt) return { action: "skip", reasonCode: "already_run" };
    if (task.displayStatus === "missed_pending" && typeof task.recoveryDispatchAt === "number" && Number.isFinite(task.recoveryDispatchAt) && now < task.recoveryDispatchAt) return { action: "skip", reasonCode: "recovery_waiting" };
    const validUntilMs = parseIsoTimestamp(task.validUntil);
    if (validUntilMs !== undefined && now > validUntilMs) return { action: "expire", reasonCode: "valid_until_passed" };
    const isMissed = this.shouldTreatDueRunAsMissed(task, now);
    if (isMissed && !isWithinMissedRunWindow(nextRunAt, now)) {
      if (task.scheduleType === "once") return { action: "expire", reasonCode: "once_window_expired" };
      return { action: "skip_missed", reasonCode: "missed_window_expired" };
    }
    if (isMissed && task.scheduleType !== "once" && (task.consecutiveInterruptCount ?? 0) >= AUTOMATION_RECOVERY_INTERRUPT_CIRCUIT_MAX) {
      return { action: "skip_missed", reasonCode: "recovery_circuit_broken" };
    }
    if (!engineReady) return { action: "wait", reasonCode: "waiting_for_model" };
    return { action: "run", runKind: isMissed ? "missed" : "scheduled", missedScheduledAt: isMissed ? nextRunAt : undefined };
  }

  /** 到点判定：超过 35s 宽限（一个 tick）才算 missed；等待/恢复期恒算 missed */
  private shouldTreatDueRunAsMissed(task: ScheduledTask, now: number): boolean {
    if (!Number.isFinite(task.nextRunAt as number)) return false;
    if (task.displayStatus === "waiting_login" || task.displayStatus === "waiting_model" || task.displayStatus === "missed_pending") return true;
    const nextRunAt = task.nextRunAt as number;
    return now - removeJitter(nextRunAt, task.id) > SCHEDULED_RUN_GRACE_MS;
  }

  // ---------- 运行 ----------
  private async run(task: ScheduledTask, runKind: "scheduled" | "missed" | "manual", missedScheduledAt?: number) {
    // missed 补跑先走恢复打散：未到放行时刻则保持 missed_pending 等待（不占用 running 槽）
    if (runKind === "missed" && missedScheduledAt !== undefined && task.scheduleType !== "once") {
      if (await this.holdMissedRunForRecovery(task, missedScheduledAt)) return;
    }
    this.running.add(task.id);
    task.running = true;
    task.runKind = runKind;
    this.log(`[Scheduler] 运行「${task.name}」(${task.id}) runKind=${runKind}${missedScheduledAt !== undefined ? ` missedScheduledAt=${new Date(missedScheduledAt).toLocaleString("zh-CN")}` : ""}`);
    let finishedAt = Date.now();
    let interrupted = false;
    try {
      const model = await this.getModel();
      if (!model) throw new Error("尚未配置自定义模型");
      let threadId: string;
      if (task.threadId) {
        // 指定会话执行：resume 恢复上下文，不新建；失败则回退新建
        try {
          const resumed = await this.server.request("thread/resume", { threadId: task.threadId, excludeTurns: false }) as any;
          threadId = resumed.thread?.id ?? task.threadId;
        } catch {
          threadId = task.threadId;
        }
      } else {
        const started = await this.server.request("thread/start", {
          model: task.model || model.model,
          modelProvider: model.provider,
          cwd: task.workspace,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          config: { model_provider: safeProviderId(model.provider), model_providers: { [safeProviderId(model.provider)]: { name: model.name, base_url: model.baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } },
          dynamicTools: [
            { type: "function", name: "memory_recall", description: "按当前任务查询相关记忆。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
          ],
        }) as any;
        threadId = started.thread.id;
      }
      const startedAt = Date.now();
      await this.server.request("turn/start", { threadId, input: [{ type: "text", text: task.prompt, text_elements: [] }], model: task.model || model.model, effort: task.effort });
      // 等待该线程首回合真正完成，用 finishedAt 推进下一次（对齐 WorkBuddy advanceNextRunAt(finishedAt)）
      const outcome = await this.waitForTurnCompletion(threadId, AUTOMATION_RUN_TIMEOUT_MS);
      finishedAt = Date.now();
      if (outcome === "completed") {
        task.lastError = undefined;
        task.consecutiveInterruptCount = 0;
        this.log(`[Scheduler] 「${task.name}」回合完成，用时 ${Math.round((finishedAt - startedAt) / 1000)}s`);
      } else {
        interrupted = true;
        task.consecutiveInterruptCount = (task.consecutiveInterruptCount ?? 0) + 1;
        this.log(`[Scheduler] 「${task.name}」回合被中断（${outcome}）`);
      }
    } catch (error: any) {
      task.lastError = error.message;
      task.consecutiveInterruptCount = (task.consecutiveInterruptCount ?? 0) + 1;
      this.log(`[Scheduler] 「${task.name}」失败：${error.message}`);
    }
    task.lastRunAt = finishedAt;
    task.running = false;
    task.displayStatus = interrupted ? "interrupted" : undefined;
    task.recoveryDispatchAt = undefined;
    task.recoveryOccurrenceMs = undefined;
    task.recoveryDelayMs = undefined;
    this.running.delete(task.id);
    this.advanceNextRunAt(task, finishedAt);
    await this.write();
  }

  /** 完成时刻推进 nextRunAt（严格 > base；若原 nextRunAt 已晚于本次完成时刻则保持，如手动提前运行） */
  private advanceNextRunAt(task: ScheduledTask, base: number) {
    if (typeof task.nextRunAt === "number" && task.nextRunAt > base) return;
    const next = computeNextRunAt(task, base);
    task.nextRunAt = next;
    this.log(`[Scheduler] 「${task.name}」下一次运行：${next ? new Date(next).toLocaleString("zh-CN") : "无（序列已结束）"}`);
  }

  /**
   * skip_missed 专用推进：两阶段逐格前进（相位守恒，INTERVAL>1 不漂移）。
   * 阶段 1 跳过补跑窗口前的陈旧点；阶段 2 走到窗口内最后一个 <= now 的点（最新鲜的错过点）。
   */
  private advanceMissedNextRunAt(task: ScheduledTask, now: number) {
    const earliestCatchUp = now - MISSED_RUN_WINDOW_MS;
    let base = typeof task.nextRunAt === "number" && Number.isFinite(task.nextRunAt) ? task.nextRunAt : now;
    const MAX_SKIP_STEPS = 5_000;
    let candidate = computeNextRunAt(task, base);
    let skipped = 0;
    while (candidate !== null && candidate < earliestCatchUp) {
      if (skipped >= MAX_SKIP_STEPS) {
        candidate = computeNextRunAt(task, now);
        break;
      }
      base = candidate;
      candidate = computeNextRunAt(task, base);
      skipped += 1;
    }
    if (candidate !== null && candidate <= now) {
      let next = computeNextRunAt(task, candidate);
      while (next !== null && next <= now) {
        candidate = next;
        next = computeNextRunAt(task, candidate);
      }
    }
    task.nextRunAt = candidate;
  }

  /** missed 补跑恢复期二次打散（recoveryDispatchAt 单调不后延；同一 occurrence 稳定复现） */
  private async holdMissedRunForRecovery(task: ScheduledTask, missedScheduledAt: number): Promise<boolean> {
    const occurrence = missedScheduledAt;
    const now = Date.now();
    const existing = task.recoveryDispatchAt;
    if (typeof existing === "number" && task.recoveryOccurrenceMs === occurrence) {
      if (now < existing) {
        task.displayStatus = "missed_pending";
        await this.write();
        return true;
      }
      return false;
    }
    const windowMs = getRecoveryWindowMs(occurrence);
    const delayMs = getSafeRecoveryDelayMs(task.id, occurrence, windowMs, now);
    if (delayMs <= 0) return false;
    task.recoveryDispatchAt = now + delayMs;
    task.recoveryOccurrenceMs = occurrence;
    task.recoveryDelayMs = delayMs;
    task.displayStatus = "missed_pending";
    this.log(`[Scheduler] 「${task.name}」missed 恢复打散：occurrence=${new Date(occurrence).toLocaleString("zh-CN")} delay=${Math.round(delayMs / 1000)}s dispatchAt=${new Date(now + delayMs).toLocaleString("zh-CN")}`);
    await this.write();
    return true;
  }

  /** 等待某线程首回合结束（turn/completed / turn/aborted / turn/failed） */
  private waitForTurnCompletion(threadId: string, timeoutMs: number): Promise<"completed" | "aborted" | "failed" | "timeout"> {
    return new Promise((resolve) => {
      const handler = (event: any) => {
        if (event?.kind !== "notification") return;
        const method = String(event.method ?? "");
        if (!["turn/completed", "turn/aborted", "turn/failed"].includes(method)) return;
        if (event.params?.threadId !== threadId) return;
        cleanup();
        resolve(method === "turn/completed" ? "completed" : method === "turn/aborted" ? "aborted" : "failed");
      };
      const timer = setTimeout(() => { cleanup(); resolve("timeout"); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.server.off("event", handler); };
      this.server.on("event", handler);
    });
  }

  /** canonical 去重：同 identity（prompt+调度+工作区+模型）只取 createdAt 最早的一条 */
  private getCanonicalAutomationIds(automations: ScheduledTask[]): Map<string, string> {
    const canonicalByIdentity = new Map<string, string>();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      const identity = getAutomationRunIdentity(automation);
      const current = canonicalByIdentity.get(identity);
      if (!current) {
        canonicalByIdentity.set(identity, automation.id);
        continue;
      }
      const currentTask = this.tasks.find((entry) => entry.id === current);
      if (currentTask) {
        const currentCreated = typeof currentTask.createdAt === "number" ? currentTask.createdAt : 0;
        const candidateCreated = typeof automation.createdAt === "number" ? automation.createdAt : 0;
        if (candidateCreated < currentCreated) canonicalByIdentity.set(identity, automation.id);
      }
    }
    return canonicalByIdentity;
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.tasks = JSON.parse(await fs.readFile(this.file, "utf8")) as ScheduledTask[];
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    // 冷启动：清运行残留（对齐 reconcileColdStart），旧数据迁移出 rrule
    for (const task of this.tasks) {
      task.running = false;
      if (task.createdAt === undefined) task.createdAt = typeof task.lastRunAt === "number" ? task.lastRunAt : 0;
      if (!task.rrule && task.kind && task.kind !== "once") {
        task.rrule = buildRRuleFromInput(task.kind, task.timeOfDay, task.weekdays, task.intervalMinutes, task.monthDay, task.month, task.biweekly);
      }
      if (!task.scheduleType) task.scheduleType = task.kind === "once" ? "once" : "recurring";
      if (task.nextRunAt === undefined || task.nextRunAt === null) task.nextRunAt = computeNextRunAt(task, Date.now());
    }
  }

  private write() { return fs.writeFile(this.file, JSON.stringify(this.tasks, null, 2), "utf8"); }
}
