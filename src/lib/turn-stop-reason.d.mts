/** src/lib/turn-stop-reason.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016）。 */

export type TurnStopReason = {
  /** 归一化分类：completed / interrupted / failed / running / 具体 codexErrorInfo（如 contextWindowExceeded）/ unknown */
  kind: string;
  /** 能直接显示的中文短标签；running 与 completed 时为空串（由调用方决定文案） */
  label: string;
  /** 完整原因（分类提示 + 引擎 message + additionalDetails） */
  detail: string;
  /** 引擎给出的「继续指令」（misalignment.steer.message），没有就是空串 */
  continueText: string;
};

export function describeTurnStop(turn: {
  status?: string | null;
  error?: { message?: string; additionalDetails?: string | null; codexErrorInfo?: unknown; misalignment?: { steer?: { message?: string } | null } | null } | null;
} | null | undefined): TurnStopReason;

export function turnHeadline(
  turn: Parameters<typeof describeTurnStop>[0],
  durationLabel: string | null,
): string;
