/**
 * main 的「mcp-overrides」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import fs from "node:fs/promises";
import { mcpOverridesFile } from "../runtime-paths";
// —— app-server MCP 启停覆盖表 ——
// app-server 回报的 MCP 分两类：harness 自己的连接器（connectors.json），
// 以及引擎直管的服务器（内置 nuphus、用户手工写进 config.toml 的段落）。
// 后者没有连接器记录，用这张表记住启用/停用，写 config.toml 时按它决定是否输出该段。
//
// 除了服务器级启停，还支持按工具的权限规则（deny/ask/allow）。
// ⛔ 09-16 实证纠正（原实现整个走错了路）：引擎**没有** per-tool 的「工具 → deny/ask/allow」
// 配置机制。旧实现把规则写成 `[permissions.allow]` + `"mcp__x__y" = true`，两个后果都致命：
//   ① 引擎的 `PermissionProfileToml` 只有 description/extends/workspace_roots/filesystem/network
//      五个字段 → 工具规则被**静默丢弃**（档位名会出现在 permissionProfile/list 里，那只是
//      「段头名」，与段内容无关 —— 旧注释据此误判成「格式正确」）；
//   ② 只写 `[permissions.*]` 而不写顶层 `default_permissions` → 引擎判定**整份配置非法**
//      （stderr `Invalid configuration; using defaults`；`config/read` / `mcpServerStatus/list`
//      随后全挂），而 harness 从来不写 default_permissions ⇒ 点一下权限格就把配置打废。
// 现在改走引擎真正支持的键（真实 app-server + 最小 stdio MCP 实证）：
//   deny  → `disabled_tools = [...]`：工具从引擎工具表里消失（模型看不到 = 真阻断）
//   ask   → `[mcp_servers.X.tools.<工具>] approval_mode = "prompt"`（引擎侧审批档位）
//   allow → 同上的 `approval_mode = "auto"`
/** 单工具的权限档位；deny = 不暴露给模型，ask = 引擎侧要审批，allow = 直接放行 */
type McpToolPermission = "deny" | "ask" | "allow";

type McpOverrideEntry = {
  enabled: boolean;
  /** 停用前的整段 config.toml 原文；只有用户手工写进 config.toml 的 MCP 才需要 */
  toml?: string;
  /** 按工具名的权限规则（deny 硬阻断 / ask 需审批 / allow 直接放行） */
  permissions?: Record<string, McpToolPermission>;
};

export type McpOverrides = Record<string, McpOverrideEntry>;

export async function readMcpOverrides(): Promise<McpOverrides> {
  try {
    const raw = JSON.parse(await fs.readFile(mcpOverridesFile, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as McpOverrides) : {};
  } catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

export async function writeMcpOverrides(value: McpOverrides) { await fs.writeFile(mcpOverridesFile, JSON.stringify(value, null, 2), "utf8"); }

/** 没记过的一律视为启用，只有显式写了 false 才算停用 */
export function mcpOverrideEnabled(overrides: McpOverrides, id: string) { return overrides[id]?.enabled !== false; }
