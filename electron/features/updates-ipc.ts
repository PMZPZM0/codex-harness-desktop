/**
 * updates-ipc（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁；
 *            10-03 改插件形态，P2 批次 2）
 *
 * 域：**应用更新链**（检查更新 / 下载 / 定位安装包 / 运行安装）。
 * 搬出符号：IPC handler updates:check / updates:download / updates:reveal / updates:install，
 *          及其权威状态 lastUpdateInfo / lastVerifiedUpdatePath。
 * 消费方：设置 → 控制台 → Codex 引擎更新。
 *
 * 跨域符号（checkLatestUpdate / downloadUpdate / installUpdate / defaultDownloadDir /
 * fileExists / UPDATE_CHANNEL）直接来自 ./updates，不依赖 main.ts，零跨域耦合。
 *
 * ── 10-03 插件化 ────────────────────────────────────────────────────────────
 *   · `inject: ["ipc"]` + `ipcHost.handle`，⛔ 不再直接 import `ipcMain`；
 *   · 两个**权威状态**（lastUpdateInfo / lastVerifiedUpdatePath）搬进 setup 闭包 ——
 *     它们本来就是"本域私有状态"，进闭包后随卸载一起消失（更干净）；
 *   · 四个通道的全部安全校验（"只认刚校验通过的那个包"）**逐字保留**；
 *   · `ctx.effect` 卸载摘通道。
 * ⛔ 注册时机不变：生成物在主进程模块加载期 import 本文件 ⇒ handler 立即注册（早于 whenReady）。
 */
import { app, shell } from "electron";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import {
  checkLatestUpdate,
  defaultDownloadDir,
  downloadUpdate,
  fileExists,
  installUpdate,
  UPDATE_CHANNEL,
} from "../updates";

/** handler 里用到的发送端形状（⛔ 不写 any：只需要 sender.send 这一个能力）。 */
type UpdateSender = { sender: { send(channel: string, payload: unknown): void } };

const UPDATE_CHANNELS = ["updates:check", "updates:download", "updates:reveal", "updates:install"];

export const updatesFeature = defineFeature<null>({
  id: "updates",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("updates: 缺少 ipc 服务（宿主未提供）");

    // ★ 更新链的主进程侧权威（09-13 审计 P0）：下载地址与安装路径**不再由渲染层决定**。
    //   `updates:check` 拿到的 info 存在这里，下载用它自己的 downloadUrl + sha256 校验，
    //   安装只接受"刚刚校验通过的那个文件"——渲染层即使被注入也换不掉安装包。
    let lastUpdateInfo: { downloadUrl?: string; sha256?: string; version?: string; filename?: string } | null = null;
    let lastVerifiedUpdatePath = "";

    ipcHost.handle("updates:check", async () => {
      try {
        const currentVersion = String(app.getVersion() || "0.0.0");
        // ⛔ 09-15 用户定稿：更新源只剩 GitHub Releases（发布站不再分发安装包）
        const info = await checkLatestUpdate(currentVersion, process.platform, process.arch);
        lastUpdateInfo = info ? { downloadUrl: (info as any).downloadUrl, sha256: (info as any).sha256, version: (info as any).version, filename: (info as any).filename } : null;
        return { ok: true, info, currentVersion, channel: UPDATE_CHANNEL, source: "github" as const };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ipcHost.handle("updates:download", async (event: unknown, input: { downloadUrl?: string; filename?: string }) => {
      // ⛔ 容器把 event 收窄成 unknown（宿主不该假设回调知道 Electron 类型面）⇒ 这里显式收窄，
      //    且只取 sender.send 一个能力（不把整个 IpcMainInvokeEvent 泄漏进业务逻辑）。
      const sender = event as UpdateSender;
      try {
        // 有"刚检查到的官方地址"就用它；渲染层传的地址只在没有检查结果时才作为兜底，
        // 而且无论如何都会被 downloadUpdate 的 https + sha256 双重校验挡住。
        const url = lastUpdateInfo?.downloadUrl || input?.downloadUrl;
        if (!url) return { ok: false, error: "没有可用的更新地址（请先检查更新）" };
        const dir = defaultDownloadDir(app.getPath("downloads"));
        const safeName = String(input?.filename || lastUpdateInfo?.filename || "codex-harness-update.bin").replace(/[\\/:*?"<>|]/g, "_");
        const dest = path.join(dir, safeName);
        let lastPushed = -1;
        const info = await downloadUpdate(url, dest, ({ percent }) => {
          const pct = Math.round(percent * 100);
          // 每 2% 推一次（+ 必定推 100%），避免高频 IPC 刷屏
          if (pct !== lastPushed && (pct - lastPushed >= 2 || pct >= 100)) {
            lastPushed = pct;
            sender.sender.send("updates:download-progress", percent);
          }
        }, lastUpdateInfo?.sha256);
        lastVerifiedUpdatePath = info.path;   // 只有校验通过才会走到这里
        return { ok: true, path: info.path, bytes: info.bytes };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ipcHost.handle("updates:reveal", async (_event, filePath: string) => {
      // ⛔ 隐私加固（09-19 审计中危）：只允许定位「刚下载并通过 sha256 校验的那个安装包」，
      // 与 updates:install 同一口径——渲染层传任意其它路径一律拒绝。
      if (!lastVerifiedUpdatePath) return { ok: false, error: "no_verified_update" };
      if (path.resolve(String(filePath ?? "")) !== path.resolve(lastVerifiedUpdatePath)) return { ok: false, error: "path_not_verified" };
      shell.showItemInFolder(lastVerifiedUpdatePath);
      return { ok: true };
    });

    // 下载完成后运行安装包：交给系统默认程序打开（Windows 下即启动安装向导）
    // ⛔ 只接受**刚刚下载并通过 sha256 校验的那个文件**（09-13 审计 P0）：此前渲染层可以传任意
    // 路径进来，配合"下载地址也由渲染层给"就构成"任意 exe 落盘并执行"。渲染层被注入时也换不掉。
    ipcHost.handle("updates:install", async (_event, filePath: string) => {
      if (!lastVerifiedUpdatePath) return { ok: false, error: "no_verified_update" };
      if (path.resolve(String(filePath ?? "")) !== path.resolve(lastVerifiedUpdatePath)) {
        return { ok: false, error: "path_not_verified" };
      }
      if (!fileExists(lastVerifiedUpdatePath)) return { ok: false, error: "file_not_found" };
      const started = await installUpdate(lastVerifiedUpdatePath);
      return { ok: started, error: started ? undefined : "open_failed" };
    });

    ctx.effect(() => {
      for (const channel of UPDATE_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
