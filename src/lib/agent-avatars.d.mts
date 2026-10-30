/** agent-avatars.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type AgentAvatarKind = "expert" | "team" | "subagent";

export const AGENT_AVATAR_KINDS: AgentAvatarKind[];
export const AGENT_AVATAR_COLS: number;
export const AGENT_AVATAR_CELLS: number;

/** 稳定散列（FNV-1a）：同 seed + salt 恒定。 */
export function agentAvatarHash(seed: string, salt?: string): number;

/** 选图集与格子：file = public/avatars 下的文件名；x/y = background-position 百分比（0/50/100）。 */
export function pickAgentAvatar(kind: AgentAvatarKind, seed: string): { file: string; cell: number; x: number; y: number };
