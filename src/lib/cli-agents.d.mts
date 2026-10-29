/** cli-agents.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type CliCategory = { key: string; label: string; hint: string };

export function matchCliAgent(item: { name?: string; bin?: string; description?: string; promptHint?: string } | null | undefined, query: unknown, categoryLabel?: string): boolean;

export function groupCliAgents(
  items: CliAgentEntry[] | null | undefined,
  categories: CliCategory[] | null | undefined,
  query: unknown,
): Array<{ key: string; label: string; hint: string; items: CliAgentEntry[]; total: number }>;

export function countCliAgents(
  items: CliAgentEntry[] | null | undefined,
  categories: CliCategory[] | null | undefined,
  query: unknown,
): { total: number; byCategory: Record<string, number> };

export function detectLabel(status: { state: "idle" | "busy" | "ok" | "miss"; version?: string } | null | undefined): string;
