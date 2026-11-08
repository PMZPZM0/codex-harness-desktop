/**
 * main 的「memory-mode」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readMemoryGateway } from "./08-channel-bot-io";
import { memoryModeFile, memoryWorkspaceFile } from "../runtime-paths";
import { memoryStore } from "../runtime-refs";
export type MemoryMode = "local" | "cloud";

/** 读记忆模式（local / cloud）；读不到或不认识一律按 local。 */
export async function readMemoryMode(): Promise<MemoryMode> {
  try { return JSON.parse(await fs.readFile(memoryModeFile, "utf8"))?.mode === "cloud" ? "cloud" : "local"; }
  catch { return "local"; }
}

/** 应用记忆模式：落盘 + 按模式设置记忆库的远程网关（cloud 时读网关配置，读不到就不设）。 */
export async function applyMemoryMode(mode: MemoryMode) {
  await fs.writeFile(memoryModeFile, JSON.stringify({ mode }, null, 2), "utf8");
  memoryStore.setRemote(mode === "cloud" ? await readMemoryGateway() ?? undefined : undefined);
  return mode;
}

/** 读「各工作区记忆开关」表；文件不存在或形状不对返回空表。 */
export async function readWorkspaceMemorySettings(): Promise<Record<string, boolean>> {
  try {
    const raw = JSON.parse(await fs.readFile(memoryWorkspaceFile, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, boolean> : {};
  } catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

/** 某个工作区的记忆是否开启：**只有显式关过才是 false**（老项目没记录保持开启，与既有行为一致）。 */
export async function workspaceMemoryEnabled(workspace?: string): Promise<boolean> {
  if (!workspace) return false;
  const settings = await readWorkspaceMemorySettings();
  // Keep existing behavior for projects that have never explicitly been disabled.
  return settings[path.resolve(workspace)] !== false;
}
