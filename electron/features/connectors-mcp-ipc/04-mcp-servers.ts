/**
 * connectors-mcp-ipc 的「mcp-servers」部分（09-22 从同目录 connectors-mcp-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, safeStorage, session, shell } from "electron";
import { collectMcpServerNames } from "../../config-toml";
import { readAppSettings } from "../../app-settings";
import { withNuphusMasks } from "../../automation-policy";
import { applyCustomModel, connectorEnv, connectorsFile, mcpOverrideEnabled, oauthSessions, readConnectors, readCustomModel, readMcpOverrides, refreshSkillDiscipline, safeConnectorId, writeMcpOverrides } from "../../main";
import { codexHome, server } from "../../runtime-refs";
import { writeConnectors } from "./01-prompt-enhance";
ipcMain.handle("mcp-servers:overrides", async () => {
  const overrides = await readMcpOverrides();
  return Object.fromEntries(Object.entries(overrides).map(([name, entry]) => [name, entry?.enabled !== false]));
});

ipcMain.handle("mcp-servers:set-enabled", async (_event, input: { ids?: unknown; enabled?: unknown }) => {
  const ids = Array.isArray(input.ids)
    ? input.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) throw new Error("未指定要更新状态的 MCP 服务");
  const enabled = input.enabled !== false;
  const connectors = await readConnectors();
  const connectorIds = new Set(connectors.map((entry) => entry.id));
  let updated = 0;
  let next = connectors;
  const connectorTargets = ids.filter((id) => connectorIds.has(id));
  if (connectorTargets.length) {
    next = connectors.map((entry) => {
      if (!connectorTargets.includes(entry.id) || entry.enabled === enabled) return entry;
      updated += 1;
      return { ...entry, enabled, updatedAt: new Date().toISOString() };
    });
    if (updated) await writeConnectors(next);
  }
  const overrides = await readMcpOverrides();
  // 覆盖表只管非连接器的服务器（内置 nuphus + 用户手工写在 config.toml 的段 + 已有记录）。
  // 陌生 id 一律忽略：记进去也只是死记录（readUserConfigSplit 会清掉），还白触发一次引擎重启。
  let knownExtra = new Set<string>();
  try {
    knownExtra = new Set(collectMcpServerNames(await fs.readFile(path.join(codexHome, "config.toml"), "utf8")));
  } catch { /* config.toml 还不存在就当没有手工段 */ }
  for (const id of ids) {
    if (connectorIds.has(id)) continue; // 已由连接器处理，别在覆盖表里留下同名垃圾
    if (id !== "nuphus" && !(id in overrides) && !knownExtra.has(id)) continue;
    if (mcpOverrideEnabled(overrides, id) === enabled) continue;
    // 保留已有原文与工具权限：用户手工写的 MCP 靠原文才能启用时拼回，工具权限不能因启停被抹掉
    overrides[id] = { enabled, toml: overrides[id]?.toml, permissions: overrides[id]?.permissions };
    updated += 1;
  }
  await writeMcpOverrides(overrides);
  if (!updated) return { ok: true, updated: 0 };
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  return { ok: true, updated };
});

ipcMain.handle("mcp-servers:permissions", async () => {
  const overrides = await readMcpOverrides();
  const view = Object.fromEntries(
    Object.entries(overrides)
      .filter(([, entry]) => entry?.permissions && Object.keys(entry.permissions).length)
      .map(([name, entry]) => [name, entry!.permissions])
  );
  // ⛔ 与 config.toml **同源**（09-20）：把总闸掩码一并反映到 UI。
  //    否则总闸关着时，界面显示「未设权限规则」而配置里那些工具已被 disabled_tools 摘掉
  //    —— 属于「显示侧与落盘不一致」，本项目修过同类 bug（供应商启用态、本地地址判定）。
  const appSettings = await readAppSettings(app.getPath("userData"));
  return withNuphusMasks(view as Record<string, Record<string, "deny" | "ask" | "allow">>, {
    desktop: appSettings.desktopAutomation !== false,
    browser: appSettings.browserAutomation !== false,
  });
});

ipcMain.handle("mcp-servers:set-tool-permission", async (_event, input: { server?: unknown; tool?: unknown; mode?: unknown }) => {
  const serverId = String(input.server ?? "").trim();
  const tool = String(input.tool ?? "").trim();
  if (!serverId || !tool) throw new Error("缺少服务器名或工具名");
  const mode = input.mode == null ? null : String(input.mode);
  if (mode !== null && mode !== "deny" && mode !== "ask" && mode !== "allow") {
    throw new Error(`未知权限档位：${mode}（应为 deny/ask/allow，或传 null 清除）`);
  }
  const overrides = await readMcpOverrides();
  // 陌生服务器不落死记录：只在覆盖表已有记录或已知服务器上生效
  const connectors = await readConnectors();
  let knownExtra = new Set<string>();
  try {
    knownExtra = new Set(collectMcpServerNames(await fs.readFile(path.join(codexHome, "config.toml"), "utf8")));
  } catch { /* config.toml 不存在就当没有手工段 */ }
  const known = serverId === "nuphus" || connectors.some((c) => c.id === serverId) || (serverId in overrides) || knownExtra.has(serverId);
  if (!known) return { ok: true, updated: false, reason: "unknown-server" };

  const permissions = overrides[serverId]?.permissions ?? {};
  if (mode === null) {
    delete permissions[tool];
  } else {
    permissions[tool] = mode;
  }
  // 清空整表就删掉字段，保持覆盖表干净
  overrides[serverId] = { ...overrides[serverId], enabled: overrides[serverId]?.enabled !== false, toml: overrides[serverId]?.toml, ...(Object.keys(permissions).length ? { permissions } : {}) };
  await writeMcpOverrides(overrides);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else await server.restart();
  return { ok: true, updated: true, server: serverId, tool, mode };
});
