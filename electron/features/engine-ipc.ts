/**
 * engine-ipc（10-03 从 `features/engine-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：engine(4)
 * 通道：engine:restart-log / active-turns / check-update / perform-update
 *
 * ⛔ 引擎更新前必须**先停引擎再替换二进制**（否则 codex.exe 被占用，rename 失败）；
 *    有任务在跑要等它结束（最多 10 分钟），避免替换文件时引擎仍在写。
 * ⛔ 更新失败要把引擎拉起来（`server.restart()`）—— 应用保持可用（会加载旧/回滚后的二进制）。
 * ⛔ `engine:active-turns` 返回**会话级明细**不只是计数：渲染层收到快照式 idle 时不能凭它熄灭
 *    运行指示器，要与引擎侧真相核对。
 * ⛔ 待接缝化（阶段 2）：app 为宿主能力。
 */
import { app } from "electron";
import { readAppSettings } from "../app-settings";
import { checkEngineUpdate, performEngineUpdate } from "../engine-updater";
import { sendToWindow } from "./window-bus";
import { engineActiveTurnIds, server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const ENGINE_CHANNELS = ["engine:restart-log", "engine:active-turns", "engine:check-update", "engine:perform-update"];

/**
 * 引擎更新的**唯一流程实现**（10-13 抽出，手动按钮与后台自动更新共用）。
 *
 * ⛔⛔ 后台自动更新必须调这里，不许再抄一遍「等任务 → 停引擎 → 替换 → 失败回滚重启」——
 *    两处各写一份必漂移（本项目在技能更新上已经栽过一次）。
 * ⛔ 唯一接缝是 `onSuccess`：
 *    · 手动更新 ⇒ 不重启引擎，由渲染层倒计时后**重启整个应用**生效（既有交互，别改）；
 *    · 后台更新 ⇒ 必须 `server.restart()` 把引擎拉回来，否则引擎一直停着、应用等于残废
 *      （新二进制已落位，重启即生效，不需要重启应用）。
 * ⛔ 失败一律 `server.restart()`：应用保持可用（加载旧/回滚后的二进制）。
 */
export async function performEngineUpdateFlow(
  onSuccess?: (version: string, message: string) => void | Promise<void>,
): Promise<{ ok: boolean; version: string; message: string }> {
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
    return result;
  }
  await onSuccess?.(result.version, result.message);
  return result;
}

/** 引擎「检查更新」的唯一实现（手动与后台共用）：读当前版本 + 查 registry 最新版。 */
export async function checkEngineUpdateInfo(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
  const settings = await readAppSettings(app.getPath("userData"));
  return checkEngineUpdate(settings.engineProxyUrl?.trim() || undefined);
}

export const engineFeature = defineFeature<null>({
  id: "engine",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("engine: 缺少 ipc 服务（宿主未提供）");

    let engineUpdateRunning = false;

    ipcHost.handle("engine:restart-log", () => server.restartHistory());

    ipcHost.handle("engine:active-turns", () => ({
      count: server.activeTurnCount(),
      // 会话级明细（渲染层核实"这个会话到底还在不在跑"用：收到快照式的 thread/status/changed idle 时，
      // 不能凭它熄灭运行指示器，要与引擎侧真相核对——见 App.tsx 的 status/changed 分支）
      threadIds: [...new Set(engineActiveTurnIds.values())],
    }));

    ipcHost.handle("engine:check-update", () => checkEngineUpdateInfo());

    ipcHost.handle("engine:perform-update", async () => {
      if (engineUpdateRunning) throw new Error("引擎更新正在进行中，请稍候");
      engineUpdateRunning = true;
      try {
        // ⛔ 成功后**不**重启引擎：渲染层会倒计时重启整个应用（既有交互，别改）
        return await performEngineUpdateFlow();
      } finally {
        engineUpdateRunning = false;
      }
    });

    ctx.effect(() => {
      for (const ch of ENGINE_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
