/**
 * expert-teams 的「team-file-io」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { capabilitiesOf } from "./08-team-capabilities";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExpertTeamConfig } from "./01-team-types";
import { reaServerScript } from "../toolchain";
let teamsFile = "";

/** 设置专家团档案文件路径（启动链按 userData 注入）。 */
export function setExpertTeamsFile(file: string) {
  teamsFile = file;
}

/** 读当前专家团档案文件路径。 */
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
    if (!Array.isArray(list)) return [];
    /* 11-18：在这里**一次性**补齐 tools/skills（档案里没写就按主理人名查能力表）。
       ⛔ 只补内存、不写盘：用户档案保持原样，删掉本段也不会丢数据。
       ⛔ 不要在消费方（列表/卡片/调度）各补一次 —— 会立刻漂。 */
    return list.map((team) => {
      const caps = capabilitiesOf(team);
      return { ...team, tools: caps.tools, skills: caps.skills };
    });
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

/** 整份写回专家团档案（先建目录，保持缩进）。 */
export async function writeExpertTeams(list: ExpertTeamConfig[]) {
  await mkdir(path.dirname(teamsFile), { recursive: true });
  await writeFile(teamsFile, JSON.stringify(list, null, 2), "utf8");
}
