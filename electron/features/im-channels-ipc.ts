/**
 * im-channels-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：bot-binding(2) / bots(2) / bot-stream(2) / bot(7) / channel-bot(3) / weixin(5) / telegram(3) / channels(1) / feishu(5) / dingtalk(2) / qq(5) / wecom-webhook(3) / ponytail(2)
 * 通道：bot-binding:get / bot-binding:set / bot-stream:get / bot-stream:set / bot:approve / bot:bind-consume / bot:bind-qrcode / bot:bind-status / bot:deny / bot:pair-state / bot:revoke / bots:get / bots:set / channel-bot:read / channel-bot:save / channel-bot:test / channels:status / dingtalk:connect / dingtalk:logout / feishu:connect / feishu:logout / feishu:qr-cancel / feishu:qr-start / feishu:qr-status / ponytail:mode:get / ponytail:mode:set / qq:connect / qq:logout / qq:qr-cancel / qq:qr-start / qq:qr-status / telegram:connect / telegram:logout / telegram:status / wecom-webhook:connect / wecom-webhook:logout / wecom-webhook:test / weixin:cancel-login / weixin:logout / weixin:poll-login / weixin:start-login / weixin:status
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 本域未使用跨域可变状态。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import fs from "node:fs/promises";
import { ipcMain, safeStorage } from "electron";
import { readBotStreamSettings, writeBotStreamSettings } from "../bot-stream";
import { qqQrCancel, qqQrSnapshot, qqQrStart } from "../qq-qr-connect";
import { feishuQrCancel, feishuQrSnapshot, feishuQrStart } from "../feishu-qr-connect";
import { getPonytailMode, setPonytailMode } from "../ponytail-mode";
import type { BotStreamSettings } from "../bot-stream";
import type { ChannelBotConfig } from "../channel-bot";
import { botsFile, channelBotBindings, dingtalkGateway, feishuGateway, loadBotBindings, qqGateway, telegramBindings, telegramGateway, wecomWebhookGateway, weixinBindings, weixinGateway, writeBotBindings } from "../features/im-gateways";
import { readChannelBot } from "../main/04-connector-config";
import { botStreamFile, channelBotFile, channelLogs, qrSvg, server } from "../runtime-refs";
import { botPairing, channelBot, remote } from "../main";
import type { StoredChannelBot } from "../main";
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
ipcMain.handle("bot-binding:get", async () => { await loadBotBindings(); return channelBotBindings; });
ipcMain.handle("bots:get", async () => {
  try { return JSON.parse(await fs.readFile(botsFile(), "utf8")); } catch { return []; }
});
ipcMain.handle("bots:set", async (_e, list: unknown) => {
  const safe = Array.isArray(list) ? list : [];
  await fs.writeFile(botsFile(), JSON.stringify(safe, null, 2), "utf8");
  return { ok: true, count: safe.length };
});
ipcMain.handle("bot-binding:set", async (_e, input: { channel: string; threadId: string | null; title?: string }) => {
  await loadBotBindings();
  const key = ["wechat", "telegram", "feishu", "dingtalk", "qq"].includes(String(input?.channel)) ? String(input.channel) : "wechat";
  if (input?.threadId) {
    // 预验证：绑定前先 resume 一次，确认该会话真实可用——否则发消息时 resume 失败
    // 会被自动重置回新会话，表现为「选了老会话又被弹回去」
    try {
      await server.request("thread/resume", { threadId: String(input.threadId), excludeTurns: false });
    } catch (error: any) {
      throw new Error(`该会话无法恢复（${String(error?.message ?? error).slice(0, 80)}），请换一个会话，或先在主界面打开它确认存在`);
    }
    channelBotBindings[key] = { threadId: String(input.threadId), title: String(input.title ?? ""), updatedAt: Date.now() };
  } else {
    channelBotBindings[key] = null;
    // 解绑：同步清 per-user 缓存，保证下一条消息开新会话
    if (key === "wechat") { for (const [k] of [...weixinBindings]) if (!k.startsWith("tg:")) weixinBindings.delete(k); }
    else if (key === "telegram") { for (const [k] of [...weixinBindings]) if (k.startsWith("tg:")) weixinBindings.delete(k); telegramBindings.clear(); }
    else { const prefix = { feishu: "fs:", dingtalk: "dd:", qq: "qq:" }[key] ?? ""; if (prefix) for (const [k] of [...weixinBindings]) if (k.startsWith(prefix)) weixinBindings.delete(k); }
  }
  await writeBotBindings();
  return channelBotBindings[key];
});
ipcMain.handle("bot-stream:get", async () => readBotStreamSettings(botStreamFile));
ipcMain.handle("bot-stream:set", async (_event, input: BotStreamSettings) => {
  const settings = { enabled: Boolean(input?.enabled), thinking: Boolean(input?.thinking), tools: Boolean(input?.tools) };
  await writeBotStreamSettings(botStreamFile, settings);
  return settings;
});
ipcMain.handle("weixin:start-login", async () => {
  const result = await weixinGateway?.startLogin();
  if (!result?.qrcodeImg) return result;
  // iLink 的 qrcode_img_content 格式不固定：可能是裸 base64 图片、data URL 图片、
  // 或二维码内容文本（liteapp.weixin.qq.com/... 短链）。统一归一化成渲染端可直接
  // 使用的形式，避免裸 base64 被当成 HTML 注入导致二维码区域白屏：
  //   data:image → 原样返回（<img> 直接显示）
  //   裸 base64 图片 → 补 data:image/png;base64, 前缀（浏览器会嗅探真实格式）
  //   http URL / 短文本 → 内容文本，编码成 SVG 码
  const raw = String(result.qrcodeImg).trim();
  const compact = raw.replace(/\s+/g, "");
  const isBareB64 = compact.length > 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
  const qr = raw.startsWith("data:")
    ? raw
    : isBareB64
      ? `data:image/png;base64,${compact}`
      : await qrSvg(raw);
  return { ...result, qrcodeImg: qr };
});
ipcMain.handle("weixin:poll-login", async () => weixinGateway?.pollLogin());
ipcMain.handle("weixin:cancel-login", async () => {
  const gateway = weixinGateway as { cancelLogin?: () => Promise<void> | void } | null;
  try { await gateway?.cancelLogin?.(); } catch { /* 网关无 cancelLogin 时忽略 */ }
  return { ok: true };
});
ipcMain.handle("weixin:status", async () => ({ bound: weixinGateway?.hasSession() ?? false }));
ipcMain.handle("weixin:logout", async () => { await weixinGateway?.logout(); channelBotBindings.wechat = null; await writeBotBindings(); return { ok: true }; });
ipcMain.handle("telegram:logout", async () => { telegramGateway.logout(); channelBotBindings.telegram = null; await writeBotBindings(); return { ok: true }; });
ipcMain.handle("channels:status", async () => ({
  weixin: weixinGateway?.hasSession() ?? false,
  telegram: telegramGateway.hasSession(),
  feishu: feishuGateway.hasSession(),
  dingtalk: dingtalkGateway.hasSession(),
  qq: qqGateway.hasSession(),
  "wecom-webhook": wecomWebhookGateway.hasSession(),
}));
ipcMain.handle("telegram:connect", async (_event, token: string) => { try { return { ok: true, ...(await telegramGateway.connect(String(token ?? ""))) }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("telegram:status", async () => ({ bound: telegramGateway.hasSession() }));
ipcMain.handle("feishu:connect", async (_event, appId: string, appSecret: string) => { try { return { ...(await feishuGateway.connect(String(appId ?? ""), String(appSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("feishu:logout", async () => { feishuGateway.logout(); channelBotBindings.feishu = null; await writeBotBindings(); return { ok: true }; });
ipcMain.handle("dingtalk:connect", async (_event, clientId: string, clientSecret: string) => { try { return { ...(await dingtalkGateway.connect(String(clientId ?? ""), String(clientSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("dingtalk:logout", async () => { dingtalkGateway.logout(); channelBotBindings.dingtalk = null; await writeBotBindings(); return { ok: true }; });
ipcMain.handle("qq:connect", async (_event, appId: string, appSecret: string) => { try { return { ...(await qqGateway.connect(String(appId ?? ""), String(appSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("qq:qr-start", async () => {
  try {
    return await qqQrStart(
      async (appId, appSecret) => qqGateway.connect(appId, appSecret),
      (text) => qrSvg(text),
    );
  } catch (error: any) {
    return { state: "failed", error: error.message };
  }
});
ipcMain.handle("qq:qr-status", () => qqQrSnapshot());
ipcMain.handle("qq:qr-cancel", () => { qqQrCancel(); return { ok: true }; });
ipcMain.handle("qq:logout", async () => { qqQrCancel(); qqGateway.logout(); channelBotBindings.qq = null; await writeBotBindings(); return { ok: true }; });
ipcMain.handle("feishu:qr-start", async () => {
  try {
    return await feishuQrStart(
      async (appId, appSecret) => feishuGateway.connect(appId, appSecret),
      (text) => qrSvg(text),
    );
  } catch (error: any) {
    return { state: "failed", error: error.message };
  }
});
ipcMain.handle("feishu:qr-status", () => feishuQrSnapshot());
ipcMain.handle("feishu:qr-cancel", () => { feishuQrCancel(); return { ok: true }; });
ipcMain.handle("wecom-webhook:connect", async (_event, url: string) => { try { return { ...(await wecomWebhookGateway.connect(String(url ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("wecom-webhook:logout", async () => { wecomWebhookGateway.logout(); return { ok: true }; });
ipcMain.handle("wecom-webhook:test", async (_event, text: string) => { try { await wecomWebhookGateway.sendMarkdown(String(text ?? "测试推送")); return { ok: true }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("ponytail:mode:get", async () => getPonytailMode());
ipcMain.handle("ponytail:mode:set", async (_event, mode: string) => { await setPonytailMode(mode as any); return { mode }; });
ipcMain.handle("bot:pair-state", () => botPairing.state());
ipcMain.handle("bot:approve", (_event, rid: string) => ({ ok: botPairing.approve(String(rid)) }));
ipcMain.handle("bot:deny", (_event, rid: string) => ({ ok: botPairing.deny(String(rid)) }));
ipcMain.handle("bot:revoke", (_event, key: string) => { const [channel, ...rest] = String(key).split(":"); return { ok: botPairing.revoke(channel, rest.join(":")) }; });
let lastBindSession = "";
ipcMain.handle("bot:bind-qrcode", async (_event, botId: string, botName: string) => {
  lastBindSession = remote.createBindSession(botId, botName);
  const code = lastBindSession.match(/\/r\/([a-z0-9]+)\?/)?.[1] ?? "";
  return { qr: await qrSvg(lastBindSession), url: lastBindSession, code };
});
ipcMain.handle("bot:bind-status", (_event, code: string) => remote.bindStatus(code));
ipcMain.handle("bot:bind-consume", (_event, code: string) => remote.consumeBind(code));
ipcMain.handle("channel-bot:read", async () => publicChannelBot(await readChannelBot()));
ipcMain.handle("channel-bot:save", (_event, input: unknown) => saveChannelBot(input));
ipcMain.handle("channel-bot:test", async (_event, input: unknown) => {
  const config = await normalizeChannelBot(input);
  if (!config.appId || !config.appSecret) throw new Error("测试连接需要 App ID 和 App Secret");
  return channelBot.test(config);
});
