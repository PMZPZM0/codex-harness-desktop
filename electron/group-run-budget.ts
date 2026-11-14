/**
 * 工作伙伴群「每成员持久运行预算」（2026-11-14 Phase 2，抄 Pachat 的「每个 agent 每天最多跑 N 次」）。
 *
 * ⛔ 与「单轮节流」是两套东西：单轮已经有 `canRun`（每人 ≤3 回合/轮）+ `chainBudget`；
 *   这里管的是**跨轮 / 跨多条用户消息**的失控保护 —— 一个群被反复派活时，别让某个成员一天跑爆。
 * ⛔ 独立小文件、惰性路径（app.setPath 之后才求值）、按天计数、跨天自动归零、只增不减当日。
 * 上限取 100/天（与 Pachat 的 LISTEN_MAX_RUNS 同量级）：正常用不到，只挡失控/死循环。
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export const GROUP_RUN_MAX_PER_DAY = 100;

type BudgetRow = { day: string; count: number };
let cache: Record<string, BudgetRow> | null = null;
let loadedFor = "";

function budgetFile(): string {
  return path.join(app.getPath("userData"), "group-run-budget.json");
}

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function load(): Record<string, BudgetRow> {
  const file = budgetFile();
  if (cache && loadedFor === file) return cache;
  loadedFor = file;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    cache = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, BudgetRow>) : {};
  } catch {
    cache = {};
  }
  return cache as Record<string, BudgetRow>;
}

function persist(): void {
  try {
    const file = budgetFile();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache ?? {}), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* 写失败不影响本轮（内存值仍生效） */
  }
}

/** 消耗一次成员运行预算。返回 false = 该成员今天已达上限（调用方据此跳过这一轮，明天自动恢复）。 */
export function consumeGroupRunBudget(groupId: string, memberId: string, now = Date.now(), maxPerDay = GROUP_RUN_MAX_PER_DAY): boolean {
  if (!groupId || !memberId) return true;
  const map = load();
  const key = `${groupId}::${memberId}`;
  const day = dayKey(now);
  const cur = map[key];
  const count = cur && cur.day === day ? Number(cur.count) || 0 : 0; // 跨天归零
  if (count >= maxPerDay) return false;
  map[key] = { day, count: count + 1 };
  persist();
  return true;
}

/** 读该成员今天还剩多少次（诊断/守卫用；不改状态）。 */
export function groupRunBudgetLeft(groupId: string, memberId: string, now = Date.now(), maxPerDay = GROUP_RUN_MAX_PER_DAY): number {
  if (!groupId || !memberId) return maxPerDay;
  const cur = load()[`${groupId}::${memberId}`];
  const used = cur && cur.day === dayKey(now) ? Number(cur.count) || 0 : 0;
  return Math.max(0, maxPerDay - used);
}
