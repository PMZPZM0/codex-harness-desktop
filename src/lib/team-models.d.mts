/** `team-models.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */

export type TeamMemberKind = "human" | "bot";

export interface TeamMemberLite {
  id: string;
  kind: TeamMemberKind;
  name: string;
  managerId: string;
  canDelegate: string[];
  addedBy: string;
  muted: boolean;
}

export interface TeamGuard {
  scope: "project" | "dept" | "all";
  allowExternal: boolean;
  respondToEveryone: boolean;
}

export interface TeamGroupLite {
  id: string;
  name: string;
  leadId: string;
  members: TeamMemberLite[];
  guard: TeamGuard;
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
  seq: number;
}

export const GROUP_MAX_PARTNERS: number;
export const DEFAULT_GROUP_GUARD: Readonly<TeamGuard>;

export function normalizeMember(entry: unknown): TeamMemberLite | null;
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

export function displayNameOf(group: TeamGroupLite, id: string): string;
export function projectGroupMessages(sources: GroupSource[] | null | undefined): GroupMessageProjected[];
export function groupIssues(group: unknown): string[];
