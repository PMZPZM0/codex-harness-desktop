/** 团队模式 · 调度会话运行时桥（见 team-runtime.mjs） */

export function markDelegateThread(threadId: string, groupId?: string): void;
export function unmarkDelegateThread(threadId: string): void;
export function isDelegateThread(threadId: string): boolean;
export function delegateThreadIds(groupId?: string): string[];
export function delegateRunningCount(): number;
/** 注册 `bag.cancelRateLimitRetry`，返回反注册函数（可直接作为 useEffect 的 cleanup）。 */
export function registerRateLimitCancel(fn: ((threadId: string, silent?: boolean) => void) | null): () => void;
/** 取消登记中的调度会话重试链，返回实际取消的条数。 */
export function cancelDelegateRetries(groupId?: string): number;
export function subscribeTeamRuntime(fn: () => void): () => void;
export function teamRuntimeSnapshot(): number;
