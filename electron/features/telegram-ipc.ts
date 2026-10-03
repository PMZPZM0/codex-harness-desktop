/**
 * telegram-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：telegram(3)
 * 通道：telegram:connect / telegram:logout / telegram:status
 *
 * ⛔ `connect` 的 try/catch 不能改成抛错：渲染层按返回值里的 `ok` 分支提示，抛出去会变成未捕获异常
 *    （换容器不许改对外契约 —— 返回形状 `{ ok, error }` 逐字保留）。
 */
import { channelBotBindings, telegramGateway, writeBotBindings } from "./im-gateways";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const telegramFeature = defineFeature<null>({
  id: "telegram",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("telegram: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("telegram:logout", async () => { telegramGateway.logout(); channelBotBindings.telegram = null; await writeBotBindings(); return { ok: true }; });
    ipcHost.handle("telegram:connect", async (_event, token: string) => {
      try { return { ok: true, ...(await telegramGateway.connect(String(token ?? ""))) }; } catch (error: any) { return { ok: false, error: error.message }; }
    });
    ipcHost.handle("telegram:status", async () => ({ bound: telegramGateway.hasSession() }));

    ctx.effect(() => {
      ipcHost.removeHandler("telegram:connect");
      ipcHost.removeHandler("telegram:logout");
      ipcHost.removeHandler("telegram:status");
    });
  },
});
