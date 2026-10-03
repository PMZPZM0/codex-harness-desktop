/**
 * awake-ipc（10-03 从 `features/shell-misc-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：awake(1)
 * 通道：awake:set（防休眠开关）
 *
 * 为什么拆出来：原 `shell-misc-ipc.ts` 一个板块承载 4 个前缀，违反「一个板块恒等于一个域前缀」。
 *
 * ⛔ `awakeId` 是**本域私有**的模块级可变状态 —— 拆分后跟着本板块走（不与别的域共享），
 *    这正是"按前缀拆"能成立的前提：共享可变状态若横跨多个前缀，说明那本就是同一个域。
 *
 * ⛔ 待接缝化（阶段 2）：`powerSaveBlocker` 是宿主能力，将来经 `"power"` 接缝注入。
 *
 * 生命周期：`ctx.effect` 内**先停掉未关闭的防休眠**，再摘通道 —— 卸载后系统若一直不休眠，
 *    正是"卸载不干净"的典型症状（与 queue-timer 的定时器同型）。
 */
import { powerSaveBlocker } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const awakeFeature = defineFeature<null>({
  id: "awake",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("awake: 缺少 ipc 服务（宿主未提供）");

    let awakeId: number | null = null;

    ipcHost.handle("awake:set", (_event, on: boolean) => {
      if (on && awakeId == null) awakeId = powerSaveBlocker.start("prevent-app-suspension");
      if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
      return awakeId != null;
    });

    ctx.effect(() => {
      if (awakeId != null) {
        try { powerSaveBlocker.stop(awakeId); } catch { /* 单个清理失败不影响摘通道 */ }
        awakeId = null;
      }
      ipcHost.removeHandler("awake:set");
    });
  },
});
