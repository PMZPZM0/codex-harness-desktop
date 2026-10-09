/**
 * pet-window（09-30 新增：桌面宠物浮窗）
 *
 * 一个**透明 / 无边框 / 置顶 / 不占任务栏**的小窗，渲染层按 `?pet=1` 分流只画宠物本体。
 * 与独立会话弹窗（`createPopoutWindow`）不是一回事，所以**不登记进 window-bus**：
 *   · 它不消费 `codex:event` 广播（会话流式事件对它毫无用处，登记进去等于白送一份载荷）；
 *   · `popoutBusWindows()` 的语义是"独立会话弹窗"，塞进宠物会让"关主窗口时关掉所有弹窗"
 *     之外的逻辑（侧栏隐藏等）把它一起算进去。
 *   ⇒ 生命周期自己管：主窗口关闭时由 window-factory 显式调用 `closePetWindow()`。
 *
 * 位置与放大倍率都落 `pet-settings.json`（见 pet-ipc.ts）；改倍率 = 改窗口尺寸
 * （⛔ 不是 CSS transform：窗口比宠物大一圈时，那一圈透明区域会挡住桌面上的鼠标事件）。
 */
import { BrowserWindow, app, screen } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { setPetSignalSink, petSignal } from "./pet-state";
// ⛔ type-only：pet-ipc 静态 import 本模块，本模块只取它的类型（编译期擦除 ⇒ 无运行时循环）
import type { PetPackage, PetSettings } from "./pet-ipc";

/** 基准窗口尺寸（scale = 1 时）。渲染层按 100% 铺满，宠物居中偏下。 */
const BASE_W = 230;
const BASE_H = 300;
/** 距离屏幕右下角的默认边距 */
const EDGE = 18;

let petWindow: BrowserWindow | null = null;
/** 拖动结束后写盘用的防抖句柄（拖动会连续触发 moved） */
let moveTimer: NodeJS.Timeout | null = null;
/** 「用户把宠物拖到哪了」的回调 —— 由 pet-ipc 登记（它才是设置的持有者）。
 *  ⛔ 用回调而不是让本模块 import pet-ipc：那会形成 pet-ipc ↔ pet-window 的运行时循环。 */
let onMoved: ((pos: { x: number; y: number }) => void) | null = null;

export function setPetMoveHandler(fn: ((pos: { x: number; y: number }) => void) | null) {
  onMoved = fn;
}

function windowSize(scale: number) {
  return { width: Math.round(BASE_W * scale), height: Math.round(BASE_H * scale) };
}

/* ── 透明区域鼠标穿透（10-09；第一版挂在渲染层 mousemove 上，**当天就被用户否掉**）────
   报障 1「打开应用后软件外面无法点」：宠物窗是**透明矩形**（图集留白 / 气泡区 / 落地余量
   都是看不见的窗口实体），而 `.pet-float` 整块是 `-webkit-app-region: drag` ⇒ 默认整个矩形
   都吃鼠标事件，压在底下的桌面图标 / 其它窗口点不到。
   报障 2「宠物现在直接挪不动」：第一版把翻转挂在渲染层 `mousemove + elementFromPoint` 上
   —— ⛔ **drag 区域属于非客户区，Chromium 根本不往里派发 DOM mousemove** ⇒ 事件永远不来
   ⇒ 窗口永远停在穿透态 ⇒ 宠物既拖不动也点不着。
   ⇒ 现方案：**不依赖任何页面鼠标事件**。渲染层只在布局变化时上报「宠物本体矩形」
   （相对窗口左上角），主进程按 `screen.getCursorScreenPoint()` 轮询比对，在/不在矩形内
   决定整块穿透还是可交互。附带好处：不再需要 `forward`（它只有 Windows 有实现），
   mac 也一并修好；拖动仍是原生 `app-region: drag`（鼠标在本体上时窗口已可交互）。 */
type PetInteractiveRect = { x: number; y: number; width: number; height: number };

/** 渲染层上报的「宠物本体」矩形（相对窗口内容左上角，CSS 像素）。null = 尚未上报 ⇒ 整块穿透。 */
let petInteractiveRect: PetInteractiveRect | null = null;
/** 轮询句柄（仅在窗口可见时跑）。 */
let petMouseTimer: NodeJS.Timeout | null = null;
/**
 * **已经应用**到窗口上的穿透状态（null = 本窗口还没设过）。
 * ⛔ 不能拿「目标状态」跟「可交互布尔」比：窗口**默认是可交互**的（不是穿透），
 *    初值若按"目标 = 当前"短路，第一帧就一次 setIgnoreMouseEvents 都不调 ⇒ 默认仍挡桌面
 *    （这正是 10-09 第一版的一个隐性坑：默认态与"没设过"必须分开记）。窗口销毁/重建时置回 null。
 */
let petMouseAppliedIgnore: boolean | null = null;
/** 当前是否可交互（= 最近一次应用的状态取反）。诊断 / 守卫用。 */
let petMouseInteractive = false;

