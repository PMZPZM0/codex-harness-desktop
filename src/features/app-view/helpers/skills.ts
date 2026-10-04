/**
 * app-view/helpers/skills（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：技能 / 专家目录的文案与匹配（技能名规范化、中文备注、技能列表重拉节流）
 * 符号（6）：normSkillName / shortSkillName / skillZhNote / matchSkillCatalog / categoryLabel / shouldRefreshSkillList
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 * ⛔ 10-04 用户拍板「调度开关要真正生效到工具」：原本这里的 `subAgentTools()`（把子智能体注册成
 *    dynamicTool `subagent_invoke`）**已整体删除**。理由：那条通道与「调度」开关完全脱钩
 *    （只要存在已启用子智能体就永远在），且与 MCP 的 `agent_invoke` 形成**两套调度工具**
 *    ⇒ 模型只会用名字最直白的那个（子智能体），专家 / 专家团永远被绕过。
 *    现在三类统一走 `agent_invoke`（kind=expert|team|member|subagent），闸在执行端
 *    （electron/dispatch.ts 的 dispatchKindAllowed）。
 */
import { CJK_TEXT_RE, EXPERT_CATEGORY_LABELS, SKILL_ZH_NOTES } from "../constants";



export /** 技能名规范化：剥掉插件限定前缀并转小写。引擎对插件技能返回 `ponytail:ponytail-audit`，
 *  本地目录技能是 `ponytail-audit`——不归一化同一个技能会显示成两条。 */
function normSkillName(raw: string): string {
  const name = String(raw ?? "").toLowerCase().trim();
  const index = name.lastIndexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

export /** 技能短名：去掉 `插件:` 前缀，保留原始大小写，用于界面展示。 */
function shortSkillName(raw: string): string {
  const name = String(raw ?? "");
  const index = name.lastIndexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

export /** 技能的中文注释：高优先级中文注释表 → 安装时存下的市场中文简介 → 技能自带描述（中英文都可）→ 技能类别 → 通用兜底。
 *  使命是「每个技能都有一句看得懂的说明」—— 市场技能装到本地后 frontmatter 描述多为英文，
 *  靠安装时写入来源清单的 descriptionZh 兜住「后续新装的技能」。
 *  ⛔ 09-30 用户拿「已安装技能」四个字当反面教材：宁可显示英文原文，也不显示一句没有信息的空话
 *     —— description 非空时不再要求必须含中文（09-25 的「英文不铺给用户」口径由此放宽）。 */
function skillZhNote(entry: { name: string; description?: string; descriptionZh?: string; category?: string }): string {
  const key = normSkillName(entry.name);
  const note = SKILL_ZH_NOTES[key];
  if (note) return note;
  const marketZh = String(entry.descriptionZh ?? "").replace(/\s+/g, " ").trim();
  if (marketZh && CJK_TEXT_RE.test(marketZh)) return marketZh.length > 72 ? `${marketZh.slice(0, 72)}…` : marketZh;
  const description = String(entry.description ?? "").replace(/^\s*>\s*/, "").replace(/\s+/g, " ").trim();
  if (description && description.toLowerCase() !== "local imported skill") return description.length > 72 ? `${description.slice(0, 72)}…` : description;
  const byCategory: Record<string, string> = {
    "ai-agent": "AI 智能体技能",
    "数据可视化": "数据可视化技能",
    "数据处理": "数据处理与清洗技能",
    "开发工具": "开发工具技能",
    "效率工具": "效率提升技能",
  };
  if (entry.category && byCategory[entry.category]) return byCategory[entry.category];
  return "已安装技能";
}

export /** 按查询词匹配技能（前缀命中优先，最多 limit 条）：输入框「#」面板与发送拦截共用，
 *  保证「面板里看到的」与「回车/点发送时选中的」是同一套结果。 */
function matchSkillCatalog<T extends { name: string; description: string; note: string }>(catalog: T[], query: string, limit = 12): T[] {
  const q = (query ?? "").toLowerCase();
  return catalog
    .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.note.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

export function categoryLabel(id: string) { return EXPERT_CATEGORY_LABELS[id] ?? (id || "未分类"); }

/** # 面板技能清单的重拉节流（09-30「列表不实时」）：30 秒内只放行一次，放行即记时间戳。
 *  ⛔ 放本模块而不是 part 文件：【93】按 parts 的顶层声明清单比对 Bag 成员，
 *     纯局部节流变量放 part 会报「推断有、Bag 没有」（实测踩到）。 */
let lastSkillListRefreshAt = 0;
export function shouldRefreshSkillList(): boolean {
  if (Date.now() - lastSkillListRefreshAt < 30_000) return false;
  lastSkillListRefreshAt = Date.now();
  return true;
}
