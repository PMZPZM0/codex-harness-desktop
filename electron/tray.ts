/**
 * 系统托盘（09-23 用户：「任务图标更新一下，然后要在系统托盘里面常驻，系统托盘右键功能菜单齐全一下」）。
 *
 * 只做**主进程能做干净**的事：显隐主窗口 / 实时状态 / 打开目录与日志 / 退出 / 「关闭窗口时最小化到托盘」开关。
 * 需要渲染层配合的条目（新建任务、跳设置页）**不放**在这里 —— 那要新增一条主→渲染命令通道
 * （preload + vite-env.d.ts + 渲染层监听三件套），属另一个改动，先不顺手加。
 *
 * 三条踩过的坑（写在这里，免得下次重踩）：
 *  ① **打包白名单**：`build/**` 不在 electron-builder 的 `files` 里 ⇒ 打包后 `app.getAppPath()/build/tray.png`
 *     不存在。本模块配套改 `package.json.files` 带上三个托盘图；运行期再做 `existsSync` + `isEmpty()`
 *     双查，缺图时打日志继续（`new Tray(空图)` 会得到一个"看不见的图标"，比抛异常更难查）。
 *  ② **菜单在弹出时现建**（`popUpContextMenu(buildAppTrayMenu(deps))`），不用 `setContextMenu` + 定时刷新：
 *     菜单里带「显示/隐藏」「运行中 N 个任务」这类实时状态，缓存住就会说假话。
 *  ③ 本模块**所有路径与版本号都惰性求值**（顶层不碰 `app.getPath` / `app.getVersion`）——
 *     见 electron/user-data-paths.ts 文件头，预检【91】同因盯这条线。
 */
import { app, nativeImage, Menu, Tray, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";

export type AppTrayDeps = {
  /** 主窗口（可能尚未创建 / 已销毁 ⇒ 调用方每次都现取） */
  getMainWindow: () => BrowserWindow | null;
  /** 显示并把主窗口带到前台（不存在则创建）——与 second-instance / activate 同一条链路 */
  showMainWindow: () => void;
  /** 正在运行的回合数（菜单里的实时状态行） */
  activeTurnCount: () => number;
  /** `<userData>` 根目录（「打开数据目录」） */
  userDataDir: () => string;
  /** 引擎诊断日志（「查看引擎日志」；路径来自 electron/user-data-paths） */
  logFilePath: () => string;
  /** 「关闭窗口时最小化到托盘」读 / 写（持久化在 app-settings.json） */
  readCloseToTray: () => boolean;
  writeCloseToTray: (next: boolean) => void;
  /** 退出应用（走既有的 app.quit 链路，不要在这里自己 cleanup） */
  quit: () => void;
};

let tray: Tray | null = null;

/** 托盘图标路径：dev 下 `app.getAppPath()` = 仓库根，打包后 = app.asar 根（两处都有 build/，见 package.json.files）。 */
export function trayIconPath(): string {
  // macOS 用「模板图」（文件名须以 Template 结尾，Electron 会自动带上 @2x）；其余平台用彩色图。
  return path.join(app.getAppPath(), "build", process.platform === "darwin" ? "trayTemplate.png" : "tray.png");
}

/** 主窗口当前是不是"已经在用户眼前"（可见且聚焦）。没聚焦时点托盘应把窗口带上来，而不是又把它藏掉。 */
function windowInFront(deps: AppTrayDeps): boolean {
  const win = deps.getMainWindow();
  if (!win || win.isDestroyed()) return false;
  return win.isVisible() && !win.isMinimized() && win.isFocused();
}

/**
 * 菜单模板。**每次弹出都重建**（见文件头 ②）：状态行与「显示/隐藏」都取当次实时值。
 * 导出是为了守卫能断言条目面（[122] 之后的托盘节）。
 */
export function buildAppTrayMenu(deps: AppTrayDeps): MenuItemConstructorOptions[] {
  const win = deps.getMainWindow();
  const alive = !!win && !win.isDestroyed();
  const visible = alive && (win as BrowserWindow).isVisible();
  const running = deps.activeTurnCount();
  const closeToTray = deps.readCloseToTray();
  return [
    {
      label: visible ? "隐藏主窗口" : "显示主窗口",
      click: () => {
        if (visible) deps.getMainWindow()?.hide();
        else deps.showMainWindow();
      },
    },
    {
      // 实时状态行：数字每回合都在变，所以这行**只读**（enabled:false 会被系统画成灰字，这里用 label 表达）
      label: running > 0 ? `运行中：${running} 个任务` : "空闲",
      enabled: false,
    },
    { type: "separator" },
    {
      // ⛔ 默认 **关**：开着就等于"点 X 不退出"，属可见行为变化，必须由用户在托盘菜单里主动打开。
      //    开启后 close 事件变成 hide（见 features/window-factory.ts 的 close 处理），退出走托盘「退出」或 Cmd+Q。
      label: "关闭窗口时最小化到托盘",
      type: "checkbox",
      checked: closeToTray,
      click: (item) => deps.writeCloseToTray(Boolean(item.checked)),
    },
    { type: "separator" },
    { label: "打开数据目录", click: () => void shell.openPath(deps.userDataDir()).catch(() => undefined) },
    {
      label: "查看引擎日志",
      click: () => {
        const file = deps.logFilePath();
        if (existsSync(file)) shell.showItemInFolder(file);
        else void shell.openPath(deps.userDataDir()).catch(() => undefined);
      },
    },
    { type: "separator" },
    { label: "退出 Codex Harness Desktop", click: () => deps.quit() },
  ];
}

/** 创建托盘（幂等）。失败必须由调用方 try/catch 兜住：托盘起不来不该影响启动链。 */
export function createAppTray(deps: AppTrayDeps): Tray {
  if (tray) return tray;
  const file = trayIconPath();
  const image = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  if (image.isEmpty()) {
    console.warn(`[tray] 托盘图标读不到或为空：${file}（打包版请检查 package.json files 白名单是否含 build/tray*.png）`);
  } else if (process.platform === "darwin") {
    // 模板图：系统只读 alpha 并按菜单栏明暗自动反色（见 scripts/build-tray-icon.cjs）
    image.setTemplateImage(true);
  }
  tray = new Tray(image);
  tray.setToolTip(`Codex Harness Desktop ${app.getVersion()}`);

  if (process.platform === "darwin") {
    // macOS 约定：点菜单栏图标 = 展开它的菜单（不做"点一下藏窗口"，那在 mac 上很反直觉）
    tray.on("click", () => tray?.popUpContextMenu(Menu.buildFromTemplate(buildAppTrayMenu(deps))));
  } else {
    // Windows/Linux：左键智能切换（没在前台就带上来，已在前台就收起来）+ 右键菜单
    tray.setIgnoreDoubleClickEvents(true);
    tray.on("click", () => {
      if (windowInFront(deps)) deps.getMainWindow()?.hide();
      else deps.showMainWindow();
    });
  }
  tray.on("right-click", () => tray?.popUpContextMenu(Menu.buildFromTemplate(buildAppTrayMenu(deps))));
  tray.on("double-click", () => deps.showMainWindow());
  return tray;
}

/** 退出前销毁：Windows 上不销毁的托盘图标会残留到鼠标划过才消失。 */
export function destroyAppTray() {
  try {
    tray?.destroy();
  } catch (error) {
    console.warn("[tray] 销毁失败（忽略，不阻塞退出）：", error instanceof Error ? error.message : error);
  }
  tray = null;
}

export function appTray() {
  return tray;
}
