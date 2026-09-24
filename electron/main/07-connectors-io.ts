/**
 * main 的「connectors-io」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import fs from "node:fs/promises";
import { collectMcpServerNames, escapeTomlString, extractMcpSection, injectMcpToolRules, injectSectionExtras, preserveUserConfig, tomlBareKey, type McpToolRules } from "../config-toml";
import { connectorsFile } from "../runtime-paths";
export type ConnectorTransport = "stdio" | "streamable_http";

export type ConnectorConfig = {
  id: string;
  name: string;
  transport: ConnectorTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  env?: Record<string, string>;
  encryptedSecrets?: Record<string, string>;
  oauth?: { status: "connected"; provider: string; authorizedAt: number; accountHint?: string };
  // 停用的连接器不写入引擎 config.toml（等效于引擎看不到该 MCP），配置本身保留
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export function decryptSecret(value?: string) {
  return value && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, "base64")) : "";
}

/** TOML 字符串转义：实现统一收口在 config-toml.ts（预检能 require 编译产物直接测它）。
 *  ⛔ 09-16 修 Bug 5：旧实现只转义 `\` 与 `"`，换行/制表/控制字符原样落盘 →
 *  粘贴一个带尾换行的 base_url 就能让引擎整份配置拒载。 */
export const escapeToml = escapeTomlString;

/** 表头里的键名：TOML 裸键只允许 `A-Za-z0-9_-`，别的字符一律剔除（写进去只会让整份配置非法）。 */
export function safeConnectorId(value: string) { return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64); }

export async function readConnectors(): Promise<ConnectorConfig[]> {
  try {
    const list = JSON.parse(await fs.readFile(connectorsFile, "utf8"));
    return Array.isArray(list) ? list.filter((entry: any) => entry && typeof entry.id === "string" && typeof entry.name === "string") : [];
  } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
}
