/**
 * phone-harness 手机控制 IPC（09-27 新增）
 *
 * 通道前缀 `phone:` 与渲染层 PhoneHarnessSection 对应；四个动作与上游 CLI 一一对应
 * （status / install / uninstall / doctor），**不自己造判定**：体检结论原样回传。
 */
import { ipcMain } from "electron";
import {
  installPhoneHarness,
  openPhoneHarnessSettings,
  phoneHarnessDoctor,
  phoneHarnessGuides,
  phoneHarnessStatus,
  uninstallPhoneHarness,
} from "./phone-harness";

ipcMain.handle("phone:harness:status", async () => await phoneHarnessStatus());
ipcMain.handle("phone:harness:install", async () => await installPhoneHarness());
ipcMain.handle("phone:harness:uninstall", async () => await uninstallPhoneHarness());
ipcMain.handle("phone:harness:doctor", async () => await phoneHarnessDoctor());
ipcMain.handle("phone:harness:guides", async () => phoneHarnessGuides());
ipcMain.handle("phone:harness:open-settings", async () => {
  await openPhoneHarnessSettings();
});
