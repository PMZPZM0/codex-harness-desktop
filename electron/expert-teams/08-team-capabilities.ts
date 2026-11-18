/**
 * 专家团/专家的**能力声明**（11-18 用户令：「专家肯定要上来技能齐全，专业工具齐全」
 * 「所有专家，都要配套技能」）。
 *
 * 落点与口径：
 *  · 用户档案（expert-teams.json）里可以有 `tools` / `skills`（用户自己改的优先）；
 *  · **没写时**由本表按「主理人名」补齐 —— 只补内存，不改用户文件（⛔ 不静默写盘）；
 *  · 工具 id = `electron/update-registry.ts` 的组件 id；
 *  · 技能名 = **本机技能目录里真实存在的名字**（`listLocalSkills` 可枚举，实测 40 个）。
 *
 * ⛔⛔ 11-18 两次踩坑，写在这里防复发：
 *  ① 曾按「应该有的技能」填名字（lark-im / frontend-ui-design / code-review-graph …），
 *     实测 13 个里 12 个本机根本不存在 ⇒ 专家卡长期显示「缺 12 个技能 / 去技能市场」，
 *     而市场里也未必有同名技能 —— **不许用不存在的名字撑门面**。
 *  ② 专家应「自带」技能，不是让用户去市场碰运气 ⇒ 每位专家**至少**配一个真实存在的技能，
 *     由守卫【专家技能】钉住（新增专家不带技能直接红）。
 */
export type TeamCapability = { tools: string[]; skills: string[] };

/** 按主理人名索引：改名不影响 teamId，也不影响这份表。 */
export const TEAM_CAPABILITIES: Record<string, TeamCapability> = {
  /* ── A 开发与环境 ───────────────────────────────────────────── */
  承枢: {
    tools: ["engine", "bundled-tool", "ponytail"],
    skills: ["dev-expert", "self-review", "handoff", "skill-authoring"],
  },
  筑基: {
    tools: ["engine", "bundled-tool"],
    skills: ["harness-api", "self-tools", "self-review"],
  },
  /* ── B 自动化与设备 ─────────────────────────────────────────── */
  掌控: {
    tools: ["computer-use", "nuphus", "phone-harness"],
    skills: ["desktop-automation", "browser-skill", "ego-browser", "rpa-recipes"],
  },
  /* ── C 办公与文档 ───────────────────────────────────────────── */
  通译: {
    tools: ["markitdown", "filee", "kb-embedding"],
    skills: ["document-convert", "knowledge-backend", "memory-classify"],
  },
  /* ── D 创作与自媒体 ─────────────────────────────────────────── */
  文枢: {
    tools: ["markitdown", "bundled-tool"],
    skills: ["libai-skill", "humanizer", "no-ai-slop"],
  },
  剪承: {
    tools: ["bundled-tool", "image-lab"],
    skills: ["video-generation", "openfilm-video-editing", "whitebox-video"],
  },
  知微: {
    tools: [],
    skills: ["essence-first", "grill-me"],
  },
  拔节: {
    tools: [],
    skills: ["challenge-requirements", "essence-first"],
  },
  观澜: {
    tools: ["kb-embedding", "markitdown"],
    skills: ["visualization-guide", "knowledge-backend"],
  },
  执舵: {
    tools: [],
    skills: ["essence-first", "challenge-requirements", "grill-me"],
  },
  /* ── E 前端与设计 ───────────────────────────────────────────── */
  执矩: {
    tools: ["image-lab"],
    skills: ["frontend-design", "design-md-library", "challenge-requirements"],
  },
  造物: {
    tools: ["image-lab", "bundled-tool"],
    skills: ["frontend-design", "design-md-library", "image-generation", "photocraft"],
  },
  画意: {
    tools: ["image-lab"],
    skills: ["image-generation", "photocraft"],
  },
  呈象: {
    tools: ["markitdown"],
    skills: ["visualization-guide", "frontend-design"],
  },
  鲁班: {
    tools: [],
    skills: ["3d-modeling"],
  },
  /* ── F 逆向与质量 ───────────────────────────────────────────── */
  洞见: {
    tools: ["rea"],
    skills: ["self-tools", "harness-api"],
  },
  洞明: {
    tools: ["engine"],
    skills: ["self-review", "dev-expert", "grill-me"],
  },
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
