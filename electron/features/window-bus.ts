/**
 * 主进程 → 渲染层的窗口广播总线。
 *
 * 为什么独立成模块：`codex:event` / `harness:event` 以及各域自己的进度事件
 * （voice / terminal / runtime / skill-install / connectors:oauth-event …）都要发到**所有窗口**
 * （主窗口 + 独立会话弹窗）。这段逻辑原先内联在 main.ts，依赖模块级的 `mainWindow` 与
 * `popoutWindows` 两个变量 —— 结果任何想搬进 features/ 的域都得回头依赖 main.ts，等于搬不走
 * （语音域 39 个 handler 全在调 sendToWindow，就是被这一条卡住）。
 *
 * 这里收敛成两件事：**登记窗口** + **发送**。
 *   · main.ts 创建窗口时 `registerBusWindow(win, { primary: true })`，销毁时 `unregisterBusWindow(win)`；
 *   · 任何模块 import `broadcastCodexEvent` / `broadcastHarnessEvent` / `sendToWindow` / `broadcastToAll`。
 *
 * 语义与原先逐条对齐：判活（isDestroyed 双查）→ try/catch 吞掉关窗竞态 → 主窗口先于弹窗。
 * 导出名刻意与旧函数同名，main.ts 的既有调用点因此**一行都不用改**。
 */

import type { BrowserWindow } from "electron";

/** 只要求「能判活 + 能发消息」—— BrowserWindow 天然满足，e2e 的 stub 也满足。 */
type BusWindow = BrowserWindow;

/** 主窗口（正常只有 1 个）。单独一列是为了「只发主窗口」的 sendToWindow 语义。 */
const primaryWindows: BusWindow[] = [];
/** 独立会话弹窗。 */
const extraWindows: BusWindow[] = [];

export function registerBusWindow(win: BusWindow, opts?: { primary?: boolean }) {
  const list = opts?.primary ? primaryWindows : extraWindows;
  if (!list.includes(win)) list.push(win);
}

export function unregisterBusWindow(win: BusWindow) {
  for (const list of [primaryWindows, extraWindows]) {
    const i = list.indexOf(win);
    if (i >= 0) list.splice(i, 1);
  }
}

/** 主窗口 + 全部独立会话弹窗（主窗口在前 —— 与原先 `[mainWindow, ...popoutWindows]` 顺序一致）。 */
export function allBusWindows(): BusWindow[] {
  return [...primaryWindows, ...extraWindows];
}

export function hasBusWindow(win: BusWindow): boolean {
  return primaryWindows.includes(win) || extraWindows.includes(win);
}

/** 独立会话弹窗（**不含**主窗口）——「关掉所有弹窗」「这个窗口是弹窗吗」这类判断必须用它，
 *  用 allBusWindows / hasBusWindow 会把主窗口也算进去（曾据此差点误关主窗口）。 */
export function popoutBusWindows(): BusWindow[] {
  return [...extraWindows];
}

export function isPopoutWindow(win: BusWindow): boolean {
  return extraWindows.includes(win);
}

/** 广播到所有窗口；单个窗口发送失败不影响其余。 */
export function broadcastToAll(channel: string, payload: unknown) {
  for (const win of allBusWindows()) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try { win.webContents.send(channel, payload); } catch { /* 窗口在关闭过程中，忽略 */ }
  }
}

/**
 * 只发主窗口（进度类事件不需要进弹窗）。
 * ⛔ 退出时窗口可能已销毁，`?.` 挡不住 destroyed 的 webContents，必须显式判活。
 */
export function sendToWindow(channel: string, payload: unknown) {
  for (const win of primaryWindows) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try { win.webContents.send(channel, payload); } catch { /* 忽略 */ }
  }
}

/** `codex:event` 广播：主窗口 + 所有独立会话弹窗（弹窗也要收到自己那个会话的流式事件）。 */
export function broadcastCodexEvent(payload: unknown) {
  broadcastToAll("codex:event", payload);
}

/**
 * `harness:event` 广播到**所有**窗口（主窗口 + 独立会话弹窗）。会话运行时配置是跨窗口共享的：
 * 一个窗口改了，另一个窗口必须看到，否则它下次「读-改-写」会拿旧值写回（丢更新）。
 */
export function broadcastHarnessEvent(payload: Record<string, unknown>) {
  broadcastToAll("harness:event", payload);
}
