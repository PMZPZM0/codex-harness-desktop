/** src/features/session-alias/alias-store.mjs 的类型声明（.mjs 无声明 tsc 会报 TS7016）。 */

export type AliasRecord = { alias?: string; supervisorThreadId?: string; userEdited?: boolean; meaning?: string; updatedAt?: number };
export type AliasState = { aliases: Record<string, AliasRecord> };

export function setAliasSnapshot(next: Record<string, AliasRecord> | null | undefined): void;
export function getAliasState(): AliasState;
export function subscribeAliases(fn: () => void): () => void;
export function aliasLabelOf(state: AliasState | null | undefined, threadId: string): string;
export function supervisorLabelOfAliases(state: AliasState | null | undefined, threadId: string): string;
export function usedAliasesOf(state: AliasState | null | undefined): string[];
