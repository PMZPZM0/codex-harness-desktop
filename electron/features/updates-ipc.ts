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
import { mkdirSync, appendFileSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { sendToWindow } from "./window-bus";
import { showMacUpdateReminder } from "../update-splash";

import {
  checkLatestUpdate,
  defaultDownloadDir,
  pruneOldInstallers,
  downloadUpdate,
  downloadUpdateDifferential,
  hasDifferentialBaseline,
  ensureInstallerCache,
  pruneStaleInstallerCache,
  rememberDownloadedInstaller,
  fileExists,
  hasPendingDifferential,
  quitAndInstallDifferential,
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

    /* ⛔⛔ 启动即清**旧安装包**（10-17 用户令：「更新重启完成后把旧的安装包去了，否则越积越大」）。
      为什么放在"重启后"而不是"安装完立刻"：安装包拉起后本进程马上退出，那一刻删不掉
      （自己还握着句柄）；**新版本跑起来的这一刻**才是安全的清理点。
      ⛔ 静默 + 幂等：清不掉就留着，绝不影响启动（这里**不许抛**，也不许拖慢首屏）。 */
    try {
      const swept = pruneOldInstallers(defaultDownloadDir(app.getPath("downloads")));
      if (swept.removed > 0) {
        console.log(`[updates] 已清理 ${swept.removed} 个旧安装包（约 ${Math.round(swept.bytes / 1048576)}MB）`);
      }
    } catch { /* 清不掉不影响启动 */ }

    // ★ 更新链的主进程侧权威（09-13 审计 P0）：下载地址与安装路径**不再由渲染层决定**。
    //   `updates:check` 拿到的 info 存在这里，下载用它自己的 downloadUrl + sha256 校验，
    //   安装只接受"刚刚校验通过的那个文件"——渲染层即使被注入也换不掉安装包。
    let lastUpdateInfo: { downloadUrl?: string; sha256?: string; version?: string; tag?: string; filename?: string } | null = null;
    let lastVerifiedUpdatePath = "";
    /** 10-12：静默下载并发闸（重复触发时不重复下几百 MB）。 */
    let silentDownloading = false;

    /* ══════════════════════════════════════════════════════════════════════
     * 11-16 「启动就闪退、反反复复」的防线：安装前先落一个 pending 标记，
     * 下次启动若版本没变（安装没成功）就告诉渲染层「上次没装成」，
     * 渲染层据此暂停自动安装，避免每次开机都「下载 → 退出 → 再退出」死循环。
     * ⛔ 路径惰性取（本域早于 app.setPath("userData") 注册）。
     * ══════════════════════════════════════════════════════════════════════ */
    const pendingFile = () => path.join(app.getPath("userData"), "update-install-pending.json");
    /** 安装链落盘日志（11-20 用户实测「点重启就闪退、再无法更新」）：
     *  主进程一退，控制台什么都没留下，只能靠猜。这里把安装的每一步写进
     *  `<userData>/update-install.log`，下次出问题直接看现场。
     *  ⛔ 只写不读、失败静默 —— 日志绝不能反过来挡住安装。 */
    const installLog = (line: string): void => {
      try {
        appendFileSync(path.join(app.getPath("userData"), "update-install.log"), `[${new Date().toISOString()}] ${line}\n`);
      } catch { /* 写不了就跳过 */ }
    };
    const readPendingInstall = (): { version: string; at: number } | null => {
      try {
        const raw = JSON.parse(readFileSync(pendingFile(), "utf8"));
        const version = String(raw?.version ?? "").trim();
        if (!version) return null;
        return { version, at: Number(raw?.at ?? 0) };
      } catch { return null; }
    };
    const writePendingInstall = (version: string): void => {
      if (!version) return;
      try {
        mkdirSync(path.dirname(pendingFile()), { recursive: true });
        writeFileSync(pendingFile(), JSON.stringify({ version, at: Date.now() }), "utf8");
      } catch { /* 写不了就退化为旧行为（不加锁也不会更糟） */ }
    };
    const clearPendingInstall = (): void => {
      try { rmSync(pendingFile(), { force: true }); } catch { /* 忽略 */ }
    };
    /** 启动时判定：装成功了（版本已变）或标记过期就清掉；还停在旧版本 = 上次安装失败。 */
    const pendingInstallState = (): { version: string; at: number; failed: boolean } | null => {
      const pending = readPendingInstall();
      if (!pending) return null;
      const current = String(app.getVersion() || "0.0.0");
      if (pending.version === current || Date.now() - pending.at > 30 * 60_000) {
        clearPendingInstall();
        return null;
      }
      /* ⛔⛔ 11-20 用户实测「安装闪退，再就无法更新了」：原来这里判定失败后**不清标记** ⇒
         之后每次启动都报一次「上次安装失败」，更新状态机把自动安装永久挂起，看起来就是更新功能死了。
         ⇒ 失败只报一次，立刻清掉；下一次点「检查更新」会重新走完整流程（下载 → 安装）。 */
      clearPendingInstall();
      return { ...pending, failed: true };
    };

    /** 10-25 差分优先：Windows 且有版本信息时先走 electron-updater；
     *  任何失败（无 latest.yml / 无 blockmap / 镜像挂 / 校验失败）都返回 null，
     *  调用方继续原有的完整包下载。 */
    const tryDifferential = async (mode: "differential" | "full" | undefined, onProgress?: (info: { receivedBytes: number; totalBytes: number; percent: number }) => void) => {
      /* ⛔⛔ 11-15 方案 A（用户拍板）：**不再因为 mode==="full" 跳过 updater**。
         差分的基线（已安装版本的 blockmap）只有 electron-updater 自己安装时才登记；
         我们自建下载器 + spawn 安装器的老路永远不登记 ⇒ 每次更新都是整包（实测 386MB，与安装包同大）。
         ⇒ 一律先交给 updater：没有基线时它自己下整包（并且这次安装会建立基线），
            有基线时它下差分（几十兆）。它彻底不可用（镜像全挂 / 无 latest.yml）才回退自建下载器。
         ⛔ mode 现在只影响进度文案，不再影响走哪条通道 —— 想强制整包请把 latest.yml 去掉。 */
      const version = lastUpdateInfo?.version;
      if (!version) return null;
      /* ⛔ 11-20 重做（用户：「差分补丁删了重新做」）：先保证差分 oldFile 存在，
         再校验它没和当前已装版本错配 —— 这两步以前完全没做，全靠"安装器会写 installer.exe"
         这个假设；假设不成立时就是「不管怎么选都是完整包」。 */
      pruneStaleInstallerCache();
      const ensured = ensureInstallerCache();
      installLog(`差分前检查 oldFile：${ensured.ok ? "就绪（" + ensured.source + "）" : "缺失（" + ensured.source + "）"}`);
      try {
        const result = await downloadUpdateDifferential({ version, tag: lastUpdateInfo?.tag }, onProgress);
        lastVerifiedUpdatePath = result.path;
        /* 下载完成即登记：这个包就是安装后的「当前版本」，下一版差分拿它当 oldFile。 */
        rememberDownloadedInstaller(result.path, String(result.version ?? version));
        return { ...result, bytes: statSync(result.path).size };
      } catch (error: any) {
        console.warn("[updates] 差分更新失败，回退完整包：", error?.message ?? error);
        installLog(`差分失败，回退完整包：${error?.message ?? String(error)}`);
        return null;
      }
    };

    ipcHost.handle("updates:check", async () => {
      try {
        const currentVersion = String(app.getVersion() || "0.0.0");
        // ⛔ 09-15 用户定稿：更新源只剩 GitHub Releases（发布站不再分发安装包）
        const info = await checkLatestUpdate(currentVersion, process.platform, process.arch);
        lastUpdateInfo = info ? { downloadUrl: (info as any).downloadUrl, sha256: (info as any).sha256, version: (info as any).version, tag: (info as any).tag, filename: (info as any).filename } : null;
        return { ok: true, info, currentVersion, channel: UPDATE_CHANNEL, source: "github" as const, pendingInstall: pendingInstallState() };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    ipcHost.handle("updates:download", async (event: unknown, input: { downloadUrl?: string; filename?: string; mode?: "differential" | "full" }) => {
      // ⛔ 容器把 event 收窄成 unknown（宿主不该假设回调知道 Electron 类型面）⇒ 这里显式收窄，
      //    且只取 sender.send 一个能力（不把整个 IpcMainInvokeEvent 泄漏进业务逻辑）。
      const sender = event as UpdateSender;
      try {
        // 有"刚检查到的官方地址"就用它；渲染层传的地址只在没有检查结果时才作为兜底，
        // 而且无论如何都会被 downloadUpdate 的 https + sha256 双重校验挡住。
        const url = lastUpdateInfo?.downloadUrl || input?.downloadUrl;
        if (!url) return { ok: false, error: "没有可用的更新地址（请先检查更新）" };
        let lastPushed = -1;
        const pushProgress = (percent: number) => {
          const pct = Math.round(percent * 100);
          // 每 2% 推一次（+ 必定推 100%），避免高频 IPC 刷屏
          if (pct !== lastPushed && (pct - lastPushed >= 2 || pct >= 100)) {
            lastPushed = pct;
            sender.sender.send("updates:download-progress", percent);
          }
        };
        // 10-25 差分优先：失败自动回退下面的完整包下载
        const differential = await tryDifferential(input?.mode, ({ percent }) => pushProgress(percent));
        if (differential) {
          return { ok: true, path: differential.path, bytes: differential.bytes, differential: true };
        }
        const dir = defaultDownloadDir(app.getPath("downloads"));
        const safeName = String(input?.filename || lastUpdateInfo?.filename || "codex-harness-update.bin").replace(/[\\/:*?"<>|]/g, "_");
        const dest = path.join(dir, safeName);
        const info = await downloadUpdate(url, dest, ({ percent }) => pushProgress(percent), lastUpdateInfo?.sha256);
        lastVerifiedUpdatePath = info.path;   // 只有校验通过才会走到这里
        rememberDownloadedInstaller(info.path, String(lastUpdateInfo?.version ?? ""));
        return { ok: true, path: info.path, bytes: info.bytes, differential: false };
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
      if (started && process.platform === "darwin") showMacUpdateReminder(String(lastUpdateInfo?.version ?? ""));
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
    ipcHost.handle("updates:download-silent", async (_event, input?: { mode?: "differential" | "full" }) => {
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
          lastUpdateInfo = info ? { downloadUrl: (info as any).downloadUrl, sha256: (info as any).sha256, version: (info as any).version, tag: (info as any).tag, filename: (info as any).filename } : null;
        } catch {
          return { ok: false, error: "check_failed" };
        }
      }
      const url = lastUpdateInfo?.downloadUrl;
      if (!url) return { ok: false, error: "no_update" };
      const version = lastUpdateInfo?.version ?? "";
      /* 11-16 用户令「做一个更新进度条」：静默下载原本一个进度事件都不推，
         用户只看到界面突然关闭。现在把下载百分比/字节数推给渲染层做常驻进度条。 */
      let lastPct = -1;
      const pushState = (info: { receivedBytes: number; totalBytes: number; percent: number }) => {
        const percent = Math.max(0, Math.min(1, Number(info.percent) || 0));
        const pct = Math.round(percent * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        sendToWindow("updates:download-state", {
          active: true, phase: "download", percent,
          receivedBytes: info.receivedBytes, totalBytes: info.totalBytes, version,
        });
      };
      /* 11-19 用户令 A：选「补丁」但本机无基线时必须**明说**本次是整包（⛔ 不许静默回退）。 */
      const baseline = hasDifferentialBaseline();
      const noBaselineNote = !baseline && input?.mode !== "full";
      sendToWindow("updates:download-state", { active: true, phase: "download", percent: 0, version, noBaseline: noBaselineNote });
      silentDownloading = true;
      try {
        // 10-25 差分优先；失败继续走下面的完整包
        const differential = await tryDifferential(input?.mode, pushState);
        if (differential) {
          sendToWindow("updates:download-state", { active: false, phase: "download", percent: 1, version });
          sendToWindow("updates:ready", { version: lastUpdateInfo?.version, path: differential.path });
          return { ok: true, version: lastUpdateInfo?.version, path: differential.path, differential: true };
        }
        const dir = defaultDownloadDir(app.getPath("downloads"));
        const safeName = String(lastUpdateInfo?.filename || "codex-harness-update.bin").replace(/[\\/:*?"<>|]/g, "_");
        const info = await downloadUpdate(url, path.join(dir, safeName), pushState, lastUpdateInfo?.sha256);
        lastVerifiedUpdatePath = info.path;
        /* 11-20：完整包也登记成 oldFile —— 下一版才有差分基准（不再只靠安装器写）。 */
        rememberDownloadedInstaller(info.path, String(lastUpdateInfo?.version ?? ""));
        sendToWindow("updates:download-state", { active: false, phase: "download", percent: 1, version });
        // ⛔ 主动推一条事件：渲染层可能没打开设置页，只能靠事件弹窗（需求 3）。
        sendToWindow("updates:ready", { version: lastUpdateInfo?.version, path: info.path });
        return { ok: true, version: lastUpdateInfo?.version, path: info.path, differential: false, noBaseline: noBaselineNote };
      } catch (err: any) {
        sendToWindow("updates:download-state", { active: false, phase: "download", percent: 0, version });
        return { ok: false, error: err?.message || String(err) };
      } finally {
        silentDownloading = false;
      }
    });

    /**
     * 「重启安装」：退出应用并拉起已校验的安装包。
     *
     * ⛔⛔ 11-15 用户实测「点重启更新，应用关了、安装提醒出来一下就没装成」：
     *   **差分包必须由下载它的 electron-updater 自己去装**（`quitAndInstall(true, true)`
     *   ＝ `/S` 静默安装 + 装完自动拉起新版本）。11-16 起 `nsis.oneClick=true`（每用户安装），
     *   安装器本身不再有向导/UAC；这段说明保留历史成因。
     *   ⛔ 顺序仍守「先起安装动作、再退出自己」：quitAndInstall 内部就是先拉起安装器再退出。
     *   ⛔ 完整包路径（手动下的 `Codex.Harness.Desktop-*.exe`）同理要带 `/S`，
     *     否则同样把用户丢进向导；only macOS 不适用（NSIS 专属，其余平台返回明确错误）。
     */
    ipcHost.handle("updates:restart-install", async () => {
      if (!lastVerifiedUpdatePath) return { ok: false, error: "no_verified_update" };
      if (!fileExists(lastVerifiedUpdatePath)) return { ok: false, error: "file_not_found" };
      if (process.platform !== "win32") {
        /* mac 没有 NSIS 静默安装：弹原生通知告诉用户「打开压缩包、拖进应用程序」。 */
        if (process.platform === "darwin") showMacUpdateReminder(String(lastUpdateInfo?.version ?? ""));
        return { ok: false, error: "unsupported_platform" };
      }
      /* ⚠️ 等一小会儿让调用方（渲染层）先把 toast 收起来，否则退出瞬间还在闪。 */
      await new Promise((r) => setTimeout(r, 120));
      const targetVersion = String(lastUpdateInfo?.version ?? "");
      installLog(`restart-install 开始：target=${targetVersion} current=${app.getVersion()} differential=${hasPendingDifferential()} installer=${lastVerifiedUpdatePath}`);
      /* 安装窗口：渲染层据此显示「正在安装更新，应用即将重启」全屏遮罩。 */
      writePendingInstall(targetVersion);
      sendToWindow("updates:download-state", { active: true, phase: "installing", percent: 1, version: targetVersion });
      /* ⛔⛔ 11-20 用户两次报「安装的时候没有进度条提醒」的最终解法：
         放弃「自己画小窗」（PowerShell 版冷启动 2–4 秒、装完才出来；独立 Electron 入口在打包后的
         exe 上又未必接受脚本参数），改成**让安装器自己显示进度页** —— 非静默安装。
         oneClick 安装器（`templates/nsis/oneClick.nsh`）只有 `MUI_PAGE_INSTFILES` 一个页面，
         没有向导页、没有完成页 ⇒ 用户看到一个真实进度的窗口，装完自动关闭并拉起新版本，零交互。 */
      if (hasPendingDifferential()) {
        try {
          installLog("differential：调用 quitAndInstall（非静默，显示安装器进度页），应用即将退出");
          quitAndInstallDifferential(false);
          return { ok: true, via: "differential" };
        } catch (error) {
          /* ⛔⛔ 这里**不许**回退到 spawn 安装包：updater 可能已经把第一个安装器拉起来了，
             再 spawn 第二个 ⇒ 两个 NSIS 实例抢同一个 $INSTDIR，前一个删文件、后一个写不进去，
             症状正是「安装窗闪一下、版本没变」。失败就如实回报，让用户重试一次，⛔ 不制造双安装。 */
          const msg = (error as Error)?.message ?? String(error);
          console.warn("[updates] 差分静默安装没能启动（不回落 spawn）:", msg);
          installLog(`differential：失败 ${msg}`);
          clearPendingInstall();
          sendToWindow("updates:download-state", { active: false, phase: "installing", percent: 0, version: targetVersion });
          return { ok: false, error: `differential_install_failed: ${msg}` };
        }
      }
      try {
        /* ② 完整包 / 回退路径：`--updated` 告诉 electron-builder 的 installer.nsh「这是覆盖更新」，
         装完会**自动拉起新版本**。
         ⛔⛔ 11-20 起**不再带 `/S`**：静默安装没有任何界面，用户的原话就是「安装的时候没有进度条提醒」；
            oneClick 安装器只有 `MUI_PAGE_INSTFILES` 一个页面 ⇒ 非静默 = 一个真实进度条窗口，
            没有向导页、没有需要点「下一步/完成」的地方（`nsis.oneClick = true`，守卫 12h 钉着）。
            ⛔ 若将来把 oneClick 改回 assisted，这条必须跟着加回 `/S`，否则会弹安装目录向导。 */
        // ⛔ spawn 不 wait：安装包是独立进程，等它结束就等于永远不退出。
        spawn(lastVerifiedUpdatePath, ["--updated"], { detached: true, stdio: "ignore" }).unref();
        installLog(`installer：已 spawn ${lastVerifiedUpdatePath} --updated（非静默，显示进度页）`);
        // ⛔ 引擎与各子进程的收尾**不在这里手写**：`app.quit()` 会触发 main.ts 的
        //    `before-quit`，那里已经统一做 cleanupAll / 停看门狗 / 断 SSH / 销毁语音工作线程。
        //    （原先这里写了一个 `server.stop?.().catch()` —— `server` 上根本没有 stop 方法，
        //      TS 直接报错；而且即便有，手写收尾也会与 before-quit 的那套**重复执行**。）
        app.quit();
        return { ok: true, via: "installer" };
      } catch (err: any) {
        /* 安装没起来：清掉 pending 标记并收起遮罩，否则下次启动会误判「上次安装失败」。 */
        installLog(`installer：spawn 失败 ${err?.message || String(err)}`);
        clearPendingInstall();
        sendToWindow("updates:download-state", { active: false, phase: "installing", percent: 0, version: targetVersion });
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
