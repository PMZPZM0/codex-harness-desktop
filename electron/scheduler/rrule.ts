/**
 * scheduler/rrule.ts —— 定时任务的 **RRULE 解析与构造**（纯函数）。
 *
 * 从 electron/scheduler.ts 切出（P2 批次 2）：这里是「表达式 ↔ 结构」的转换，与运行时
 *（tick / 并发闸 / 投递）无关，独立成模块后可单测。
 * ⛔ 对外仍经 scheduler.ts 重导出 —— 调用方零改动；`ScheduleKind` 走 type-only 回引（运行时擦除）。
 */
import type { ScheduleKind } from "../scheduler";

export const FULL_WEEK = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_TO_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export const INDEX_TO_DAY: Record<number, string> = { 0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA" };


export type RruleFreq = "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type ParsedRRule = {
  freq: RruleFreq;
  interval: number;
  intervalHours: number;
  byday: string[];
  bymonthday: number[];
  bymonth: number[];
  byhour: number;
  byminute: number;
};

function parseByDay(value: string | undefined): string[] {
  const values = (value || "").split(",").map((day) => day.trim().toUpperCase()).filter(Boolean).filter((day) => day in DAY_TO_INDEX);
  return [...new Set(values)].sort((left, right) => DAY_TO_INDEX[left] - DAY_TO_INDEX[right]);
}

function parseByNumberList(value: string | undefined, min: number, max: number): number[] {
  const values = (value || "").split(",").map((part) => Number.parseInt(part.trim(), 10)).filter((num) => Number.isFinite(num) && num >= min && num <= max);
  return [...new Set(values)].sort((left, right) => left - right);
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
