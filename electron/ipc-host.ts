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
  /** 注册一个 invoke 通道（同名重复注册由 Electron 抛错，与直连 `ipcMain.handle` 行为一致）。
   *  ⚠️ 这里必须用 `any[]`：`ipcMain.handle` 的 handler 签名就是 `(event, ...args: any[])`，
   *  收窄成 `unknown[]` 会与 Electron 的类型面不兼容（只能靠回调内部的参数校验兜住，
   *  见各域的 `input?.x` 判空写法）。 */
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void;
  /**
   * 注册一个**单向监听**通道（`ipcMain.on`，无回包）。
   *
   * 用途：高频数据流（麦克风音频块每 64ms 一帧）走 invoke 会因等待回包产生抖动。
   * ⛔ 必须同时有 `removeHandler` 能摘 —— 否则插件卸载后监听残留在 Electron 里，
   *    域再挂一次就会重复收到（表现为音频被处理两遍）。
   */
  on(channel: string, fn: (event: unknown, ...args: any[]) => void): void;
  /** 摘掉一个通道（插件卸载用；未注册时幂等）。 */
  removeHandler(channel: string): void;
};

/** 一次性监听器登记簿：channel → 本容器注册过的 fn 引用（供卸载时精确摘除）。
 *  ⚠️ 必须声明在 `ipcHost` **之前**：`on`/`removeHandler` 的函数体在调用时才求值，
 *     但 `const` 有 TDZ —— 若声明在后面，模块体初始化阶段一旦有代码碰 `ipcHost.on` 就会炸。 */
const oneWayListeners = new Map<string, Array<(event: unknown, ...args: any[]) => void>>();

export const ipcHost: IpcHost = {
  handle: (channel, fn) => {
    ipcMain.handle(channel, fn as never);
  },
  on: (channel, fn) => {
    ipcMain.on(channel, fn as never);
    const list = oneWayListeners.get(channel) ?? [];
    list.push(fn);
    oneWayListeners.set(channel, list);
  },
  removeHandler: (channel) => {
    ipcMain.removeHandler(channel);
    // ⚛️ removeHandler 只摘 invoke 监听，`ipcMain.on` 注册的那种必须用 removeListener。
    //    按登记的引用精确摘 —— 避免误摘同通道上别人注册的监听。
    for (const fn of oneWayListeners.get(channel) ?? []) ipcMain.removeListener(channel, fn as never);
    oneWayListeners.delete(channel);
  },
};

// 挂到根上下文：所有域通过 `inject: ["ipc"]` 取它。
rootContext.provide("ipc", ipcHost);
