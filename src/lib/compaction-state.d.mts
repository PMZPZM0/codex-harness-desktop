/** 上下文压缩四态模型（唯一判定口径：引擎 item × compactToast）。 */
export const COMPACTION_STATE: { idle: string; compacting: string; done: string; failed: string };
export function compactionStateLabel(state: string): string;
export function compactionStateOf(
  turns: Array<{ id?: unknown; items?: unknown[] }> | null | undefined,
  toastState?: string | null,
): { state: string; turnId: string; item: any };
export function reportCompactionState(key: string, derived: { state: string; turnId: string }): void;
