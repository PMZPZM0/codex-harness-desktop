/**
 * session-alias-ipc（10-31 新板块）—— 会话名的读写面（11-01 起「笔名」= 会话名）。
 *
 * 域：session-alias(3)
 * 通道：
 *   · `session-alias:snapshot` —— 全量快照（threadId → { alias, supervisorThreadId, meaning, … }），
 *     渲染层据此显示会话名、算"哪些名字已被占用"；
 *   · `session-alias:set` —— **用户改名**（唯一入口：侧栏菜单 / 双击标题 / 顶栏双击都走它）。
 *     主进程校验后落盘、写穿引擎会话名（`thread/name/set`）、广播快照；
 *   · `session-alias:ensure` —— 新建会话后确保有名字（幂等；主会话不传上级）。
 *
 * ⛔ 11-01 用户令：「重命名和改笔名不是一样的逻辑吗，为啥要两个选项」——
 *    ⇒ 只有一个操作（改名）。它同时改三处：别名记录（侧栏真相源）、引擎会话名（顶栏/其他客户端）、
 *      广播快照（子会话里的「上级：X」当场跟着变）。
 * ⛔ 为什么真相源在主进程：被调度会话的**上级名字**要拼进它的持久指令与首条任务，
 *    那时渲染层还没参与（见 electron/session-alias.ts 文件头）。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { server } from "../runtime-refs";
import { ensureSessionAlias, setSessionAlias, snapshotSessionAliases } from "../session-alias";

export const sessionAliasFeature = defineFeature<null>({
  id: "session-alias",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("session-alias: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("session-alias:snapshot", async () => await snapshotSessionAliases());

    ipcHost.handle("session-alias:set", async (_event: unknown, input?: { threadId?: string; alias?: string; allowDuplicate?: boolean }) => {
      const threadId = String(input?.threadId ?? "");
      const result = await setSessionAlias(threadId, String(input?.alias ?? ""), { allowDuplicate: Boolean(input?.allowDuplicate) });
      if (!result.ok) return { ok: false, error: result.error };
      /* ⛔ 写穿引擎会话名（11-01 联动要求）：顶栏、其他客户端、导出都读引擎那份 name。
         失败不回滚 —— 侧栏真相源已经改了，回滚会让界面倒退回旧名字（更糟）。 */
      let engineError = "";
      try { await server.request("thread/name/set", { threadId, name: String(result.record?.alias ?? "") }); }
      catch (error: any) { engineError = String(error?.message ?? error); }
      return { ok: true, record: result.record, engineError: engineError || undefined, snapshot: await snapshotSessionAliases() };
    });

    ipcHost.handle("session-alias:ensure", async (_event: unknown, input?: { threadId?: string; supervisorThreadId?: string }) => {
      const record = await ensureSessionAlias(String(input?.threadId ?? ""), String(input?.supervisorThreadId ?? ""));
      return record ? { ok: true, record, snapshot: await snapshotSessionAliases() } : { ok: false, error: "名字池已用尽" };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("session-alias:snapshot");
      ipcHost.removeHandler("session-alias:set");
      ipcHost.removeHandler("session-alias:ensure");
    });
  },
});
