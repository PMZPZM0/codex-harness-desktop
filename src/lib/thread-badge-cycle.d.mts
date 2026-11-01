/** src/lib/thread-badge-cycle.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016）。 */

export function cycleThreadBadge(threadId: string, len: number): void;
export function getBadgeCycleState(): { index: Record<string, number> };
export function subscribeBadgeCycle(fn: () => void): () => void;
export function badgeCycleIndexOf(
  badgeState: { index: Record<string, number> } | null | undefined,
  threadId: string,
  len: number,
): number;
