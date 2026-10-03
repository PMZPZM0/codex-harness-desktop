/**
 * phone-harness 手机控制 IPC（09-27 新增；10-03 改插件形态，P2 批次 2）
 *
 * 通道前缀 `phone:` 与渲染层 PhoneHarnessSection 对应；四个动作与上游 CLI 一一对应
 * （status / install / uninstall / doctor），**不自己造判定**：体检结论原样回传。
 *
 * ── 10-03 插件化 ────────────────────────────────────────────────────────────
 *   · 依赖经 `inject: ["ipc"]` 声明，⛔ 不再直接 import `ipcMain`；
 *   · 7 个通道名与全部回传逻辑**逐字保留**；
 *   · `ctx.effect` 卸载时摘掉本域通道；挂载由 `electron/composition.gen.ts` 负责。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import {
  installPhoneHarness,
  wireAdb,
  openPhoneHarnessSettings,
  phoneHarnessDoctor,
  phoneHarnessGuides,
  phoneHarnessStatus,
  uninstallPhoneHarness,
} from "./phone-harness";

const PHONE_CHANNELS = [
  "phone:harness:status",
  "phone:harness:install",
  "phone:harness:uninstall",
  "phone:harness:doctor",
  "phone:harness:wire-adb",
  "phone:harness:guides",
  "phone:harness:open-settings",
];

export const phoneHarnessFeature = defineFeature<null>({
  id: "phone",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("phone-harness: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("phone:harness:status", async () => await phoneHarnessStatus());
    ipcHost.handle("phone:harness:install", async () => await installPhoneHarness());
    ipcHost.handle("phone:harness:uninstall", async () => await uninstallPhoneHarness());
    ipcHost.handle("phone:harness:doctor", async () => await phoneHarnessDoctor());
    ipcHost.handle("phone:harness:wire-adb", async () => ({ adb: await wireAdb() }));
    ipcHost.handle("phone:harness:guides", async () => phoneHarnessGuides());
    ipcHost.handle("phone:harness:open-settings", async () => {
      await openPhoneHarnessSettings();
    });

    ctx.effect(() => {
      for (const channel of PHONE_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