/** 命中容差（像素）：边界上抖动会让「可交互 ↔ 穿透」反复横跳。 */
const PET_HIT_PADDING = 2;

function applyPetMouseState(): void {
  if (!isPetWindowOpen()) return;
  const win = petWindow!;
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  let inside = false;
  if (win.isVisible() && petInteractiveRect) {
    try {
      const b = win.getBounds();
      const p = screen.getCursorScreenPoint();
      const r = petInteractiveRect;
      inside = p.x >= b.x + r.x - PET_HIT_PADDING
        && p.x <= b.x + r.x + r.width + PET_HIT_PADDING
        && p.y >= b.y + r.y - PET_HIT_PADDING
        && p.y <= b.y + r.y + r.height + PET_HIT_PADDING;
    } catch { inside = false; }
  }
  const ignore = !inside;
  if (petMouseAppliedIgnore === ignore) return;   // 状态没变，不重复调（避免无谓的窗口属性写）
  try {
    /* ⛔ forward 只在 Windows 有效：它的用途是把 mousemove 转给页面（悬停效果 / 光标形状），
       翻转判据**不依赖它**（那正是第一版栽的地方）。 */
    if (process.platform === "win32") win.setIgnoreMouseEvents(ignore, { forward: true });
    else win.setIgnoreMouseEvents(ignore);
    petMouseAppliedIgnore = ignore;
    petMouseInteractive = inside;
  } catch { /* 窗口在关，忽略 */ }
}

function startPetMouseWatch(): void {
  if (petMouseTimer) return;
  // 100ms 足够跟手（人移动鼠标的判定粒度远粗于此），成本只是一次 DIP 坐标读取
  petMouseTimer = setInterval(applyPetMouseState, 100);
  if (typeof petMouseTimer.unref === "function") petMouseTimer.unref();
  applyPetMouseState();
}

function stopPetMouseWatch(): void {
  if (petMouseTimer) clearInterval(petMouseTimer);
  petMouseTimer = null;
}

/** 渲染层上报宠物本体矩形（布局变化时调；null = 没有可交互区域 ⇒ 整块穿透）。 */
export function setPetInteractiveRect(rect: PetInteractiveRect | null): void {
  petInteractiveRect = rect && rect.width > 0 && rect.height > 0 ? rect : null;
  applyPetMouseState();
}

/** 宠物窗当前是否可交互（false = 整块穿透）。诊断 / 守卫用。 */
export function isPetMouseInteractive(): boolean {
  return petMouseInteractive;
}

/** 把坐标夹到某块屏幕的工作区内（显示器拔掉/改分辨率后，旧坐标可能落在屏幕外 = 宠物消失）。 */
function clampToWorkArea(x: number, y: number, width: number, height: number) {
  const displays = screen.getAllDisplays();
  const near = displays.find((d) => {
    const a = d.workArea;
    return x + width > a.x && x < a.x + a.width && y + height > a.y && y < a.y + a.height;
  }) ?? screen.getPrimaryDisplay();
  const area = near.workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - height),
  };
}

function defaultPosition(width: number, height: number) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - width - EDGE, y: area.y + area.height - height - EDGE };
}

export function isPetWindowOpen(): boolean {
  return Boolean(petWindow && !petWindow.isDestroyed());
}

/**
 * 宠物**当前是否可见**。
 * ⛔ 别拿 `isPetWindowOpen()` 当"开着"：`hide()` 只把窗口藏起来、并不销毁它，
 *    于是"隐藏后仍报已显示"（设置页会显示错误的当前状态，09-30 实测）。
 *    对外语义（设置页 / IPC 的 `open`）一律用这个。
 */
export function isPetVisible(): boolean {
  if (!isPetWindowOpen()) return false;
  try { return petWindow!.isVisible(); } catch { return false; }
}

export function petWindowBounds() {
  if (!isPetWindowOpen()) return null;
  return petWindow!.getBounds();
}

/** 主进程 → 浮窗的状态推送（浮窗首帧还会自己 invoke pet:state 补水，防漏推）。 */
function pushSignal() {
  if (!isPetWindowOpen()) return;
  const win = petWindow!;
  if (win.webContents.isDestroyed()) return;
  try { win.webContents.send("pet:signal", petSignal()); } catch { /* 窗口在关，忽略 */ }
}

/**
 * 主进程 → 浮窗的**配置**推送（当前宠物包 + 设置）。
 *
 * ⛔ 为什么必须有它：浮窗只在**挂载时**读一次 `petSettingsGet`（那时才知道画哪只宠物）。
 *    设置页换一只宠物只改了主进程的落盘值，已开着的浮窗**不会自己知道** ——
 *    症状是「切了宠物没反应，重开应用才变」（09-30 用户实测）。
 *    所以每次设置变更都要把结果推过去。
 */
