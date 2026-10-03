/**
 * notify-ipc（10-03 从 `features/shell-misc-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：notify(1)
 * 通道：notify:show
 *
 * 为什么拆出来：原 `shell-misc-ipc.ts` 一个板块承载 notify / awake / external / shell 四个前缀，
 * 违反「一个板块恒等于一个域前缀」（10-03 用户令：功能必须独立板块、不许巨型文件）。
 *
 * ⛔ 待接缝化（阶段 2）：`Notification` 是宿主能力，将来应经 `"notify"` 接缝注入（连同 awake 的
 *    powerSaveBlocker 一起）。当前能力接缝只有 `"ipc"` 一个，故仍直接 import —— 这里显式标注，
 *    **不假装已经接缝化**；接缝建立后只需改本文件的取用方式，组合表与对外契约不动。
 * ⛔ `mainWindow` 经 `../runtime-refs` 活绑定取用，且**只在 handler 回调内求值** ⇒ 模块体不碰跨域
 *    符号，不受 main.ts 模块体执行顺序影响（【91】防线）。
 *
 * 生命周期：通道在 `setup` 内注册、`ctx.effect` 内摘除；注册时机由组合表决定（本文件不自挂载）。
 */
import { Notification } from "electron";
import { mainWindow } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const notifyFeature = defineFeature<null>({
  id: "notify",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("notify: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("notify:show", (_event, title: string, body: string) => {
      if (!Notification.isSupported()) return false;
      const n = new Notification({ title: String(title ?? "Codex Harness"), body: String(body ?? ""), silent: false });
      n.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
      n.show();
      return true;
    });

    ctx.effect(() => {
      ipcHost.removeHandler("notify:show");
    });
  },
});
