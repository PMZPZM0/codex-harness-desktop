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

/** 运行中 **且回合内没有任何还在跑的 item**、最后一个有正文的 agentMessage 已不在流式中
 *  = 「正文已完整，等待模型收尾」状态（GPT 系正文后上游迟迟不发结束信号）。
 *  有任何在跑 item（命令/工具/思考）一律 false —— 那种时候状态行另有话说，不能自相矛盾。 */
export function isAwaitingTurnClose(turn: {
  status?: string | null;
  items?: { type?: string; status?: string | null; text?: string }[] | null;
} | null | undefined): boolean;
