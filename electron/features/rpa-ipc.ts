/**
 * rpa-ipc（10-03 从 `features/memory-rpa-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：rpa(4)
 * 通道：rpa:list / rpa:save / rpa:delete / rpa:run-result
 *
 * 口径唯一真相源 = `rpaStore`（`../runtime-refs` 活绑定，与 tasks 域共用同一个 store 实例 ——
 *    共用**基座层对象**不构成"同一域"，故 rpa 与 tasks 各自独立成板块）。
 */
import { rpaStore } from "../runtime-refs";
import { RpaStore } from "../rpa-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const rpaFeature = defineFeature<null>({
  id: "rpa",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("rpa: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("rpa:list", () => rpaStore.listRecipes());
    ipcHost.handle("rpa:save", (_e, input: unknown) => rpaStore.saveRecipe(input as Parameters<RpaStore["saveRecipe"]>[0]));
    ipcHost.handle("rpa:delete", (_e, id: string) => rpaStore.deleteRecipe(id));
    /* ⛔ 名字必须是 run-result：这里记的是**一次运行的终态**，不是录制操作
       （11-13 审查发现叫 rpa:record 会让人以为是「开始录制」）。 */
    ipcHost.handle("rpa:run-result", (_e, input: { id: string; ok: boolean; error?: string }) => rpaStore.recordRun(input.id, input.ok, input.error));

    ctx.effect(() => {
      for (const ch of ["rpa:list", "rpa:save", "rpa:delete", "rpa:run-result"]) ipcHost.removeHandler(ch);
    });
  },
});
