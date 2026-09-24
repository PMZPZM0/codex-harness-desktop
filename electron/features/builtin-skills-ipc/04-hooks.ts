/**
 * builtin-skills-ipc 的「hooks」部分（09-22 从同目录 builtin-skills-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app, dialog, ipcMain } from "electron";
import { applyCustomModel, builtinPluginsFile, describeNetworkError, dirEntries, readBuiltinPlugins, readCustomModel, refreshSkillDiscipline, skillsRegistryFile, userSkillsDir } from "../../main";
import { codexHome, mainWindow, server } from "../../runtime-refs";
import { setSkillEnabledSilent } from "./03-plugins-market";
function escapeHookKey(key: string) {
  return String(key).split("\\").join("\\\\").split('"').join('\\"');
}

async function writeHookEnabled(key: string, enabled: boolean) {
  await server.request("config/value/write", {
    filePath: path.join(codexHome, "config.toml"),
    keyPath: `hooks.state."${escapeHookKey(key)}".enabled`,
    value: Boolean(enabled),
    mergeStrategy: "replace",
  });
}

ipcMain.handle("hooks:set-enabled", async (_event, input: { hookKeys: string[]; enabled: boolean }) => {
  const keys = (Array.isArray(input?.hookKeys) ? input.hookKeys : []).map((key) => String(key ?? "")).filter(Boolean);
  const failures: string[] = [];
  for (const key of keys) {
    try { await writeHookEnabled(key, Boolean(input.enabled)); }
    catch (error: any) { failures.push(`${key}：${error.message}`); }
  }
  return { changed: keys.length - failures.length, failures };
});

ipcMain.handle("plugins:set-linked-enabled", async (_event, input: { pluginId: string; enabled: boolean }) => {
  const pluginId = String(input?.pluginId ?? "");
  if (!pluginId) throw new Error("缺少插件 ID");
  const enabled = Boolean(input.enabled);
  const failures: string[] = [];

  // 市场安装的插件真实 ID 形如 "ponytail@ponytail"（id@市场名），调用方可能传短名。
  // 先从 plugin/list 解析出真实 ID，否则 config 写错键、钩子/技能归属全部匹配不上。
  let targetId = pluginId;
  try {
    const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
    const base = (value: string) => String(value ?? "").split("@")[0];
    const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
      .find((plugin: any) => plugin.installed && (plugin.id === pluginId || base(plugin.id) === base(pluginId)));
    if (found?.id) targetId = String(found.id);
  } catch { /* 列表失败时保留原 ID */ }

  // 1. 插件本体
  try {
    await server.request("config/value/write", {
      filePath: path.join(codexHome, "config.toml"),
      keyPath: `plugins."${escapeHookKey(targetId)}".enabled`,
      value: enabled,
      mergeStrategy: "replace",
    });
  } catch (error: any) { failures.push(`插件：${error.message}`); }

  // 2. 该插件提供的钩子（按 pluginId 过滤，用户自定义钩子 source=user 不受影响）
  try {
    const result: any = await server.request("hooks/list", { cwds: [] });
    const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
    for (const hook of hooks.filter((hook: any) => hook.pluginId === targetId)) {
      try { await writeHookEnabled(hook.key, enabled); }
      catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
    }
  } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }

  // 3. 该插件提供的技能（.plugin.json 的 pluginId 可能带市场后缀，按 base 名归一化匹配）
  try {
    const base = (value: string) => String(value ?? "").split("@")[0];
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      const dir = path.join(userSkillsDir, entry.name);
      let owner: string | undefined;
      try { owner = JSON.parse(await fs.readFile(path.join(dir, ".plugin.json"), "utf8"))?.pluginId || undefined; } catch { /* 没有归属清单 */ }
      if (!owner || base(owner) !== base(targetId)) continue;
      try { await setSkillEnabledSilent(entry.name, enabled); }
      catch (error: any) { failures.push(`技能 ${entry.name}：${error.message}`); }
    }
  } catch { /* 技能目录不存在时跳过 */ }

  await server.restart();
  return { ok: failures.length === 0, failures };
});

ipcMain.handle("plugins:set-enabled", async (_event, input: { pluginIds: string[]; enabled: boolean }) => {
  const ids = (Array.isArray(input?.pluginIds) ? input.pluginIds : []).map((id) => String(id ?? "")).filter(Boolean);
  if (!ids.length) return { changed: 0, failures: [] };
  const configPath = path.join(codexHome, "config.toml");
  const failures: string[] = [];
  const idSet = new Set(ids);
  for (const id of ids) {
    try {
      await server.request("config/value/write", {
        filePath: configPath,
        keyPath: `plugins."${escapeHookKey(id)}".enabled`,
        value: Boolean(input.enabled),
        mergeStrategy: "replace",
      });
    } catch (error: any) {
      failures.push(`${id}：${error.message}`);
    }
  }
  // 联动：插件停用后它提供的钩子在 UI 上也应显示成停用，否则两页状态打架
  try {
    const result: any = await server.request("hooks/list", { cwds: [] });
    const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
    for (const hook of hooks.filter((hook: any) => hook.pluginId && idSet.has(hook.pluginId))) {
      try { await writeHookEnabled(hook.key, Boolean(input.enabled)); }
      catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
    }
  } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }
  return { changed: ids.length - failures.length, failures };
});
