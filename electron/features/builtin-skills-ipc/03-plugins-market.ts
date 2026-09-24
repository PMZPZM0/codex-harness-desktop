/**
 * builtin-skills-ipc 的「plugins-market」部分（09-22 从同目录 builtin-skills-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app, dialog, ipcMain } from "electron";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { sendToWindow } from "../../features/window-bus";
import { ensureCodexMarketplaceSection, installCodexMarketPlugin, listCodexMarketPlugins } from "../../codex-market";
import type { InstalledMarketSkill, MarketSkill } from "../../skills-market";
import type { CodexMarketPlugin } from "../../codex-market";
import { applyCustomModel, builtinPluginsFile, describeNetworkError, dirEntries, readBuiltinPlugins, readCustomModel, refreshSkillDiscipline, skillsRegistryFile, userSkillsDir } from "../../main";
import { codexHome, mainWindow, server } from "../../runtime-refs";
import { removeFromSkillRegistry } from "./02-skills-registry";
ipcMain.handle("plugins:market-list", (_event, input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) => listCodexMarketPlugins(input));

ipcMain.handle("plugins:market-install", async (_event, plugin: CodexMarketPlugin) => {
  const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "plugin-install", pluginId: plugin.slug, stage, message, at: Date.now() });
  // 幂等注册本地 marketplace 段（缺才写），返回插件落盘目录
  const destinationRoot = await ensureCodexMarketplaceSection(codexHome);
  const installed = await installCodexMarketPlugin({
    plugin,
    destinationRoot,
    onProgress: ({ stage, message }) => emit(stage, message),
  });
  // 引擎实证：光把文件写进本地 marketplace 引擎不认（plugin/list 返回空），
  // 必须调 plugin/install（marketplacePath 传 .claude-plugin/marketplace.json 文件路径）
  // 让引擎把它拷进 plugins/cache/<marketplace>/<plugin>/<version> 并置 installed=true。
  emit("engine", "正在通过引擎注册插件");
  try {
    await server.request("plugin/install", { pluginName: installed.marketId ?? plugin.slug, marketplacePath: installed.manifestPath });
  } catch (error: any) {
    emit("pending", `引擎注册插件未成功：${error?.message ?? error}（文件已落盘，重启引擎后会重新扫描）`);
  }
  emit("engine", "正在重启 Codex 引擎并注册插件");
  await server.restart();
  emit("verify", "正在确认 Codex 是否已发现该插件");
  let engineRegistered = false;
  let engineCheckMessage = "插件目录已写入，重启 Codex 后生效";
  try {
    const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
    const base = (value: string) => String(value ?? "").split("@")[0];
    const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
      .find((entry: any) => entry?.installed && (base(entry.id) === plugin.slug || entry.name === plugin.slug || entry.name === plugin.name));
    engineRegistered = Boolean(found);
    if (!engineRegistered) engineCheckMessage = "插件已写入本地插件目录；引擎已刷新，但当前列表未返回该插件，新建会话后仍会重新扫描。";
  } catch (error: any) {
    engineCheckMessage = `插件已安装且引擎已重启，但自动确认暂时不可用：${error.message}`;
  }
  emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
  return { ...installed, engineRegistered, engineCheckMessage };
});

ipcMain.handle("skills:local-list", async () => {
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
        // 引擎不做强制（引擎技能对象只有 enabled），这里是给 UI 展示声明的工具范围；不声明则为空。
        const allowedTools = parseSkillAllowedTools(content);
        return { name: declaredName || entry.name, folder: entry.name, path: target, description, descriptionZh: market?.descriptionZh, enabled: active, pluginId, marketId: market?.marketId, sourceUrl: market?.sourceUrl, installedAt: market?.installedAt, source: marketSource ?? "local", allowedTools, icon: market?.icon, category: market?.category };
      } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch { return []; }
});

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

export async function setSkillEnabledSilent(folder: string, enabled: boolean) {
  const resolved = path.resolve(userSkillsDir, String(folder ?? ""));
  if (!resolved.startsWith(path.resolve(userSkillsDir) + path.sep)) throw new Error("非法技能路径");
  const active = path.join(resolved, "SKILL.md");
  const inactive = path.join(resolved, "SKILL.md.disabled");
  if (enabled) {
    if (existsSync(inactive) && !existsSync(active)) await fs.rename(inactive, active);
  } else if (existsSync(active)) {
    await fs.rename(active, inactive);
  }
}

ipcMain.handle("skills:set-enabled", async (_event, input: { folder: string; enabled: boolean }) => {
  await setSkillEnabledSilent(input.folder, Boolean(input.enabled));
  await server.restart();
  void refreshSkillDiscipline();
  return { ok: true };
});

ipcMain.handle("skills:set-enabled-batch", async (_event, input: { folders: string[]; enabled: boolean }) => {
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

ipcMain.handle("skills:local-remove", async (_event, input: { folder?: string; name?: string } | string) => {
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

ipcMain.handle("hooks:trust", async (_event, input: { cwds?: string[] } = {}) => {
  const result: any = await server.request("hooks/list", { cwds: input.cwds ?? [] });
  const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
  const targets = hooks.filter((hook: any) => hook.trustStatus !== "trusted" && hook.currentHash && hook.key);
  if (!targets.length) return { total: hooks.length, trusted: 0, alreadyTrusted: hooks.length, failures: [] };
  const configPath = path.join(codexHome, "config.toml");
  const failures: string[] = [];
  for (const hook of targets) {
    // 钩子 key 里含 Windows 路径反斜杠，写进 TOML 点路径前必须转义，否则会被吞掉、信任记录匹配不上
    const escaped = String(hook.key).split("\\").join("\\\\");
    try {
      await server.request("config/value/write", {
        filePath: configPath,
        keyPath: `hooks.state."${escaped}".trusted_hash`,
        value: hook.currentHash,
        mergeStrategy: "replace",
      });
    } catch (error: any) {
      failures.push(`${hook.eventName ?? hook.key}：${error.message}`);
    }
  }
  return { total: hooks.length, trusted: targets.length - failures.length, alreadyTrusted: hooks.length - targets.length, failures };
});
