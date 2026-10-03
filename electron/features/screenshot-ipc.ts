/**
 * screenshot 域（09-24；**10-03 P2 批次 8 从合并文件 `screenshot-favorites-ipc.ts` 拆出**）。
 *
 * 域：**截图**（隐藏窗口全屏 + 冻结帧框选，两种模式各绑一条全局快捷键）。
 * 通道：screenshot:settings-get / settings-set / hotkey-set / capture / pick-dir / reveal
 *
 * ⛔ 拆分口径（本项目硬规则）：**一个文件恒等于一个域前缀**。原来把截图与收藏夹合在一个
 *   文件里（理由是"同一条用户素材链、避免两个文件互相 import 成环"），但两者其实只共享
 *   一个三行的 `userDataDir()` —— 拆开各自持有一份，比"一个文件两个前缀"的例外便宜得多。
 *   守卫【253】有棘轮盯着这条不许再长回来。
 *
 * ⛔ 所有 `app.getPath("userData")` 都在 **handler 内部**求值，不在模块顶层 ——
 *    main.ts 的 `app.setPath("userData", …)` 是模块体语句，被 import 的模块体先于它运行，
 *    顶层求值会拿到默认目录（路径静默漂移，守卫【91】盯死这一条）。
 */
import { app, BrowserWindow, dialog, globalShortcut } from "electron";
import path from "node:path";
import {
  DEFAULT_SCREENSHOT_SETTINGS,
  captureScreenshot,
  createHotkeyRegistry,
  defaultShotDir,
  readScreenshotSettings,
  revealShot,
  writeScreenshotSettings,
  type ScreenshotSettings,
  type ShotMode,
} from "../screenshot";
import { allBusWindows, sendToWindow } from "./window-bus";
import { copyImageFileToClipboard } from "./clipboard-ipc";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function userDataDir(): string {
  return app.getPath("userData");
}

/** 主窗口（window-bus 的 primary 列表第一个；没有就退回任意窗口）。 */
function mainWindow(): BrowserWindow | null {
  const windows = allBusWindows();
  return windows[0] ?? BrowserWindow.getAllWindows()[0] ?? null;
}

/* ── 全局快捷键 + 截图 ───────────────────────────────────────────── */

const hotkeys = createHotkeyRegistry(globalShortcut as any);
/** 最近一次注册失败的说明（设置页照实显示，不假装成功）。 */
const hotkeyError: Partial<Record<ShotMode, string>> = {};

async function capture(mode: ShotMode): Promise<ReturnType<typeof captureScreenshot>> {
  const settings = await readScreenshotSettings(userDataDir());
  const result = await captureScreenshot({ window: mainWindow(), userData: userDataDir() }, mode, settings);
  if (result.ok) {
    // 确认即复制（与微信/QQ 截图同款）：让图「有去处」——粘贴 anywhere 都能用，不只是躺在输入框
    try {
      await copyImageFileToClipboard(result.path);
    } catch (error: unknown) {
      console.error("[screenshot] 写剪贴板失败（不影响落盘与插入）：", error);
    }
    // 单一插入路径：成功一律**推事件**，渲染层只认事件 ⇒ 不会因为「invoke 返回 + 事件」双通道而插两份。
    sendToWindow("screenshot:captured", { ...result, at: Date.now() });
  }
  return result;
}

function fire(mode: ShotMode) {
  void capture(mode).catch((error: unknown) => console.error(`[screenshot] ${mode} 失败：`, error));
}

/** 启动时按已保存设置注册一次（与语音热键同口径：注册失败只记录，不阻断启动）。 */
function registerSavedHotkeys() {
  void readScreenshotSettings(userDataDir()).then((settings) => {
    for (const mode of ["full", "region"] as ShotMode[]) {
      const slot = settings[mode];
      if (!slot.enabled || !slot.accelerator) continue;
      const result = hotkeys.apply(mode, slot.accelerator, () => fire(mode));
      if (!result.ok) hotkeyError[mode] = result.error;
      else delete hotkeyError[mode];
    }
  }).catch((error: unknown) => console.error("[screenshot] 热键注册失败：", error));
}

async function screenshotSettingsGet() {
  const settings = await readScreenshotSettings(userDataDir());
  return {
    settings,
    registered: { ...hotkeys.registered },
    errors: { ...hotkeyError },
    defaultDir: defaultShotDir(userDataDir()),
    // 默认值从主进程带走：渲染层不再抄一份常量（抄了就会与主进程分叉，「恢复默认」恢复出个旧值）
    defaults: DEFAULT_SCREENSHOT_SETTINGS,
    platform: process.platform,
  };
}

