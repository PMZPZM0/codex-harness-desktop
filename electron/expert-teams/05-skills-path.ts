/**
 * expert-teams 的「skills-path」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import type { ExpertTeamConfig } from "./01-team-types";
/* ---------- 洞明技能包路径同步（纯函数；启动 ensure 与离线预检共用） ----------
 *
 * 为什么需要：内置专家的启动 ensure 是「按 teamId 存在即不更新」，而洞明的 systemPrompt 里写着
 * 技能包的**绝对路径**。一旦安装位置变化（开发版 resources/ ↔ 打包版 process.resourcesPath、
 * 项目目录改名或搬家），存档里那条旧路径就失效了 —— 而专家读不到技能包时**不报错、静默降级**，
 * 表现为「洞明突然不再读规则集了」。这里只同步路径那一行，其余内容逐字保留。            */

/** 提示词里技能包绝对路径那一行的行首标记（改动它必须同步 scripts/check-preflight.mjs 的断言）。 */
export const SKILLS_PATH_MARK = "**技能包在本机的绝对路径**：";

const SKILLS_PATH_RE = /(\*\*技能包在本机的绝对路径\*\*：`)([^`]*)`/;

/** 规范化技能包目录：去尾部斜杠。 */
export function normalizeSkillsDir(dir?: string): string {
  return String(dir ?? "").replace(/[\\/]+$/, "");
}

/** 提示词末尾的「兜底段」（没给路径时返回空数组）。 */
export function skillsPathBlock(skillsDir: string): string[] {
  const dir = normalizeSkillsDir(skillsDir);
  if (!dir) return [];
  return [
    "",
    `${SKILLS_PATH_MARK}\`${dir}\``,
    "上文提到的 `SKILL.md` / `references/rule-map.md` / `references/rules/*` / `references/false-positive-filter.md` 都在这个目录下。",
    "**若引擎的技能列表里没有 dongming-code-review，就用文件工具直接读这个目录**（先读 SKILL.md，再按它的第 2 步读规则文档）——不要把「技能没装」当成跳过审查方法的理由。",
  ];
}

/** 读出提示词里的技能包路径；没有则返回 ""。 */
export function readSkillsPath(systemPrompt: string): string {
  const m = SKILLS_PATH_RE.exec(String(systemPrompt ?? ""));
  return m ? m[2] : "";
}

/**
 * 把提示词里的技能包路径同步为 skillsDir。返回新提示词；**无需变更时返回 null**（调用方据此决定不写盘）。
 * - 已有路径行 → 只替换那一段路径字符串，其余内容逐字保留；
 * - 没有路径行（老版本播种 / 被手工删掉）→ 追加兜底段。
 */
export function syncSkillsPath(systemPrompt: string, skillsDir: string): string | null {
  const dir = normalizeSkillsDir(skillsDir);
  if (!dir) return null;
  const cur = String(systemPrompt ?? "");
  const have = readSkillsPath(cur);
  if (have === dir) return null;
  if (have) return cur.replace(SKILLS_PATH_RE, (_m: string, head: string) => `${head}${dir}\``);
  return `${cur}\n${skillsPathBlock(dir).join("\n")}`;
}

/**
 * 内置专家存档的路径同步：把已播种的配置里的技能包路径刷成当前真实路径。
 * 返回更新后的配置；无需变更（或数据异常）时返回 null。
 */
export function syncSkillsPathInTeam(stored: ExpertTeamConfig, expected: ExpertTeamConfig): ExpertTeamConfig | null {
  if (!stored || !expected || stored.teamId !== expected.teamId) return null;
  if (!stored.lead || !expected.lead) return null;
  const want = readSkillsPath(expected.lead.systemPrompt ?? "");
  const next = syncSkillsPath(stored.lead.systemPrompt ?? "", want);
  if (next === null) return null;
  return { ...stored, lead: { ...stored.lead, systemPrompt: next }, updatedAt: new Date().toISOString() };
}
