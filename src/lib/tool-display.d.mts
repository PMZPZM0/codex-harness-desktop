/** tool-display.mjs 的类型声明（TS7016：.mjs 需配 .d.mts） */

/** 技能特征表：{ skill: 技能名, label: 中文名, re: 特征正则 } */
export const SKILL_MATCHERS: Array<{ skill: string; label: string; re: RegExp }>;

/** 「怎么用的」：从工具入参挑最能说明这次在干什么的那个值（认不出返回空串） */
export function argSummary(args: unknown, max?: number): string;

/** 注册本地技能清单（`skills:local-list` 的结果）：把目录名翻成人话；可重复调用 */
export function registerKnownSkills(
  list: Array<{ name?: string; folder?: string; descriptionZh?: string; description?: string }>
): number;

/** 已登记的技能条目数（探针/守卫用） */
export function knownSkillCount(): number;

/** 这条调用属于哪个技能（工具特征 / 技能目录路径）；认不出返回 null */
export function skillOfItem(item: { type?: string; server?: string; tool?: string; command?: string }): { skill: string; label: string } | null;

/** 技能卡的目标显示规则（技能目录内/半截路径 ⇒ 丢弃，长路径只留文件名） */
export function skillTargetLabel(target: string): string;

/** 这条调用来自哪个插件（插件缓存/市场目录路径）；认不出返回 null */
export function pluginOfItem(item: { type?: string; server?: string; tool?: string; command?: string }): { plugin: string } | null;
