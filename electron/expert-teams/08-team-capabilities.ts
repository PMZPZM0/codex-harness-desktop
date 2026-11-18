/**
 * 专家团/专家的**能力声明**（11-18 用户令：「专家肯定要上来技能齐全，专业工具齐全」）。
 *
 * 落点与口径：
 *  · 用户档案（expert-teams.json）里可以有 `tools` / `skills`（用户自己改的优先）；
 *  · **没写时**由本表按「主理人名」补齐 —— 只补内存，不改用户文件（⛔ 不静默写盘）；
 *  · 工具 id = `electron/update-registry.ts` 的组件 id；技能名 = 技能目录里的名字。
 * ⛔ 新增专家时**必须**在这里给一份能力表，否则专家卡会显示「未声明能力」。
 */
export type TeamCapability = { tools: string[]; skills: string[] };

/** 按主理人名索引：改名不影响 teamId，也不影响这份表。 */
export const TEAM_CAPABILITIES: Record<string, TeamCapability> = {
  /* A · 开发与环境（软件交付） */
  承枢: { tools: ["engine", "bundled-tool", "ponytail"], skills: ["code-review-graph", "dongming-code-review", "xaction-code-review"] },
  /* D · 创作与自媒体 */
  文枢: { tools: ["markitdown", "bundled-tool"], skills: ["month-report", "frontend-ui-design"] },
  剪承: { tools: ["bundled-tool", "image-lab"], skills: [] },
  /* E · 前端与设计 */
  执矩: { tools: ["image-lab"], skills: ["frontend-ui-design"] },
  /* 数据 / 增长 / 战略 */
  观澜: { tools: ["kb-embedding", "markitdown"], skills: [] },
  拔节: { tools: [], skills: [] },
  执舵: { tools: [], skills: [] },
  /* 单专家 */
  洞见: { tools: ["rea"], skills: ["reverse-engineer-anything"] },
  画意: { tools: ["image-lab"], skills: ["buddy-image-processing"] },
  呈象: { tools: ["markitdown"], skills: [] },
  知微: { tools: [], skills: [] },
  洞明: { tools: ["engine"], skills: ["code-review-graph", "dongming-code-review"] },
  鲁班: { tools: [], skills: [] },
  /* 11-18 计划新建的四位（先登记能力，建档后即生效） */
  筑基: { tools: ["engine", "bundled-tool"], skills: ["codex-engine-config-probe"] },
  掌控: { tools: ["computer-use", "nuphus", "phone-harness"], skills: ["ego-browser", "computer-use-acceptance"] },
  通译: { tools: ["markitdown", "filee", "kb-embedding"], skills: ["lark-im", "lark-doc", "lark-sheets", "lark-calendar", "lark-task"] },
  造物: { tools: ["image-lab", "bundled-tool"], skills: ["frontend-ui-design", "buddy-image-processing"] },
};

/** 取某团队/专家的能力：档案里写了就用档案，否则按主理人名查表（都没有 = 空）。 */
export function capabilitiesOf(team: { lead?: { name?: string; tools?: string[]; skills?: string[] }; tools?: string[]; skills?: string[] }): TeamCapability {
  const own = { tools: team.tools ?? [], skills: team.skills ?? [] };
  const leadOwn = { tools: team.lead?.tools ?? [], skills: team.lead?.skills ?? [] };
  const fromMap = TEAM_CAPABILITIES[String(team.lead?.name ?? "")] ?? { tools: [], skills: [] };
  return {
    tools: [...new Set([...own.tools, ...leadOwn.tools, ...fromMap.tools])],
    skills: [...new Set([...own.skills, ...leadOwn.skills, ...fromMap.skills])],
  };
}
