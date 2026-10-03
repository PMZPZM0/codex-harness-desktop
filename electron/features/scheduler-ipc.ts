/**
 * scheduler-ipc（10-03 从 `features/memory-rpa-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：scheduler(4)
 * 通道：scheduler:list / scheduler:save / scheduler:delete / scheduler:run
 *
 * ⛔ 调度能力同时以 MCP 工具面暴露（scheduler_save / scheduler_run / scheduler_delete，
 *    守卫【196】断言 schema 与执行端都要有）—— 改本文件时要记得那边的参数口径同源。
 */
import { scheduler } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const schedulerFeature = defineFeature<null>({
  id: "scheduler",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("scheduler: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("scheduler:list", () => scheduler.list());
    ipcHost.handle("scheduler:save", (_event, input: unknown) => scheduler.save(input as any));
    ipcHost.handle("scheduler:delete", (_event, id: string) => scheduler.remove(id));
    ipcHost.handle("scheduler:run", (_event, id: string) => scheduler.runNow(id));

    ctx.effect(() => {
      for (const ch of ["scheduler:list", "scheduler:save", "scheduler:delete", "scheduler:run"]) ipcHost.removeHandler(ch);
    });
  },
});
