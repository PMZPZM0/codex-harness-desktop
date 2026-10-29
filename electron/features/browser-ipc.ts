/**
 * browser-ipc —— 浏览器域（内置预览窗 / Ego Lite 浏览器自动化）。
 *
 * 域：browser(6)
 * 通道：browser:ego-status / browser:ego-install / browser:ego-open / browser:ego-cleanup / browser:popout /
 *      browser:clear-data（清内置浏览器的登录态/缓存，10-29）
 *
 * 10-22 用户拍板：用 ego lite 替换 CloakBrowser 指纹浏览器，浏览器自动化优先走 ego；
 * 每个 Codex 会话一个独立 TaskSpace，共存并发。ego 本体不随应用内置（安装目录约 611MB），
 * 这里只负责**发现已装 CLI / 打开官方下载页 / 打开 GUI / 归档会话时回收 Space**。
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { BrowserWindow, app, session, shell } from "electron";
import { egoAppPath, egoBrowserPath, egoBrowserVersion, runEgoUpgrade } from "../toolchain";
import { ensureEgoBrowserSkill } from "../builtin-skills";
import { filePreviewAllowed } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

/** 内置浏览器 webview 的**持久分区**：登录态跟着它落盘（⛔ 别改成内存分区，否则重启就掉登录）。 */
export const BROWSER_PARTITION = "persist:harness-browser";

/** 官方下载页会自动识别 Windows / macOS（只带安装器，不内置 611MB 解包目录）。 */
const EGO_DOWNLOAD_URL = "https://lite.ego.app/download?auto=1";

/** 清理指定会话（或全部 codex-*）的 Space。
 *  ⛔ 用 `taskSpace(name)` 续用自己的 Space 再 finish；`claimTaskSpace` 对脚本已退出的 Space
 *    会等控制权（实测 20s 超时），归档回收必须走名字续用。
 *  ⛔ threadId 由主进程拼进脚本前必须 JSON.stringify，禁止字符串插值裸拼（防脚本注入）。 */
function cleanupEgoSpaces(cli: string, threadId: string): Promise<{ ok: boolean; cleaned: number; detail: string }> {
  const script = `
const target = ${JSON.stringify(threadId)};
const wanted = target ? "codex-" + target : "codex-";
const names = target
  ? [wanted]
  : (await listTaskSpaces()).map((entry) => String(entry?.name || "")).filter((name) => name.startsWith(wanted));
let cleaned = 0;
for (const name of names) {
  try {
    const task = await taskSpace(name);
    await task.finish({ keep: [] });
    cleaned += 1;
  } catch { /* 正在被别的会话占用：留给手动清理 */ }
}
console.log(JSON.stringify({ cleaned }));
`;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { ok: boolean; cleaned: number; detail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // ⛔ 用 stdin 传脚本（`nodejs < script` 同款）；`-e` 对多行/双引号脚本在 Windows
    //    ego CLI 上会卡住不退出（实测 20s 超时），且脚本结果走 stderr。
    const child = spawn(cli, ["nodejs"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin?.end(script);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已退出 */ }
      finish({ ok: false, cleaned: 0, detail: "清理 ego 工作区超时（20 秒）" });
    }, 20_000);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish({ ok: false, cleaned: 0, detail: error.message }));
    child.once("exit", (code) => {
      const combined = `${stdout}\n${stderr}`.trim();
      if (code !== 0) return finish({ ok: false, cleaned: 0, detail: combined.slice(-300) || `ego-browser 退出（${code}）` });
      const match = combined.match(/\{"cleaned":(\d+)\}/);
      return finish({ ok: true, cleaned: match ? Number(match[1]) : 0, detail: "" });
    });
  });
}

export const browserFeature = defineFeature<null>({
  id: "browser",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("browser: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("browser:ego-status", async () => {
      const cliPath = egoBrowserPath();
      // 安装/引导完成后重新检测：顺手把官方 ego-browser 技能镜像进 Codex 技能目录，
      // 不用等下一次应用重启（引擎的新会话会重新读 skills）。
      if (cliPath) await ensureEgoBrowserSkill(path.join(app.getPath("userData"), "codex-home", "skills"));
      return {
        installed: Boolean(cliPath),
        cliPath,
        version: cliPath ? egoBrowserVersion() : "",
        appPath: egoAppPath(),
        platform: process.platform,
        downloadUrl: EGO_DOWNLOAD_URL,
      };
    });

    ipcHost.handle("browser:ego-install", async () => {
      await shell.openExternal(EGO_DOWNLOAD_URL);
      return {
        ok: true,
        detail: "已打开 ego lite 官方下载页：安装并完成首次引导后，回来点「重新检测」。Windows 安装包较小，首次启动会下载约 600MB 的 Chromium。",
      };
    });

    ipcHost.handle("browser:ego-open", async () => {
      const appPath = egoAppPath();
      if (appPath) {
        const error = await shell.openPath(appPath);
        if (!error) return { ok: true, detail: "已打开 ego lite" };
      }
      await shell.openExternal(EGO_DOWNLOAD_URL);
      return { ok: false, detail: "没找到 ego lite 启动器，已打开官方下载页" };
    });

    ipcHost.handle("browser:ego-upgrade", async () => {
      const before = egoBrowserVersion();
      const result = await runEgoUpgrade();
      const after = egoBrowserVersion();
      return { ...result, before, after, changed: Boolean(before && after && before !== after) };
    });

    ipcHost.handle("browser:ego-cleanup", async (_event, threadId?: string) => {
      const cli = egoBrowserPath();
      if (!cli) return { ok: false, cleaned: 0, detail: "ego lite 未安装" };
      const safeThreadId = String(threadId ?? "").replace(/[^0-9a-zA-Z_-]/g, "");
      return cleanupEgoSpaces(cli, safeThreadId);
    });

    /* 10-29 用户：「浏览器加一个 cookie 登录态保存功能，还有浏览器记录清空功能」。
       登录态 = webview 用 `persist:harness-browser` 这个**持久分区**（见 BrowserPane 的 partition 属性），
       关掉应用也在；这里提供清空入口 —— 清的是那个分区，⛔ 不碰主应用 session（避免连带踢掉账号登录态）。
       kind=cookies ⇒ 只清登录态（cookie / localStorage / indexedDB / cacheStorage）；
       kind=all     ⇒ 再把 HTTP 缓存也清掉。 */
    ipcHost.handle("browser:clear-data", async (_event, kind?: string) => {
      const target = session.fromPartition(BROWSER_PARTITION);
      const storages = ["cookies", "localstorage", "indexdb", "cachestorage", "serviceworkers"] as const;
      await target.clearStorageData({ storages: [...storages] });
      if (String(kind ?? "") === "all") await target.clearCache();
      return { ok: true, partition: BROWSER_PARTITION, cleared: kind === "all" ? "all" : "cookies" };
    });

    ipcHost.handle("browser:popout", async (_event, value: string) => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:" && !filePreviewAllowed(url)) throw new Error("Unsupported URL");
      const pop = new BrowserWindow({
        width: 1180,
        height: 800,
        minWidth: 480,
        minHeight: 320,
        title: "预览",
        autoHideMenuBar: true,
        backgroundColor: "#1b1b1a",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      pop.setMenuBarVisibility(false);
      void pop.loadURL(url.toString());
      return { ok: true };
    });

    ctx.effect(() => {
      for (const ch of ["browser:ego-status", "browser:ego-install", "browser:ego-open", "browser:ego-upgrade", "browser:ego-cleanup", "browser:popout"]) ipcHost.removeHandler(ch);
    });
  },
});
