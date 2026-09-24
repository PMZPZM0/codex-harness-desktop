/**
 * engine-ipc 的「bridge」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
ipcMain.handle("bridge:status", async () => ({
  ...responsesBridge.status(),
  modes: responsesBridge.modesSnapshot(),
  // 「用户配了什么协议」（区别于 modes = 「实际跑成什么」）——排查"改了设置不生效"看这个
  configured: responsesBridge.configuredModes(),
}));
