/**
 * rpa-ipc（10-03 从 `features/memory-rpa-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：rpa(10)
 * 通道：list / save / delete / run-result / record-start / record-stop / recorder-state /
 *       record-discard / play-start / play-stop
 *
 * 口径唯一真相源 = `rpaStore`（`../runtime-refs` 活绑定，与 tasks 域共用同一个 store 实例 ——
 *    共用**基座层对象**不构成"同一域"，故 rpa 与 tasks 各自独立成板块）。
 * 键鼠录制的原生进程/状态在 `../rpa-recorder`（Windows PowerShell / macOS Swift helper）。
 */
import { type IpcMainInvokeEvent } from "electron";
import { rpaStore } from "../runtime-refs";
import { RpaStore } from "../rpa-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";
import { broadcastHarnessEvent } from "./window-bus";
import { scheduler } from "../main";
import {
  cleanupRpaRecorder,
  discardRpaRecording,
  rpaRecorderState,
  setRpaRecorderNotifier,
  startRpaPlayback,
  startRpaRecording,
  stopRpaPlayback,
  stopRpaRecording,
} from "../rpa-recorder";

const RPA_CHANNELS = [
  "rpa:list", "rpa:save", "rpa:delete", "rpa:run-result",
  "rpa:record-start", "rpa:record-stop", "rpa:recorder-state", "rpa:record-discard",
  "rpa:play-start", "rpa:play-stop",
];

export const rpaFeature = defineFeature<null>({
  id: "rpa",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("rpa: 缺少 ipc 服务（宿主未提供）");
    const host = ctx.get<HostCaps>("host");
    if (!host) throw new Error("rpa: 缺少宿主能力接缝（window）");

    setRpaRecorderNotifier((payload) => broadcastHarnessEvent(payload));
    ipcHost.handle("rpa:list", () => rpaStore.listRecipes());
    ipcHost.handle("rpa:save", (_e, input: unknown) => rpaStore.saveRecipe(input as Parameters<RpaStore["saveRecipe"]>[0]));
    ipcHost.handle("rpa:delete", async (_e, id: string) => {
      const recipeId = String(id ?? "");
      await rpaStore.deleteRecipe(recipeId);
      /* 删除配方时级联删掉它的定时任务 —— 否则调度器每次到点都报「配方不存在」。 */
      const tasks = await scheduler.list();
      for (const task of tasks) {
        if (task.rpa?.recipeId === recipeId) await scheduler.remove(task.id);
      }
    });
    /* ⛔ 名字必须是 run-result：这里记的是**一次运行的终态**，不是录制操作
       （11-13 审查发现叫 rpa:record 会让人以为是「开始录制」）。 */
    ipcHost.handle("rpa:run-result", (_e, input: { id: string; ok: boolean; error?: string }) => rpaStore.recordRun(input.id, input.ok, input.error));

    /* 键鼠录制（Windows 原生）：开始会最小化当前窗口；停止快捷键 Ctrl+Alt+F9。 */
    ipcHost.handle("rpa:record-start", async (event) => startRpaRecording(host.window.fromWebContents((event as IpcMainInvokeEvent).sender)));
    ipcHost.handle("rpa:record-stop", () => stopRpaRecording());
    ipcHost.handle("rpa:recorder-state", () => rpaRecorderState());
    ipcHost.handle("rpa:record-discard", () => { discardRpaRecording(); });
    ipcHost.handle("rpa:play-start", async (event, id: unknown) => {
      const recipe = (await rpaStore.listRecipes()).find((entry) => entry.id === String(id ?? ""));
      if (!recipe) return { ok: false, error: "配方不存在（可能已被删除）" };
      return startRpaPlayback(recipe, host.window.fromWebContents((event as IpcMainInvokeEvent).sender));
    });
    ipcHost.handle("rpa:play-stop", () => stopRpaPlayback());

    ctx.effect(() => {
      for (const ch of RPA_CHANNELS) ipcHost.removeHandler(ch);
      setRpaRecorderNotifier(() => {});
      cleanupRpaRecorder();
    });
  },
});
