/** 旧会话「补种」的类型声明（实现：prompt-seeds.mjs）。 */

export const BOSS_SEED_VERSION: number;
export const TEAM_SEED_VERSION: number;
export const TEAM_DISPATCH_SUPPLEMENT: string;
export function seededVersion(threadId: string, kind: "boss" | "team"): number;
export function needsSeed(threadId: string, kind: "boss" | "team", version: number): boolean;
export function markSeeded(threadId: string, kind: "boss" | "team", version: number): void;
/** 仅供回归脚本：清掉记账。 */
export function setTeamLeadThreads(ids: Iterable<string> | string[]): void;
export function isTeamLeadThread(threadId: string): boolean;
/** 仅供回归脚本：清掉记账。 */
export function _resetPromptSeeds(): void;
