/**
 * 手机远控的 Windows 输入注入。
 *
 * 屏幕截图是 DIP 坐标下的整块显示器缩略图，手机点击给的是 0–1 归一化坐标；
 * 这里先还原到 DIP，再用 Electron 的 dipToScreenPoint 转物理像素，最后 SetCursorPos + mouse_event。
 * 键盘用 keybd_event；文本走「写剪贴板 + Ctrl+V + 还原剪贴板」。
 * ⛔ 只在「看屏租约仍有效」时由 remote.ts 调用；本模块不负责鉴权。
 */
import { clipboard, screen } from "electron";
import koffi from "koffi";

export type ScreenBounds = { x: number; y: number; width: number; height: number };
export type RemoteMouseButton = "left" | "right";
export type RemoteKey = "enter" | "esc" | "tab" | "backspace" | "delete" | "left" | "up" | "right" | "down" | "space" | "home" | "end" | "pageup" | "pagedown";

type User32 = {
  setCursorPos: (x: number, y: number) => boolean;
  mouseEvent: (flags: number, dx: number, dy: number, data: number, extra: number) => void;
  keybdEvent: (vk: number, scan: number, flags: number, extra: number) => void;
};

const KEY_CODES: Record<RemoteKey, number> = {
  enter: 0x0d,
  esc: 0x1b,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  space: 0x20,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
};

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_WHEEL = 0x0800;
const KEYEVENTF_KEYUP = 0x0002;

let user32: User32 | null = null;
let typingClipboard: string | null = null;
let typingRestoreTimer: ReturnType<typeof setTimeout> | null = null;
let editQueue: Promise<unknown> = Promise.resolve();

function loadUser32(): User32 {
  if (user32) return user32;
  const lib = koffi.load("user32.dll");
  const setCursorPos = lib.func("bool SetCursorPos(int x, int y)") as User32["setCursorPos"];
  const mouseEvent = lib.func("void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uint64 dwExtraInfo)") as User32["mouseEvent"];
  const keybdEvent = lib.func("void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)") as User32["keybdEvent"];
  user32 = { setCursorPos, mouseEvent, keybdEvent };
  return user32;
}

function windowsOnly(platform: NodeJS.Platform) {
  if (platform === "win32") return null;
  return { ok: false as const, error: "远程控制目前只支持 Windows；macOS 需要辅助功能授权，暂未接入。" };
}

function validBounds(bounds: ScreenBounds) {
  return Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0;
}

/** 把手机点击的归一化坐标映射到当前截图的显示器并注入左键/右键。 */
export async function clickRemoteScreen(
  x: number,
  y: number,
  bounds: ScreenBounds,
  button: RemoteMouseButton = "left",
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unsupported = windowsOnly(platform);
  if (unsupported) return unsupported;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return { ok: false, error: "点击坐标无效。" };
  }
  if (!validBounds(bounds)) return { ok: false, error: "屏幕尺寸不可用。" };

  try {
    const dip = { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height };
    const physical = screen.dipToScreenPoint(dip);
    const api = loadUser32();
    if (!api.setCursorPos(Math.round(physical.x), Math.round(physical.y))) {
      return { ok: false, error: "光标定位失败（可能被系统权限拦截）。" };
    }
    await new Promise((resolve) => setTimeout(resolve, 8));
    api.mouseEvent(button === "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 12));
    api.mouseEvent(button === "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: `鼠标注入失败：${String(error?.message ?? error)}` };
  }
}

/** 滚轮滚动；dy > 0 向下，dy < 0 向上，单位是滚轮格。 */
export async function scrollRemoteScreen(
  dy: number,
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unsupported = windowsOnly(platform);
  if (unsupported) return unsupported;
  if (!Number.isInteger(dy) || dy === 0 || Math.abs(dy) > 20) return { ok: false, error: "滚动幅度无效。" };
  try {
    loadUser32().mouseEvent(MOUSEEVENTF_WHEEL, 0, 0, (dy * 120) >>> 0, 0);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: `滚动失败：${String(error?.message ?? error)}` };
  }
}

/** 发送一个常用功能键（Enter / Esc / Tab / 方向键等）。 */
export async function pressRemoteKey(
  key: RemoteKey,
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unsupported = windowsOnly(platform);
  if (unsupported) return unsupported;
  const code = KEY_CODES[key];
  if (!code) return { ok: false, error: "不支持的按键。" };
  try {
    const api = loadUser32();
    api.keybdEvent(code, 0, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 18));
    api.keybdEvent(code, 0, KEYEVENTF_KEYUP, 0);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: `按键注入失败：${String(error?.message ?? error)}` };
  }
}

async function restoreTypingClipboard() {
  if (typingClipboard === null) return;
  const previous = typingClipboard;
  typingClipboard = null;
  if (typingRestoreTimer) { clearTimeout(typingRestoreTimer); typingRestoreTimer = null; }
  await clipboard.writeText(previous).catch(() => undefined);
}

function scheduleTypingRestore() {
  if (typingRestoreTimer) clearTimeout(typingRestoreTimer);
  typingRestoreTimer = setTimeout(() => {
    typingRestoreTimer = null;
    void restoreTypingClipboard();
  }, 1800);
}

/**
 * 实时键盘编辑：先删 remove 个字符，再粘贴 text。
 * 连续输入会排队执行；文本走剪贴板，空闲 1.8 秒或 restore=true 时还原。
 */
export function editRemoteText(
  remove: number,
  text: string,
  restore = true,
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const unsupported = windowsOnly(platform);
    if (unsupported) return unsupported;
    const count = Number.isFinite(remove) ? Math.max(0, Math.min(100, Math.floor(remove))) : -1;
    if (count < 0) return { ok: false, error: "删除数量无效。" };
    if (text.length > 2000) return { ok: false, error: "文本超过 2000 字。" };
    if (!count && !text && !restore) return { ok: true };
    try {
      if (typingClipboard === null) typingClipboard = await clipboard.readText();
      const api = loadUser32();
      if (count) {
        for (let index = 0; index < count; index += 1) {
          api.keybdEvent(0x08, 0, 0, 0);
          api.keybdEvent(0x08, 0, KEYEVENTF_KEYUP, 0);
          await new Promise((resolve) => setTimeout(resolve, 6));
        }
      }
      if (text) {
        await clipboard.writeText(text);
        api.keybdEvent(0x11, 0, 0, 0);
        api.keybdEvent(0x56, 0, 0, 0);
        await new Promise((resolve) => setTimeout(resolve, 18));
        api.keybdEvent(0x56, 0, KEYEVENTF_KEYUP, 0);
        api.keybdEvent(0x11, 0, KEYEVENTF_KEYUP, 0);
      }
      if (restore) await restoreTypingClipboard();
      else scheduleTypingRestore();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: `键盘输入失败：${String(error?.message ?? error)}` };
    }
  };
  const task = editQueue.then(run, run);
  editQueue = task.then(() => undefined, () => undefined);
  return task;
}

/** 一次性输入文本（保留给旧调用）：等价于 editRemoteText(0, text, true)。 */
export function typeRemoteText(text: string, platform: NodeJS.Platform = process.platform) {
  return editRemoteText(0, text, true, platform);
}
