/**
 * scratch-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：scratch(1)
 * 通道：scratch:create（开一个临时工作目录）
 *
 * ⛔⛔ root 一律 `userData`（09-22 实测教训）：旧实现用 exe 同级目录 —— 开发模式落在 dist/
 *    （构建即清，记忆全丢），打包后在 Program Files（无写权限）。userData 持久且必有写权限。
 * ⛔ 待接缝化（阶段 2）：app / fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const scratchFeature = defineFeature<null>({
  id: "scratch",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("scratch: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("scratch:create", async () => {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const name = `chat-${stamp}-${Date.now().toString(36)}`;
      /* ⛔ root 一律 userData（09-22 实测教训）：旧实现用 exe 同级目录 —— 开发模式落在
       * dist/（构建即清，记忆全丢），打包后在 Program Files（无写权限）。userData 持久且必有写权限。 */
      const dir = path.join(app.getPath("userData"), "scratch", name);
      await fs.mkdir(dir, { recursive: true });
      return dir;
    });

    ctx.effect(() => {
      ipcHost.removeHandler("scratch:create");
    });
  },
});
