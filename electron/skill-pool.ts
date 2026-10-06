/**
 * 共享技能池（09-27 用户需求：技能界面加共享技能池管理，每个项目可选择生效哪些技能）。
 *
 * 模型（两个配置真相源 + 一个磁盘投影）：
 *  - 全局停用集 `codex-home/skill-global-disabled.json`：跨项目停用（迁移自原 .disabled 改名）。
 *  - 项目禁用集 `<项目>/.codex-harness/skill-pool.json`：本项目额外停用的技能（随项目走）。
 *  - 实际生效 = 全局启用 ∩ 不在项目禁用集；`syncSkillPool(cwd)` 把这个计算结果**投影**到
 *    `codex-home/skills/` 的改名状态（SKILL.md ⇄ SKILL.md.disabled，引擎「扫到就注入」的唯一入口）。
 *
 * ⛔ 引擎限制（诚实声明）：引擎按磁盘目录扫描、无 per-project/per-thread 过滤 ⇒ 同一时刻每个
 *    技能只有一种全局磁盘状态。sync 在 thread/start 前按**当前 cwd 的池**重排——若同时开着
 *    两个不同项目的会话，后 sync 的一方决定磁盘状态（单实例锁下这是边缘场景）。
 *    技能正文永不被删：改名保留，恢复 = 改回。
 *
 * 迁移：首次 sync 发现 `<dir>/SKILL.md.disabled` 且目录不在任何配置里 ⇒ 记入全局停用集
 *   （保住用户已停用的技能不被误恢复）。
 *
 * ⛔⛔ 项目间独立性（09-27 用户拍板「A 项目启用禁用跟 B 项目没有毛关系」）：
 *   每个项目的 `skill-pool.json` 是**该项目生效集的唯一真相源**，互相不可见。
 *   `describeSkillPool(cwd)` 的 active 一律按 **cwd 自己的配置**算，禁止读磁盘改名态——
 *   磁盘只是「最近一次 sync 的项目」的投影，读它必然把一个项目的状态泄漏进另一个项目。
 */
import fs from "node:fs";
import path from "node:path";
import { globalSkillsDir, MEMORY_MCP_BACKEND_SKILL, SKILL_FILE, SKILL_FILE_DISABLED, SKILL_FILE_POOL_DISABLED } from "./skill-pack";
import { codexHome as codexHomeRef } from "./runtime-refs";

export const SKILL_POOL_FILE = path.join(".codex-harness", "skill-pool.json");

type PoolFile = { version: 1; disabled: string[] };
type GlobalFile = { version: 1; disabled: string[] };

function readJson(file: string): { disabled: string[] } | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && Array.isArray(j.disabled)) return { disabled: j.disabled.filter((x: unknown) => typeof x === "string") };
  } catch { /* 缺失/损坏 = 空 */ }
  return null;
}

function writeJson(file: string, disabled: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, disabled } satisfies PoolFile, null, 2) + "\n", "utf8");
}

export function skillPoolFile(cwd: string): string {
  return path.join(cwd, SKILL_POOL_FILE);
}

/** 读项目禁用集（文件缺失/损坏 = 空集合）。
 *  ⛔ 空 cwd = 没有当前项目 ⇒ **直接返回空集**，不去读相对路径 ——
 *     `path.join("", ".codex-harness", "skill-pool.json")` 是相对路径，会落到进程 cwd，
 *     那是"读了一个碰巧在那儿的文件"的不确定行为（控制台的总开关就可能在没打开工作区时被点）。 */
export function readSkillPool(cwd: string): Set<string> {
  if (!String(cwd ?? "").trim()) return new Set();
  return new Set(readJson(skillPoolFile(cwd))?.disabled ?? []);
}

/** 写项目禁用集。空 cwd 同理：没有项目就不该有"项目级禁用"，静默跳过（⛔ 不写相对路径）。 */
export function writeSkillPool(cwd: string, disabled: Iterable<string>): void {
  if (!String(cwd ?? "").trim()) return;
  writeJson(skillPoolFile(cwd), [...disabled].sort());
}

function globalDisabledFile(codexHome: string): string {
  return path.join(codexHome, "skill-global-disabled.json");
}

/** 读全局停用集。 */
export function readGlobalDisabled(codexHome: string): Set<string> {
  return new Set(readJson(globalDisabledFile(codexHome))?.disabled ?? []);
}

function writeGlobalDisabled(codexHome: string, disabled: Iterable<string>): void {
  writeJson(globalDisabledFile(codexHome), [...disabled].sort());
}

