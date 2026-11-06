/** 团队模式 · 调度会话运行时桥（见 team-runtime.mjs） */

/** 登记一次宿主派活（同时登记粘性身份；重复登记不重复通知）。 */
export function markDelegateThread(threadId: string): void;
/** 派活结束：只摘「运行中」，⛔ 粘性身份保留（finished 早于 429 时总闸仍要认得它）。 */
export function unmarkDelegateThread(threadId: string): void;
/** 限流总闸判据：本窗口见过这个 threadId 是调度会话。 */
export function isDelegateThread(threadId: string): boolean;
/** 仍在跑的调度会话 id（群聊停止键的清理范围）。 */
export function delegateThreadIds(): string[];
/** 注册 `bag.cancelRateLimitRetry`，返回反注册函数（可直接作为 useEffect 的 cleanup）。 */
export function registerRateLimitCancel(fn: ((threadId: string, silent?: boolean) => void) | null): () => void;
/** 清理仍在跑的调度会话的重试状态，返回实际调用取消函数的条数（未注册时为 0）。 */
export function cancelDelegateRetries(): number;
export function subscribeTeamRuntime(fn: () => void): () => void;
export function teamRuntimeSnapshot(): number;
