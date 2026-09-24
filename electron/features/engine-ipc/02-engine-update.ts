/**
 * engine-ipc 的「engine-update」部分（09-22 从同目录 engine-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import { broadcastHarnessEvent, sendToWindow } from "../../features/window-bus";
import { readAppSettings, saveAppSettings } from "../../app-settings";
import { checkEngineUpdate, performEngineUpdate } from "../../engine-updater";
import { bridgeDial, readCustomModel, responsesBridge, restrictedThreadRole } from "../../main";
import { codexHome, engineActiveTurnIds, mainWindow, server, threadCwd, threadRuntimeStore } from "../../runtime-refs";
let engineUpdateRunning = false;

ipcMain.handle("engine:restart-log", () => server.restartHistory());

ipcMain.handle("engine:active-turns", () => ({
  count: server.activeTurnCount(),
  // 会话级明细（渲染层核实"这个会话到底还在不在跑"用：收到快照式的 thread/status/changed idle 时，
  // 不能凭它熄灭运行指示器，要与引擎侧真相核对——见 App.tsx 的 status/changed 分支）
  threadIds: [...new Set(engineActiveTurnIds.values())],
}));

ipcMain.handle("engine:check-update", async () => {
  const settings = await readAppSettings(app.getPath("userData"));
  return checkEngineUpdate(settings.engineProxyUrl?.trim() || undefined);
});

ipcMain.handle("engine:perform-update", async () => {
  if (engineUpdateRunning) throw new Error("引擎更新正在进行中，请稍候");
  engineUpdateRunning = true;
  try {
    const settings = await readAppSettings(app.getPath("userData"));
    const proxy = settings.engineProxyUrl?.trim() || undefined;
    // 有任务在跑就等它结束（最多 10 分钟），避免替换文件时引擎仍在写
    if (engineActiveTurnIds.size) {
      sendToWindow("engine:update:progress", { stage: "wait", detail: "等待当前任务结束后开始替换…" });
      const deadline = Date.now() + 10 * 60_000;
      while (engineActiveTurnIds.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // 替换二进制前必须停引擎（否则 codex.exe 被占用，rename 失败）
    server.stop();
    const result = await performEngineUpdate(proxy, (progress) => {
      sendToWindow("engine:update:progress", { stage: progress.stage, detail: progress.detail, percent: progress.percent });
    });
    if (!result.ok) {
      // 更新失败要把引擎拉起来，应用保持可用（引擎会加载旧/回滚后的二进制）
      await server.restart().catch(() => undefined);
    }
    return result;
  } finally {
    engineUpdateRunning = false;
  }
});
