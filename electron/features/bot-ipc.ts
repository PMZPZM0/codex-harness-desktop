/**
 * bot-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：bot(7)
 * 通道：bot:pair-state / bot:approve / bot:deny / bot:revoke / bot:bind-qrcode / bot:bind-status / bot:bind-consume
 *
 * 为什么拆出来：原 `im-channels-ipc.ts` 一个板块承载 **13 个前缀**，是「一个板块恒等于一个域前缀」
 * 违反得最狠的一处。本域只留**配对与绑定**这一类（pairing 状态机 + 扫码绑定会话）。
 *
 * ⛔ `lastBindSession` 是本域私有的模块级状态（只被 `bot:bind-qrcode` 读写）⇒ 跟着本板块走。
 *    "共享可变状态是否横跨多个前缀"正是判断「它们本是不是同一个域」的判据。
 * ⛔ `botPairing` / `remote` 经 `../bot-pairing` / `../main` 活绑定取用（跨域符号只在 handler 内求值，【91】）。
 * ⛔ 待接缝化（阶段 2）：`qrSvg` 属宿主侧绘图能力，将来经接缝注入。
 */
import { botPairing, remote } from "../main";
import { qrSvg } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const botFeature = defineFeature<null>({
  id: "bot",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("bot: 缺少 ipc 服务（宿主未提供）");

    let lastBindSession = "";

    ipcHost.handle("bot:pair-state", () => botPairing.state());
    ipcHost.handle("bot:approve", (_event, rid: string) => ({ ok: botPairing.approve(String(rid)) }));
    ipcHost.handle("bot:deny", (_event, rid: string) => ({ ok: botPairing.deny(String(rid)) }));
    ipcHost.handle("bot:revoke", (_event, key: string) => {
      const [channel, ...rest] = String(key).split(":");
      return { ok: botPairing.revoke(channel, rest.join(":")) };
    });
    ipcHost.handle("bot:bind-qrcode", async (_event, botId: string, botName: string) => {
      lastBindSession = remote.createBindSession(botId, botName);
      const code = lastBindSession.match(/\/r\/([a-z0-9]+)\?/)?.[1] ?? "";
      return { qr: await qrSvg(lastBindSession), url: lastBindSession, code };
    });
    ipcHost.handle("bot:bind-status", (_event, code: string) => remote.bindStatus(code));
    ipcHost.handle("bot:bind-consume", (_event, code: string) => remote.consumeBind(code));

    ctx.effect(() => {
      for (const ch of ["bot:pair-state", "bot:approve", "bot:deny", "bot:revoke", "bot:bind-qrcode", "bot:bind-status", "bot:bind-consume"]) {
        ipcHost.removeHandler(ch);
      }
    });
  },
});
