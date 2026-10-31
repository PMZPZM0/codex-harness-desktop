/**
 * session-alias-ipc（10-31 新板块）—— 会话笔名的读写面。
 *
 * 域：session-alias(3)
 * 通道：
 *   · `session-alias:snapshot` —— 全量快照（threadId → { alias, supervisorThreadId, meaning, … }），
 *     渲染层据此显示笔名、算"哪些名字已被占用"；
 *   · `session-alias:set` —— 用户改笔名（两字中文 + 全局不重名，主进程校验）；
 *   · `session-alias:ensure` —— 新建会话后确保有笔名（幂等；主会话不传上级）。
 *
 * ⛔ 为什么真相源在主进程：被调度会话的**上级名字**要拼进它的持久指令与首条任务，
 *    那时渲染层还没参与（见 electron/session-alias.ts 文件头）。
 * ⛔ 改名后必须广播（`setSessionAliasEmitter` 在 boot 里接上）——
 *    否则"改完主管名，子会话那边还显示旧名字"，正是用户点名的联动要求。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { ensureSessionAlias, setSessionAlias, snapshotSessionAliases } from "../session-alias";

export const sessionAliasFeature = defineFeature<null>({
  id: "session-alias",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("session-alias: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("session-alias:snapshot", async () => await snapshotSessionAliases());

    ipcHost.handle("session-alias:set", async (_event: unknown, input?: { threadId?: string; alias?: string }) => {
      const result = await setSessionAlias(String(input?.threadId ?? ""), String(input?.alias ?? ""));
      return result.ok
        ? { ok: true, record: result.record, snapshot: await snapshotSessionAliases() }
        : { ok: false, error: result.error };
    });

    ipcHost.handle("session-alias:ensure", async (_event: unknown, input?: { threadId?: string; supervisorThreadId?: string }) => {
      const record = await ensureSessionAlias(String(input?.threadId ?? ""), String(input?.supervisorThreadId ?? ""));
      return record ? { ok: true, record, snapshot: await snapshotSessionAliases() } : { ok: false, error: "笔名池已用尽" };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("session-alias:snapshot");
      ipcHost.removeHandler("session-alias:set");
      ipcHost.removeHandler("session-alias:ensure");
    });
  },
});
