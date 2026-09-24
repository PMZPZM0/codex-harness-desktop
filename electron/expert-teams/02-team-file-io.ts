/**
 * expert-teams 的「team-file-io」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExpertTeamConfig } from "./01-team-types";
let teamsFile = "";

export function setExpertTeamsFile(file: string) {
  teamsFile = file;
}

export function getExpertTeamsFile() {
  return teamsFile;
}

export async function readExpertTeams(): Promise<ExpertTeamConfig[]> {
  try {
    const list = JSON.parse(await readFile(teamsFile, "utf8")) as ExpertTeamConfig[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeExpertTeams(list: ExpertTeamConfig[]) {
  await mkdir(path.dirname(teamsFile), { recursive: true });
  await writeFile(teamsFile, JSON.stringify(list, null, 2), "utf8");
}
