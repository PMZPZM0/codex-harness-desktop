/**
 * 能力接缝层（10-03，方案 §4.2 L1）：宿主能力封成容器里可注入的服务。
 *
 * 为什么要它：容器已经能管「注册通道」（`ipc` 接缝），但域仍能直接
 * `import { app, shell, safeStorage, BrowserWindow } from "electron"` 拿能力 ——
 * 于是"能力"不在容器的管辖内，`inject` 声明出来的权限清单也就名不副实。
 * 接缝层把宿主能力变成**可替换的服务**：域只认接口，换实现 = 换 Provider。
 *
 * 判据（`ARCHITECTURE-RULES.md` §1.1）：本文件只提供能力、不注册任何通道 ⇒ **基座层**。
 * ⛔ `context.ts` 是**纯逻辑**（守卫【252】直接 require 它的产物跑真值表），所以 provide
 *    必须发生在本文件这种能安全 import electron 的地方，不能塞进 context.ts。
 *
 * ── 接缝粒度是按**实测引用量**定的，不是按符号逐个拆（10-03 实测 38/14/12/11 个域）──
 *   app     38 个域在用（几乎全是 getPath("userData")）—— 路径可信根的锚点，必须接缝
 *   secure  14 —— 密钥加密，必须接缝
 *   shell   12 —— openExternal / reveal 能触及系统，必须接缝
 *   dialog  11 · window 6 —— 宿主 UI，必须接缝
 *   其余（net/session/globalShortcut/systemPreferences/Notification/screen…）各 1–4 个域，
 *         本轮**不接**（守卫【266】的 `ALLOWED_DIRECT_ELECTRON` 只锁高危三项：safeStorage /
 *         BrowserWindow / ipcMain；低频项进接缝只增概念面）。
 *
 * ⛔⛔ **内核独占、不可替换的两项**（不提供接缝，见方案 §4.1）：
 *   `protocol`（自定义协议注册）与路径可信校验（`isInsideOrEqualTrustedRoots`）。
 *   前者一旦可被 Provider 替换就等于放开协议白名单（安全回归，实测三次事故）；
 *   后者是渲染层传入路径的唯一防线。
 *
 * ⛔ **不放行 fs / path / crypto / child_process**：它们是 **Node 能力、不是 Electron 宿主绑定**，
 *    不含宿主权限语义；真正的门禁是路径可信校验。全量接缝化是 200+ 文件的机械改动、
 *    风险远大于收益 —— 明确不做，别把它当"还没做完的阶段 2"。
 */
import {
  app,
  BrowserWindow,
  dialog,
  safeStorage,
  shell,
} from "electron";
import { rootContext } from "../../context";

/* ── app：路径与生命周期（38 个域在用） ─────────────────────────────────── */
export type AppHost = {
  /** 数据目录 —— 路径可信根集合的锚点，换实现等于换整套校验基准，故与校验同属内核边界 */
  getPath: (name: "userData" | "home" | "temp" | "exe" | "appData" | "logs" | "downloads") => string;
  getVersion: () => string;
  getName: () => string;
  getAppPath: () => string;
  isPackaged: () => boolean;
  quit: () => void;
  relaunch: (args?: string) => void;
  /**
   * 订阅应用生命周期事件（10-03，laya 域需要 `will-quit` 关停子进程）。
   *
   * ⛔ **必须返回退订函数**，且调用方要把它挂进 `ctx.effect` —— 不登记退订的订阅会在
   *   域卸载后残留（泄漏；再挂一次还会重复触发）。这是「可逆副作用」语义的硬要求，
   *   也是本接缝存在的意义：不让域直接 `import { app } from "electron"` 自己去 `app.on`。
   *
   * ⚠️ 事件名用**白名单**而不是任意 string：这是宿主生命周期面，允许域监听
   *   `before-quit` 之类并 `preventDefault()` 就能改变退出流程（域不该有这种权力）。
   */
  on: (event: "will-quit", listener: () => void) => () => void;
};

