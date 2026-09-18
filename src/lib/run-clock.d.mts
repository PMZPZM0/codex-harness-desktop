/** 运行计时的起点记忆（见 run-clock.mjs） */

export const RUN_CLOCK_MAX_ENTRIES: number;

export interface RunClock {
  /** 该回合已运行的秒数（负数/时钟回拨夹到 0）。 */
  elapsedSeconds(turnId: unknown, now?: number): number;
  /** 该回合的起点毫秒时间戳；第一次问即为 now，之后幂等返回同一个值。 */
  startOf(turnId: unknown, now?: number): number;
  /** 回合结束后清理该回合的起点。 */
  forget(turnId: unknown): boolean;
  /** 该回合是否已有起点。 */
  has(turnId: unknown): boolean;
  readonly size: number;
  clear(): void;
}

export function createRunClock(options?: { maxEntries?: number }): RunClock;
