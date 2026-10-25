// Windows 大圆角：DWM 原生圆角只给 ~8px 且仅 Win11；Win10 完全没有。
// 用户 2026-10-25 要 Marvis 那种大圆弧 ⇒ 跟随 Marvis 在本机的实际做法（其日志：
// `[FixLayeredWindowForDComp] Switched from ... to SetWindowRgn`）：
// 用 CreateRoundRectRgn + SetWindowRgn 把顶层窗口裁成圆角。Win11 仍先设 DWM 圆角（更细腻，
// 有系统阴影），随后区城裁剪覆盖成统一半径（两平台视觉一致）。
import { BrowserWindow, screen } from "electron";
import koffi from "koffi";

const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;
/** 视觉半径（CSS px）；按显示器缩放换算成物理像素。Marvis 截图约 28px。 */
const CORNER_RADIUS_CSS = 26;

type DwmSetWindowAttributeFn = (hwnd: bigint, attr: number, value: Buffer, size: number) => number;
type CreateRoundRectRgnFn = (x1: number, y1: number, x2: number, y2: number, w: number, h: number) => bigint;
type SetWindowRgnFn = (hwnd: bigint, rgn: bigint, redraw: number) => number;

let dwmSetWindowAttribute: DwmSetWindowAttributeFn | null = null;
let createRoundRectRgn: CreateRoundRectRgnFn | null = null;
let setWindowRgn: SetWindowRgnFn | null = null;
let libTried = false;

function ensureLibs(): boolean {
  if (libTried) return Boolean(setWindowRgn);
  libTried = true;
  try {
    const dwm = koffi.load("dwmapi.dll");
    dwmSetWindowAttribute = dwm.func("long DwmSetWindowAttribute(uint64 hwnd, uint32 attr, void* value, uint32 size)") as unknown as DwmSetWindowAttributeFn;
    const gdi = koffi.load("gdi32.dll");
    createRoundRectRgn = gdi.func("uint64 CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h)") as unknown as CreateRoundRectRgnFn;
    const user = koffi.load("user32.dll");
    setWindowRgn = user.func("int SetWindowRgn(uint64 hwnd, uint64 rgn, int redraw)") as unknown as SetWindowRgnFn;
    return true;
  } catch {
    return false;
  }
}

function hwndOf(win: BrowserWindow): bigint | null {
  try {
    const handle = win.getNativeWindowHandle();
    return handle && handle.length >= 8 ? handle.readBigUInt64LE(0) : null;
  } catch {
    return null;
  }
}

function roundOnce(win: BrowserWindow): void {
  if (!ensureLibs()) return;
  const hwnd = hwndOf(win);
  if (!hwnd) return;
  if (win.isMaximized() || win.isFullScreen()) return;
  // ① Win11 原生圆角（系统阴影/抗锯齿由 DWM 负责；Win10 上这次调用无效，静默跳过）
  if (dwmSetWindowAttribute) {
    const pref = Buffer.alloc(4);
    pref.writeUInt32LE(DWMWCP_ROUND, 0);
    try { dwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, pref, 4); } catch { /* no-op */ }
  }
  // ② 统一大圆弧：区域裁剪（SetWindowRgn 成功后 region 归系统所有，禁止再 DeleteObject）
  if (createRoundRectRgn && setWindowRgn) {
    try {
      const bounds = win.getBounds();
      const scale = screen.getDisplayMatching(bounds).scaleFactor || 1;
      const radius = Math.round(CORNER_RADIUS_CSS * scale) * 2; // CreateRoundRectRgn 参数是椭圆的宽/高
      const rgn = createRoundRectRgn(0, 0, bounds.width + 1, bounds.height + 1, radius, radius);
      if (rgn) setWindowRgn(hwnd, rgn, 1);
    } catch { /* 失败不影响使用（直角窗口） */ }
  }
}


function clearRegion(win: BrowserWindow): void {
  if (!ensureLibs() || !setWindowRgn) return;
  const hwnd = hwndOf(win);
  if (hwnd) { try { setWindowRgn(hwnd, 0n, 1); } catch { /* no-op */ } }
}

/**
 * 给窗口开启大圆角（Windows：DWM 圆角 + SetWindowRgn 区域裁剪），其余平台跳过。
 *
 * 时序同旧版：构造期设一次；'show' 后补设（titleBarOverlay 的边框延展会重置 DWM 圆角）；
 * 还原/改变尺寸后重设（region 尺寸必须跟窗口一致）；最大化时清掉 region（否则四角会在屏幕边缘被裁）。
 */
export function applyRoundedCorners(win: BrowserWindow): void {
  if (process.platform !== "win32") return;
  roundOnce(win);
  win.once("show", () => { setTimeout(() => roundOnce(win), 0); });
  win.on("unmaximize", () => roundOnce(win));
  win.on("maximize", () => clearRegion(win));
  win.on("resize", () => {
    if (win.isMaximized() || win.isFullScreen()) return;
    clearTimeout((win as any).__roundRaf);
    (win as any).__roundRaf = setTimeout(() => roundOnce(win), 60);
  });
}

