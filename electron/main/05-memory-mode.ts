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

export async function readMemoryMode(): Promise<MemoryMode> {
  try { return JSON.parse(await fs.readFile(memoryModeFile, "utf8"))?.mode === "cloud" ? "cloud" : "local"; }
  catch { return "local"; }
}

export async function applyMemoryMode(mode: MemoryMode) {
  await fs.writeFile(memoryModeFile, JSON.stringify({ mode }, null, 2), "utf8");
  memoryStore.setRemote(mode === "cloud" ? await readMemoryGateway() ?? undefined : undefined);
  return mode;
}

export async function readWorkspaceMemorySettings(): Promise<Record<string, boolean>> {
  try {
    const raw = JSON.parse(await fs.readFile(memoryWorkspaceFile, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, boolean> : {};
  } catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

export async function workspaceMemoryEnabled(workspace?: string): Promise<boolean> {
  if (!workspace) return false;
  const settings = await readWorkspaceMemorySettings();
  // Keep existing behavior for projects that have never explicitly been disabled.
  return settings[path.resolve(workspace)] !== false;
}
