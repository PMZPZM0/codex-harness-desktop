/**
 * media-desk 域：自媒体工作台（11-09）。
 *
 * 界面与流程 = 开源 dsh-media-desk 2.6.2 **原样嵌入**（客户端 bundle + 宿主源码随包，MIT），
 * 主进程只提供宿主适配与一个本地服务（electron/features/media-desk/embed.ts）。
 * 通道：media-desk:endpoint（拿本地页面地址）/ media-desk:popout（开独立窗口，尺寸跟随主窗口）/
 * Codex 工具走 embed 的 mediaDeskRequest（与界面同一份数据/流程），不经过这里。
 * ⛔ 密钥走宿主 secure 接缝（守卫【266】）；app.getPath 只在调用时求值（守卫【91】）。
 */
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import type { HostCaps } from "../../runtime/seams";
import { ensureMediaDeskServer, restartMediaDeskServer, setMediaDeskSecure } from "./embed";
import { checkMediaDeskUpdate, installMediaDeskVersion, mediaDeskVersionInfo } from "./vendor";
import { createMediaDeskPopoutWindow } from "../window-factory";

const CHANNELS = ["media-desk:endpoint", "media-desk:popout", "media-desk:version", "media-desk:check-update", "media-desk:update"] as const;

export const mediaDeskFeature = defineFeature<null>({
  id: "media-desk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("media-desk: 缺少 ipc 服务（宿主未提供）");
    setMediaDeskSecure(ctx.get<HostCaps>("host")?.secure ?? null);
    ipcHost.handle("media-desk:endpoint", () => ensureMediaDeskServer());
    ipcHost.handle("media-desk:popout", () => createMediaDeskPopoutWindow());

    /* 11-16 用户令：控制台里能更新工作台，更新后自适应现有布局（页面由渲染层重载 iframe）。
       ⛔ 更新只落 userData，不动随包资源；⛔ 不在这里判版本新旧（判断在 vendor 里，单一真相源）。 */
    ipcHost.handle("media-desk:version", () => mediaDeskVersionInfo());
    ipcHost.handle("media-desk:check-update", () => checkMediaDeskUpdate());
    ipcHost.handle("media-desk:update", async (_event: unknown, input?: { version?: string }) => {
      try {
        const latest = String(input?.version ?? "").trim() || (await checkMediaDeskUpdate()).latest;
        const installed = await installMediaDeskVersion(latest);
        /* 起新服务（读新目录）：返回的地址带新令牌前缀，渲染层据此重载 iframe。 */
        const endpoint = await restartMediaDeskServer();
        return { ok: true, version: installed.version, endpoint };
      } catch (error) {
        return { ok: false, error: String((error as { message?: unknown } | null)?.message ?? error) };
      }
    });
    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
      setMediaDeskSecure(null);
    });
  },
});
