/**
 * team-threads-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：team-threads(2)
 * 通道：team-threads:map（线程 → 团队 全量映射）/ team-threads:team-of（查某个线程属于哪个团）
 *
 * 映射由 `teams-ipc` 在开会话时写入（`setThreadTeam`），本域只做查询面 ——
 * 任何窗口（含 popout）据此才知道这个会话属于哪个团。
 */
import { teamRunStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const teamThreadsFeature = defineFeature<null>({
  id: "team-threads",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("team-threads: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("team-threads:map", async () => teamRunStore.listThreads());
    ipcHost.handle("team-threads:team-of", async (_event, threadId: string) => teamRunStore.teamOfThread(String(threadId ?? "")));

    ctx.effect(() => {
      ipcHost.removeHandler("team-threads:map");
      ipcHost.removeHandler("team-threads:team-of");
    });
  },
});
