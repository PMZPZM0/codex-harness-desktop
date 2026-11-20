/**
 * 更新安装小窗 —— **独立 Electron 入口**（11-20 重做，替代原来的 PowerShell WinForms 方案）。
 *
 * ⛔⛔ 为什么换掉 PowerShell：实测冷启动要 2–4 秒（PowerShell 5.1 本身 ~800ms，
 *   `Add-Type` 现场编译 C# 再 >1s，还要加载 WinForms/Drawing 两个程序集），
 *   而我们静默安装往往 5–10 秒就结束 —— 用户的原话就是「安装的时候没有进度条提醒」：
 *   窗口出现时安装已经完了。另一个隐患是 `Add-Type` 依赖机器上的 csc.exe，
 *   精简系统上编译失败会**静默**什么都不显示（`$ErrorActionPreference = SilentlyContinue` 把错误吞了）。
 *   Electron 入口冷启动 ~300ms，窗口用 HTML/CSS 画，不依赖 .NET、不依赖任何外部编译器。
 *
 * 启动方式（由 `update-splash.ts` 的 `showUpdateSplash()` 负责）：
 *   `process.execPath  <dist-electron/splash-main.js>  <version> <appExeName> <timeoutSeconds>`
 *   ⛔ 它是**另一个 Electron 应用**（入口就是本文件），不会执行 `main.ts`，
 *     所以不受单实例锁影响；userData 也改到 temp 下，避免和主实例抢 profile 锁。
 *
 * 行为：应用进程「消失过、又出现」⇒ 新版本起来了 ⇒ 自动关窗；
 *       超时仍没等到 ⇒ 文案改成「更新未完成」，留一个关闭按钮。
 */
