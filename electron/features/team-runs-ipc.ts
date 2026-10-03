/**
 * team-runs-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：team-runs(1)
 * 通道：team-runs:list（某会话的运行记录）
 *
 * 运行记录的**写入方**在 `teams-ipc` 的 `beginRun`/`finishRun`（调度路径），本域只做查询面。
 */
import { teamRunStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const teamRunsFeature = defineFeature<null>({
  id: "team-runs",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("team-runs: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("team-runs:list", async (_event, threadId: string) => teamRunStore.listRuns(String(threadId ?? "")));

    ctx.effect(() => {
      ipcHost.removeHandler("team-runs:list");
    });
  },
});
