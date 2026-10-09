/**
 * 轮询配置与中止登记（主进程侧，10-09 建）。
 *
 * ⛔ 配置真相源在 `userData/poll-settings.json`：**渲染层改、主进程用** ——
 *    wait 循环跑在主进程，读渲染层的内存变量是读不到的（两个进程）；反过来让主进程自己拍脑袋
 *    定死 5 秒 / 10 分钟，用户就永远改不了。⇒ 落盘一份，两边都读它。
 *
 * ⛔⛔ 中止为什么要一张登记表：wait 循环是主进程里的一段 `while`，渲染层的「中止」按钮在
 *    另一个进程 —— 唯一的通道是 IPC。登记表是这段跨进程协作的最小接缝（不做"取消 Promise"
 *    那套：跨进程传 cancellable 对象在此处没有意义，还会把 wait 循环拖进事件序问题）。
 *
 * ⛔ 惰性求值（【91】）：`app.getPath("userData")` 只在函数体内取 —— 模块体求值会拿到
 *    `app.setPath` 改写之前的默认目录（路径静默漂移，历史事故）。
 *
 * ⛔⛔ **这里的常量是 `src/lib/poll-config.mjs` 的镜像**（electron 与 src 互不 import，
 *    各有字面量 —— 与记忆里那条纪律一致）。改一边必须改另一边，守卫【284】逐字比对。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type PollConfig = {
  /** 两次查询之间的等待（毫秒） */
  intervalMs: number;
  /** 从开始到判定超时的总时长（毫秒） */
  timeoutMs: number;
  /** 连续失败多少次后才判失败（中间按指数退避自动重试） */
  maxRetry: number;
};

export const POLL_DEFAULTS: PollConfig = { intervalMs: 5000, timeoutMs: 600000, maxRetry: 3 };

export const POLL_LIMITS = {
  intervalMs: { min: 500, max: 120000 },
  timeoutMs: { min: 5000, max: 3600000 },
  maxRetry: { min: 0, max: 10 },
};

let hostApp: { getPath: (n: "userData") => string } | null = null;

/** 由 poll 域在 setup 里注入（与 video 域的 `bindVideoHost` 同一套）。 */
export function bindPollHost(app: { getPath: (n: "userData") => string }): void {
  hostApp = app;
}

function userDataDir(): string {
  return hostApp?.getPath?.("userData") ?? process.cwd();
}

function configPath(): string {
  return path.join(userDataDir(), "poll-settings.json");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 任意输入 → 合法配置。
 * ⛔ **超时必须 ≥ 间隔 ×2**：否则第一轮还没发出去就被判超时（面板显示「超时」而其实一次都没查）
 *    —— 两个数字各自合法、放一起不成立，这是"自洽地错"的典型。
 */
export function normalizePollConfig(patch: Partial<PollConfig> | null, base: PollConfig = POLL_DEFAULTS): PollConfig {
  const src = patch && typeof patch === "object" ? patch : {};
  const intervalMs = clampInt(src.intervalMs ?? base.intervalMs, POLL_LIMITS.intervalMs.min, POLL_LIMITS.intervalMs.max, POLL_DEFAULTS.intervalMs);
  const timeoutMs = clampInt(src.timeoutMs ?? base.timeoutMs, POLL_LIMITS.timeoutMs.min, POLL_LIMITS.timeoutMs.max, POLL_DEFAULTS.timeoutMs);
  const maxRetry = clampInt(src.maxRetry ?? base.maxRetry, POLL_LIMITS.maxRetry.min, POLL_LIMITS.maxRetry.max, POLL_DEFAULTS.maxRetry);
  return { intervalMs, timeoutMs: Math.max(timeoutMs, intervalMs * 2), maxRetry };
}

/** 第 N 次连续失败后该等多久（指数退避 + 封顶）。 */
export function backoffMs(intervalMs: number, failures: number): number {
  const base = clampInt(intervalMs, POLL_LIMITS.intervalMs.min, POLL_LIMITS.intervalMs.max, POLL_DEFAULTS.intervalMs);
  return Math.min(POLL_LIMITS.intervalMs.max, base * Math.pow(2, Math.max(0, Math.floor(Number(failures) || 0))));
}

export function readPollConfig(): PollConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<PollConfig>;
    return normalizePollConfig(raw, POLL_DEFAULTS);
  } catch {
    return normalizePollConfig(null, POLL_DEFAULTS);
  }
}

export async function writePollConfig(patch: Partial<PollConfig> | null): Promise<PollConfig> {
  const next = normalizePollConfig(patch, readPollConfig());
  await fsp.mkdir(path.dirname(configPath()), { recursive: true });
  await fsp.writeFile(configPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/** 被用户中止的任务 id（wait 循环每轮开头查一次）。 */
const aborted = new Set<string>();

export function requestPollAbort(taskId: string): void {
  const id = String(taskId ?? "").trim();
  if (id) aborted.add(id);
}

export function isPollAborted(taskId: string): boolean {
  return aborted.has(String(taskId ?? "").trim());
}

/** 任务收尾后清掉（⛔ 不清会让同 id 的下一次等待一起被误中止）。 */
export function clearPollAbort(taskId: string): void {
  aborted.delete(String(taskId ?? "").trim());
}