async function screenshotSettingsSet(patch: Partial<ScreenshotSettings>) {
  const next = await writeScreenshotSettings(userDataDir(), patch ?? {});
  // 设置变更后立刻重挂快捷键：不然「改完不生效，要重启」
  for (const mode of ["full", "region"] as ShotMode[]) {
    const slot = next[mode];
    const result = hotkeys.apply(mode, slot.enabled ? slot.accelerator : "", () => fire(mode));
    if (!result.ok) hotkeyError[mode] = result.error;
    else delete hotkeyError[mode];
  }
  return { settings: next, registered: { ...hotkeys.registered }, errors: { ...hotkeyError } };
}

async function screenshotHotkeySet(input: { mode: ShotMode; accelerator?: string; enabled?: boolean }) {
  const mode: ShotMode = input?.mode === "region" ? "region" : "full";
  const current = await readScreenshotSettings(userDataDir());
  const accelerator = input?.enabled === false ? "" : String(input?.accelerator ?? "");
  if (!accelerator) {
    // 关掉这个模式：注销 + 落盘 enabled=false（保留 accelerator 供下次开回来）
    const applied = hotkeys.apply(mode, "", () => fire(mode));
    const next = await writeScreenshotSettings(userDataDir(), { [mode]: { enabled: false, accelerator: current[mode].accelerator } } as any);
    return { ok: applied.ok, error: applied.error, settings: next };
  }
  // ⛔ 先注册、成功才落盘：注册失败时若先落盘，配置里存的就是一个注册不上的死键，
  //    且旧快捷键已被注销 ⇒ 重启后永远失联。失败保留原设置并明确报错。
  const applied = hotkeys.apply(mode, accelerator, () => fire(mode));
  if (!applied.ok) {
    hotkeyError[mode] = applied.error;
    return { ok: false, error: applied.error, settings: current };
  }
  delete hotkeyError[mode];
  const next = await writeScreenshotSettings(userDataDir(), { [mode]: { enabled: true, accelerator } } as any);
  return { ok: true, settings: next, registered: { ...hotkeys.registered } };
}

async function screenshotPickDir() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "选择截图保存目录" });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}

export const screenshotFeature = defineFeature<null>({
  id: "screenshot",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("screenshot: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("screenshot:settings-get", () => screenshotSettingsGet());
    ipcHost.handle("screenshot:settings-set", (_event, patch: Partial<ScreenshotSettings>) => screenshotSettingsSet(patch));
    ipcHost.handle("screenshot:hotkey-set", (_event, input: { mode: ShotMode; accelerator?: string; enabled?: boolean }) => screenshotHotkeySet(input));
    ipcHost.handle("screenshot:capture", (_event, mode: ShotMode) => capture(mode === "region" ? "region" : "full"));
    ipcHost.handle("screenshot:pick-dir", () => screenshotPickDir());
    ipcHost.handle("screenshot:reveal", (_event, file: string) => revealShot(String(file ?? "")));

    /* ⛔ 原来在模块体里的 `app.whenReady().then(registerSavedHotkeys)` 移到这里：
       setup 在**模块被 require 时**执行（与原来同一时机），但"域被组合表禁用 ⇒ 模块根本不会被
       import ⇒ 热键不注册"这条语义现在成立了，而且卸载时能一并注销。 */
    app.whenReady().then(registerSavedHotkeys);

    // 生命期：卸载时摘掉六条通道 + 注销两条全局热键（不注销 = 键还占着、实现已回收）
    ctx.effect(() => {
      for (const mode of ["full", "region"] as ShotMode[]) hotkeys.apply(mode, "", () => fire(mode));
      ipcHost.removeHandler("screenshot:settings-get");
      ipcHost.removeHandler("screenshot:settings-set");
      ipcHost.removeHandler("screenshot:hotkey-set");
      ipcHost.removeHandler("screenshot:capture");
      ipcHost.removeHandler("screenshot:pick-dir");
      ipcHost.removeHandler("screenshot:reveal");
    });
  },
});

/* 供设置页展示「当前保存目录」的解析结果（saveDir 为空时是 userData/screenshots）。 */
export function resolveShotDir(settings: ScreenshotSettings, userData: string): string {
  return settings.saveDir.trim() || path.join(userData, "screenshots");
}

export { DEFAULT_SCREENSHOT_SETTINGS };
