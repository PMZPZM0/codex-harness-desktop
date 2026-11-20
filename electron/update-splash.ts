/**
 * 更新安装提醒（11-16 立，11-20 重做实现）。
 *
 * ⛔⛔ 11-20 为什么换掉 PowerShell 方案（用户原话「安装的时候，没有进度条提醒」）：
 *   旧实现是「写一个 .ps1 → spawn powershell.exe → WinForms 自绘卡片」。实测冷启动 2–4 秒：
 *   PowerShell 5.1 本身 ~800ms，`Add-Type` 现场编译 C# >1s，再加载 WinForms/Drawing 两个程序集；
 *   而我们静默安装常常 5–10 秒就结束 ⇒ **窗口出现时安装已经完了**，用户根本没看见。
 *   更糟的是 `Add-Type` 依赖机器上的 csc.exe，精简系统上编译失败会被
 *   `$ErrorActionPreference = SilentlyContinue` 吞掉 —— 那就是「压根没有弹窗」。
 *
 *   现方案：小窗由**另一个 Electron 实例**渲染（入口 `dist-electron/splash-main.js`，
 *   见 `electron/splash-main.ts`）。冷启动 ~300ms，UI 用 HTML/CSS 画，不依赖 .NET、不依赖编译器。
 *   ⛔ 它是独立的 Electron 应用（入口不是 main.ts）⇒ 不受单实例锁影响，userData 也改到 temp。
 *
 * 这个文件只剩两个入口：Windows 的安装小窗、mac 的原生通知。
 */
import { spawn } from "node:child_process";
import { app } from "electron";
import path from "node:path";

/** 在应用退出前拉起安装提醒小窗（Windows）；失败静默，⛔ 不能挡住安装。 */
export function showUpdateSplash(version: string, timeoutSeconds = 240): void {
  if (process.platform !== "win32") return;
  try {
    /* ⛔ 入口必须用编译产物（dist-electron/splash-main.js），和本文件同目录。 */
    const entry = path.join(__dirname, "splash-main.js");
    /* ⛔ 传 exe 基名：小窗靠 `tasklist /FI IMAGENAME eq <名>` 判断「旧进程退过、新进程起来」，
       两段都匹配不上，窗口就会一直挂到超时。 */
    const exeName = path.basename(process.execPath);
    spawn(process.execPath, [entry, String(version || app.getVersion()), exeName, String(timeoutSeconds)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch { /* 小窗失败不能挡住安装 */ }
}

/** macOS：更新包打开前弹原生通知（mac 没有 NSIS 静默安装，实际是拖进「应用程序」）。 */
export function showMacUpdateReminder(version: string): void {
  if (process.platform !== "darwin") return;
  const title = "Codex Harness 更新";
  const body = `新版本${version ? ` v${version}` : ""}已下载并校验通过。请打开下载的压缩包，把应用拖进「应用程序」完成更新。`;
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
  try {
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 通知失败不影响下载/打开 */ }
}
