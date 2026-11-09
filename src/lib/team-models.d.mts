/** `team-models.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */
import type { MenuItem, MenuPlacement } from "./team-menu.mjs";
import type { GroupSchedule } from "./team-schedule.mjs";
import type { SenderKind } from "./message-origin.mjs";

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
  /** 群内自定义头像（11-07）：空串 = 跟随默认；`preset:<id>` = 内置头像；`data:image/...` = 上传的图 */
  avatar: string;
}

/** 11-08：一回合的 token 用量（引擎 `thread/tokenUsage/updated` 的 last 桶；老日志为空）。 */
export interface GroupMessageUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/** 一条群消息日志（P0b）：真身 = threadId（伙伴子会话）或 `group:<群id>`（人自己说的）。 */
export interface GroupLogMessage {
  id: string;
  threadId: string;
  authorId: string;
  authorKind: TeamMemberKind;
  /** 11-07：真实发送者身份（老日志由 senderKindOf 推导，不落库也有值） */
  senderKind: SenderKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  /** @ 了谁（成员 id 数组） */
  mentions: string[];
  /** 11-08：这一回合的 token 用量（用户消息 / 老日志为空） */
  usage?: GroupMessageUsage | null;
  /** 11-08 流式：所属派活轮次 / 该轮第一条（挂运行过程大折叠）/ 收尾汇总（挂文件卡） */
  runId?: string;
  runFirst?: boolean;
  summary?: boolean;
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
  /** 派生成员（团成员，合成 id）的头像覆盖表 */
  avatars?: Record<string, string>;
  /** 消息排版：split = 伙伴靠左/用户靠右；left = 全部靠左 */
  messageLayout?: "split" | "left";
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
  usage?: GroupMessageUsage | null;
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
  senderKind: SenderKind;
  at: number;
  kind: "text" | "card";
  text: string;
  card: unknown;
  mentions: string[];
  seq: number;
  /** 这一回合的 token 用量（老日志/用户消息为 null） */
  usage?: GroupMessageUsage | null;
  /** 11-08 流式：所属派活轮次 / 该轮第一条（挂运行过程大折叠）/ 收尾汇总（挂文件卡） */
  runId?: string;
  runFirst?: boolean;
  summary?: boolean;
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
/** 协作协议行（lead / member / single 三档口径） */
export function collaborationProtocolLines(role: "lead" | "member" | "single"): string[];

export function withMentionPrefix(text: string, names: readonly string[]): string;

export function groupContextBlock(
  group: TeamGroupLite | unknown,
  options?: { forMemberId?: string; forTeam?: boolean; catalog?: unknown[] },
): string;
/** 群里绑定的专家团展开成可直接派活的团成员虚拟条目（11-07：成员之间要能互相 @）。 */
export function teamKidsOf(group: unknown, catalog: unknown): TeamMemberLite[];
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
/** 改某个成员在**这个群**里的头像（空串 = 恢复默认）；⛔ 不动专家中心 / 用户中心 */
export function setMemberAvatar(group: TeamGroupLite, memberId: string, avatar: string): TeamGroupLite;
export function setMessageLayout(group: TeamGroupLite, layout: string): TeamGroupLite;
export function normalizeMessageLayout(value: unknown): "split" | "left";
/* 11-08：群回复模式（process = 运行中展示过程 / placeholder = 只显示占位） */
export function setReplyMode(group: TeamGroupLite, mode: string): TeamGroupLite;
export function normalizeReplyMode(value: unknown): "process" | "placeholder";
export function setMessageForm(group: TeamGroupLite, form: string): TeamGroupLite;
export function normalizeMessageForm(value: unknown): "chat" | "topic";
export function normalizeMemberAvatar(value: unknown): string;
export const MAX_MEMBER_AVATAR_CHARS: number;
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
  options?: { excludeId?: string; max?: number; alreadyRan?: string[]; catalog?: unknown[] },
): { memberId: string; name: string; ask: string; target?: TeamMemberLite | null }[];

/** 团成员在群里的合成作者 id（`team:<teamId>:<memberId>`；非法入参 ⇒ 空串） */
export function teamAuthorIdOf(teamId: unknown, memberId: unknown): string;

/** 反解合成作者 id；不是这个形状 ⇒ null */
export function teamMemberIdOf(entry: unknown): string;

export function parseTeamAuthorId(id: unknown): { teamId: string; memberId: string } | null;

/** 两段文本是否「几乎同一句」（成员 group_say 与最终回复重复时的宿主兜底判据） */
export function textsAreNearDuplicate(a: unknown, b: unknown): boolean;

/** 伙伴会话在外面显示的身份（名字取群成员当前名，头像取群内自定义 / 覆盖表） */
export interface TalkPartnerIdentity {
  id: string;
  name: string;
  avatar: string;
  kind: TeamMemberKind;
  targetKind: string;
  targetKey: string;
}
export function talkPartnerIdentity(
  row: { memberId?: string; name?: string } | null | undefined,
  group: TeamGroupLite | null | undefined,
): TalkPartnerIdentity;
