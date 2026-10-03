/**
 * IPC 宿主服务（P0，2026-10-03）：把 `ipcMain` 封成容器里可注入的 `"ipc"` 服务。
 *
 * 判据（`docs/ARCHITECTURE-RULES.md` §1.1）：本文件**自己不暴露通道**（没有具体的 `ipcMain.handle("域:动作")`），
 * 只是给别人用的基础设施 ⇒ 属**基座层**，放 `electron/` 根、不进 `features/`。
 *
 * ⛔ 为什么域不许直接 `import { ipcMain } from "electron"`：那是宿主能力，一旦插件能随便拿，
 *    P3 的"白名单能力 + 权限分级"就无从谈起（插件能自己挂任意通道 = 绕过全部声明与校验）。
 *    所以能力**一律经容器注入**，插件只认 `IpcHost` 这个类型面。
 * ⛔ 通道的可发现性：死链守卫（`01-build-ipc-css.mjs`）按**字面量**收集 handler，所以域里注册通道
 *    一律写 `ipcHost.handle("域:动作", …)` —— 别包一层动态拼名的 helper，那会让守卫静默失效。
 */
import { ipcMain } from "electron";
import { rootContext } from "./context";

export type IpcHost = {
  /** 注册一个 invoke 通道（同名重复注册由 Electron 抛错，与直连 `ipcMain.handle` 行为一致）。 */
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void;
  /** 摘掉一个通道（插件卸载用；未注册时幂等）。 */
  removeHandler(channel: string): void;
};

export const ipcHost: IpcHost = {
  handle: (channel, fn) => {
    ipcMain.handle(channel, fn as never);
  },
  removeHandler: (channel) => {
    ipcMain.removeHandler(channel);
  },
};

// 挂到根上下文：所有域通过 `inject: ["ipc"]` 取它。
rootContext.provide("ipc", ipcHost);
