/**
 * model-specs-ipc（10-03 从 `features/model-custom-ipc/04-custom-model-read.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：model-specs(1)
 * 通道：model-specs:read（内置模型规格表，落 userData/model-specs.json）
 *
 * 为什么单独成板块：它是**只读的规格表**（与各供应商配置无关），只是当初和 custom-model 的
 * read 通道写在同一个文件里。按「一个板块恒等于一个域前缀」拆出。
 * ⛔ 读不到就返回 null（规格表缺失不应让 UI 崩），这个兜底不要改成抛错。
 * ⛔ 待接缝化（阶段 2）：app / fs 为宿主能力。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const modelSpecsFeature = defineFeature<null>({
  id: "model-specs",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("model-specs: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("model-specs:read", async () => {
      try { return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "model-specs.json"), "utf8")); } catch { return null; }
    });

    ctx.effect(() => {
      ipcHost.removeHandler("model-specs:read");
    });
  },
});
