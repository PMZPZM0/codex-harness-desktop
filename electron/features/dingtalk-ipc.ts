/**
 * dingtalk-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：dingtalk(2)
 * 通道：dingtalk:connect / dingtalk:logout
 */
import { channelBotBindings, dingtalkGateway, writeBotBindings } from "./im-gateways";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const dingtalkFeature = defineFeature<null>({
  id: "dingtalk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("dingtalk: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("dingtalk:connect", async (_event, clientId: string, clientSecret: string) => {
      try { return { ...(await dingtalkGateway.connect(String(clientId ?? ""), String(clientSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
    });
    ipcHost.handle("dingtalk:logout", async () => { dingtalkGateway.logout(); channelBotBindings.dingtalk = null; await writeBotBindings(); return { ok: true }; });

    ctx.effect(() => {
      ipcHost.removeHandler("dingtalk:connect");
      ipcHost.removeHandler("dingtalk:logout");
    });
  },
});
