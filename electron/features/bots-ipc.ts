/**
 * bots-ipc（10-03 从 `features/im-channels-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：bots(1 前缀 / 2 通道)
 * 通道：bots:get / bots:set（机器人清单读写）
 *
 * ⚠️ 与 `bot-ipc` 的关系：本域是**清单持久化**（bots.json 读写），`bot-ipc` 是**配对状态机** ——
 *    两者前缀相近但语义不同，故各自独立成板块（也正因如此才需要拆：混在一个文件里分不清谁管什么）。
 * ⛔ 待接缝化（阶段 2）：`fs` 直接读写属宿主能力，将来经 `"fs"` 接缝注入。
 */
import fs from "node:fs/promises";
import { botsFile } from "./im-gateways";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const botsFeature = defineFeature<null>({
  id: "bots",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("bots: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("bots:get", async () => {
      try { return JSON.parse(await fs.readFile(botsFile(), "utf8")); } catch { return []; }
    });
    ipcHost.handle("bots:set", async (_e, list: unknown) => {
      const safe = Array.isArray(list) ? list : [];
      await fs.writeFile(botsFile(), JSON.stringify(safe, null, 2), "utf8");
      return { ok: true, count: safe.length };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("bots:get");
      ipcHost.removeHandler("bots:set");
    });
  },
});
