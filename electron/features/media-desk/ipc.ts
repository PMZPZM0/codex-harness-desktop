/**
 * media-desk 域：自媒体工作台（11-09）。
 *
 * 界面与流程 = 开源 dsh-media-desk 2.6.2 **原样嵌入**（客户端 bundle + 宿主源码随包，MIT），
 * 主进程只提供宿主适配与一个本地服务（electron/features/media-desk/embed.ts）。
 * 通道：media-desk:endpoint（拿本地页面地址，渲染层用 iframe 打开）。
 * Codex 工具走 embed 的 mediaDeskRequest（与界面同一份数据/流程），不经过这里。
 * ⛔ 密钥走宿主 secure 接缝（守卫【266】）；app.getPath 只在调用时求值（守卫【91】）。
 */
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import type { HostCaps } from "../../runtime/seams";
import { ensureMediaDeskServer, setMediaDeskSecure } from "./embed";

const CHANNELS = ["media-desk:endpoint"] as const;

export const mediaDeskFeature = defineFeature<null>({
  id: "media-desk",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("media-desk: 缺少 ipc 服务（宿主未提供）");
    setMediaDeskSecure(ctx.get<HostCaps>("host")?.secure ?? null);
    ipcHost.handle("media-desk:endpoint", () => ensureMediaDeskServer());
    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
      setMediaDeskSecure(null);
    });
  },
});
