/**
 * 截图能力（harness 自持）。
 *
 * 两种模式（用户 09-24 要求「两个都要」，各自可绑快捷键）：
 *   · full   —— 隐藏窗口后截整块屏幕（截图菜单里「隐藏窗口截图」的语义）
 *   · region —— 隐藏窗口 → 抓一帧冻结画面 → 铺满该显示器的框选覆盖层 → 按选区裁剪
 *
 * 为什么框选用「冻结帧」而不是「透明覆盖层」：
 *   透明覆盖层的做法要在用户拖框时**实时**看到下面的真实桌面，这要求覆盖层不遮挡内容
 *   （即真的透明 + 下面是别的窗口），在 Windows/macOS 上的合成行为不一致（拖框时会出现
 *   半透明重影、任务栏闪烁、mac 全屏空间异常）。冻结帧是业界通行做法：先把屏幕**拍下来**
 *   当背景铺上，用户对着这张图拖框，坐标可直接用于裁剪，且不会因为别的窗口刷新导致选区错位。
 *
 * 落盘：`userData/screenshots/shot-YYYYMMDD-HHmmss.png`（可在设置页改目录）。
 *
 * ⛔ 本模块只导出纯逻辑 + 注册入口，不 import main.ts（避免模块顶层求值顺序踩 app.setPath 的坑）。
 */

import { BrowserWindow, desktopCapturer, ipcMain, screen, shell, systemPreferences, nativeImage, type Display } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeAccelerator } from "./accelerator";
/* P2 批次 6（10-24）：覆盖层页面模板已切到 ./screenshot/overlay-page —— 调用点用别名，零改动。 */
import { buildOverlayHtml as overlayHtml } from "./screenshot/overlay-page";
/* P2 批次 7（10-24）：覆盖层窗口编排已切到 ./screenshot/overlay-window（preload 路径走参数）。 */
import { pickEdited } from "./screenshot/overlay-window";

export type ShotMode = "full" | "region";

export type ShotHotkey = { enabled: boolean; accelerator: string };

export type ScreenshotSettings = {
  full: ShotHotkey;
  region: ShotHotkey;
  /** 截图前是否先把自己的窗口藏起来（默认 true = 「隐藏窗口截图」） */
  hideWindow: boolean;
  /** 保存目录；空串 = userData/screenshots（默认） */
  saveDir: string;
};

export type ShotResult =
  | { ok: true; path: string; width: number; height: number; mode: ShotMode }
  | { ok: false; canceled?: boolean; error?: string };

/** 默认快捷键：两个模式默认都开（用户要的就是「有快捷键」），键位尽量避开浏览器常用组合。
 *  ⛔ Ctrl+Shift+S / Ctrl+Shift+A 在浏览器里都有用途（另存为 / 搜索标签页），系统级抢占用户会骂。
 *     所以默认都带 Alt。注册失败（被占用）时不会静默：设置页会显示冲突提示。
 *  hideWindow 默认**不隐藏**（09-24 用户：「万一用户需要截图应用界面呢」）——要纯桌面截图
 *  再去设置页勾「截图前隐藏本应用窗口」。⚠️ 只对没存过设置的用户生效；设置文件里已显式
 *  存了 hideWindow 的（动过设置页就会落盘）保持原值，需去设置页自行取消勾选。 */
export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  full: { enabled: true, accelerator: "CommandOrControl+Shift+Alt+A" },
  region: { enabled: false, accelerator: "CommandOrControl+Shift+Alt+S" },
  hideWindow: false,
  saveDir: "",
};

function settingsFile(userData: string): string {
  return path.join(userData, "screenshot-settings.json");
}

export function normalizeScreenshotSettings(raw: any): ScreenshotSettings {
  const d = DEFAULT_SCREENSHOT_SETTINGS;
  const readToggle = (key: ShotMode): ShotHotkey => {
    const value = raw?.[key];
    return {
      // 显式 false 才算关；缺字段用默认
      enabled: value?.enabled === undefined ? d[key].enabled : Boolean(value.enabled),
      accelerator: sanitizeAccelerator(value?.accelerator, d[key].accelerator),
    };
  };
  return {
    full: readToggle("full"),
    region: readToggle("region"),
    hideWindow: raw?.hideWindow === undefined ? d.hideWindow : Boolean(raw.hideWindow),
    saveDir: typeof raw?.saveDir === "string" ? raw.saveDir.trim() : "",
  };
}

export async function readScreenshotSettings(userData: string): Promise<ScreenshotSettings> {
  try {
    return normalizeScreenshotSettings(JSON.parse(await fs.readFile(settingsFile(userData), "utf8")));
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.error("[screenshot] 设置读取失败，用默认值：", error?.message ?? error);
    return { ...DEFAULT_SCREENSHOT_SETTINGS };
  }
}

