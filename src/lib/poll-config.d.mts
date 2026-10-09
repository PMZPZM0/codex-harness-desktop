/**
 * `src/lib/poll-config.mjs` 的类型面（供 TS 侧 import 时拿到签名；实现仍在 .mjs）。
 *
 * ⛔ 为什么这份纯函数放在 `src/lib/` 而不是域目录：主进程（`electron/features/poll-ipc.ts`
 *    与 `dispatch-rpc.ts`）也要用它，而打包清单只收 `src/lib/*.mjs`（见 package.json 的
 *    build.files）—— 放别处会在**安装版**上 `require` 不到 ⇒ 运行时崩（记忆里的 tsc 盲区）。
 */

export type PollStatus = "polling" | "success" | "failed" | "timeout" | "aborted";

export interface PollConfig {
  /** 两次查询之间的等待（毫秒） */
  intervalMs: number;
  /** 从开始到判定超时的总时长（毫秒） */
  timeoutMs: number;
  /** 连续失败多少次后才判失败（中间按指数退避自动重试） */
  maxRetry: number;
}

export declare const POLL_STATUSES: PollStatus[];
export declare const POLL_DEFAULTS: PollConfig;
export declare const POLL_LIMITS: {
  intervalMs: { min: number; max: number };
  timeoutMs: { min: number; max: number };
  maxRetry: { min: number; max: number };
};

export declare function normalizePollConfig(patch?: Partial<PollConfig> | null, base?: PollConfig): PollConfig;
export declare function backoffMs(intervalMs: number, failures: number): number;
export declare function pollStatusLabel(status: string | undefined): string;
export declare function pollStatusTone(status: string | undefined): "running" | "ok" | "err" | "warn" | "mute";
export declare function formatPollDuration(ms: number): string;
export declare function formatPollInterval(ms: number): string;
export declare function formatPollClock(at: number): string;
export declare function measuredIntervalMs(rounds: Array<{ at?: number }> | null): number | null;
export declare function pollMetricText(task: { status?: string; rounds?: unknown[]; intervalMs?: number; managed?: boolean; startedAt?: number; endedAt?: number } | null | undefined, nowMs?: number): string;
export declare function roundSummaryText(round: { ok?: boolean; summary?: string; progress?: string; error?: string } | null | undefined): string;
