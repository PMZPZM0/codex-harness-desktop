/**
 * feishu-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：feishu(5)
 * 通道：feishu:connect / feishu:logout / feishu:qr-start / feishu:qr-status / feishu:qr-cancel
 *
 * 扫码登录的状态机在 `../feishu-qr-connect`（与 qq 同构、各自独立实现），本域只做 IPC 面。
 */
import { feishuQrCancel, feishuQrSnapshot, feishuQrStart } from "../feishu-qr-connect";
import { channelBotBindings, feishuGateway, writeBotBindings } from "./im-gateways";
import { qrSvg } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const feishuFeature = defineFeature<null>({
  id: "feishu",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("feishu: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("feishu:connect", async (_event, appId: string, appSecret: string) => {
      try { return { ...(await feishuGateway.connect(String(appId ?? ""), String(appSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
    });
    ipcHost.handle("feishu:logout", async () => { feishuGateway.logout(); channelBotBindings.feishu = null; await writeBotBindings(); return { ok: true }; });
    ipcHost.handle("feishu:qr-start", async () => {
      try {
        return await feishuQrStart(
          async (appId, appSecret) => feishuGateway.connect(appId, appSecret),
          (text) => qrSvg(text),
        );
      } catch (error: any) {
        return { state: "failed", error: error.message };
      }
    });
    ipcHost.handle("feishu:qr-status", () => feishuQrSnapshot());
    ipcHost.handle("feishu:qr-cancel", () => { feishuQrCancel(); return { ok: true }; });

    ctx.effect(() => {
      for (const ch of ["feishu:connect", "feishu:logout", "feishu:qr-start", "feishu:qr-status", "feishu:qr-cancel"]) {
        ipcHost.removeHandler(ch);
      }
    });
  },
});
