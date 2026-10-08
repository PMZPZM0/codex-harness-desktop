/**
 * skills-ipc（10-03 从 `features/builtin-skills-ipc/02-...` + `03-...` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：skills(10)
 * 通道：skills:import / market-list / market-install / market-install-light /
 *      local-list / set-enabled / set-enabled-batch / local-remove / pool-describe / pool-set
 *
 * ⛔⛔ 四条实证口径（本次纯搬迁，一字未改）：
 *   1. **本地导入也必须过技能安全审查**（09-23 用户明令）：此前只有市场安装走 auditSkill，
 *      本地导入是**绕开审查的后门** —— 随手挑一个来源不明的 SKILL.md 就能把任意指令送进
 *      引擎执行链。
 *   2. **导入的 SKILL.md 要剥 BOM**：用户从编辑器/导出拿来的文件可能带 BOM，不剥引擎拒载。
 *   3. **技能名以 SKILL.md 的 frontmatter 为准**，不能用文件夹名（文件夹名是安装 ID）——
 *      否则会与 Codex skills/list 返回的规范名显示成两条。
 *   4. **卸载要防目录穿越**：解析后必须仍在技能根目录内；且要清市场来源登记
 *      （`removeFromSkillRegistry`），否则重装的来源信息错乱。
 * ⛔ `setSkillEnabledSilent`（启停改名）已下沉到基座层 `../skill-store`（plugins 域的联动也用）。
 * ⛔ 待接缝化（阶段 2）：dialog / fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { dialog } from "electron";
import { auditSkill, installCocoLoopSkill, listSkillHubSkills, stripSkillBom } from "../skills-market";
import type { InstalledMarketSkill, MarketSkill } from "../skills-market";
import { describeSkillPool, readGlobalDisabled, setSkillPoolState } from "../skill-pool";
import { sendToWindow } from "./window-bus";
import { refreshSkillDiscipline, skillsRegistryFile, userSkillsDir } from "../main";
import { refreshDeveloperInstructions } from "../main/12-skill-discipline";
import { isOutputStyleSkill } from "../output-styles";
import { codexHome, mainWindow, server } from "../runtime-refs";
import { globalSkillsDir } from "../skill-pack";
import { setSkillEnabledSilent } from "../skill-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

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

async function removeFromSkillRegistry(skillPath: string) {
  const records = await readSkillRegistry();
  await fs.writeFile(skillsRegistryFile, JSON.stringify(records.filter((entry) => entry.path !== skillPath), null, 2), "utf8");
}

function skillFolderName(source: string) {
  return path.basename(path.dirname(source)).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `skill-${Date.now()}`;
}

function parseSkillAllowedTools(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^allowed-tools\s*:/i.test(line));
  if (idx < 0) return [];
  // 行内列表写法
  const inline = lines[idx].match(/^allowed-tools\s*:\s*\[(.*)\]\s*$/i);
  if (inline) {
    return inline[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  // 块级列表写法：后续以 "- " 开头的行，直到下一个 frontmatter 键或结束
  const tools: string[] = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!/^-\s+/.test(line)) break; // 不再是列表项
    const tool = line.replace(/^-\s+/, "").replace(/^["']|["']$/g, "").trim();
    if (tool) tools.push(tool);
  }
  return tools;
}

const skillHubSectionMap: Record<string, string> = { "总排行": "hot", "近期最热": "trending", "最新上传": "newest", "官方精选": "featured" };

const SKILLS_CHANNELS = [
  "skills:import", "skills:market-list", "skills:market-install", "skills:market-install-light",
  "skills:local-list", "skills:set-enabled", "skills:set-enabled-batch", "skills:local-remove",
  "skills:pool-describe", "skills:pool-set",
  "skills:builtin-switch-get", "skills:builtin-switch-set",
];

export const skillsFeature = defineFeature<null>({
  id: "skills",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("skills: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("skills:import", async () => {
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
      //    此前只有市场安装走 auditSkill，本地导入是**绕开审查的后门**。
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

    ipcHost.handle("skills:market-list", (_event, input: { category?: string; query?: string } = {}) => {
      const section = skillHubSectionMap[input.category ?? ""] ?? "hot";
      return listSkillHubSkills({ section, query: input.query });
    });

    ipcHost.handle("skills:market-install", async (_event, skill: MarketSkill) => {
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "skill-install", skillId: skill.id, stage, message, at: Date.now() });
      const installed = await installCocoLoopSkill({
        skill,
        destinationRoot: userSkillsDir,
        onProgress: ({ stage, message }) => emit(stage, message),
      });
      await updateSkillRegistry({ name: installed.name, path: installed.path, source: "cocoloop", marketId: installed.marketId, sourceUrl: installed.sourceUrl, installedAt: new Date().toISOString() });
      // SKILL.md 落到 CODEX_HOME/skills 后重启进程，再强制刷新 skills/list；返回的状态才是 UI 的“Codex 已发现”依据。
      emit("engine", "正在重启 Codex 引擎并注册技能");
      // ⛔⛔ 重启失败 ≠ 安装失败（10-08 用户实测「装完报安装失败、其实已经装好了」）：
      //   前 5 步（下载 / 解压 / 安检 / 落盘 / 登记来源）都已经成功，技能文件就在磁盘上；
      //   这里只是引擎**这一次**没起来（瞬时故障由 CodexServer 内置重试消化，本分支是重试
      //   也用尽的兜底）。原样抛出会让用户看到"安装失败"、反复重装却查不出问题。
      //   降级成 pending 如实告知，并跳过引擎确认（引擎没起来时 request 会再触发一次启动，
      //   白等 60s 超时）。
      let restartError = "";
      try { await server.restart(); } catch (error: any) { restartError = error?.message ?? String(error); }
      emit("verify", "正在确认 Codex 是否已发现该技能");
      let engineRegistered = false;
      let engineCheckMessage = "Codex 技能目录已刷新，下一轮任务可使用该技能";
      if (restartError) {
        engineCheckMessage = `技能已写入 Codex 技能目录，但引擎本轮启动失败（${restartError}）。重启应用后即可使用。`;
      } else try {
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

    ipcHost.handle("skills:market-install-light", async (_event, skill: MarketSkill) => {
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

    ipcHost.handle("skills:local-list", async () => {
      try {
        const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
        const results = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
          const file = path.join(userSkillsDir, entry.name, "SKILL.md");
          // 停用是把 SKILL.md 改名成 SKILL.md.disabled：Codex 扫描目录时看不到，技能就真的不生效。
          const disabledFile = path.join(userSkillsDir, entry.name, "SKILL.md.disabled");
          const active = existsSync(file);
          const target = active ? file : disabledFile;
          try {
            const content = await fs.readFile(target, "utf8");
            let market: InstalledMarketSkill | null = null;
            let marketSource: "cocoloop" | "skillhub" | null = null;
            // 市场来源清单：cocoloop 与 skillhub 两种命名都认
            try { market = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".cocoloop.json"), "utf8")); marketSource = "cocoloop"; } catch { /* 继续查 skillhub 清单 */ }
            if (!market) { try { market = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".skillhub.json"), "utf8")); marketSource = "skillhub"; } catch { /* 本地导入没有市场清单 */ } }
            // .plugin.json 记录「这个技能由哪个插件提供」，钩子页的联动开关靠它定位关联技能
            let pluginId: string | undefined;
            try { pluginId = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".plugin.json"), "utf8"))?.pluginId || undefined; } catch { /* 非插件技能没有归属 */ }
            const description = (content.match(/^description:\s*["']?(.+?)["']?\s*$/mi)?.[1] ?? content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---")) ?? "本地导入技能").slice(0, 120);
            // 文件夹名是安装 ID（例如 Memory-Setup-7733），技能名必须以 SKILL.md 的 frontmatter 为准，
            // 否则会与 Codex skills/list 返回的规范名（例如 memory-setup）显示成两条。
            const declaredName = content.match(/^name:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim();
            // allowed-tools：SKILL.md frontmatter 里声明的工具白名单（复刻 WorkBuddy 的 allowed-tools）。
            const allowedTools = parseSkillAllowedTools(content);
            const marketKind = String((market as any)?.kind ?? "");
            return { name: declaredName || entry.name, folder: entry.name, path: target, description, descriptionZh: market?.descriptionZh, enabled: active, pluginId, marketId: market?.marketId, sourceUrl: market?.sourceUrl, installedAt: market?.installedAt, source: marketSource ?? "local", allowedTools, icon: market?.icon, category: market?.category, skillset: marketKind === "skillset", skillsetSlug: marketKind === "skillset-child" ? String((market as any)?.skillset ?? "") : undefined };
          } catch { return null; }
        }));
        return results.filter(Boolean);
      } catch { return []; }
    });

    ipcHost.handle("skills:set-enabled", async (_event, input: { folder: string; enabled: boolean }) => {
      await setSkillEnabledSilent(input.folder, Boolean(input.enabled));
      await server.restart();
      void refreshSkillDiscipline();
      return { ok: true };
    });

    ipcHost.handle("skills:set-enabled-batch", async (_event, input: { folders: string[]; enabled: boolean }) => {
      const folders = Array.isArray(input?.folders) ? input.folders : [];
      const failures: string[] = [];
      for (const folder of folders) {
        try { await setSkillEnabledSilent(folder, Boolean(input.enabled)); }
        catch (error: any) { failures.push(`${folder}：${error.message}`); }
      }
      await server.restart();
      void refreshSkillDiscipline();
      return { ok: failures.length === 0, changed: folders.length - failures.length, failures };
    });

    ipcHost.handle("skills:local-remove", async (_event, input: { folder?: string; name?: string } | string) => {
      const folder = (typeof input === "string" ? input : String(input?.folder ?? "")).trim();
      const label = (typeof input === "string" ? input : String(input?.name ?? folder)).trim() || folder;
      if (!folder) throw new Error("缺少技能目录名");
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "skill-remove", skillId: folder, stage, message, at: Date.now() });
      const root = path.resolve(userSkillsDir);
      const target = path.resolve(userSkillsDir, folder);
      // 防目录穿越：解析后必须仍在技能根目录内
      if (!target.startsWith(root + path.sep)) throw new Error("非法技能路径");
      if (!existsSync(target)) throw new Error("技能目录不存在，可能已被卸载");
      emit("prepare", `已确认待卸载技能：${label}`);
      emit("delete", "正在删除技能文件");
      await removeFromSkillRegistry(path.join(target, "SKILL.md"));
      await fs.rm(target, { recursive: true, force: true });
      emit("registry", "已清理市场来源与来源登记");
      emit("engine", "正在重启 Codex 引擎并注销技能");
      await server.restart();
      emit("verify", "正在确认 Codex 是否已移除该技能");
      let engineRemoved = false;
      let engineCheckMessage = "技能目录已删除，引擎已刷新";
      try {
        const result: any = await server.request("skills/list", { cwds: [], forceReload: true });
        const discovered = (result.data ?? []).flatMap((entry: any) => entry.skills ?? []);
        const stillPresent = discovered.some((entry: any) => {
          const entryPath = String(entry?.path ?? "").replace(/\\/g, "/").toLowerCase();
          const targetPath = target.replace(/\\/g, "/").toLowerCase();
          const entryFolder = entryPath.split("/").slice(-2, -1)[0] ?? "";
          return entryPath.startsWith(targetPath) || entryFolder === folder.toLowerCase();
        });
        engineRemoved = !stillPresent;
        if (!engineRemoved) engineCheckMessage = `技能文件已删除，但引擎列表仍返回「${label}」；引擎已刷新，下一轮任务会重新扫描确认。`;
      } catch (error: any) {
        engineCheckMessage = `技能已删除且引擎已重启，但自动确认暂时不可用：${error.message}`;
      }
      emit(engineRemoved ? "complete" : "pending", engineCheckMessage);
      void refreshSkillDiscipline();
      return { ok: true, engineRemoved, engineCheckMessage };
    });

    // ── 共享技能池（09-27）：按项目查看/管理全局技能生效集 ──────────────────────────
    ipcHost.handle("skills:pool-describe", (_event, input: { cwd: string }) => {
      try {
        return { skills: describeSkillPool(String(input?.cwd ?? "")).skills };
      } catch (error: any) {
        return { skills: [], error: error?.message ?? String(error) };
      }
    });

    ipcHost.handle("skills:pool-set", async (_event, input: { cwd: string; name: string; globalDisabled?: boolean; projectDisabled?: boolean }) => {
      try {
        setSkillPoolState(String(input?.cwd ?? ""), String(input?.name ?? ""), {
          globalDisabled: input?.globalDisabled,
          projectDisabled: input?.projectDisabled,
        });
        // 与全局启停同一刷新链（AGENTS.md 守则区间的 MCP 清单仍走这）
        await refreshSkillDiscipline().catch(() => undefined);
        /* 输出风格类技能的启停 = developer_instructions 的内容变了 ⇒ 必须重下发
           （见 ../output-styles.ts 的文件头）。⛔ 只对风格技能这么做：其余技能启停
           与常驻指令无关，不该为此重启引擎。 */
        if (isOutputStyleSkill(String(input?.name ?? ""))) await refreshDeveloperInstructions();
        return { ok: true };
      } catch (error: any) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    });

    // ── 内置技能的独立开关（10-06）：设置 → 控制台用，只动**全局**生效集 ──────────────
    /* ⛔ 与共享技能池**共用同一份真相源**（`codex-home/skill-global-disabled.json`），只是入口不同：
       池面板按项目管（globalDisabled + projectDisabled），控制台这个开关是**跨项目的总开关**。
       ⇒ 不新增第二份状态（否则两处会各说各话）。
       `cwd` 可空：控制台可能在还没打开工作区时就被点 —— 全局集与 cwd 无关，投影里那部分照常生效
       （`readSkillPool("")` 已按"无项目 ⇒ 空集"处理，不读相对路径）。
       ⛔ 开启 ≠ 生效（10-06 用户报障）：技能在磁盘上只代表引擎**能发现**它，用不用由模型判断
       —— 风格类技能必须由宿主把开关翻成常驻指令才算生效（../output-styles.ts）。 */
    const builtinSwitchState = (name: string) => {
      if (!existsSync(path.join(globalSkillsDir(codexHome), name))) return { name, enabled: false, available: false };
      return { name, enabled: !readGlobalDisabled(codexHome).has(name), available: true };
    };

    ipcHost.handle("skills:builtin-switch-get", (_event, input: { name: string }) => {
      try {
        return builtinSwitchState(String(input?.name ?? ""));
      } catch (error: any) {
        return { name: String(input?.name ?? ""), enabled: false, available: false, error: error?.message ?? String(error) };
      }
    });

    ipcHost.handle("skills:builtin-switch-set", async (_event, input: { name: string; enabled: boolean; cwd?: string }) => {
      try {
        const name = String(input?.name ?? "");
        if (!builtinSwitchState(name).available) return { name, enabled: false, available: false, error: `技能不存在: ${name}` };
        setSkillPoolState(String(input?.cwd ?? ""), name, { globalDisabled: input?.enabled === false });
        // 与全局启停同一刷新链（守则区间的 MCP 清单仍走这）
        await refreshSkillDiscipline().catch(() => undefined);
        /* ⛔⛔ 开关语义的最后一环（10-06 用户报障「要我点名才生效」）：
           把新状态翻成常驻指令下发给引擎。没这一句，开关只管"技能文件在不在"——
           模型照样不会主动用（渐进披露 + 该技能的 description 自称手动模式）。 */
        if (isOutputStyleSkill(name)) await refreshDeveloperInstructions();
        return builtinSwitchState(name);
      } catch (error: any) {
        return { name: String(input?.name ?? ""), enabled: false, available: false, error: error?.message ?? String(error) };
      }
    });

    ctx.effect(() => {
      for (const ch of SKILLS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
