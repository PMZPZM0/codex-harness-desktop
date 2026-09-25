/**
 * 本地 MCP 记忆服务 → 连接器同步（09-25）。
 *
 * 后端语义（与 `memory-backend.ts` 同源，两处必须一致）：
 *   - 生效后端 = "mcp" ⇒ 把 `local-memory` 连接器设为 **enabled**（harness 会把它写进引擎
 *     config.toml 的 `mcp_servers`）⇒ 引擎能看到并调用 MCP 记忆工具，写入走 MCP。
 *   - 生效后端 = "builtin" ⇒ 连接器 **enabled: false**（引擎看不到这套工具），
 *     写入走内置金字塔。
 *
 * ⛔ 为什么必须同源：两边不一致会出现「内置金字塔在写 + MCP 工具同时可见」⇒
 *    模型可能两边都写 = 双份记忆（用户 09-25 明确不要）。
 * ⛔ 幂等：状态已一致时**不写盘**（避免每次启动都重写 connectors.json，也避免
 *    在应用运行期间与渲染层的连接器保存操作打架）。
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { ConnectorConfig } from "./main/07-connectors-io";
import { effectiveMemoryBackend, localMemoryMcpServerPath } from "./memory-backend";
import { connectorsFile } from "./runtime-paths";

export const LOCAL_MEMORY_CONNECTOR_ID = "local-memory";

type SyncResult = "enabled" | "disabled" | "absent";

/** 按生效后端同步 `local-memory` 连接器的启用态。返回最终动作（便于日志与断言）。 */
export async function syncLocalMemoryConnector(): Promise<SyncResult> {
  const want = effectiveMemoryBackend() === "mcp";
  let list: ConnectorConfig[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(connectorsFile, "utf8"));
    if (Array.isArray(raw)) list = raw;
  } catch { /* 文件不存在或损坏：按空列表处理 */ }

  const idx = list.findIndex((entry: any) => entry && entry.id === LOCAL_MEMORY_CONNECTOR_ID);
  if (idx < 0 && !want) return "absent";

  const now = new Date().toISOString();
  if (idx >= 0) {
    if (Boolean(list[idx].enabled) === want) return want ? "enabled" : "disabled"; // 幂等：一致就不写盘
    list[idx] = { ...list[idx], enabled: want, updatedAt: now };
  } else {
    /* 首次注册：command 用**当前进程的可执行文件**。
       主进程里 process.execPath 是 electron(.exe) ⇒ 必须带 ELECTRON_RUN_AS_NODE=1，
       否则引擎 spawn 它会当成 GUI 应用再开一个窗口（而不是 MCP 服务器）。 */
    const exec = process.execPath;
    const isElectron = /electron(\.exe)?$/i.test(exec);
    list.push({
      id: LOCAL_MEMORY_CONNECTOR_ID,
      name: "本地记忆（MCP 记忆服务）",
      transport: "stdio",
      command: exec,
      args: [localMemoryMcpServerPath()],
      env: {
        ...(isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        MEMORY_DB_PATH: path.join(app.getPath("userData"), "memory-mcp", "memory.db"),
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    } as ConnectorConfig);
  }

  await fs.writeFile(connectorsFile, JSON.stringify(list, null, 2), "utf8");
  return want ? "enabled" : "disabled";
}

/** 服务入口是否就位（供 UI/诊断用；只判文件，不启进程）。 */
export function localMemoryConnectorReady(): boolean {
  return existsSync(localMemoryMcpServerPath());
}
