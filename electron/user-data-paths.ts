/**
 * user-data-paths —— `<userData>` 下**所有**派生子路径的唯一真相源。
 *
 * 背景（09-22 收口）：改造过程中 `<userData>/images` 曾在**三处**各自推导
 *   · electron/features/app-diagnostics.ts  `path.join(ud, "images")`（量尺寸 + 清理）
 *   · electron/features/clipboard-ipc.ts     `path.join(app.getPath("userData"), "images")`
 * 今天同值，但**改一处即静默分叉**（设置页量的目录 ≠ 剪贴板写的目录，且没有任何断言会红）。
 *
 * ⛔ 本模块的每个函数都必须**惰性求值**：模块顶层不得调 `app.getPath("userData")`。
 *   非 main.ts 的模块体语句在 `app.setPath("userData", …)` **之前**执行
 *   （TS 把 import 编成 require 置于最前）⇒ 顶层求值会拿到默认目录，路径静默漂移。
 *   预检【91】盯这条线。
 *
 * 守卫：【95】断言 `"images"` 只在**本文件**里被拼进 userData 路径。
 */
import { app } from "electron";
import path from "node:path";

/** `<userData>/images` —— 粘贴图片落盘目录（clipboard 写、设置页量/删）。 */
export function imagesDir(): string {
  return path.join(app.getPath("userData"), "images");
}

/** `<userData>/engine-debug.log` —— 引擎诊断日志（黑匣子）。 */
export function engineDebugLogPath(): string {
  return path.join(app.getPath("userData"), "engine-debug.log");
}
