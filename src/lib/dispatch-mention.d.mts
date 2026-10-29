/** dispatch-mention.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type MentionKind = "expert" | "subagent" | "team" | "cli";

export type MentionTarget = {
  kind: MentionKind | "member" | string;
  key: string;
  name: string;
  profession?: string;
  description?: string;
};

export const MENTION_GROUPS: Array<{ kind: MentionKind; label: string; hint: string }>;
/** kind → 显示标签（芯片 / 候选行共用；⛔ 别在 JSX 里再写一遍三元） */
export const MENTION_KIND_LABEL: Record<string, string>;
export function mentionKindLabel(kind: unknown): string;
export const MENTION_PER_GROUP: number;
export const MENTION_MAX: number;

/** query 归一化（小写 + 折叠空白） */
export function normalizeMentionQuery(raw: unknown): string;

/** 单条候选相关度：0 相等 / 1 前缀 / 2 包含 / -1 不匹配 */
export function rankMentionTarget(target: MentionTarget | null | undefined, query: unknown): number;

/** 按类型分组筛选（组内按相关度，同分保持目录顺序） */
export function filterMentionTargets(
  targets: MentionTarget[] | null | undefined,
  query: unknown,
): { groups: Array<{ kind: MentionKind; label: string; hint: string; items: MentionTarget[] }>; total: number; overflow: number };

/** 面板 ↑↓/Enter 的线性顺序 */
export function flatMentionTargets(groups: unknown, limit?: number): MentionTarget[];

/** 去重键（key 优先） */
export function mentionKeyOf(target: MentionTarget | null | undefined): string;

/** 追加一个点名对象（去重 + 上限） */
export function addMention(list: MentionTarget[] | null | undefined, target: MentionTarget | null | undefined): MentionTarget[];

/** 发送时注入正文的「本轮点名对象」指令块（空数组 → 空串） */
export function mentionBlockOf(mentions: MentionTarget[] | null | undefined): string;
