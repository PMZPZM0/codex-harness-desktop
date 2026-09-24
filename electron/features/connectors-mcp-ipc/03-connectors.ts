/**
 * connectors-mcp-ipc 的「connectors」部分（09-22 从同目录 connectors-mcp-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import http from "node:http";
import { app, ipcMain, safeStorage, session, shell } from "electron";
import { BUILTIN_CONNECTOR_TEMPLATES } from "../../features/connector-templates";
import { applyCustomModel, connectorEnv, connectorsFile, mcpOverrideEnabled, oauthSessions, readConnectors, readCustomModel, readMcpOverrides, refreshSkillDiscipline, safeConnectorId, writeMcpOverrides } from "../../main";
import { codexHome, server } from "../../runtime-refs";
import type { ConnectorConfig, ConnectorTransport } from "../../main";
import { publicConnector, writeConnectors } from "./01-prompt-enhance";
ipcMain.handle("connectors:list", async () => (await readConnectors()).map(publicConnector));

ipcMain.handle("connectors:templates", () => BUILTIN_CONNECTOR_TEMPLATES);

ipcMain.handle("connectors:save", async (_event, input: any) => {
  const id = safeConnectorId(String(input.id ?? input.name ?? ""));
  const name = String(input.name ?? "").trim();
  const transport: ConnectorTransport = input.transport === "streamable_http" ? "streamable_http" : "stdio";
  if (!id || !name) throw new Error("连接器名称不能为空");
  const command = String(input.command ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (transport === "stdio" && !command) throw new Error("stdio 连接器必须填写启动命令");
  if (transport === "streamable_http") {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("HTTP MCP 地址不是合法 URL"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("HTTP MCP 地址必须使用 http 或 https");
  }
  const list = await readConnectors();
  const previous = list.find((entry) => entry.id === id);
  const secrets: Record<string, string> = Object.fromEntries(Object.entries(input.secrets ?? {}).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => Boolean(key && value)) as [string, string][]);
  if (Object.keys(secrets).length && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存连接器密钥");
  const encryptedSecrets = { ...(previous?.encryptedSecrets ?? {}), ...Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")])) };
  const config: ConnectorConfig = {
    id, name, transport, command: transport === "stdio" ? command : undefined,
    args: transport === "stdio" ? (Array.isArray(input.args) ? input.args.map((value: unknown) => String(value).trim()).filter(Boolean) : []) : undefined,
    url: transport === "streamable_http" ? url : undefined,
    headers: transport === "streamable_http" && input.headers && typeof input.headers === "object" ? Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    envHttpHeaders: transport === "streamable_http" && input.envHttpHeaders && typeof input.envHttpHeaders === "object" ? Object.fromEntries(Object.entries(input.envHttpHeaders).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    env: transport === "stdio" && input.env && typeof input.env === "object" ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    encryptedSecrets, enabled: input.enabled === undefined ? previous?.enabled ?? true : Boolean(input.enabled), createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await writeConnectors([...list.filter((entry) => entry.id !== id), config]);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(await readConnectors())); await server.restart(); }
  void refreshSkillDiscipline();
  return publicConnector(config);
});

ipcMain.handle("connectors:remove", async (_event, id: string) => {
  const list = await readConnectors();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) throw new Error("未找到连接器");
  await writeConnectors(next);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  void refreshSkillDiscipline();
  return { ok: true };
});

ipcMain.handle("connectors:set-enabled", async (_event, input: { ids?: unknown; enabled?: unknown }) => {
  const ids = Array.isArray(input.ids)
    ? input.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) throw new Error("未指定要更新状态的连接器");
  const enabled = input.enabled !== false;
  const list = await readConnectors();
  let updated = 0;
  const next = list.map((entry) => {
    if (!ids.includes(entry.id) || entry.enabled === enabled) return entry;
    updated += 1;
    return { ...entry, enabled, updatedAt: new Date().toISOString() };
  });
  if (!updated) return { ok: true, updated: 0 };
  await writeConnectors(next);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  void refreshSkillDiscipline();
  return { ok: true, updated };
});
