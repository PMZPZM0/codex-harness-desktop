/**
 * screenshot/overlay-window.ts —— 截图的**覆盖层窗口**（打开 → 等用户编辑 → 回传结果）。
 *
 * 从 electron/screenshot.ts（659 行）切出（P2 批次 7）：这一段是纯 Electron 窗口编排，
 * 与「设置 / 采集 / 保存 / 热键」无关。
 * ⛔ preload 路径**由调用方传入**：搬进子目录后 `__dirname` 变了，写死路径会在运行时找不到
 *    预加载脚本（而 TypeScript 不会报错）—— 这是本批唯一的行为风险点，已用参数化规避。
 */
import { BrowserWindow, ipcMain, type Display } from "electron";
import { buildOverlayHtml as overlayHtml } from "./overlay-page";
import type { OverlayRect, OverlayResult } from "../screenshot";

export function pickEdited(
  display: Display,
  frame: Electron.NativeImage,
  initialRect: OverlayRect | null,
  preloadPath: string,
): Promise<OverlayResult> {
  return new Promise((resolve) => {
    const bounds = display.bounds;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    // ⛔ 编辑器底图必须**物理分辨率**（标注合成后回传的就是它）：不能 resize 到逻辑尺寸，
    //    否则高分屏上确认出的图糊一半。JPEG 92：视觉无损级别，base64 后 1~3MB 可内联。
    let guide = "";
    try {
      guide = `data:image/jpeg;base64,${frame.toJPEG(92).toString("base64")}`;
    } catch {
      guide = "";
    }
    const overlay = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width,
      height,
      show: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: "#000000",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    // 压过任务栏/其它置顶窗口；mac 上还要允许盖住全屏空间
    overlay.setAlwaysOnTop(true, "screen-saver");
    try { overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* 平台不支持 */ }

    let settled = false;
    const finish = (value: OverlayResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMainRemove();
      try { if (!overlay.isDestroyed()) overlay.destroy(); } catch { /* 已销毁 */ }
      resolve(value);
    };
    // 结果从覆盖层的 preload 回来；只认**这个窗口**发的消息（别的窗口发同一通道不算）
    const onResult = (event: Electron.IpcMainEvent, payload: unknown) => {
      if (event.sender !== overlay.webContents) return;
      if (!payload || typeof payload !== "object") { finish(null); return; }
      const raw = payload as { rect?: unknown; image?: unknown };
      const r = raw.rect as OverlayRect | undefined;
      const image = typeof raw.image === "string" && raw.image.startsWith("data:image/png;base64,") ? raw.image : "";
      if (!r || typeof r !== "object") { finish(null); return; }
      const clean = {
        x: Math.max(0, Math.round(Number(r.x) || 0)),
        y: Math.max(0, Math.round(Number(r.y) || 0)),
        width: Math.max(0, Math.round(Number(r.width) || 0)),
        height: Math.max(0, Math.round(Number(r.height) || 0)),
      };
      if (clean.width < 8 || clean.height < 8) { finish(null); return; }
      finish({ rect: clean, image });
    };
    const ipcMainRemove = () => { try { ipcMain.removeListener("screenshot:overlay-result", onResult); } catch { /* noop */ } };
    ipcMain.on("screenshot:overlay-result", onResult);

    // 兜底：用户用 Alt+F4 / 系统方式关掉覆盖层 ⇒ 视为取消，不能把 Promise 吊死
    overlay.on("closed", () => finish(null));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    // 2 分钟没人操作就自动放弃，避免一个看不见的置顶窗口卡住
    const timer = setTimeout(() => finish(null), 120_000);

    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml(guide, initialRect))}`).then(() => {
      if (overlay.isDestroyed()) return;
      overlay.show();
      overlay.focus();
    }).catch(() => finish(null));
  });
}
