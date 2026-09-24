/**
 * window-factory（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：createWindow / createPopoutWindow
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import path from "node:path";
import { BrowserWindow, app, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { applyRoundedCorners } from "../win-rounded-corners";
import { popoutBusWindows, registerBusWindow, unregisterBusWindow } from "../features/window-bus";
import { flushBootTiming, markBoot } from "../boot-timing";
import { installContextMenu } from "../main/10-window-menu";
import { closeToTrayEnabled, engineActiveTurnIds, notifyPopoutClosed, popoutThreadIds, titleBarOverlayOptions } from "../runtime-refs";
import { mutableState } from "../main";
export function createWindow() {
  // Windows 任务栏图标必须用 .ico 才可靠（PNG 会被 electron.exe 默认图标顶掉）；
  // ⛔ 资源定位锚在 app.getAppPath()（dev = 仓库根 / 打包 = app.asar 根），**不要用 __dirname**：
  //    features/ 下的 __dirname 是 dist-electron/features，`..` 会落到 dist-electron 里
  //    （09-21 架构改造把本模块从 electron/main.ts 搬进 features/ 时正是这样把图标/渲染层/preload 三个路径一起打歪的）。
  // 打包后 build/ 不进 asar（files 白名单只有 dist/**、dist-electron/**），existsSync 为 false
  // 走 exe 内嵌图标（electron-builder win.icon 已注入）。
  const windowIcon = path.join(
    app.getAppPath(),
    "build",
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
  mutableState.mainWindow = new BrowserWindow({
    // 默认桌面尺寸要容纳展开侧栏和完整输入工具栏；小屏仍由响应式布局处理。
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#ffffff",
    title: "Codex Harness Desktop",
    icon: existsSync(windowIcon) ? windowIcon : undefined,
    autoHideMenuBar: true,
    // 无边框标题栏：系统标题栏隐藏，应用 topbar 顶到窗口边缘（省 ~32px 高度）。
    // ⛔ 平台分叉（09-16 mac 适配）：titleBarOverlay 的窗口控制钮是 **Windows 专属**
    // （右上角贴靠/双击最大化等原生行为）；mac 上硬传只是被忽略，红绿灯仍画在左上角，
    // 而渲染层按 Windows 预留的右上 145px 空白就成了纯浪费。mac 走 hiddenInset——
    // 红绿灯按系统标准内缩，渲染层用 [data-os="darwin"] 把顶行内容让开（styles.css）。
    ...(process.platform === "win32"
      ? {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: {
          // 让 `.topbar { background: var(--bg) }` 自己穿过来——钮不再"浮在自己的色条上"，
          // 也无需枚举每个主题调色；亮/暗主题都能干净。符号色在 theme:apply 里跟着主题切。
          color: "#00000000",
          symbolColor: titleBarOverlayOptions().symbolColor,
          // 43 而非 44：底下留 1px 给 .topbar::after 分隔线，线可贯通窗口钮下方
          height: 43,
        },
      }
      : { titleBarStyle: "hiddenInset" as const }),
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // <webview> 标签（Electron 默认禁用）：主区「浏览器」视图用它嵌入外部网页。
      // guest 内容是独立 webContents，与主应用隔离（拿不到 preload / node API），
      // 仅用于渲染，不赋予任何宿主权限。
      webviewTag: true,
    },
  });
  // Windows 11 原生圆角（仅 win32；其余平台函数内静默跳过）。
  applyRoundedCorners(mutableState.mainWindow);
  // 登记进窗口广播总线：主窗口 ⇒ sendToWindow 只发它，broadcast* 发全部窗口（见 features/window-bus）
  registerBusWindow(mutableState.mainWindow, { primary: true });
  // ⛔ 导航与新窗口收敛（09-13 审计 S5）：全仓此前 `will-navigate` / `setWindowOpenHandler`
  // **零命中** —— 主窗口加载了任意页面（模型输出里的链接、拖入的本地 html）就能在当前
  // webContents 里换掉整个应用界面，而它带着 `harness-image://` 与全部 IPC 桥。
  // 规则：**主窗口自身永不导航**（应用只从 dist/devServer 加载），新窗口一律拒绝并转系统浏览器。
  mutableState.mainWindow.webContents.on("will-navigate", (event, target) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "";
    if (devUrl && target.startsWith(devUrl)) return;   // 开发期 HMR reload 放行
    if (target.startsWith("file://") && target.includes("/dist/index.html")) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) void shell.openExternal(target).catch(() => undefined);
  });
  mutableState.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
  // <webview> guest 只允许 http(s) 且禁弹窗；不给它任何宿主权限（分区隔离见 BrowserPane）。
  mutableState.mainWindow.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    delete (webPreferences as any).preload;
    (webPreferences as any).nodeIntegration = false;
    (webPreferences as any).contextIsolation = true;
    if (!/^https?:/i.test(String(params.src ?? ""))) delete (params as any).src;
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  // ⛔ 关窗守卫（09-13 审计第 5 条）：此前全 `main.ts` **没有 `mainWindow.on("close")`、没有确认框**，
  // 而 `cleanupAll()` 里 `server.stop()` 直接 kill 引擎 —— 长任务流式中点关闭 = 该回合在 rollout 里
  // 没有 task_complete（半截），排队中的消息随引擎内存一起消失。
  // 只做一件事：**有在跑回合时先问一句**。不阻塞主进程（异步对话框 + preventDefault + 二次 close）。
  mutableState.mainWindow.on("close", (event) => {
    // ⛔ 托盘「关闭窗口时最小化到托盘」（09-23 用户要求托盘常驻）：开着时 X 只隐藏窗口 ——
    //    引擎 / 调度器 / 渠道机器人 / 正在跑的回合全都不中断。**必须排在下面的"还有任务在跑"确认框之前**：
    //    隐藏不中断任何东西，这时再弹"关闭会中断回合"的警告只会吓人。
    //    ⛔ 退出路径（托盘「退出」/ Cmd+Q / 系统关机）由 `before-quit` 置 closeConfirmed=true 绕开这里，
    //      否则会退不出去（点了退出却只是把窗口藏起来）。
    if (!mutableState.closeConfirmed && closeToTrayEnabled()) {
      event.preventDefault();
      mutableState.mainWindow?.hide();
      // 留一行日志：这条分支是"点了 X 却不退出"的地方，出问题时**必须能从日志里看出它到底走没走**
      // （否则只能靠猜"是不是开关没读到 / 事件没触发"）。e2e 也用它做判据。
      console.log("[tray] 关闭被拦截 → 隐藏主窗口（closeToTray 开启；退出走托盘「退出」/ Cmd+Q）");
      return;
    }
    if (mutableState.closeConfirmed || engineActiveTurnIds.size === 0) return;
    event.preventDefault();
    const busy = engineActiveTurnIds.size;
    void dialog.showMessageBox(mutableState.mainWindow!, {
      type: "warning",
      buttons: ["继续运行（取消关闭）", "仍然关闭"],
      defaultId: 0,
      cancelId: 0,
      message: `还有 ${busy} 个任务在运行`,
      detail: "关闭应用会中断正在运行的回合，未完成的内容不会写入会话记录；排队中的消息也会丢失。",
    }).then(({ response }) => {
      if (response !== 1) return;
      mutableState.closeConfirmed = true;
      mutableState.mainWindow?.close();
    }).catch(() => undefined);
  });
  // 主窗口真正关闭后，独立会话弹窗跟着一起关（用户 09-13 明确要求「跟着主应用关闭」）。
  mutableState.mainWindow.on("closed", () => {
    for (const win of popoutBusWindows()) { if (!win.isDestroyed()) win.close(); }
  });
  const contents = mutableState.mainWindow.webContents;
  contents.on("did-start-loading", () => markBoot("page-start-loading"));
  contents.on("did-finish-load", () => { markBoot("page-finish-load"); flushBootTiming(); });
  if (devUrl) void mutableState.mainWindow.loadURL(devUrl);
  else void mutableState.mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  installContextMenu(mutableState.mainWindow);
}

/**
 * 把主窗口带到用户眼前（托盘点按 / second-instance / mac activate 共用一条链路）：
 * 不存在则创建、最小化则还原、隐藏则显示，最后聚焦。
 * ⛔ 三处都别自己写 `mainWindow?.show()`：窗口被销毁后它只是 no-op，用户点了「显示主窗口」却什么都没发生。
 */
