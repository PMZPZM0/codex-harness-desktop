export declare function resolveSelectedGroup(
  groups: Array<{ id: string; bossThreadId?: string }>,
  explicitId: string | undefined,
  threadId: string,
  options?: { fallbackToFirst?: boolean },
): string;
