/** `team-mention.mjs` 的类型声明（与实现一一对应；⛔ 规则只在 .mjs 里，这里只描述形状）。 */

export const MENTION_MAX_QUERY: number;

export interface MentionTrigger {
  /** `@` 的索引 */
  start: number;
  /** 光标位置（已夹到 [0, length]） */
  caret: number;
  /** `@` 与光标之间的查询词（可能是空串） */
  query: string;
}

export function mentionTriggerOf(text: unknown, caret: unknown): MentionTrigger | null;

/** ⛔ 形参写 `T[]` 而不是 `T[] | unknown`：后者会把联合塌成 `unknown`，泛型推不出 T
    ⇒ 调用点拿到的是约束类型 `{name?, role?}`，MentionItem 的字段全部报错（11-07 实测）。
    实现在 .mjs 里仍对非数组宽容（返回空数组），类型层面只描述正常调用。 */
export function matchMentionCandidates<T extends { name?: string; role?: string }>(
  items: T[],
  query: unknown,
  limit?: number,
): T[];

export function applyMention(
  text: unknown,
  trigger: { start?: number; caret?: number } | null | undefined,
  name: unknown,
): { text: string; caret: number };

export interface MentionItem {
  id: string;
  /** 点它要加进「本轮 @」的成员 id（团成员 = 合成 id `team:<teamId>:<memberId>`） */
  selectId: string;
  name: string;
  role: string;
  hint: string;
  avatar: { id: string; kind?: string; name?: string; targetKind?: string; targetKey?: string; avatar?: string };
  muted: boolean;
  unbound: boolean;
}

export interface MentionSection {
  key: "bot" | "team" | "kid";
  title: string;
  items: MentionItem[];
}

export function mentionSectionsOf(group: unknown, catalog: unknown): MentionSection[];

export function flattenMentionSections(sections: unknown): MentionItem[];

/** 正文里的 @ 提及 → 目标 id（按出现顺序、去重；长名优先匹配）。 */
export declare function mentionTargetsInText(
  text: string,
  candidates: Array<{ selectId?: string; name?: string }>,
): string[];
/** 从正文里摘掉完整提及（⛔ 不会劈开更长的名字）。 */
export declare function removeMentionsFromText(text: string, names: string[]): string;