export function showMainWindow() {
  const win = mutableState.mainWindow;
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

export function createPopoutWindow(threadId: string) {
  const windowIcon = path.join(
    app.getAppPath(),
    "build",
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
  const win = new BrowserWindow({
    // 1120 而非 1080：主布局在 ≤1080px 时隐藏消息刻度尺（media query），弹窗初始宽度
    // 必须避开这个断点，否则弹窗里看不到刻度线（用户截图反馈）。
    width: 1120,
    height: 760,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: "#ffffff",
    title: "Codex Harness Desktop — 独立会话",
    icon: existsSync(windowIcon) ? windowIcon : undefined,
    autoHideMenuBar: true,
    // 独立弹窗同款平台分叉（mac hiddenInset / win overlay），理由见 createWindow
    ...(process.platform === "win32"
      ? {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: titleBarOverlayOptions(),
      }
      : { titleBarStyle: "hiddenInset" as const }),
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 弹窗只渲染对话区，不需要 webview 标签
      webviewTag: false,
    },
  });
  // Windows 11 原生圆角（仅 win32；其余平台函数内静默跳过）。
  applyRoundedCorners(win);
  // ⛔ 导航收敛与主窗口同规则：弹窗永不导航，新窗口一律拒绝并转系统浏览器。
  win.webContents.on("will-navigate", (event, target) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "";
    if (devUrl && target.startsWith(devUrl)) return;   // 开发期 HMR reload 放行
    if (target.startsWith("file://") && target.includes("/dist/index.html")) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) void shell.openExternal(target).catch(() => undefined);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
  win.on("closed", () => {
    unregisterBusWindow(win);
    popoutThreadIds.delete(win);
    notifyPopoutClosed(threadId);
  });
  registerBusWindow(win);
  popoutThreadIds.set(win, threadId);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const query = `?popout=${encodeURIComponent(threadId)}`;
  if (devUrl) {
    const sep = devUrl.includes("?") ? "&" : "?";
    void win.loadURL(devUrl + sep + query.slice(1));
  } else {
    void win.loadFile(path.join(app.getAppPath(), "dist", "index.html"), { query: { popout: threadId } });
  }
  installContextMenu(win);
  return win;
}
