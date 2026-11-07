/** agent-avatars.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type AgentAvatarKind = "expert" | "team" | "subagent";

export const AGENT_AVATAR_KINDS: AgentAvatarKind[];
export const AGENT_AVATAR_COLS: number;
export const AGENT_AVATAR_CELLS: number;

/** 稳定散列（FNV-1a）：同 seed + salt 恒定。 */
export function agentAvatarHash(seed: string, salt?: string): number;

/** 调度目录的 kind → 头像风格（cli 用机器人；member 用专家）。 */
export function agentAvatarKindOf(kind: unknown): AgentAvatarKind;

/** 选图集与格子：file = public/avatars 下的文件名；x/y = background-position 百分比（0/50/100）。 */
export function pickAgentAvatar(kind: AgentAvatarKind, seed: string): { file: string; cell: number; x: number; y: number };

/** 固定图集 + 格子（头像选择器的固定面孔，不按 seed 散列）。 */
export function agentAvatarFaceAt(kind: AgentAvatarKind, sheetIndex: number, cell: number): { file: string; cell: number; x: number; y: number };
