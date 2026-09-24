/**
 * 截图框选覆盖层专用 preload（09-24）。
 *
 * ⛔ 为什么单独一个 preload 而不是复用主窗口那个：
 *   主窗口 preload 暴露的是**整个 codex 桥**（三百多个方法）。覆盖层是一块临时的、
 *   覆盖全屏的、与主界面无关的画布，不该拿到那些能力。这里只开两个通道：
 *   报告选区 / 报告取消。
 * ⛔ 必须是**自包含单文件**（沙箱化 preload 不能 require 相对模块）——
 *   历史事故：把生成内容放独立文件再 import ⇒ preload 整体加载失败 ⇒ 白屏。
 *   本文件只 import("electron")，由 `tsc -p electron/tsconfig.json` 直接产出
 *   dist-electron/overlay-preload.js，无任何相对依赖。
 */
import { contextBridge, ipcRenderer } from "electron";

export type ShotRect = { x: number; y: number; width: number; height: number };

contextBridge.exposeInMainWorld("shotOverlay", {
  /** 确认：选区（CSS 像素，仅元数据用）+ 合成标注后的 PNG dataURL（物理分辨率，主进程直接落盘）。 */
  done: (rect: ShotRect, image: string) => ipcRenderer.send("screenshot:overlay-result", { rect, image }),
  /** 取消（ESC / 右键 / 选区过小）。 */
  cancel: () => ipcRenderer.send("screenshot:overlay-result", null),
});
