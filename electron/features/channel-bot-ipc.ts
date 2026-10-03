/**
 * channel-bot-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：channel-bot(3)
 * 通道：channel-bot:read / channel-bot:save / channel-bot:test
 *
 * 三个辅助函数（publicChannelBot / normalizeChannelBot / saveChannelBot）**只服务本域** ⇒ 随板块搬，
 *    不需要下沉到基座层 —— 这也是"按前缀拆"能保持内聚的证据。
 *
 * ⛔⛔ 安全边界（本次改造不放宽）：
 *   · 端口必须 1024–65535、host 只许 127.0.0.1 / 0.0.0.0（不许任意监听地址）；
 *   · 密钥经 `safeStorage` 加密落盘；读出一律**不回传明文**（只给 hasXxx 布尔位）；
 *   · 启用前必须填齐 workspace / appId / appSecret / verificationToken。
 */
import { safeStorage } from "electron";
import fs from "node:fs/promises";
import type { ChannelBotConfig } from "../channel-bot";
import { readChannelBot } from "../main/04-connector-config";
import { channelBotFile, channelLogs } from "../runtime-refs";
import { channelBot } from "../main";
import type { StoredChannelBot } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function publicChannelBot(config: ChannelBotConfig | null) {
  const defaults = { enabled: false, host: "127.0.0.1" as const, port: 8787, workspace: "", sandbox: "workspace-write" as const, appId: "" };
  const value = config ?? defaults;
  return {
    ...defaults,
    ...value,
    appSecret: undefined,
    verificationToken: undefined,
    encryptKey: undefined,
    hasAppSecret: Boolean(config?.appSecret),
    hasVerificationToken: Boolean(config?.verificationToken),
    hasEncryptKey: Boolean(config?.encryptKey),
    ...channelBot.status(),
    logs: channelLogs,
  };
}

async function normalizeChannelBot(input: any): Promise<ChannelBotConfig> {
  const previous = await readChannelBot();
  const host = input.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(input.port ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("回调端口必须在 1024 到 65535 之间");
  const config: ChannelBotConfig = {
    enabled: Boolean(input.enabled),
    host,
    port,
    workspace: String(input.workspace ?? "").trim(),
    sandbox: ["read-only", "danger-full-access"].includes(input.sandbox) ? input.sandbox : "workspace-write",
    appId: String(input.appId ?? "").trim(),
    appSecret: String(input.appSecret ?? "").trim() || previous?.appSecret || "",
    verificationToken: String(input.verificationToken ?? "").trim() || previous?.verificationToken || "",
    encryptKey: String(input.encryptKey ?? "").trim() || previous?.encryptKey || "",
  };
  if (config.enabled && (!config.workspace || !config.appId || !config.appSecret || !config.verificationToken)) throw new Error("启用前需填写工作区、App ID、App Secret 和 Verification Token");
  return config;
}

async function saveChannelBot(input: any) {
  const config = await normalizeChannelBot(input);
  if ((config.appSecret || config.verificationToken || config.encryptKey) && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存机器人密钥");
  const encrypt = (value: string) => value ? safeStorage.encryptString(value).toString("base64") : undefined;
  const stored: StoredChannelBot = {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    workspace: config.workspace,
    sandbox: config.sandbox,
    appId: config.appId,
    encryptedAppSecret: encrypt(config.appSecret),
    encryptedVerificationToken: encrypt(config.verificationToken),
    encryptedEncryptKey: encrypt(config.encryptKey),
  };
  await channelBot.configure(config);
  await fs.writeFile(channelBotFile, JSON.stringify(stored, null, 2), "utf8");
  return publicChannelBot(config);
}

export const channelBotFeature = defineFeature<null>({
  id: "channel-bot",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("channel-bot: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("channel-bot:read", async () => publicChannelBot(await readChannelBot()));
    ipcHost.handle("channel-bot:save", (_event, input: unknown) => saveChannelBot(input));
    ipcHost.handle("channel-bot:test", async (_event, input: unknown) => {
      const config = await normalizeChannelBot(input);
      if (!config.appId || !config.appSecret) throw new Error("测试连接需要 App ID 和 App Secret");
      return channelBot.test(config);
    });

    ctx.effect(() => {
      ipcHost.removeHandler("channel-bot:read");
      ipcHost.removeHandler("channel-bot:save");
      ipcHost.removeHandler("channel-bot:test");
    });
  },
});