export async function writeScreenshotSettings(userData: string, patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettings> {
  const current = await readScreenshotSettings(userData);
  const next = normalizeScreenshotSettings({ ...current, ...patch });
  await fs.mkdir(userData, { recursive: true });
  const target = settingsFile(userData);
  const tmp = `${target}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, target);
  return next;
}

/* ── 抓屏 ────────────────────────────────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** mac 上没给「屏幕录制」权限时 getSources 会返回黑帧/空表 —— 提前判掉，给一句能照做的话。 */
export function screenCaptureBlockedReason(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") {
      return "macOS 未授权「屏幕录制」：系统设置 → 隐私与安全性 → 屏幕录制，勾选本应用后重开应用";
    }
  } catch { /* 老版本 Electron / 平台不支持时忽略 */ }
  return null;
}

/** 抓指定显示器的**物理像素**整帧。 */
async function grabDisplay(display: Display): Promise<Electron.NativeImage> {
  const scale = display.scaleFactor || 1;
  const width = Math.max(1, Math.round(display.bounds.width * scale));
  const height = Math.max(1, Math.round(display.bounds.height * scale));
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  if (!sources.length) throw new Error("没有可用的屏幕源（可能被系统权限拦截）");
  // 优先按 display_id 配对；Windows 上某些驱动不给 display_id，退回「按显示器序号」配对。
  const byId = sources.find((source) => source.display_id && String(source.display_id) === String(display.id));
  const displays = screen.getAllDisplays();
  const index = displays.findIndex((item) => item.id === display.id);
  const picked = byId ?? sources[index >= 0 && index < sources.length ? index : 0] ?? sources[0];
  return picked.thumbnail;
}

function displayForCursor(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

async function saveShot(userData: string, image: Electron.NativeImage, saveDir: string): Promise<string> {
  const dir = saveDir.trim() || path.join(userData, "screenshots");
  await fs.mkdir(dir, { recursive: true });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `shot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
  const file = path.join(dir, name);
  await fs.writeFile(file, image.toPNG());
  return file;
}

/* ── 框选 + 标注编辑覆盖层 ────────────────────────────────────────── */

export type OverlayRect = { x: number; y: number; width: number; height: number };

/**
 * 覆盖层页面 = 拖框选区 + 选区内标注编辑（09-24 用户：截图完不能只是消失，要有编辑功能）。
 *
 * 交互流（与微信/QQ 截图同款）：
 *   ① select 态：拖框建选区（initialRect 非空 = 直接进编辑态，用于全屏模式默认全选）
 *   ② edit   态：选区下方出工具条 —— 画笔/矩形/椭圆/箭头/文字/马赛克 × 5 色 × 撤销，
 *      ✓ 确认（把「底图选区 + 标注层」合成 PNG 回传）/ ↺ 重选 / ✕ 取消
 *
 * ⛔ 分辨率：ink 画布与冻结帧同为**物理像素**（绘制坐标 × scaleFactor），
 *    回传的 PNG 是物理分辨率 —— 不能拿 CSS 像素截图回传（高分屏会糊一半）。
 * ⛔ 内层脚本**不用反引号**（整段嵌在 TS 模板串里），字符串一律单引号拼接。
 */

/** 覆盖层回传：选区 + 合成标注后的 PNG dataURL（确认时才回传；取消 = null）。 */
export type OverlayResult = { rect: OverlayRect; image: string } | null;

/** 打开框选/编辑覆盖层并等结果（取消/超时/关窗 = null）。 */

/* ── 抓图主流程 ──────────────────────────────────────────────────── */

export type CaptureDeps = {
  /** 需要被藏起来的主窗口（没有就不藏） */
  window: BrowserWindow | null;
  userData: string;
};

/**
 * 执行一次截图（两种模式都先进覆盖层编辑器：选区/标注后确认才出图 —— 09-24 用户：
 * 「截图完不能只是消失，要有编辑功能」。全屏模式默认整屏全选，直接回车即得图）。
 * ⛔ 窗口恢复放在 finally：任何一条失败路径（抓屏报错、用户取消、覆盖层崩）都必须把窗口还回来，
 *    否则用户看到的是「应用凭空消失」。
 */
export async function captureScreenshot(deps: CaptureDeps, mode: ShotMode, settings: ScreenshotSettings): Promise<ShotResult> {
  const blocked = screenCaptureBlockedReason();
  if (blocked) return { ok: false, error: blocked };

  const win = deps.window && !deps.window.isDestroyed() ? deps.window : null;
  const wasVisible = Boolean(win?.isVisible());
  const shouldHide = settings.hideWindow && wasVisible;
  const display = displayForCursor();

  try {
    if (shouldHide) {
      win!.hide();
      // 等窗口真的从合成器上消失再抓屏（太快会把自己的窗口拍进去）
      await delay(260);
    }
    const frame = await grabDisplay(display);

    // 编辑覆盖层：region = 先拖框；full = 默认整屏全选（可缩小重选）
    const initial: OverlayRect | null = mode === "full"
      ? { x: 0, y: 0, width: Math.max(8, display.bounds.width), height: Math.max(8, display.bounds.height) }
      : null;
    const picked = await pickEdited(display, frame, initial, path.join(__dirname, "overlay-preload.js"));
    if (!picked) return { ok: false, canceled: true };

    // 优先用覆盖层合成好的 PNG（含标注，物理分辨率）；异常缺失时退回按选区裁原帧
    let image: Electron.NativeImage | null = null;
    if (picked.image) {
      try {
        const decoded = nativeImage.createFromDataURL(picked.image);
        if (!decoded.isEmpty()) image = decoded;
      } catch { /* 解码失败走裁剪兜底 */ }
    }
    if (!image) {
      const scale = display.scaleFactor || 1;
      const size = frame.getSize();
      const x = Math.min(Math.max(0, Math.round(picked.rect.x * scale)), Math.max(0, size.width - 1));
      const y = Math.min(Math.max(0, Math.round(picked.rect.y * scale)), Math.max(0, size.height - 1));
      const width = Math.max(1, Math.min(Math.round(picked.rect.width * scale), size.width - x));
      const height = Math.max(1, Math.min(Math.round(picked.rect.height * scale), size.height - y));
      image = frame.crop({ x, y, width, height });
    }

    const file = await saveShot(deps.userData, image, settings.saveDir);
    const size = image.getSize();
    return { ok: true, path: file, width: size.width, height: size.height, mode };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (win && !win.isDestroyed()) {
      // 只还原「本来可见」的窗口；原本就最小化的不要替用户弹出来
      if (shouldHide) { try { win.show(); win.focus(); } catch { /* 窗口在关闭中 */ } }
    }
  }
}

/** 在系统文件管理器里定位截图（失败静默——只是便利功能）。 */
export async function revealShot(file: string): Promise<boolean> {
  try { shell.showItemInFolder(file); return true; } catch { return false; }
}

// ── 全局快捷键：两种模式各一条 ─────────────────────────────────────
/** ⛔ 注册策略与语音热键一致：**先注册新键、成功后才注销旧键**。
 *  反过来（先注销再注册）一旦新键被占用，旧键已没了、新键也没注册上 ⇒ 快捷键两头空。 */
export type HotkeyRegistry = {
  registered: Record<ShotMode, string>;
  apply: (mode: ShotMode, accelerator: string, onFire: () => void) => { ok: boolean; error?: string };
  reset: () => void;
};

export function createHotkeyRegistry(globalShortcut: { register: (a: string, cb: () => void) => boolean; unregister: (a: string) => void }): HotkeyRegistry {
  const registered: Record<ShotMode, string> = { full: "", region: "" };
  return {
    registered,
    apply(mode, accelerator, onFire) {
      try {
        if (!accelerator) {
          if (registered[mode]) { globalShortcut.unregister(registered[mode]); registered[mode] = ""; }
          return { ok: true };
        }
        if (accelerator === registered[mode]) return { ok: true };
        // 两个模式不许共用同一个键（后者注册必然失败，且失败原因不直观）
        const other: ShotMode = mode === "full" ? "region" : "full";
        if (registered[other] && registered[other] === accelerator) {
          return { ok: false, error: `「${accelerator}」已被另一种截图模式占用，请换一个组合键` };
        }
        const ok = globalShortcut.register(accelerator, onFire);
        if (!ok) return { ok: false, error: `快捷键「${accelerator}」注册失败（可能被其它程序占用）` };
        if (registered[mode]) globalShortcut.unregister(registered[mode]);
        registered[mode] = accelerator;
        return { ok: true };
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    reset() {
      for (const mode of ["full", "region"] as ShotMode[]) {
        if (registered[mode]) { try { globalShortcut.unregister(registered[mode]); } catch { /* noop */ } registered[mode] = ""; }
      }
    },
  };
}

/** 给「保存目录」用的默认值（设置页展示当前实际目录）。 */
export function defaultShotDir(userData: string): string {
  return path.join(userData, "screenshots");
}
