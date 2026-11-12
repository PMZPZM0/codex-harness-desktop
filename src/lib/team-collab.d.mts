/** 群内协作判据（纯函数，守卫 11f 直接 import 真跑）。 */
export declare const WRAP_SIGNALS: readonly string[];
export declare const CONTINUE_SIGNALS: readonly string[];
export declare const MAX_IDLE_ROUNDS: number;
export declare const OPEN_TASK_STATES: readonly string[];
export declare function openTaskCount(tasks: unknown): number;
export declare const HANDOFF_STATES: { readonly pending: "pending"; readonly done: "done"; readonly failed: "failed"; readonly timeout: "timeout" };
export type Handoff = { id?: string; from?: string; to?: string; at?: number; settledAt?: number; state?: "pending" | "done" | "failed" | "timeout" };
export declare function wrapSignalOf(text: unknown): string;
export declare function continueSignalOf(text: unknown): string;
export declare function progressOf(input?: { createdTasks?: number; writtenFiles?: number; ackedHandoffs?: number }): number;
export declare function pendingOf(handoffs: unknown): Handoff[];
export declare function settleHandoffs(handoffs: unknown, now: unknown, timeoutMs: unknown): Handoff[];
/** 用户这句是「提问 / 要信息」还是「布置任务」（催办门用；信息类提问不该再被催一轮）。 */
export declare function isInfoRequest(text: unknown): boolean;
export declare function classifyTurn(input?: {
  text?: unknown;
  handoffTo?: unknown;
  handoffs?: Handoff[];
  budgetLeft?: number;
  idleRounds?: number;
  /** 群里还没结束的任务数（boss-groups 链路用；工作伙伴群没有任务表，传 0 或不传）。 */
  openTasks?: number;
  progress?: { createdTasks?: number; writtenFiles?: number; ackedHandoffs?: number };
}): { action: "handoff" | "wait" | "continue" | "wrap"; reason: string; overBudget?: boolean };
