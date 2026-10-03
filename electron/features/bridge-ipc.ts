/**
 * bridge-ipc（10-03 从 `features/engine-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：bridge(1)
 * 通道：bridge:status（协议桥状态）
 *
 * ⛔ 三个字段语义不同，别合并：`status()` = 当前状态、`modesSnapshot()` = **实际跑成什么**、
 *    `configuredModes()` = **用户配了什么**。排查「改了设置不生效」正是看后者与前者的差异。
 */
import { responsesBridge } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const bridgeFeature = defineFeature<null>({
  id: "bridge",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("bridge: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("bridge:status", async () => ({
      ...responsesBridge.status(),
      modes: responsesBridge.modesSnapshot(),
      // 「用户配了什么协议」（区别于 modes = 「实际跑成什么」）——排查"改了设置不生效"看这个
      configured: responsesBridge.configuredModes(),
    }));

    ctx.effect(() => {
      ipcHost.removeHandler("bridge:status");
    });
  },
});
