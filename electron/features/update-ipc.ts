/**
 * 应用更新链 IPC（11-21 重写；替代已删除的 `features/updates-ipc.ts`）。
 *
 * 只有三个调用 + 一个推送，别再加通道：
 *   `update:check`    → 查最新版本（只读，⛔ 不下载）
 *   `update:download` → 下载 / 复用已下好的包（幂等、单飞）
 *   `update:install`  → 退出应用并起安装器（Windows `--updated`）
 *   `update:state`    ← 主进程主动推送状态快照（前端唯一数据源）
 *
 * ⛔ 安全口径（沿用 09-13 审计 P0）：渲染层**不能**指定下载地址或安装路径 ——
 *   地址来自 `latest.yml`（主进程读），安装路径来自主进程落盘的状态文件。
 * ⛔ 不在本文件写任何状态逻辑：状态机全在 `update-service.ts`，这里只做 IPC 转发与推送。
 */
import { app, shell } from "electron";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { onPrimaryWindowLoaded, sendToWindow } from "./window-bus";
import { GITHUB_REPO } from "../repo-info";
import { checkForUpdate, downloadUpdatePackage, getUpdateSnapshot, installUpdatePackage, restoreUpdateState, setUpdateNotifier } from "../update-service";

/** 本域全部通道（卸载时逐个摘掉，避免热重载叠 handler）。 */
const UPDATE_CHANNELS = ["update:check", "update:download", "update:install", "update:feedback"];

/** 更新 feature：注册三个调用通道，并把状态推送接到窗口。 */
export const updateFeature = defineFeature<null>({
  id: "update",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("update: 缺少 ipc 服务（宿主未提供）");

    /* 状态推送：服务层只认回调，窗口细节留在这一层。 */
    setUpdateNotifier((snapshot) => sendToWindow("update:state", snapshot));

    /* 启动即恢复：磁盘上已有就绪包 / 上次安装没完成，都要在首屏就体现在徽标上。
       ⛔ 失败静默：更新状态读不出来绝不能挡启动。
       ⛔⛔ 11-21 闭环修复：本域在组合层 `process.nextTick` 挂载，**早于窗口创建** ⇒
          restoreUpdateState 那一刻的推送发给的是「还不存在的窗口」，静默丢失；渲染层只能
          被动订阅、又没有主动拉取的通道 ⇒ 重启后明明有 ready 包，徽标却不显示「安装」。
          ⇒ 订阅「主窗口加载完成」，在那时把当前快照重放一次（idle 不推，渲染层初值就是 idle）。 */
    void restoreUpdateState().catch(() => undefined);
    const offLoaded = onPrimaryWindowLoaded(() => {
      const state = getUpdateSnapshot();
      if (state.phase === "idle") return;
      sendToWindow("update:state", state);
    });

    ipcHost.handle("update:check", async () => {
      try {
        return { ok: true, state: await checkForUpdate() };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err), state: getUpdateSnapshot() };
      }
    });

    ipcHost.handle("update:download", async () => {
      try {
        return { ok: true, state: await downloadUpdatePackage() };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err), state: getUpdateSnapshot() };
      }
    });

    ipcHost.handle("update:install", async () => {
      try {
        return await installUpdatePackage();
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err) };
      }
    });

    /* 意见反馈（11-21 用户令「加个反馈」）：打开本仓的 Issues 新建页，并把版本/平台预填进正文。
       ⛔ 仓库地址只在主进程有一份（`repo-info.ts`）⇒ URL 必须在这里拼，⛔ 别让渲染层写死
          —— 两仓同步时渲染层代码是同一份，写死会把 PPcode 的反馈发到主仓去。 */
    ipcHost.handle("update:feedback", async () => {
      const version = String(app.getVersion() || "");
      const title = encodeURIComponent(`[反馈] v${version}`);
      const body = encodeURIComponent(`\n\n---\n应用版本：v${version}\n平台：${process.platform} ${process.arch}\n`);
      const url = `https://github.com/${GITHUB_REPO}/issues/new?title=${title}&body=${body}`;
      await shell.openExternal(url);
      return { ok: true };
    });

    ctx.effect(() => {
      offLoaded();
      for (const channel of UPDATE_CHANNELS) ipcHost.removeHandler(channel);
      setUpdateNotifier(null);
    });
  },
});
