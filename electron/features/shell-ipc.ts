/**
 * shell-ipc（10-03 从 `features/shell-misc-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：shell(1)
 * 通道：shell:reveal（在文件管理器中定位文件/目录）
 *
 * ⛔⛔ 安全边界（09-19 审计中危，**本次改造不放宽**）：目标必须落在可信根内（含根本身 ——
 *    reveal 工作区 / userData 目录是合法用法）。渲染层传来的路径不可信，不校验就等于能
 *    系统级打开任意目录。校验口径唯一真相源 = `isInsideOrEqualTrustedRoots`。
 *
 * ⛔ 待接缝化（阶段 2）：`shell` 与 `fs` 是宿主能力，将来经 `"shell"` / `"fs"` 接缝注入。
 */
import { shell } from "electron";
import fs from "node:fs/promises";
import { isInsideOrEqualTrustedRoots } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const shellFeature = defineFeature<null>({
  id: "shell",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("shell: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("shell:reveal", async (_event, target: string) => {
      if (!target) return;
      // ⛔ 隐私加固（09-19 审计中危）：目标必须落在可信根内（含根本身——reveal 工作区 /
      // userData 目录是合法用法）。渲染层传来的路径不可信，不校验就等于能系统级打开任意目录。
      if (!isInsideOrEqualTrustedRoots(target)) throw new Error("仅允许打开会话工作区与应用数据目录");
      // 目录用 openPath 在文件管理器打开；文件用 showItemInFolder 定位
      try {
        const st = await fs.stat(target);
        if (st.isDirectory()) await shell.openPath(target);
        else shell.showItemInFolder(target);
      } catch {
        shell.showItemInFolder(target);
      }
    });

    ctx.effect(() => {
      ipcHost.removeHandler("shell:reveal");
    });
  },
});
