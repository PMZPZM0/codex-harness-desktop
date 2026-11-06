/** `team-models.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */
import type { MenuItem, MenuPlacement } from "./team-menu.mjs";
import type { GroupSchedule } from "./team-schedule.mjs";

export type TeamMemberKind = "human" | "bot";

export interface TeamMemberLite {
  id: string;
  kind: TeamMemberKind;
  name: string;
  managerId: string;
  canDelegate: string[];
  addedBy: string;
  muted: boolean;
  /** P0b：伙伴绑定的真实调度目标（`agents:catalog` 的 kind / key）；未绑定为空串 */
  targetKind: string;
  targetKey: string;
  /** 角色/岗位（专家团成员的 profession）；空串 = 没配，⛔ 不编 */
  targetProfession: string;
}

/** 一条群消息日志（P0b）：真身 = threadId（伙伴子会话）或 `group:<群id>`（人自己说的）。 */
export interface GroupLogMessage {
  id: string;
  threadId: string;
  authorId: string;
  authorKind: TeamMemberKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  /** @ 了谁（成员 id 数组） */
  mentions: string[];
}

export interface TeamGuard {
  scope: "project" | "dept" | "all";
  allowExternal: boolean;
  respondToEveryone: boolean;
}

/** 群参考文件（只存路径 + 说明，⛔ 不搬文件） */
export interface GroupFileLite {
  path: string;
  name: string;
  note: string;
  addedBy: string;
  at: number;
}

/** 群记忆条目（豆包 `type` + `origin` 的同构） */
export type MemoryNoteType = "fact" | "constraint" | "runbook";

export interface MemoryNoteLite {
  id: string;
  text: string;
  type: MemoryNoteType;
  origin: { groupId: string; actorId: string; threadId: string };
  at: number;
}

export interface TeamGroupLite {
  id: string;
  name: string;
  leadId: string;
  members: TeamMemberLite[];
  guard: TeamGuard;
  /** 群简介（注入每次派活），上限 MAX_GROUP_MEMORY_CHARS */
  memory: string;
  /** 项目地址（群的工作目录）：派活时作为子会话 cwd；空串 = 跟随应用默认 */
  workspace: string;
  /** 群记忆条目：带类型 + 来源的结论 */
  memoryNotes: MemoryNoteLite[];
  files: GroupFileLite[];
  /** 快捷指令菜单（飞书 ChatBotMenu 的本地等价物） */
  menu: MenuItem[];
  /** 菜单形态（飞书 INPUT_FIRST / FLOAT） */
  menuPlacement: MenuPlacement;
  /** 群定时任务（豆包 §③ 自动化定时） */
  schedules: GroupSchedule[];
}

export interface GroupSourceMessage {
  itemId: string;
  authorId?: string;
  authorKind?: TeamMemberKind;
  at?: number;
  kind?: "text" | "card";
  text?: string;
  card?: unknown;
}

export interface GroupSource {
  threadId: string;
  messages?: GroupSourceMessage[];
}

export interface GroupMessageProjected {
  key: string;
  threadId: string;
  itemId: string;
  authorId: string;
  authorKind: TeamMemberKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  mentions: string[];
  seq: number;
}

export const GROUP_MAX_PARTNERS: number;
export const MAX_MEMORY_NOTES: number;
export const MAX_MEMORY_NOTE_CHARS: number;
export const MEMORY_TYPES: readonly MemoryNoteType[];
export const MEMORY_TYPE_LABELS: Readonly<Record<string, string>>;
export const MAX_GROUP_MESSAGES: number;
export const MAX_GROUP_MEMORY_CHARS: number;
export const MAX_GROUP_FILES: number;
export const DEFAULT_GROUP_GUARD: Readonly<TeamGuard>;

export function normalizeMember(entry: unknown): TeamMemberLite | null;
export function normalizeGroupFile(entry: unknown): GroupFileLite | null;
export function normalizeMemoryNote(entry: unknown): MemoryNoteLite | null;
export function addMemoryNote(
  group: TeamGroupLite,
  note: unknown,
): { ok: boolean; reason?: string; group: TeamGroupLite; dropped?: string[] };
export function removeMemoryNote(
  group: TeamGroupLite,
  noteId: string,
): { ok: boolean; group: TeamGroupLite; changed?: boolean };
export function groupContextBlock(group: TeamGroupLite | unknown, options?: { forMemberId?: string }): string;
export function setManager(
  group: TeamGroupLite,
  memberId: string,
  managerId?: string,
): { ok: boolean; reason?: string; group: TeamGroupLite; changed?: boolean };
export function createGroup(input: unknown): TeamGroupLite;
export function memberIdsOf(group: TeamGroupLite | null | undefined): string[];
export function partnersOf(group: TeamGroupLite | null | undefined): TeamMemberLite[];

export function addPartner(
  group: TeamGroupLite,
  partner: unknown,
  addedBy?: string,
): { ok: boolean; reason?: string; limit?: number; group: TeamGroupLite; changed?: boolean };

export function removePartner(
  group: TeamGroupLite,
  partnerId: string,
  byId?: string,
): { ok: boolean; reason?: string; group: TeamGroupLite; changed?: boolean };

export function setPartnerMuted(group: TeamGroupLite, partnerId: string, muted: boolean): TeamGroupLite;
export function canDelegate(fromId: string, toId: string, group: TeamGroupLite): boolean;

export function guardAllows(
  group: TeamGroupLite,
  facts?: { isExternal?: boolean; mentionsEveryone?: boolean; targetKind?: string },
): { ok: boolean; reason?: string };

export interface MentionedMember {
  id: string;
  name: string;
  kind: TeamMemberKind;
}

/** 从一段回复里解析 @（伙伴互相 @ 的入口）：只认群里真实存在的成员 */
export function parseMentions(
  text: string,
  group: TeamGroupLite | unknown,
  options?: { excludeId?: string },
): MentionedMember[];

/** 斜杠命令解析（目前只有 /stop；⛔ 非开头不算命令） */
export function parseCommand(text: string): { name: string; rest: string } | null;

/** 同一作者短间隔连续消息合并（仅渲染分组；`continued` 里仍是独立消息） */
export function mergeConsecutive<T extends { authorId: string; kind: string; at: number }>(
  rows: T[] | null | undefined,
  gapMs?: number,
): Array<T & { lastAt: number; continued: T[] }>;

export function displayNameOf(group: TeamGroupLite, id: string): string;
export function projectGroupMessages(sources: GroupSource[] | null | undefined): GroupMessageProjected[];
export function groupIssues(group: unknown): string[];
export function createBlockers(group: unknown): string[];

export function groupThreadId(groupId: string): string;
export function normalizeGroupMessage(entry: unknown): GroupLogMessage | null;
export function appendGroupMessage(list: unknown, entry: unknown, max?: number): GroupLogMessage[];
export function projectGroupLog(messages: unknown): GroupMessageProjected[];
export function addModeStateOf(partners: unknown, mode: string): { blocked: boolean; reason: string };
export function resolveManagerId(group: unknown, memberId: string): string;
export function parseAgentMentions(
  text: unknown,
  group: unknown,
  options?: { excludeId?: string; max?: number; alreadyRan?: string[] },
): { memberId: string; name: string; ask: string }[];
