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
import { broadcastHarnessEvent } from "./window-bus";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const tasksFeature = defineFeature<null>({
  id: "tasks",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("tasks: 缺少 ipc 服务（宿主未提供）");

    /* 任务清单**变更广播**（10-06 夜三轮）：Codex 每次 task_add / task_update 之后，渲染层的
       `bag.taskList` 要立刻跟上 —— 回合状态胶囊的「步骤 N/M」就是它的视图（原来是工具分发处
       自己手动重拉，写入口一多就漏）。⛔ 广播失败不影响写入本身。 */
    const notifyTasksChanged = () => { try { broadcastHarnessEvent({ type: "tasks-changed" } as any); } catch { /* 尽力而为 */ } };
    ipcHost.handle("tasks:list", () => rpaStore.listTasks());
    ipcHost.handle("tasks:add", async (_e, input: unknown) => {
      const task = await rpaStore.addTask(input as { text: string; priority?: "low" | "medium" | "high" });
      notifyTasksChanged();
      return task;
    });
    ipcHost.handle("tasks:update", async (_e, input: { id: string; patch: unknown }) => {
      const task = await rpaStore.updateTask(input.id, input.patch as any);
      notifyTasksChanged();
      return task;
    });
    ipcHost.handle("tasks:delete", async (_e, id: string) => {
      const result = await rpaStore.deleteTask(id);
      notifyTasksChanged();
      return result;
    });

    ctx.effect(() => {
      for (const ch of ["tasks:list", "tasks:add", "tasks:update", "tasks:delete"]) ipcHost.removeHandler(ch);
    });
  },
});