export function pushPetConfig(payload: { settings: PetSettings; active: PetPackage | null }) {
  if (!isPetWindowOpen()) return;
  const win = petWindow!;
  if (win.webContents.isDestroyed()) return;
  try { win.webContents.send("pet:config", payload); } catch { /* 忽略 */ }
}

function createPetWindow(settings: PetSettings): BrowserWindow {
  const { width, height } = windowSize(settings.scale);
  const pos = settings.x != null && settings.y != null
    ? clampToWorkArea(settings.x, settings.y, width, height)
    : defaultPosition(width, height);

  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const icon = path.join(app.getAppPath(), "build", iconName);

  const win = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    // ⛔ 桌宠三件套：透明 + 无边框 + 置顶；再加 skipTaskbar（不进任务栏/Alt-Tab）
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    // ⛔ 不要 titleBarStyle：透明无边框窗上挂 overlay 会画出一圈系统描边
    show: false,
    icon: existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // 透明窗默认会以"低分辨率"合成导致边缘发毛，显式打开背景节流即可（不含内容缩放）
      backgroundThrottling: false,
    },
  });

  // 置顶重申：Windows 上偶发被其它置顶窗盖住，ready-to-show 再申明一次（幂等、零成本）
  win.once("ready-to-show", () => {
    try {
      win.setAlwaysOnTop(true);
      win.setOpacity(settings.opacity);
      win.showInactive();          // ⛔ showInactive：显示宠物**不抢当前应用的焦点**
      // 光标轮询开跑；矩形尚未上报前**整块穿透**（fail-safe：绝不挡桌面）
      startPetMouseWatch();
    } catch { /* 忽略 */ }
  });

  /* 导航收敛：与主窗口/弹窗同规则（宠物窗永不导航，外链一律交给系统浏览器） */
  win.webContents.on("will-navigate", (event, target) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "";
    if (devUrl && target.startsWith(devUrl)) return;
    if (target.startsWith("file://") && target.includes("/dist/index.html")) return;
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  /* 拖动后存位置（防抖 400ms：连续 moved 会写爆磁盘） */
  win.on("moved", () => {
    if (!isPetWindowOpen()) return;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!isPetWindowOpen()) return;
      const b = win.getBounds();
      onMoved?.({ x: b.x, y: b.y });
    }, 400);
  });

  win.on("closed", () => {
    stopPetMouseWatch();
    petMouseAppliedIgnore = null;
    petWindow = null;
    setPetSignalSink(null);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const sep = devUrl.includes("?") ? "&" : "?";
    void win.loadURL(`${devUrl}${sep}pet=1`);
  } else {
    void win.loadFile(path.join(app.getAppPath(), "dist", "index.html"), { query: { pet: "1" } });
  }
  return win;
}

/** 显示（不存在则创建）+ 应用当前设置。 */
export function showPetWindow(settings: PetSettings) {
  if (!isPetWindowOpen()) {
    petWindow = createPetWindow(settings);
    // 浮窗一建就接上状态推送（渲染层首帧还会 invoke 补水，双保险）
    setPetSignalSink(() => pushSignal());
    return petWindow;
  }
  const win = petWindow!;
  try {
    const { width, height } = windowSize(settings.scale);
    const b = win.getBounds();
    const pos = clampToWorkArea(b.x, b.y, width, height);
    win.setBounds({ ...pos, width, height });
    win.setOpacity(settings.opacity);
    win.setAlwaysOnTop(true);
    win.showInactive();
    startPetMouseWatch();
  } catch { /* 忽略 */ }
  return win;
}

export function hidePetWindow() {
  if (!isPetWindowOpen()) return;
  try { petWindow!.hide(); } catch { /* 忽略 */ }
  // 藏起来即停轮询并回到穿透态：下次 showInactive 若指针恰好停在窗上，不至于一出现就挡住桌面
  stopPetMouseWatch();
  applyPetMouseState();
}

export function closePetWindow() {
  if (!isPetWindowOpen()) return;
  stopPetMouseWatch();
  petMouseAppliedIgnore = null;
  try { petWindow!.destroy(); } catch { /* 忽略 */ }
  petWindow = null;
  setPetSignalSink(null);
}

/**
 * 设置变更后的副作用统一入口（pet-ipc 里每次写盘都会调）。
 * ⛔ 只在"尺寸真的变了"时重设 bounds —— 每次都 setBounds 会在用户拖动时把窗口弹回去。
 */
export function applyPetSettings(settings: PetSettings) {
  if (!settings.enabled) {
    hidePetWindow();
    return;
  }
  const win = showPetWindow(settings);
  if (!win) return;
  try {
    const { width, height } = windowSize(settings.scale);
    const b = win.getBounds();
    if (b.width !== width || b.height !== height) {
      const pos = clampToWorkArea(b.x, b.y, width, height);
      win.setBounds({ ...pos, width, height });
    }
  } catch { /* 忽略 */ }
}
