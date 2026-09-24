/** expertIconOf（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ClipboardList, DraftingCompass, FlaskConical, Code2, Crown, TrendingUp, Microscope, Calculator, Shield, Telescope, Bot } from "lucide-react";

export function expertIconOf(member: ExpertTeamMember) {
  const p = `${member.profession.zh}${member.name}`;
  if (/产品/.test(p)) return ClipboardList;
  if (/架构/.test(p)) return DraftingCompass;
  if (/测试|验收|质量|过关/.test(p)) return FlaskConical;
  if (/开发|豆码/.test(p)) return Code2;
  if (/总监|主理|交付|活林/.test(p)) return Crown;
  if (/资金|流向|行情/.test(p)) return TrendingUp;
  if (/基本面|研究/.test(p)) return Microscope;
  if (/估值|定价/.test(p)) return Calculator;
  if (/风控|安全|审查|审计/.test(p)) return Shield;
  if (/策略|预测|知微|慎思/.test(p)) return Telescope;
  return Bot;
}
