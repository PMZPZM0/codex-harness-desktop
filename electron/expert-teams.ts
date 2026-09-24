/**
 * expert-teams —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
export type { ExpertTeamMember, ExpertTeamConfig } from "./expert-teams/01-team-types";
export { setExpertTeamsFile, getExpertTeamsFile, readExpertTeams, writeExpertTeams } from "./expert-teams/02-team-file-io";
export { normalizeTeamConfig } from "./expert-teams/03-team-id-normalize";
export { buildChengxiangExpertTeam, buildZhiweiExpertTeam, buildDongmingExpertTeam } from "./expert-teams/04-team-builders";
export { SKILLS_PATH_MARK, skillsPathBlock, readSkillsPath, syncSkillsPath, syncSkillsPathInTeam } from "./expert-teams/05-skills-path";
export { buildTeamSystemPrompt, buildTeamTools, buildTeamPhaseTool } from "./expert-teams/06-team-tools";
export { buildDefaultExpertTeams } from "./expert-teams/07-team-default";


