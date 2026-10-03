/**
 * channels-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：channels(1)
 * 通道：channels:status（各渠道登录态总览）
 *
 * ⚠️ 本域是**只读聚合视图**：它 import 了全部 IM 网关，但**只读取 `hasSession()`**，不写任何网关状态
 *    —— 这是它能独立成板块的前提（若它还要写状态，就说明与那些平台域耦合，不该拆开）。
 *    ⛔ 因此这里**不** `inject` 任何东西，也不持有可变状态。
 */
import { dingtalkGateway, feishuGateway, qqGateway, telegramGateway, wecomWebhookGateway, weixinGateway } from "./im-gateways";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const channelsFeature = defineFeature<null>({
  id: "channels",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("channels: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("channels:status", async () => ({
      weixin: weixinGateway?.hasSession() ?? false,
      telegram: telegramGateway.hasSession(),
      feishu: feishuGateway.hasSession(),
      dingtalk: dingtalkGateway.hasSession(),
      qq: qqGateway.hasSession(),
      "wecom-webhook": wecomWebhookGateway.hasSession(),
    }));

    ctx.effect(() => {
      ipcHost.removeHandler("channels:status");
    });
  },
});
