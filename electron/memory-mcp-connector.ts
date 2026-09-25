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
import { bundledNodePath, effectiveMemoryBackend, localMemoryMcpServerPath } from "./memory-backend";
import { connectorsFile } from "./runtime-paths";

export const LOCAL_MEMORY_CONNECTOR_ID = "local-memory";

type SyncResult = "enabled" | "disabled" | "absent";

/** 期望的连接器形态：**用应用自带的 node** 当 runner。
 *
 *  ⛔ 为什么不能用 electron.exe（老做法 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`）：
 *     better-sqlite3 按 ABI 取预编译产物 —— Electron 43 = 149、自带 node 24 = 137，
 *     用错一个就 `Could not locate the bindings file`，引擎侧直接报「local-memory 启动失败」。
 *     装（安装器）与跑（连接器）都用自带 node，ABI 才自洽（09-25 真机踩到）。
 *  自带 node 缺失时退回过路（能跑通但 ABI 可能不匹配）—— 只在异常环境兜底。 */
function expectedShape(): { command: string; env: Record<string, string> } {
  const nodeExe = bundledNodePath();
  const dbEnv = { MEMORY_DB_PATH: path.join(app.getPath("userData"), "memory-mcp", "memory.db") };
  if (existsSync(nodeExe)) return { command: nodeExe, env: dbEnv };
  return { command: process.execPath, env: { ...dbEnv, ELECTRON_RUN_AS_NODE: "1" } };
}

/** 按生效后端同步 `local-memory` 连接器的启用态。返回最终动作（便于日志与断言）。
 *  ⛔ 幂等判据是「**形态 + 启用态**都一致才不写盘」—— 只比 enabled 的话，老版本写下的
 *     electron.exe 形态会永远留在盘上（正是 09-25「装好了还是启动失败」的现场）。 */
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
  const shape = expectedShape();
  const expectedArgs = [localMemoryMcpServerPath()];

  if (idx >= 0) {
    const cur: any = list[idx];
    const curEnv = cur.env ?? {};
    const sameShape =
      cur.command === shape.command &&
      JSON.stringify(cur.args ?? []) === JSON.stringify(expectedArgs) &&
      curEnv.MEMORY_DB_PATH === shape.env.MEMORY_DB_PATH &&
      Boolean(curEnv.ELECTRON_RUN_AS_NODE) === Boolean(shape.env.ELECTRON_RUN_AS_NODE);
    if (Boolean(cur.enabled) === want && sameShape) return want ? "enabled" : "disabled"; // 幂等
    list[idx] = { ...cur, command: shape.command, args: expectedArgs, env: shape.env, enabled: want, updatedAt: now };
  } else {
    list.push({
      id: LOCAL_MEMORY_CONNECTOR_ID,
      name: "本地记忆（MCP 记忆服务）",
      transport: "stdio",
      command: shape.command,
      args: expectedArgs,
      env: shape.env,
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
