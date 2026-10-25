// Windows 11 原生圆角：对窗口 HWND 设置 DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND。
// 这是系统级圆角——保留原生阴影、拉伸边框与右上角系统控制钮，仅磨圆四个角；
// 最大化时系统自动回方（预期行为），还原后自动复圆。仅 Windows 生效，其余平台静默跳过。
//
// 通过 koffi（纯 FFI，N-API 模块，跨 Electron ABI 稳定）调用 dwmapi.dll，避免引入 C++ 原生插件。
import { BrowserWindow } from "electron";
import koffi from "koffi";

// DWM_WINDOW_CORNER_PREFERENCE 枚举值（dwmapi.h）
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;

type DwmSetWindowAttributeFn = (
  hwnd: bigint,
  dwAttribute: number,
  pvAttribute: Buffer,
  cbAttribute: number
) => number;

let dwmSetWindowAttribute: DwmSetWindowAttributeFn | null = null;
let libTried = false;

function ensureDwm(): boolean {
  if (libTried) return dwmSetWindowAttribute !== null;
  libTried = true;
  try {
    const lib = koffi.load("dwmapi.dll");
    dwmSetWindowAttribute = lib.func(
      "long DwmSetWindowAttribute(uint64 hwnd, uint32 dwAttribute, void* pvAttribute, uint32 cbAttribute)"
    ) as unknown as DwmSetWindowAttributeFn;
    return true;
  } catch {
    return false;
  }
}

function roundOnce(win: BrowserWindow): void {
  if (!ensureDwm() || !dwmSetWindowAttribute) return;
  let handle: Buffer;
  try {
    handle = win.getNativeWindowHandle();
  } catch {
    return;
  }
  if (!handle || handle.length < 8) return;
  const hwnd = handle.readBigUInt64LE(0);
  const pref = Buffer.alloc(4);
  pref.writeUInt32LE(DWMWCP_ROUND, 0);
  try {
    // HRESULT：失败不致命，静默忽略（老系统/远端会话等不支持时不影响使用）。
    dwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, pref, 4);
  } catch {
    /* no-op */
  }
}

/**
 * 给窗口开启 Windows 11 原生圆角。非 win32 平台直接跳过。
 *
 * 关键时序：本函数通常在 `new BrowserWindow(...)` 之后立即调用，但此时窗口尚未显示。
 * 对于使用 `titleBarOverlay`（titleBarStyle:"hidden"）的窗口，系统会在窗口**首次显示**
 * 时把边框延展进客户端区（DwmExtendFrameIntoClientArea），这一步会把构造期设置的
 * DWM 圆角属性覆盖回直角——这正是「主窗口/弹窗是方的、标准边框弹窗自动圆」的根因。
 * 因此必须在 'show' 事件之后（边框延展完成）再补设一次，圆角才能真正生效。
 * 同时：最大化时系统自动回方（预期），在 unmaximize 时防御性复圆。
 */
export function applyRoundedCorners(win: BrowserWindow): void {
  if (process.platform !== "win32") return;
  // 创建后立即设一次（HWND 此时已存在；窗口未显示也不影响，仅为兜底层）。
  roundOnce(win);
  // 首次显示后补设：让 show 引起的边框延展先完成，再覆盖回圆角，避免被系统重置。
  win.once("show", () => {
    setTimeout(() => roundOnce(win), 0);
  });
  // 还原窗口（从最大化恢复）后防御性复圆；用 .on 而非 .once 以覆盖多次最大化/还原。
  win.on("unmaximize", () => roundOnce(win));
}
