export const THREAD_SOURCE_ORDER: string[];
export const THREAD_SOURCE_LABELS: Record<string, string>;
export function classifyThreadSource(input: { delegateKind?: string; teamId?: string; isTeamMember?: boolean }): string;
export function groupThreadsBySource<T extends { id: string; updatedAt?: number }>(
  threads: T[],
  ctx?: {
    delegateRecords?: Record<string, { kind?: string }>;
    teamThreadIndex?: Record<string, string>;
    teamMemberThreadIds?: Set<string>;
    pinnedThreadIds?: string[];
  }
): { key: string; label: string; items: T[] }[];
