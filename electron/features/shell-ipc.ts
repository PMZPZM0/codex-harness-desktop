/**
 * shell-ipc（10-03 从 `features/shell-misc-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：shell(1)
 * 通道：shell:reveal（在文件管理器中定位文件/目录）
 *
 * ⛔⛔ 安全边界（09-19 审计中危，**本次改造不放宽**）：目标必须落在可信根内（含根本身 ——
 *    reveal 工作区 / userData 目录是合法用法）。渲染层传来的路径不可信，不校验就等于能
 *    ⛔ 10-29 用户令后本域**不再判可信根**：预览/编辑/打开一律直通（见 fs-ipc 头部同一条说明）。
 *
 * ⛔ 待接缝化（阶段 2）：`shell` 与 `fs` 是宿主能力，将来经 `"shell"` / `"fs"` 接缝注入。
 */
import { shell } from "electron";
import fs from "node:fs/promises";

import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

export const shellFeature = defineFeature<null>({
  id: "shell",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("shell: 缺少 ipc 服务（宿主未提供）");
    /* ⛔ 窗口能力走接缝（守卫【266】：域不经接缝直取 BrowserWindow = 0 容忍）——
       接缝只给「按调用者 webContents 反查自己的窗口」，不给任意窗口 id。 */
    const host = ctx.get<HostCaps>("host");
    if (!host) throw new Error("shell: 缺少 host 接缝（宿主未提供）");

    ipcHost.handle("shell:reveal", async (_event, target: string) => {
      if (!target) return;
      /* ⛔ 10-29 用户令：定位不再判可信根（与预览同口径 —— 能看就能在资源管理器里找到）。 */
      // 目录用 openPath 在文件管理器打开；文件用 showItemInFolder 定位
      try {
        const st = await fs.stat(target);
        if (st.isDirectory()) await shell.openPath(target);
        else shell.showItemInFolder(target);
      } catch {
        shell.showItemInFolder(target);
      }
    });

    /* 10-22 文件卡「默认应用」：用系统关联程序打开文件/目录。
       ⛔ 10-29 起与 shell:reveal 一样不再判可信根（用户：不管哪里的文件都要能打开）。 */
    ipcHost.handle("shell:open", async (_event, target: string) => {
      if (!target) return;
      /* ⛔ 10-29 用户令：不再判可信根（用户原话「不用授权弹窗，不管哪里的文件都要能预览和编辑」）。
         原来这里越界只抛一句中文，用户点「用默认应用打开」没有任何可走通的路。 */
      const openErr = await shell.openPath(target);
      if (openErr) throw new Error(openErr);
    });

    /* 无边框窗（win32 大圆角）的自定义窗口按钮：只操作**调用者自己的窗口**，不接任意 hwnd。 */
    const winOf = (event: any) => host.window.fromWebContents(event.sender);
    ipcHost.handle("shell:window-minimize", (event) => { winOf(event)?.minimize(); return { ok: true }; });
    ipcHost.handle("shell:window-toggle-maximize", (event) => {
      const win = winOf(event);
      if (!win) return { maximized: false };
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
      return { maximized: win.isMaximized() };
    });
    ipcHost.handle("shell:window-close", (event) => { winOf(event)?.close(); return { ok: true }; });
    ipcHost.handle("shell:window-state", (event) => ({ maximized: Boolean(winOf(event)?.isMaximized()) }));

    ctx.effect(() => {
      ipcHost.removeHandler("shell:reveal");
      ipcHost.removeHandler("shell:open");
      for (const ch of ["shell:window-minimize", "shell:window-toggle-maximize", "shell:window-close", "shell:window-state"]) ipcHost.removeHandler(ch);
    });
  },
});
