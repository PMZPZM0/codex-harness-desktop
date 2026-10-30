/** dispatch-mention.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

export type MentionKind = "expert" | "subagent" | "team" | "cli";

export type MentionTarget = {
  kind: MentionKind | "member" | string;
  key: string;
  name: string;
  profession?: string;
  description?: string;
  /** 本会话未开通这一类调度 ⇒ true（面板置灰、不可选中；⛔ 仍要显示，不是隐藏） */
  disabled?: boolean;
  /** 置灰原因：`kind-off` = 本会话没开这一类；`cli-missing` = CLI 没装（去开发工具一键安装） */
  disabledReason?: "kind-off" | "cli-missing";
  /** CLI 智能体：本机是否已安装（主进程检测；false ⇒ 置灰不可选） */
  installed?: boolean;
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

/** 按类型分组筛选（组内按相关度，同分保持目录顺序）。
 *  给了 `allow` 时：未开通的类别**照样列出**，但每行带 `disabled: true`，组上带 `off: true`。 */
export function filterMentionTargets(
  targets: MentionTarget[] | null | undefined,
  query: unknown,
  allow?: { team?: boolean } | null,
): {
  groups: Array<{ kind: MentionKind; label: string; hint: string; items: MentionTarget[]; off: boolean }>;
  total: number;
  overflow: number;
};

/** 面板 ↑↓/Enter 的线性顺序（⛔ 自动跳过 `disabled` 行） */
export function flatMentionTargets(groups: unknown, limit?: number): MentionTarget[];

/** 去重键（key 优先） */
export function mentionKeyOf(target: MentionTarget | null | undefined): string;

/** 追加一个点名对象（去重 + 上限） */
export function addMention(list: MentionTarget[] | null | undefined, target: MentionTarget | null | undefined): MentionTarget[];

/** 发送时注入正文的「本轮点名对象」指令块（空数组 → 空串） */
export function mentionBlockOf(mentions: MentionTarget[] | null | undefined): string;

/** 这一类在本会话能不能派（专家/子智能体/CLI 恒可用，专家团跟随开关；与主进程 dispatchAllowOf 同口径）。 */
export function mentionKindAllowed(allow: { team?: boolean } | null | undefined, kind: string): boolean;
/** 第一条**可选**候选（置灰行不参与），Enter 采纳用。 */
export function firstMentionTarget(
  targets: any[],
  query: string,
  allow?: { team?: boolean } | null,
): any | null;

/** Enter 的决策：target=第一条可选候选；disabledOnly=有候选但全被置灰（此时**不许**落到历史消息）。 */
export function mentionEnterPlan(
  targets: any[],
  query: string,
  allow?: { team?: boolean } | null,
): { target: any | null; disabledOnly: boolean };

/** 输入框当前被哪个触发符唤起（`@` 点名 / `*` 历史消息 / 空串 = 都没唤起）。 */
export function contextTriggerOf(value: unknown): { mode: "" | "mention" | "history"; query: string };

/** 置灰行的原因文案（面板 title / 行内小字共用）。 */
export function mentionDisabledText(target: MentionTarget | null | undefined): string;