/* ── secure：密钥加密（14 个域在用） ────────────────────────────────────── */
export type SecureHost = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (buf: Buffer) => string;
};

/* ── shell：触及系统（12 个域在用） ─────────────────────────────────────── */
export type ShellHost = {
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
};

/* ── dialog：宿主文件/消息框（11 个域在用） ─────────────────────────────── */
export type DialogHost = {
  showOpenDialog: (win: BrowserWindow | null, options: Record<string, unknown>) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (win: BrowserWindow | null, options: Record<string, unknown>) => Promise<{ canceled: boolean; filePath?: string }>;
  showMessageBox: (win: BrowserWindow | null, options: Record<string, unknown>) => Promise<{ response: number }>;
  showErrorBox: (title: string, content: string) => void;
};

/* ── window：宿主窗口（6 个域在用） ─────────────────────────────────────── */
export type WindowHost = {
  /** 创建窗口。⚠️ 调用方**不得**覆盖 contextIsolation / nodeIntegration / sandbox ——
   *  这三项是渲染层隔离边界，内核在此强制补齐，不给域绕过的机会。 */
  create: (options: Record<string, unknown>) => BrowserWindow;
  getAll: () => BrowserWindow[];
  getFocused: () => BrowserWindow | null;
};

const FORCED_WINDOW_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

/* ── 组合面：一次注入拿全部（域按需取用，避免逐条 inject 写满一行） ──────── */
export type HostCaps = {
  app: AppHost;
  secure: SecureHost;
  shell: ShellHost;
  dialog: DialogHost;
  window: WindowHost;
};

const hostCaps: HostCaps = {
  app: {
    getPath: (name) => app.getPath(name as never),
    getVersion: () => app.getVersion(),
    getName: () => app.getName(),
    getAppPath: () => app.getAppPath(),
    isPackaged: () => app.isPackaged,
    quit: () => app.quit(),
    // ⚠️ `app.isPackaged` 是**属性**不是方法（写 `isPackaged()` 会 TS2349）；
    //    `app.relaunch` 收的是 `{ args?: string[] }` 对象，不是裸字符串数组。
    relaunch: (args) => app.relaunch(typeof args === "string" ? { args: [args] } : undefined),
    on: (event, listener) => {
      app.on(event, listener);
      return () => { app.removeListener(event, listener); };
    },
  },
  secure: {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (buf) => safeStorage.decryptString(buf),
  },
  shell: {
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path),
  },
  dialog: {
    showOpenDialog: (win, options) => dialog.showOpenDialog(win as never, options as never) as never,
    showSaveDialog: (win, options) => dialog.showSaveDialog(win as never, options as never) as never,
    showMessageBox: (win, options) => dialog.showMessageBox(win as never, options as never) as never,
    showErrorBox: (title, content) => dialog.showErrorBox(title, content),
  },
  window: {
    create: (options) => {
      const webPreferences = { ...FORCED_WINDOW_WEB_PREFERENCES, ...((options.webPreferences as object) || {}) };
      // 强制项放最后：域传什么都改不掉隔离边界
      return new BrowserWindow({ ...options, webPreferences: { ...webPreferences, ...FORCED_WINDOW_WEB_PREFERENCES } } as never);
    },
    getAll: () => BrowserWindow.getAllWindows(),
    getFocused: () => BrowserWindow.getFocusedWindow(),
  },
};

// 挂到根上下文：域通过 inject: ["host"] 取用。
// ⛔ 与 ipc 接缝一样，必须在**域挂载之前** provide —— 组合表生成物里 import 本模块即可。
rootContext.provide("host", hostCaps);

/** 供守卫/调试读取当前接缝表（哪些键被 provide）。 */
export function hostCapabilityKeys(): string[] {
  return Object.keys(hostCaps);
}
