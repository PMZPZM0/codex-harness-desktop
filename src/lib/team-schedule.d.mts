/** 群定时任务（纯函数，见 team-schedule.mjs） */

export type ScheduleKind = "interval" | "daily" | "weekly" | "once";

export interface GroupSchedule {
  id: string;
  name: string;
  prompt: string;
  memberIds: string[];
  kind: ScheduleKind;
  timeOfDay: string;
  weekdays: number[];
  scheduleType: "recurring" | "once";
  scheduledAt: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt?: number;
  lastError?: string;
  createdAt: number;
}

export const MAX_GROUP_SCHEDULES: number;
export const MAX_SCHEDULE_PROMPT_CHARS: number;
export const MAX_SCHEDULE_NAME_CHARS: number;
export const MAX_SCHEDULE_TARGETS: number;
export const SCHEDULE_KINDS: readonly ScheduleKind[];
export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string>;
export const WEEKDAY_LABELS: readonly string[];

export function normalizeTimeOfDay(value: unknown): string;
export function normalizeScheduleEntry(entry: unknown): GroupSchedule | null;
export function normalizeSchedules(list: unknown): GroupSchedule[];
export function upsertSchedule(list: unknown, entry: unknown, now?: number): GroupSchedule[];
export function sameCadence(a: unknown, b: unknown): boolean;
export function removeSchedule(list: unknown, id: string): GroupSchedule[];
export function toggleSchedule(list: unknown, id: string, enabled: boolean): GroupSchedule[];
export function scheduleBlockers(group: unknown, entry: unknown): string[];
export function describeSchedule(entry: unknown): string;
export function formatNextRun(ts: unknown, now?: number): string;
