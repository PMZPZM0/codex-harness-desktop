/**
 * app-settings-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：appSettings(2)
 * 通道：appSettings:read / appSettings:save
 *
 * ⚠️ 前缀仍是 camelCase 的 `appSettings`（历史遗留，**不改对外契约**）；文件与目录按规范走 kebab。
 * ⛔ 保存后必须做两件事（缺一等于"设置没生效"）：
 *     ① `applyCustomModel(model)` —— 把模型口径重写到 config.toml；
 *     ② `syncEngineWatchdog()` —— 引擎健康看门狗开关即时生效（不依赖重启后的 ready 事件）。
 * ⛔ 待接缝化（阶段 2）：app 为宿主能力。
 */
import { app } from "electron";
import { readAppSettings, saveAppSettings } from "../app-settings";
import type { AppSettings } from "../app-settings";
import { applyCustomModel } from "./custom-model-apply";
import { readCustomModel } from "../main/01-model-catalog";
import { syncEngineWatchdog } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const appSettingsFeature = defineFeature<null>({
  id: "appSettings",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("appSettings: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("appSettings:read", async (): Promise<AppSettings> => readAppSettings(app.getPath("userData")));
    ipcHost.handle("appSettings:save", async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
      const next = await saveAppSettings(app.getPath("userData"), patch);
      const model = await readCustomModel();
      if (model) await applyCustomModel(model);
      // 引擎健康看门狗开关即时生效（不依赖重启后的 ready 事件）
      await syncEngineWatchdog();
      return next;
    });

    ctx.effect(() => {
      ipcHost.removeHandler("appSettings:read");
      ipcHost.removeHandler("appSettings:save");
    });
  },
});
