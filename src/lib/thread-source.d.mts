export const THREAD_SOURCE_ORDER: string[];
export const THREAD_SOURCE_LABELS: Record<string, string>;
export function classifyThreadSource(input: { delegateKind?: string; teamId?: string; isTeamMember?: boolean }): string;
export function buildDispatchChildren<T extends { id: string }>(
  threads: T[],
  delegateRecords?: Record<string, { kind?: string; originThreadId?: string; name?: string }>,
  options?: { skipIds?: Set<string> }
): { childrenOf: Record<string, { threadId: string; kind: string; name: string }[]>; childIds: Set<string> };
export function groupThreadsBySource<T extends { id: string; updatedAt?: number }>(
  threads: T[],
  ctx?: {
    delegateRecords?: Record<string, { kind?: string }>;
    teamThreadIndex?: Record<string, string>;
    teamMemberThreadIds?: Set<string>;
    pinnedThreadIds?: string[];
  }
): { key: string; label: string; items: T[] }[];
export function resolveGroupCwd<T extends { id: string; cwd?: string }>(
  threads: T[],
  ctx?: {
    delegateRecords?: Record<string, { originThreadId?: string }>;
    teamThreadIndex?: Record<string, string>;
    teamMemberThreadIds?: Set<string>;
  }
): Record<string, string>;
