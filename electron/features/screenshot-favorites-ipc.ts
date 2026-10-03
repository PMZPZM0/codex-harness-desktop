/**
 * 截图 + 收藏夹的 IPC 面（09-24）。
 *
 * 两个域合在一个文件，因为它们共享同一套「用户素材」入口：
 *   截图的结果直接进输入框、也可以直接收藏；收藏里也包含截图。
 *   （与 memory-rpa-ipc.ts 的合并口径一致：同一条用户素材链上的通道放一起，避免
 *   两个文件互相 import 造成循环。）
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
import {
  addFavorite,
  clearFavorites,
  deleteFavorites,
  favoriteMemoryLine,
  readFavorites,
  touchFavorite,
  updateFavorite,
  type FavoriteItem,
} from "../favorites";
import { allBusWindows, sendToWindow } from "./window-bus";
import { copyImageFileToClipboard } from "./clipboard-ipc";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

type MemoryScope = "user" | "project" | "background" | "lessons";

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

/* ⛔ 原来这里是模块体 `app.whenReady().then(registerSavedHotkeys)` —— P2 批次 7 移进
   `screenshotFeature.setup`：setup 在**模块被 require 时**执行（与原来同一时机），
   但"域被组合表禁用 ⇒ 模块根本不会被 import ⇒ 热键不注册"这条语义现在成立了，
   而且卸载时能一并注销。 */

/* ══════════════════ IPC：两个域（P2 批次 7） ══════════════════
   这个文件承载**两个前缀**（screenshot + favorites）⇒ 导出**两个** `defineFeature`、
   组合表写**两行**（一行恒等于一个前缀：行的 id 就是挂载身份）。
   ⛔ 13 个通道名 / 参数 / 返回值 / 注释里的口径一字不改；实现留模块级函数，注册交容器。 */

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

async function favoritesTouch(id: string) {
  try {
    return await touchFavorite(userDataDir(), String(id ?? ""));
  } catch (error) {
    // 记账失败不该挡住「发送」这条主路径 ⇒ 返回当前列表即可
    console.error("[favorites] touch 失败：", error);
    return readFavorites(userDataDir());
  }
}

/**
 * 把收藏写进 Agent 记忆（记忆金字塔的层文件）。
 * scope 语义与 `memory:layers:write` 完全一致（复用同一份 layers 实现，不自己拼文件）：
 *   user = L0 用户档案（跨项目）；project = L1 项目记忆；background = L3 项目背景；lessons = L2 纪律
 * ⛔ 只**追加**：先读该层当前文本，再写回（层文件是整份覆盖语义，不读就写 = 抹掉用户已有记忆）。
 * ⛔ 单行限长见 favoriteMemoryLine（记忆注入是硬预算）。
 */
async function favoritesToMemory(input: { ids: string[]; scope?: MemoryScope; workspace?: string }) {
  const ids = (Array.isArray(input?.ids) ? input.ids : []).filter((id) => typeof id === "string" && id);
  if (!ids.length) return { ok: false, written: 0, error: "没有选中任何收藏" };
  const scope: MemoryScope = input?.scope === "user" || input?.scope === "lessons" || input?.scope === "background" ? input.scope : "project";
  const workspace = String(input?.workspace ?? "").trim();
  if (scope !== "user" && !workspace) return { ok: false, written: 0, error: "尚未选择工作区，无法写入项目级记忆" };

  const items = (await readFavorites(userDataDir())).filter((item) => ids.includes(item.id));
  if (!items.length) return { ok: false, written: 0, error: "选中的收藏已不存在" };

  // 懒加载：main.ts 在模块体里 setPath(userData)，早于本文件的 handler 执行 ——
  // 只有在这里（handler 内）require 才能拿到正确实例。
  const { memoryLayers } = require("../main") as { memoryLayers: any };
  let written = 0;
  const failed: string[] = [];
  for (const item of items) {
    const line = favoriteMemoryLine(item);
    try {
      if (scope === "lessons") {
        const okWritten = await memoryLayers.appendLesson(workspace, line, item.title || item.content.slice(0, 40));
        if (okWritten) written += 1;
      } else if (scope === "user") {
        const current = await memoryLayers.readUser();
        await memoryLayers.writeUser(appendBlock(current, line));
        written += 1;
      } else if (scope === "background") {
        const current = await memoryLayers.readBackground(workspace);
        await memoryLayers.writeBackground(workspace, appendBlock(current, line));
        written += 1;
      } else {
        const current = await memoryLayers.readProject(workspace);
        await memoryLayers.writeProject(workspace, appendBlock(current, line));
        written += 1;
      }
    } catch (error: any) {
      failed.push(`${item.title || item.id}：${error?.message ?? error}`);
    }
  }
  return { ok: written > 0, written, error: failed.length ? failed.join("；") : undefined };
}

/** 截图域：六条通道 + 全局快捷键注册（启动时按已保存设置注册一次，失败只记录不阻断）。 */
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

/** 收藏夹域：七条通道（含 to-memory 写记忆层）。 */
export const favoritesFeature = defineFeature<null>({
  id: "favorites",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("favorites: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("favorites:list", () => readFavorites(userDataDir()));
    ipcHost.handle("favorites:add", (_event, input: Partial<FavoriteItem>) => addFavorite(userDataDir(), input ?? {}));
    ipcHost.handle("favorites:update", (_event, input: { id: string; patch: Partial<FavoriteItem> }) =>
      updateFavorite(userDataDir(), String(input?.id ?? ""), input?.patch ?? {}));
    ipcHost.handle("favorites:delete", (_event, ids: string[]) => deleteFavorites(userDataDir(), Array.isArray(ids) ? ids : []));
    ipcHost.handle("favorites:clear", () => clearFavorites(userDataDir()));
    ipcHost.handle("favorites:touch", (_event, id: string) => favoritesTouch(id));
    ipcHost.handle("favorites:to-memory", (_event, input: { ids: string[]; scope?: MemoryScope; workspace?: string }) => favoritesToMemory(input));

    // 生命期：卸载时摘掉本域七条通道（收藏数据在磁盘上，不随卸载销毁 —— 那是用户数据）
    ctx.effect(() => {
      ipcHost.removeHandler("favorites:list");
      ipcHost.removeHandler("favorites:add");
      ipcHost.removeHandler("favorites:update");
      ipcHost.removeHandler("favorites:delete");
      ipcHost.removeHandler("favorites:clear");
      ipcHost.removeHandler("favorites:touch");
      ipcHost.removeHandler("favorites:to-memory");
    });
  },
});

/** 追加一行（保留原文件头与既有内容，只在末尾加，并保证一个换行分隔）。 */
function appendBlock(current: string, line: string): string {
  const text = String(current ?? "").replace(/\s+$/, "");
  return text ? `${text}\n${line}\n` : `${line}\n`;
}

/* 供设置页展示「当前保存目录」的解析结果（saveDir 为空时是 userData/screenshots）。 */
export function resolveShotDir(settings: ScreenshotSettings, userData: string): string {
  return settings.saveDir.trim() || path.join(userData, "screenshots");
}

export { DEFAULT_SCREENSHOT_SETTINGS };
