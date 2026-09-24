/**
 * app-view/helpers/skills（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：技能 / 专家目录的文案与匹配（技能名规范化、中文备注、子代理工具）
 * 符号（6）：normSkillName / shortSkillName / skillZhNote / matchSkillCatalog / categoryLabel / subAgentTools
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
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

export /** 技能的中文注释：高优先级中文注释表 → 安装时存下的市场中文简介 → 技能自带的中文描述 → 技能类别 → 通用兜底。
 *  使命是「每个技能都有一句中文说明」——市场技能装到本地后 frontmatter 描述多为英文，
 *  靠安装时写入来源清单的 descriptionZh 兜住「后续新装的技能」。英文描述不会再原样铺给用户。 */
function skillZhNote(entry: { name: string; description?: string; descriptionZh?: string; category?: string }): string {
  const key = normSkillName(entry.name);
  const note = SKILL_ZH_NOTES[key];
  if (note) return note;
  const marketZh = String(entry.descriptionZh ?? "").replace(/\s+/g, " ").trim();
  if (marketZh && CJK_TEXT_RE.test(marketZh)) return marketZh.length > 72 ? `${marketZh.slice(0, 72)}…` : marketZh;
  const description = String(entry.description ?? "").replace(/^\s*>\s*/, "").replace(/\s+/g, " ").trim();
  if (description && CJK_TEXT_RE.test(description)) return description.length > 64 ? `${description.slice(0, 64)}…` : description;
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

export /** 把启用的子智能体登记成 Codex 可直接调用的 dynamicTool。 */
function subAgentTools(agents: SubAgentEntry[]) {
  const enabled = agents.filter((agent) => agent.enabled);
  if (!enabled.length) return [];
  return [{
    type: "function",
    name: "subagent_invoke",
    description: `调用用户配置的子智能体完成一个独立子任务并返回结构化结果。可用子智能体：${enabled.map((agent) => `${agent.name}（${agent.description || "无描述"}）`).join("；")}。子智能体在独立会话中运行，会继承主对话的模型与权限设置。`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "要调用的子智能体名称，必须是上面列出的名称之一", enum: enabled.map((agent) => agent.name) },
        query: { type: "string", description: "交给子智能体的完整任务描述，信息要足够独立执行" },
      },
      required: ["name", "query"],
    },
  }];
}