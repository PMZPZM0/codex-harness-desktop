/**
 * main 的「agents-plugins」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { FRESH_REVIEW_ID, freshReviewSpec } from "../builtin-agents";
import { builtinPluginsFile, subAgentsFile } from "../runtime-paths";
export type BuiltinPluginConfig = {
  image?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
  vision?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
};

export async function readBuiltinPlugins(): Promise<BuiltinPluginConfig> {
  try { return JSON.parse(await fs.readFile(builtinPluginsFile, "utf8")); } catch { return {}; }
}

export type SubAgentConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  effort: string;
  inheritModel: boolean;
  model?: string;
  inheritSandbox: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  inheritApproval: boolean;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function readSubAgents(): Promise<SubAgentConfig[]> {
  try {
    const list = JSON.parse(await fs.readFile(subAgentsFile, "utf8")) as SubAgentConfig[];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function writeSubAgents(list: SubAgentConfig[]) { await fs.writeFile(subAgentsFile, JSON.stringify(list, null, 2), "utf8"); }

/** 种入内置「评审」子智能体（新鲜上下文复审）。
 *  **幂等**：已存在就不动 —— 用户可能改过提示词、调过 effort 或直接停用它，那些都不该被覆盖。
 *  为什么用子智能体而不是新工具：见 electron/builtin-agents.ts —— 复用整条委派链路
 *  （含防套娃/独占锁/身份闸），且它在界面上看得见、改得动、停得了。 */
export async function ensureBuiltinReviewer() {
  const list = await readSubAgents();
  if (list.some((agent) => agent.id === FRESH_REVIEW_ID)) return;
  const now = new Date().toISOString();
  await writeSubAgents([...list, { ...freshReviewSpec(), createdAt: now, updatedAt: now }]);
  console.log(`[reviewer] 已种入内置评审子智能体（${FRESH_REVIEW_ID}）：用干净上下文复审，写的人不审自己`);
}
