/**
 * user-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出；10-03 按前缀拆成单前缀板块 + 改插件形态）
 *
 * 域：user(1)
 * 通道：user:name
 *
 * ⛔ 10-03 拆分：原文件里还有一个 `capabilities` 前缀 —— 按「一个板块恒等于一个域前缀」已拆出到
 *    `features/capabilities-ipc.ts`，本文件只留 `user`。
 *
 * 生命周期：通道在 `setup` 内注册、`ctx.effect` 内摘除 —— 插件必须能**干净卸载**，
 *   这是"插件"与"模块级 side effect"的分水岭。
 * 注册时机：由 `electron/composition.gen.ts` 挂载（是否启用见 `electron/composition.json`），
 *   本文件**不自挂载**（⛔ 反向 import 组合层 = 成环 = 启动即崩）。
 */
import os from "node:os";
import { readPersonalization } from "../personalization";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const userFeature = defineFeature<null>({
  id: "user",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("user: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("user:name", async () => {
      // 用户名的权威源是个性化昵称（personalization.json），重启不丢；
      // 只有未设置昵称时才回退到操作系统用户名，避免每次启动把自定义称呼覆盖回系统用户。
      try {
        const cfg = await readPersonalization();
        if (cfg?.nickname) return cfg.nickname;
      } catch { /* 忽略，走回退 */ }
      try { return os.userInfo().username || "Codex 用户"; } catch { return "Codex 用户"; }
    });

    ctx.effect(() => {
      ipcHost.removeHandler("user:name");
    });
  },
});
