/**
 * tasks-ipc（10-03 从 `features/memory-rpa-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：tasks(4)
 * 通道：tasks:list / tasks:add / tasks:update / tasks:delete
 *
 * 与 `rpa` 的关系：共用 `rpaStore` 这个基座层对象，但**职责不同**（rpa = 自动化配方，
 * tasks = 任务清单）⇒ 按前缀各自成板块。
 */
import { rpaStore } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const tasksFeature = defineFeature<null>({
  id: "tasks",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("tasks: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("tasks:list", () => rpaStore.listTasks());
    ipcHost.handle("tasks:add", (_e, input: unknown) => rpaStore.addTask(input as { text: string; priority?: "low" | "medium" | "high" }));
    ipcHost.handle("tasks:update", (_e, input: { id: string; patch: unknown }) => rpaStore.updateTask(input.id, input.patch as any));
    ipcHost.handle("tasks:delete", (_e, id: string) => rpaStore.deleteTask(id));

    ctx.effect(() => {
      for (const ch of ["tasks:list", "tasks:add", "tasks:update", "tasks:delete"]) ipcHost.removeHandler(ch);
    });
  },
});
