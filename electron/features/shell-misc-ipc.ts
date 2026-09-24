/**
 * shell-misc-ipc（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：**壳族杂项通道** —— 系统通知 / 防休眠 / 外链打开 / 在文件管理器定位。
 * 搬出符号：IPC handler notify:show、awake:set、external:open、shell:reveal，及其状态 awakeId。
 *
 * 跨域符号（mainWindow / filePreviewAllowed / isInsideOrEqualTrustedRoots）经 ../main 活绑定取用，
 * 且**只在 handler 回调内求值** ⇒ 模块体不碰跨域符号，不受 main.ts 模块体执行顺序影响（【91】防线）。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行（早于 whenReady）。
 */
import { Notification, ipcMain, powerSaveBlocker, shell } from "electron";
import fs from "node:fs/promises";
import { isInsideOrEqualTrustedRoots, mainWindow } from "../runtime-refs";
import { filePreviewAllowed } from "../main";


// 机器人扫码绑定：创建绑定会话二维码 + 渲染层轮询状态
let awakeId: number | null = null;

ipcMain.handle("notify:show", (_event, title: string, body: string) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title ?? "Codex Harness"), body: String(body ?? ""), silent: false });
  n.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
  n.show();
  return true;
});

ipcMain.handle("awake:set", (_event, on: boolean) => {
  if (on && awakeId == null) awakeId = powerSaveBlocker.start("prevent-app-suspension");
  if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  return awakeId != null;
});

ipcMain.handle("external:open", async (_event, value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:" && !filePreviewAllowed(url)) throw new Error("Unsupported URL");
  await shell.openExternal(url.toString());
});

// 放大查看：独立 BrowserWindow 弹出预览（右栏 BrowserPane 太窄时用），宽高可自由调整
ipcMain.handle("shell:reveal", async (_event, target: string) => {
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
