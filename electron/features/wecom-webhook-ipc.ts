/**
 * wecom-webhook-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：wecom-webhook(3)
 * 通道：wecom-webhook:connect / wecom-webhook:logout / wecom-webhook:test
 *
 * 企业微信机器人走**群机器人 Webhook**（只出不进），故没有登录态轮询，也没有 bot-binding 解绑。
 */
import { wecomWebhookGateway } from "./im-gateways";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const wecomWebhookFeature = defineFeature<null>({
  id: "wecom-webhook",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("wecom-webhook: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("wecom-webhook:connect", async (_event, url: string) => {
      try { return { ...(await wecomWebhookGateway.connect(String(url ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
    });
    ipcHost.handle("wecom-webhook:logout", async () => { wecomWebhookGateway.logout(); return { ok: true }; });
    ipcHost.handle("wecom-webhook:test", async (_event, text: string) => {
      try { await wecomWebhookGateway.sendMarkdown(String(text ?? "测试推送")); return { ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
    });

    ctx.effect(() => {
      ipcHost.removeHandler("wecom-webhook:connect");
      ipcHost.removeHandler("wecom-webhook:logout");
      ipcHost.removeHandler("wecom-webhook:test");
    });
  },
});
