/**
 * clipboard-ipc（09-22 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 域：**剪贴板读写**（复制截图 / 写文本 / 写图片 / 读文件列表）。
 * 搬出符号：IPC handler clipboard:image / clipboard:write / clipboard:write-image /
 *           clipboard:read-files。
 * 消费方：渲染层输入框（粘贴图片 / 复制 / 落盘粘贴文本引用的图片）。
 *
 * 代码与原地逐字一致（仅顶部 import、文件头注释、通道归并）。
 * ⛔ imagesDir 不再取 main.ts 模块顶层常量 —— 改为 handler 内惰性求值
 *   `path.join(app.getPath("userData"), "images")`：模块顶层不得求值
 *   `app.getPath("userData")`（【91】复发防线，见 electron/personalization.ts）。
 *   其余符号（clipboard / nativeImage / ClipboardItem / app）均来自 electron 模块，
 *   不依赖 main.ts，零跨域耦合。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行（早于 whenReady）。
 */
import { app, clipboard, nativeImage, ClipboardItem, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { imagesDir as resolveImagesDir } from "../user-data-paths";

ipcMain.handle("clipboard:image", async () => {
  // Electron 44：clipboard.readImage() 已移除，改 W3C 风格 read() → ClipboardItem[] → image/png Blob
  const items = await clipboard.read();
  const item = items.find((entry) => entry.types.includes("image/png"));
  if (!item) return null;
  const blob = await item.getType("image/png");
  if (!(blob instanceof Blob)) return null;
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (!buffer.length) return null;
  const imagesDir = resolveImagesDir();
  await fs.mkdir(imagesDir, { recursive: true });
  const file = path.join(imagesDir, `codex-harness-${Date.now()}.png`);
  await fs.writeFile(file, buffer);
  return file;
});
/** 文本写剪贴板：走主进程 electron clipboard，不受渲染层 Clipboard API 的
 *  焦点/权限限制（用户实测窗口失焦时 navigator.clipboard.writeText 抛
 *  "Write permission denied"，表现为「复制失败」toast）。 */
ipcMain.handle("clipboard:write", async (_event, text: string) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});
/** 复制本地图片文件到剪贴板（主进程能力，渲染层拿不到）：供 clipboard:write-image 与
 *  截图确认（screenshot-favorites-ipc）共用 —— Electron 44 已移除 clipboard.writeImage。 */
export async function copyImageFileToClipboard(filePath: string): Promise<void> {
  if (!filePath) throw new Error("缺少图片路径");
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error("无法读取该图片文件");
  const png = image.toPNG();
  // Electron 44 的 ClipboardItem 是 electron 模块具名导出（官方 breaking-changes 迁移示例：
  // const { clipboard, ClipboardItem } = require('electron')）。writeImage 已移除，写图片 =
  // clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()]) })]）。
  if (typeof ClipboardItem !== "function") throw new Error("剪贴板 API 不可用");
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
}

ipcMain.handle("clipboard:write-image", async (_event, filePath: string) => {
  await copyImageFileToClipboard(String(filePath ?? ""));
  return true;
});
/** 读取剪贴板里的文件路径（渲染层 clipboardData.files/uri-list 拿不到时的兜底）：
 *  Windows 复制文件进剪贴板是 CF_HDROP，Chromium 渲染层有时不暴露，但主进程
 *  clipboard.read() 的 ClipboardItem 带 text/uri-list（file:/// 列表）。 */
ipcMain.handle("clipboard:read-files", async () => {
  const items = await clipboard.read();
  const paths: string[] = [];
  for (const item of items) {
    if (!item.types.includes("text/uri-list")) continue;
    try {
      const payload = await item.getType("text/uri-list");
      if (!(payload instanceof Blob)) continue;
      const text = await payload.text();
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const url = new URL(trimmed);
          if (url.protocol === "file:") {
            paths.push(decodeURIComponent(trimmed.slice("file://".length)).replace(/\//g, "\\").replace(/^\\/, ""));
          }
        } catch { /* 非 URL 行跳过 */ }
      }
    } catch { /* 单个 item 读取失败不影响其他 */ }
  }
  return paths;
});
