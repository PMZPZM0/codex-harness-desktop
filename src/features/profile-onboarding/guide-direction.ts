const directions = {
  devtools: { categories: ["engineering", "02-engineering"], role: /工程|开发|测试|运维|自动化|架构|debug|engineer|developer/i },
  "media-desk": { categories: ["06-contentcreative", "05-marketinggrowth"], role: /文案|编辑|编剧|视频|剪辑|运营|营销|内容|写作|editor/i },
  "component-library": { categories: ["design", "01-productdesign"], role: /设计|视觉|交互|前端|原型|designer|front[ -]?end/i },
  artifacts: { categories: ["office"], role: /交付|文档|资料|归档|项目管理|项目经理|质量|验收|delivery/i },
};
export type GuideDirection = keyof typeof directions;

/** 按团队正式分类和成员自身职业筛选；未选择方向时保留全部已启用专家。 */
export function matchesGuideDirection(direction: GuideDirection | null, category: string, profession: { zh: string; en: string }) {
  if (!direction) return true;
  const rule = directions[direction];
  return rule.categories.includes(category.trim().toLowerCase()) || rule.role.test(`${profession.zh} ${profession.en}`);
}

const key = 'profile-guide:last-start:v1';
/** 仅记住显式保存的页面和专家标识，不把一次性的启动偏好注入对话。 */
export function rememberGuideChoice(direction: GuideDirection | null, expert: { team: {teamId: string}; member: {id: string} } | null) {
  try { localStorage.setItem(key, JSON.stringify({ direction, teamId: expert?.team.teamId, memberId: expert?.member.id })); } catch { /* 禁用缓存时仍可正常保存档案 */ }
}
/** 重开时校验旧缓存；专家对象必须由调用者按标识从最新档案解析。 */
export function readGuideChoice(): { direction: GuideDirection | null; teamId?: string; memberId?: string } {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    return { direction: data && Object.hasOwn(directions, data.direction) ? data.direction : null, teamId: typeof data?.teamId === 'string' ? data.teamId : undefined, memberId: typeof data?.memberId === 'string' ? data.memberId : undefined };
  } catch { return { direction: null }; }
}
