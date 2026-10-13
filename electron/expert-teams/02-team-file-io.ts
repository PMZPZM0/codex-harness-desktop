/**
 * expert-teams 的「team-file-io」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExpertTeamConfig } from "./01-team-types";
import { reaServerScript } from "../toolchain";
let teamsFile = "";

export function setExpertTeamsFile(file: string) {
  teamsFile = file;
}

export function getExpertTeamsFile() {
  return teamsFile;
}

/** requiresTool 的可用性判据（2026-10-13 用户令「下载后，才可以用这个专家」）：
 *  目前唯一依赖工具 = rea（REA 逆向分析，开发工具页按需装）。 */
export function toolAvailable(tool: string): boolean {
  if (tool === "rea") return Boolean(reaServerScript());
  return true;
}

/** 原始读（⛔ 存档口径）：**不过滤** —— expert_save 等**写路径**必须用这份，
 *  否则「REA 未装时保存任何专家」会把隐藏的依赖型专家从存档里永久删掉。 */
export async function readExpertTeams(): Promise<ExpertTeamConfig[]> {
  try {
    const list = JSON.parse(await readFile(teamsFile, "utf8")) as ExpertTeamConfig[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 可用读（⛔ 呈现口径）：在原始读之上按 requiresTool 过滤。列表 / 调度 / 会话配置 / expert_list
 *  这些**呈现与消费方**一律用这份 —— 过滤只在这一处写，不许各消费方再抄一遍。 */
export async function readUsableExpertTeams(): Promise<ExpertTeamConfig[]> {
  const list = await readExpertTeams();
  return list.filter((entry) => !entry.requiresTool || toolAvailable(entry.requiresTool));
}

export async function writeExpertTeams(list: ExpertTeamConfig[]) {
  await mkdir(path.dirname(teamsFile), { recursive: true });
  await writeFile(teamsFile, JSON.stringify(list, null, 2), "utf8");
}
