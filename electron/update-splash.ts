/**
 * 更新提醒（11-16 立；11-20 收敛成只剩 macOS 一条）。
 *
 * ⛔⛔ 11-20 结论：Windows 的「安装进度小窗」**不再由我们自己画**，改用安装器自带的进度页
 *   （`quitAndInstall(false, …)` 非静默；oneClick 安装器只有 `MUI_PAGE_INSTFILES` 一个页面，
 *   无向导、无完成页 ⇒ 用户看到一个真实进度条，装完自动拉起新版本）。
 *   为什么放弃自绘：用户两次报「安装的时候没有进度条提醒」，逐个排掉后确认：
 *   · PowerShell + Add-Type 现场编译 C#，冷启动 2–4 秒，而静默安装 5–10 秒就结束 ⇒ 窗比安装慢；
 *   · 换成独立 Electron 入口也不保险 —— 打包后的 exe 是否接受「脚本路径」作为入口没有保证，
 *     赌错就是「第三次没有弹窗」。安装器自己的进度页是**零依赖**的，一定出现。
 *
 * 这个文件现在只剩 macOS 的原生通知（mac 没有 NSIS，更新是「打开 zip、拖进应用程序」）。
 */
import { spawn } from "node:child_process";

/** macOS：更新包打开前弹原生通知（提示用户把 App 拖进「应用程序」）。 */
export function showMacUpdateReminder(version: string): void {
  if (process.platform !== "darwin") return;
  const title = "Codex Harness 更新";
  const body = `新版本${version ? ` v${version}` : ""}已下载并校验通过。请打开下载的压缩包，把应用拖进「应用程序」完成更新。`;
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
  try {
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 通知失败不影响下载/打开 */ }
}
