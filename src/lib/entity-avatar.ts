// 实体头像配色：把任意名称稳定映射到 6 色调之一（同名的头像永远同色）。
// 插件卡 / 专家团成员 chip 共用；专家团额外提供渐变背景变体。
export type AvatarTone = "blue" | "green" | "amber" | "pink" | "violet" | "cyan";

const TONES: AvatarTone[] = ["blue", "green", "amber", "pink", "violet", "cyan"];

/** 名称 → 稳定色调。用简单字符串哈希（FNV-1a 思路），跨会话跨重启一致。 */
export function avatarToneOf(name: string): AvatarTone {
  const text = String(name ?? "").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TONES[hash % TONES.length];
}

/** 名称 → 渐变背景（用于专家成员头像点亮态/lead 徽标），与 tone 一一对应。 */
export const AVATAR_GRADIENTS: Record<AvatarTone, string> = {
  blue: "linear-gradient(135deg, #2f6bdd, #5b8def)",
  green: "linear-gradient(135deg, #1a7f37, #3fb36b)",
  amber: "linear-gradient(135deg, #d68910, #e5a53c)",
  pink: "linear-gradient(135deg, #d6409f, #e667bd)",
  violet: "linear-gradient(135deg, #7048e8, #9775fa)",
  cyan: "linear-gradient(135deg, #0b7285, #15aabf)",
};

/* —— 团队会话上下文注册表 ——
 * ItemView 在组件树深处（App → TurnView → SegmentList → ItemView），把 expertTeams /
 * thread→team 映射逐层传参会污染 4 层签名。这里用模块级 Map 注册（threadId → 解析函数），
 * App 在 expertTeams 或线程映射变化时重注册，ItemView 直接查表拿成员信息渲染头像。
 * 只用于展示（头像/文案），不承载逻辑状态，注册表过期最多回落到通用扳手图标。 */
export type TeamMemberInfo = { id: string; name: string; label: string; isLead: boolean };

const threadMemberResolver = new Map<string, (memberId: string) => TeamMemberInfo | null>();

export function registerThreadTeam(threadId: string, resolve: (memberId: string) => TeamMemberInfo | null) {
  threadMemberResolver.set(threadId, resolve);
}

export function unregisterThreadTeam(threadId: string) {
  threadMemberResolver.delete(threadId);
}

export function resolveTeamMember(threadId: string, memberId: string): TeamMemberInfo | null {
  try {
    return threadMemberResolver.get(threadId)?.(memberId) ?? null;
  } catch {
    return null;
  }
}
