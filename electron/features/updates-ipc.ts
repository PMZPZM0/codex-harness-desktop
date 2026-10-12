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
import { spawn } from "node:child_process";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { sendToWindow } from "./window-bus";

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
    /** 10-12：静默下载并发闸（重复触发时不重复下几百 MB）。 */
    let silentDownloading = false;

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

    /* ══════════════════════════════════════════════════════════════════════
     * 10-12 新增：后台静默下载 + 「重启安装」通道（修「下载完还要自己找安装包」）
     *
     * ⛔⛔ **为什么 `updates:install` 不够用**：它只 `shell.openPath(exe)` 把安装向导
     *   拉起来，而应用进程还在跑 —— NSIS 覆盖安装要求先关掉旧进程，于是安装向导
     *   弹出「无法关闭，请手动关闭」，或干脆被浏览器/安全软件抢了打开方式而失败。
     *   旧逻辑失败即静默退回「打开文件夹」（界面只弹一句"请手动安装"）⇒ 用户体验
     *   就是「下载完还得自己找包、自己装」。**正解是 quit-and-install**：
     *   先退出应用（清干净引擎与文件占用），再拉起安装包。
     *
     * ⛔ 安全口径**沿用** `updates:install` 那条（09-13 审计 P0）：只接受
     *   「刚刚下载并 sha256 校验通过的那个文件」，渲染层传任意路径一律拒。
     *   静默下载走的是**主进程自己取的地址**（lastUpdateInfo），不接受渲染层指定。
     * ══════════════════════════════════════════════════════════════════════ */

    /** 后台静默下载 → 校验通过后置位；已就绪时再次调用直接返回（幂等）。 */
    ipcHost.handle("updates:download-silent", async () => {
      // ⛔ 幂等：已经下好并校验过就别重复下几百 MB。
      if (lastVerifiedUpdatePath && fileExists(lastVerifiedUpdatePath)) {
        return { ok: true, alreadyDone: true, version: lastUpdateInfo?.version, path: lastVerifiedUpdatePath };
      }
      if (silentDownloading) return { ok: false, error: "already_downloading" };
      // ⛔ 没检查过就没有权威地址：静默下载**自己检查一次**，绝不接受渲染层给的 URL。
      if (!lastUpdateInfo?.downloadUrl) {
        try {
          const currentVersion = String(app.getVersion() || "0.0.0");
          const info = await checkLatestUpdate(currentVersion, process.platform, process.arch);
          lastUpdateInfo = info ? { downloadUrl: (info as any).downloadUrl, sha256: (info as any).sha256, version: (info as any).version, filename: (info as any).filename } : null;
        } catch {
          return { ok: false, error: "check_failed" };
        }
      }
      const url = lastUpdateInfo?.downloadUrl;
      if (!url) return { ok: false, error: "no_update" };
      silentDownloading = true;
      try {
        const dir = defaultDownloadDir(app.getPath("downloads"));
        const safeName = String(lastUpdateInfo?.filename || "codex-harness-update.bin").replace(/[\\/:*?"<>|]/g, "_");
        const info = await downloadUpdate(url, path.join(dir, safeName), undefined, lastUpdateInfo?.sha256);
        lastVerifiedUpdatePath = info.path;
        // ⛔ 主动推一条事件：渲染层可能没打开设置页，只能靠事件弹窗（需求 3）。
        sendToWindow("updates:ready", { version: lastUpdateInfo?.version, path: info.path });
        return { ok: true, version: lastUpdateInfo?.version, path: info.path };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      } finally {
        silentDownloading = false;
      }
    });

    /**
     * 「重启安装」：退出应用并拉起已校验的安装包。
     *
     * ⛔ 顺序至关重要：**先起安装包、再退出自己**。反过来（先 quit 再 spawn）的话，
     *   本进程持有的 exe 锁没释放，安装包会撞上「无法关闭」。
     *   ⛔ macOS 上 NSIS 不适用，走的是 dmg 拖拽；这里只在 win32 上提供此通道，
     *   其余平台返回明确错误让界面改用「打开文件夹」。
     */
    ipcHost.handle("updates:restart-install", async () => {
      if (!lastVerifiedUpdatePath) return { ok: false, error: "no_verified_update" };
      if (!fileExists(lastVerifiedUpdatePath)) return { ok: false, error: "file_not_found" };
      if (process.platform !== "win32") {
        return { ok: false, error: "unsupported_platform" };
      }
      try {
        // ⚠️ 等一小会儿让调用方（渲染层）先把 toast 收起来，否则退出瞬间还在闪。
        await new Promise((r) => setTimeout(r, 120));
        // ⛔ spawn 不 wait：安装包是独立进程，等它结束就等于永远不退出。
        spawn(lastVerifiedUpdatePath, [], { detached: true, stdio: "ignore" }).unref();
        // ⛔ 引擎与各子进程的收尾**不在这里手写**：`app.quit()` 会触发 main.ts 的
        //    `before-quit`，那里已经统一做 cleanupAll / 停看门狗 / 断 SSH / 销毁语音工作线程。
        //    （原先这里写了一个 `server.stop?.().catch()` —— `server` 上根本没有 stop 方法，
        //      TS 直接报错；而且即便有，手写收尾也会与 before-quit 的那套**重复执行**。）
        app.quit();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ctx.effect(() => {
      for (const channel of UPDATE_CHANNELS) ipcHost.removeHandler(channel);
      // 新增通道也要在卸载时摘掉（否则热重载会叠 handler）。
      ipcHost.removeHandler("updates:download-silent");
      ipcHost.removeHandler("updates:restart-install");
    });
  },
});
