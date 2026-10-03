/**
 * external-ipc（10-03 从 `features/shell-misc-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：external(1)
 * 通道：external:open（用系统默认浏览器打开外链）
 *
 * ⛔ 安全边界（不在本次改造里放宽）：只允许 http/https，或经 `filePreviewAllowed` 放行的
 *    本地预览地址 —— 渲染层传来的 URL 不可信，放宽等于能打开任意协议。
 *
 * ⛔ 待接缝化（阶段 2）：`shell` 是宿主能力，将来经 `"shell"` 接缝注入。
 * ⛔ `filePreviewAllowed` 经 `../main` 活绑定取用，且**只在 handler 回调内求值**（【91】防线）。
 */
import { shell } from "electron";
import { filePreviewAllowed } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const externalFeature = defineFeature<null>({
  id: "external",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("external: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("external:open", async (_event, value: string) => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:" && !filePreviewAllowed(url)) throw new Error("Unsupported URL");
      await shell.openExternal(url.toString());
    });

    ctx.effect(() => {
      ipcHost.removeHandler("external:open");
    });
  },
});