/** 枚举全局技能目录：{ dir, enabled(磁盘当前态) }。 */
function listGlobalSkillDirs(codexHome: string): { dir: string; name: string; enabled: boolean }[] {
  const root = globalSkillsDir(codexHome);
  const out: { dir: string; name: string; enabled: boolean }[] = [];
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const dir = path.join(root, e.name);
      out.push({ dir, name: e.name, enabled: fs.existsSync(path.join(dir, "SKILL.md")) });
    }
  } catch { /* 目录不存在 = 空 */ }
  return out;
}

/**
 * 把「全局停用集 ∪ 项目禁用集」投影到磁盘改名状态。幂等；失败静默（启动链旁路纪律）。
 *
 * ⛔ 磁盘形态区分（变异实测踩出来的竞态）：池投影停用用**专属后缀 `.pool-disabled`**，
 *   与用户遗留的 `SKILL.md.disabled` 可区分——否则投影结果会被下一轮「迁移」误判成
 *   用户手动停用而收编进全局集（实测：解除项目禁用后又被停回去）。
 *   `SKILL.md.disabled`（旧形态）只被**收编**：记入全局停用集并转成 .pool-disabled。
 * ⛔ 联动技能（memory-mcp-backend）由 builtin-skills 的记忆后端切换维护（二选一改名），
 *   不进池管理——避免「联动恢复 → sync 又停」的打架。
 */
export function syncSkillPool(cwd: string): void {
  const codexHome = codexHomeRef;
  try {
    const dirs = listGlobalSkillDirs(codexHome);
    let global = readGlobalDisabled(codexHome);
    const project = readSkillPool(cwd);

    let changed = false;
    for (const { dir, name, enabled } of dirs) {
      if (name === MEMORY_MCP_BACKEND_SKILL) continue; // 联动自管，不进池
      const shouldDisable = global.has(name) || project.has(name);
      const skillMd = path.join(dir, SKILL_FILE);
      const poolOff = path.join(dir, SKILL_FILE_POOL_DISABLED);
      const legacyOff = path.join(dir, SKILL_FILE_DISABLED);
      if (shouldDisable && enabled) {
        fs.renameSync(skillMd, poolOff);
        changed = true;
      } else if (!shouldDisable && !enabled) {
        if (fs.existsSync(poolOff)) {
          fs.renameSync(poolOff, skillMd);
          changed = true;
        } else if (fs.existsSync(legacyOff)) {
          // 收编遗留停用：记入全局停用集并纳入池形态（用户此前手动停用的不丢）
          global.add(name);
          fs.renameSync(legacyOff, poolOff);
          changed = true;
        }
      }
    }
    if (changed) writeGlobalDisabled(codexHome, global);
  } catch { /* 静默降级：与 ensureProjectAgentsMd 同一条启动链纪律 */ }
}

/** UI 数据：全局技能列表 + 全局停用态 + 当前项目禁用态。
 *  ⛔ active 必须按**该项目自己的配置**算（!globalDisabled && !projectDisabled），
 *     不能读磁盘改名态——磁盘是「最近一次 sync 的那个项目」的投影，读它会把这个
 *     项目的状态泄漏进另一个项目的视图（实测：A 停用 → 切到 B 显示已停用 →
 *     在 B 点开还会把 A 的状态写进 B 的配置，双向污染）。 */
export function describeSkillPool(cwd: string): {
  skills: { name: string; globalDisabled: boolean; projectDisabled: boolean; active: boolean }[];
} {
  const codexHome = codexHomeRef;
  const global = readGlobalDisabled(codexHome);
  const project = readSkillPool(cwd);
  return {
    skills: listGlobalSkillDirs(codexHome)
      .map(({ name }) => {
        const globalDisabled = global.has(name);
        const projectDisabled = project.has(name);
        return {
          name,
          globalDisabled,
          projectDisabled,
          active: !globalDisabled && !projectDisabled,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** UI 动作：设置某技能的「全局停用」或「本项目禁用」。返回后调用方需重新 describe。 */
export function setSkillPoolState(
  cwd: string,
  name: string,
  patch: { globalDisabled?: boolean; projectDisabled?: boolean },
): void {
  const codexHome = codexHomeRef;
  const dirs = listGlobalSkillDirs(codexHome);
  if (!dirs.some((d) => d.name === name)) throw new Error(`技能不存在: ${name}`);
  if (patch.globalDisabled !== undefined) {
    const global = readGlobalDisabled(codexHome);
    if (patch.globalDisabled) global.add(name);
    else global.delete(name);
    writeGlobalDisabled(codexHome, global);
  }
  if (patch.projectDisabled !== undefined) {
    const project = readSkillPool(cwd);
    if (patch.projectDisabled) project.add(name);
    else project.delete(name);
    writeSkillPool(cwd, project);
  }
  // 立即投影（不等下一次 thread/start，UI 即点即生效）
  syncSkillPool(cwd);
}
