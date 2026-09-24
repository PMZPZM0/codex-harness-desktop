/**
 * main 的「channel-bot-io」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { ChannelBotService, type ChannelBotConfig } from "../channel-bot";
import { MemoryStore, type MemoryCategory, type MemoryRemoteConfig } from "../memory-store";
import { Scheduler } from "../scheduler";
import { decryptSecret } from "./07-connectors-io";
import { channelBotFile, memoryGatewayFile } from "../runtime-paths";
/** 供应商下的单个模型配置（图二弹窗编辑的字段） */


export type StoredChannelBot = Omit<ChannelBotConfig, "appSecret" | "verificationToken" | "encryptKey"> & {
  encryptedAppSecret?: string;
  encryptedVerificationToken?: string;
  encryptedEncryptKey?: string;
};

export type StoredMemoryGateway = Omit<MemoryRemoteConfig, "apiKey"> & { encryptedApiKey?: string };

export async function readStoredChannelBot(): Promise<StoredChannelBot | null> {
  try { return JSON.parse(await fs.readFile(channelBotFile, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}

export async function readMemoryGateway(): Promise<MemoryRemoteConfig | null> {
  try {
    const stored = JSON.parse(await fs.readFile(memoryGatewayFile, "utf8")) as StoredMemoryGateway;
    return { endpoint: stored.endpoint, sessionKey: stored.sessionKey, userId: stored.userId, apiKey: decryptSecret(stored.encryptedApiKey) };
  } catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}