import { app, BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";

const argv = process.argv;
/** argv[0]=exe / [1]=本脚本 / 之后是我们传的三个参数 */
const version = String(argv[2] ?? "").trim();
const exeName = String(argv[3] ?? "").trim();
const timeoutSeconds = Math.max(20, Number(argv[4] ?? 240) || 240);

/* ⛔ 必须在 ready 之前改：独立 profile，别和正在退出的主实例抢同一个 userData 锁。 */
app.setPath("userData", path.join(app.getPath("temp"), "harness-update-splash"));
app.disableHardwareAcceleration();

const BTN_CLOSE = "&#10005;";

/** 小窗 HTML（内联，零外部资源 ⇒ 首帧就是最终样式，不会闪白）。 */
function htmlFor(title: string, sub: string, hint: string, iconDataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { height:100%; }
  body {
    background:#171c24; color:#f5f7fa; overflow:hidden;
    font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;
    -webkit-user-select:none; user-select:none;
    border-radius:14px; border:1px solid #2b3442;
    display:flex; flex-direction:column;
  }
  .bar { height:3px; flex:0 0 3px; background:linear-gradient(90deg,#4c8dff,#8b5cf6,#4c8dff);
    background-size:200% 100%; animation:flow 2.4s linear infinite; border-radius:14px 14px 0 0; }
  @keyframes flow { from { background-position:0 0 } to { background-position:-200% 0 } }
  .body { flex:1; display:flex; gap:16px; padding:20px 20px 18px; position:relative; }
  .icon { width:42px; height:42px; flex:0 0 42px; border-radius:10px; background:#232b38;
    display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .icon img { width:32px; height:32px; }
  .main { flex:1; min-width:0; padding-top:2px; }
  .title { font-size:15px; font-weight:600; letter-spacing:.2px; line-height:20px; }
  .title small { font-weight:500; color:#98a2b3; margin-left:6px; font-size:12px; }
  .sub { font-size:12px; color:#98a2b3; margin-top:6px; line-height:18px; }
  .track { position:absolute; left:20px; right:20px; bottom:34px; height:6px; border-radius:999px;
    background:#2a313d; overflow:hidden; }
  .indet { position:absolute; top:0; height:100%; width:38%; border-radius:999px;
    background:linear-gradient(90deg,#4c8dff,#8b5cf6); animation:slide 1.35s cubic-bezier(.4,0,.2,1) infinite; }
  @keyframes slide { 0% { left:-40% } 100% { left:100% } }
  .hint { position:absolute; left:20px; bottom:10px; font-size:11px; color:#6f7a8a; }
  .close { position:absolute; top:8px; right:10px; width:24px; height:24px; border-radius:6px;
    display:flex; align-items:center; justify-content:center; color:#7c8798; font-size:12px;
    cursor:pointer; -webkit-app-region:no-drag; }
  .close:hover { background:#232b38; color:#f5f7fa; }
  .drag { -webkit-app-region:drag; position:absolute; inset:0; }
  </style></head><body>
  <div class="bar"></div>
  <div class="drag"></div>
  <div class="body">
    <div class="icon">${iconDataUrl ? `<img src="${iconDataUrl}">` : ""}</div>
    <div class="main">
      <div class="title">${title}<small>v${version}</small></div>
      <div class="sub">${sub}</div>
    </div>
  </div>
  <div class="track"><div class="indet"></div></div>
  <div class="hint">${hint}</div>
  <div class="close" onclick="window.close()">${BTN_CLOSE}</div>
  </body></html>`;
}

const TITLE = "正在安装更新";
const SUB = "请勿重复启动，安装完成后会自动打开";
const HINT = "安装通常需要 5–20 秒，期间请不要重复启动";
const FAIL_TITLE = "更新未完成";
const FAIL_SUB = "安装似乎没有完成，请手动重新打开应用";
const FAIL_HINT = "若仍失败，请重新运行安装包（安装包已保留在下载目录）";

/** 用 tasklist 判断应用进程在不在（不引第三方依赖）。 */
function isAppRunning(cb: (running: boolean) => void): void {
  if (!exeName) return cb(true);
  execFile("tasklist", ["/FI", `IMAGENAME eq ${exeName}`, "/NH", "/FO", "CSV"],
    { windowsHide: true, timeout: 4000 },
    (err, stdout) => cb(!err && String(stdout).toLowerCase().includes(exeName.toLowerCase())));
}

app.whenReady().then(async () => {
  let iconDataUrl = "";
  try {
    /* 拿主程序图标（失败就留空，图标位是个圆角方块，不影响观感）。 */
    const src = path.join(process.execPath);
    const img = await app.getFileIcon(src, { size: "normal" });
    iconDataUrl = img.isEmpty() ? "" : img.toDataURL();
  } catch { /* 图标取不到就不显示 */ }

  const win = new BrowserWindow({
    width: 420,
    height: 176,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: "#171c24",
    title: "Codex Harness 更新",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlFor(TITLE, SUB, HINT, iconDataUrl)));
  win.once("ready-to-show", () => win.show());

  /* 进程状态机：
     · sawLive：本次至少见过一次「应用在跑」（主进程还没退干净）；
     · wentOff：见过它消失；
     · wentOff 之后又见到 ⇒ 新版本起来了 ⇒ 关窗。
     ⛔ 若启动时主进程已经退了（sawLive 一直为假），6 秒后把它当成「已经离开过」，
        否则永远等不到 wentOff，小窗会挂到超时。 */
  let sawLive = false;
  let wentOff = false;
  let done = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (done) return;
    isAppRunning((running) => {
      if (done) return;
      if (running) {
        if (!sawLive) sawLive = true;
        else if (wentOff) {
          done = true;
          clearInterval(timer);
          win.close();
        }
      } else if (sawLive) {
        wentOff = true;
      } else if (Date.now() - startedAt > 6000) {
        /* 启动时主进程就已经没了 —— 视为「已经退出过」。 */
        wentOff = true;
      }
      if (!done && Date.now() - startedAt > timeoutSeconds * 1000) {
        done = true;
        clearInterval(timer);
        void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlFor(FAIL_TITLE, FAIL_SUB, FAIL_HINT, iconDataUrl)));
      }
    });
  }, 700);
});
