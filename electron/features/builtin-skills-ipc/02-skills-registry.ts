/**
 * builtin-skills-ipc 的「skills-registry」部分（09-22 从同目录 builtin-skills-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app, dialog, ipcMain } from "electron";
import { installCocoLoopSkill, listSkillHubSkills, stripSkillBom, auditSkill } from "../../skills-market";
import { sendToWindow } from "../../features/window-bus";
import { DISCIPLINE_END, DISCIPLINE_START } from "../../skill-discipline";
import type { InstalledMarketSkill, MarketSkill } from "../../skills-market";
import { applyCustomModel, builtinPluginsFile, describeNetworkError, dirEntries, readBuiltinPlugins, readCustomModel, refreshSkillDiscipline, skillsRegistryFile, userSkillsDir } from "../../main";
import { codexHome, mainWindow, server } from "../../runtime-refs";
type SkillRegistryRecord = { name: string; path: string; source: "cocoloop" | "local"; marketId?: string; sourceUrl?: string; installedAt: string };

async function readSkillRegistry(): Promise<SkillRegistryRecord[]> {
  try {
    const records = JSON.parse(await fs.readFile(skillsRegistryFile, "utf8"));
    return Array.isArray(records) ? records.filter((entry: any) => entry && typeof entry.name === "string" && typeof entry.path === "string") : [];
  } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
}

async function updateSkillRegistry(record: SkillRegistryRecord) {
  const records = await readSkillRegistry();
  const next = [...records.filter((entry) => entry.path !== record.path && entry.marketId !== record.marketId), record];
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(skillsRegistryFile, JSON.stringify(next, null, 2), "utf8");
}

export async function removeFromSkillRegistry(skillPath: string) {
  const records = await readSkillRegistry();
  await fs.writeFile(skillsRegistryFile, JSON.stringify(records.filter((entry) => entry.path !== skillPath), null, 2), "utf8");
}

function skillFolderName(source: string) {
  return path.basename(path.dirname(source)).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `skill-${Date.now()}`;
}

ipcMain.handle("skills:import", async () => {
  const picked = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [{ name: "Skill definition", extensions: ["md"] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const source = picked.filePaths[0];
  if (path.basename(source).toLowerCase() !== "skill.md") throw new Error("请选择名为 SKILL.md 的技能定义文件");
  const content = await fs.readFile(source, "utf8");
  if (!content.trim()) throw new Error("SKILL.md 不能为空");
  // ⛔ 导入口也必须过技能安全审查（09-23 用户明令：任何技能安装前必须审）。
  //    此前只有市场安装走 auditSkill，本地导入是**绕开审查的后门** —— 用户随手挑一个
  //    来源不明的 SKILL.md 就能把任意指令送进引擎的执行链。
  const findings = auditSkill(content, [path.basename(source)]);
  if (findings.length) throw new Error(`安全检查未通过：${findings.join("；")}`);
  const name = skillFolderName(source);
  const destination = path.join(userSkillsDir, name);
  await fs.mkdir(destination, { recursive: true });
  const skillPath = path.join(destination, "SKILL.md");
  await fs.copyFile(source, skillPath);
  // 用户从本地挑的 SKILL.md 也可能带 BOM（编辑器/导出习惯所致）：剥掉，否则引擎拒载
  await stripSkillBom(skillPath);
  await updateSkillRegistry({ name, path: skillPath, source: "local", installedAt: new Date().toISOString() });
  await server.restart();
  void refreshSkillDiscipline();
  return { name, path: destination, source, content };
});

const skillHubSectionMap: Record<string, string> = { "总排行": "hot", "近期最热": "trending", "最新上传": "newest", "官方精选": "featured" };

ipcMain.handle("skills:market-list", (_event, input: { category?: string; query?: string } = {}) => {
  const section = skillHubSectionMap[input.category ?? ""] ?? "hot";
  return listSkillHubSkills({ section, query: input.query });
});

ipcMain.handle("skills:market-install", async (_event, skill: MarketSkill) => {
  const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "skill-install", skillId: skill.id, stage, message, at: Date.now() });
  const installed = await installCocoLoopSkill({
    skill,
    destinationRoot: userSkillsDir,
    onProgress: ({ stage, message }) => emit(stage, message),
  });
  await updateSkillRegistry({ name: installed.name, path: installed.path, source: "cocoloop", marketId: installed.marketId, sourceUrl: installed.sourceUrl, installedAt: new Date().toISOString() });
  // SKILL.md 落到 CODEX_HOME/skills 后重启进程，再强制刷新 skills/list；返回的状态才是 UI 的“Codex 已发现”依据。
  emit("engine", "正在重启 Codex 引擎并注册技能");
  await server.restart();
  emit("verify", "正在确认 Codex 是否已发现该技能");
  let engineRegistered = false;
  let engineCheckMessage = "Codex 技能目录已刷新，下一轮任务可使用该技能";
  try {
    const result: any = await server.request("skills/list", { cwds: [], forceReload: true });
    const discovered = (result.data ?? []).flatMap((entry: any) => entry.skills ?? []);
    engineRegistered = discovered.some((entry: any) => entry?.path === installed.path || entry?.name === installed.name || entry?.name === skill.name);
    if (!engineRegistered) engineCheckMessage = "技能已写入 Codex 技能目录；引擎已刷新，但当前接口未返回该技能名称。新建或下一轮任务仍会重新扫描。";
  } catch (error: any) {
    engineCheckMessage = `技能已安装且引擎已重启，但自动确认暂时不可用：${error.message}`;
  }
  emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
  void refreshSkillDiscipline();
  return { ...installed, engineRegistered, engineCheckMessage };
});

ipcMain.handle("skills:market-install-light", async (_event, skill: MarketSkill) => {
  const installed = await installCocoLoopSkill({ skill, destinationRoot: userSkillsDir });
  await updateSkillRegistry({ name: installed.name, path: installed.path, source: "cocoloop", marketId: installed.marketId, sourceUrl: installed.sourceUrl, installedAt: new Date().toISOString() });
  let discovered = false;
  try {
    const result: any = await server.request("skills/list", { cwds: [], forceReload: true });
    discovered = (result.data ?? []).flatMap((entry: any) => entry.skills ?? [])
      .some((entry: any) => entry?.name === installed.name || entry?.path === installed.path);
  } catch { /* 重扫失败不阻塞：下一回合引擎自己会重新扫描 */ }
  await refreshSkillDiscipline();
  return { name: installed.name, path: installed.path, discovered, engineCheckMessage: discovered ? "引擎已发现该技能，下一回合即可使用" : "技能已入库，下一回合引擎重新扫描后即可使用" };
});

ipcMain.handle("skill-discipline:get", async () => {
  try {
    const raw = await fs.readFile(path.join(codexHome, "AGENTS.md"), "utf8");
    const start = raw.indexOf(DISCIPLINE_START);
    const end = raw.indexOf(DISCIPLINE_END);
    return { present: start >= 0 && end > start, section: start >= 0 && end > start ? raw.slice(start, end + DISCIPLINE_END.length) : "" };
  } catch { return { present: false, section: "" };
  }
});
