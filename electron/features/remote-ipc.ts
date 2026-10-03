/**
 * remote-ipc（09-21 从 electron/main.ts 按域拆出；**10-03 改为插件形态，作为「零宿主依赖域」的样板**）
 *
 * 域：remote(11)
 * 通道：remote:start / status / devices / send / stop / pair-state / pair-rotate / approve / deny /
 *      revoke / qrcode
 *
 * ── 这个域是「能力接缝化」的最小样板（方案 §6 阶段 2）────────────────────────
 * 它是 10 个老域里**唯一只依赖 `ipc`**、不碰 app/shell/dialog 任何宿主能力的域，
 * 所以改造面 = "把裸 ipcMain 换成容器注入"，没有接缝取值问题。改造它有两个作用：
 *   ① 证明模式可行（其余 9 个域与 59 个已插件化域照此办理）；
 *   ② 让 `electron/runtime/seams/` 建出来的接缝层**有真实消费者**，而不是一段没人调用的死代码。
 *
 * ⛔ 通道名 / 参数 / 返回值逐字保留（零行为变化），仅注册时机从「main.ts 模块体 import」
 *    改为「组合表按顺序挂载」—— 两者都是模块作用域执行，时机等价。
 * ⛔ `qrcode` 通道的 URL 由服务端拼（含一次性凭据），别让调用方自己拼 `?`/`&` —— 拼错的后果是
 *    扫码后 401（这条口径跟着搬迁保留）。
 */
import { mainWindow, qrSvg } from "../runtime-refs";
import { remote } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const REMOTE_CHANNELS = [
  "remote:start", "remote:status", "remote:devices", "remote:send", "remote:stop",
  "remote:pair-state", "remote:pair-rotate", "remote:approve", "remote:deny",
  "remote:revoke", "remote:qrcode",
];

export const remoteFeature = defineFeature<null>({
  id: "remote",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("remote: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("remote:start", async () => { const port = await remote.start(); return { port, url: remote.pairUrlAuth() }; });
    ipcHost.handle("remote:status", () => ({ status: "idle", devices: remote.listDevices(), url: remote.pairUrlAuth() }));
    ipcHost.handle("remote:devices", () => remote.listDevices());
    ipcHost.handle("remote:send", (_event, cmd: string) => { mainWindow?.webContents.send("remote:command", { command: String(cmd), device: { id: "local", name: "本机" } }); return { ok: true }; });
    ipcHost.handle("remote:stop", () => { remote.stop(); return { ok: true }; });
    ipcHost.handle("remote:pair-state", () => ({ code: remote.pairingCode(), pending: remote.pendingPairs(), approved: remote.approvedDevices() }));
    ipcHost.handle("remote:pair-rotate", () => ({ code: remote.rotatePairingCode() }));
    ipcHost.handle("remote:approve", (_event, rid: string) => ({ ok: remote.approvePair(String(rid)) }));
    ipcHost.handle("remote:deny", (_event, rid: string) => ({ ok: remote.denyPair(String(rid)) }));
    ipcHost.handle("remote:revoke", (_event, deviceId: string) => ({ ok: remote.revokeDevice(String(deviceId)) }));
    ipcHost.handle("remote:qrcode", async (_event, botId?: string) => {
      // 服务端拼 URL（含一次性凭据），避免调用方把 `?`/`&` 拼错 —— 拼错的后果是扫码后 401
      return qrSvg(remote.pairUrlFor(botId));
    });

    ctx.effect(() => {
      for (const ch of REMOTE_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
