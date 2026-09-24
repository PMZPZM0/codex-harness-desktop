/** expertRoleLabel（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function expertRoleLabel(member: ExpertTeamMember, isLead = false) {
  return member.profession.zh?.trim() || (isLead ? "主理人" : "团队成员");
}
