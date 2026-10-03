/**
 * qq-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：qq(5)
 * 通道：qq:connect / qq:qr-start / qq:qr-status / qq:qr-cancel / qq:logout
 *
 * ⛔ `logout` 必须先 `qqQrCancel()` 再 `qqGateway.logout()`：只 logout 会留下一个仍在轮询的扫码
 *    会话（表现为「已退出但还在弹二维码状态」）。顺序是修过的 bug，别简化。
 */
import { qqQrCancel, qqQrSnapshot, qqQrStart } from "../qq-qr-connect";
import { channelBotBindings, qqGateway, writeBotBindings } from "./im-gateways";
import { qrSvg } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const qqFeature = defineFeature<null>({
  id: "qq",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("qq: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("qq:connect", async (_event, appId: string, appSecret: string) => {
      try { return { ...(await qqGateway.connect(String(appId ?? ""), String(appSecret ?? ""))), ok: true }; } catch (error: any) { return { ok: false, error: error.message }; }
    });
    ipcHost.handle("qq:qr-start", async () => {
      try {
        return await qqQrStart(
          async (appId, appSecret) => qqGateway.connect(appId, appSecret),
          (text) => qrSvg(text),
        );
      } catch (error: any) {
        return { state: "failed", error: error.message };
      }
    });
    ipcHost.handle("qq:qr-status", () => qqQrSnapshot());
    ipcHost.handle("qq:qr-cancel", () => { qqQrCancel(); return { ok: true }; });
    ipcHost.handle("qq:logout", async () => { qqQrCancel(); qqGateway.logout(); channelBotBindings.qq = null; await writeBotBindings(); return { ok: true }; });

    ctx.effect(() => {
      for (const ch of ["qq:connect", "qq:qr-start", "qq:qr-status", "qq:qr-cancel", "qq:logout"]) {
        ipcHost.removeHandler(ch);
      }
    });
  },
});
