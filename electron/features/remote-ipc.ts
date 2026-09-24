/**
 * remote-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：remote(11)
 * 通道：remote:approve / remote:deny / remote:devices / remote:pair-rotate / remote:pair-state / remote:qrcode / remote:revoke / remote:send / remote:start / remote:status / remote:stop
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 本域未使用跨域可变状态。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import { ipcMain } from "electron";
import { mainWindow, qrSvg } from "../runtime-refs";
import { remote } from "../main";
ipcMain.handle("remote:start", async () => { const port = await remote.start(); return { port, url: remote.pairUrlAuth() }; });
ipcMain.handle("remote:status", () => ({ status: "idle", devices: remote.listDevices(), url: remote.pairUrlAuth() }));
ipcMain.handle("remote:devices", () => remote.listDevices());
ipcMain.handle("remote:send", (_event, cmd: string) => { mainWindow?.webContents.send("remote:command", { command: String(cmd), device: { id: "local", name: "本机" } }); return { ok: true }; });
ipcMain.handle("remote:stop", () => { remote.stop(); return { ok: true }; });
ipcMain.handle("remote:pair-state", () => ({ code: remote.pairingCode(), pending: remote.pendingPairs(), approved: remote.approvedDevices() }));
ipcMain.handle("remote:pair-rotate", () => ({ code: remote.rotatePairingCode() }));
ipcMain.handle("remote:approve", (_event, rid: string) => ({ ok: remote.approvePair(String(rid)) }));
ipcMain.handle("remote:deny", (_event, rid: string) => ({ ok: remote.denyPair(String(rid)) }));
ipcMain.handle("remote:revoke", (_event, deviceId: string) => ({ ok: remote.revokeDevice(String(deviceId)) }));
ipcMain.handle("remote:qrcode", async (_event, botId?: string) => {
  // 服务端拼 URL（含一次性凭据），避免调用方把 `?`/`&` 拼错 —— 拼错的后果是扫码后 401
  return qrSvg(remote.pairUrlFor(botId));
});
