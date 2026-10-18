/**
 * HTML 实时预览 · 主进程域（10-18 用户：「写 html 文件的时候，自动打开右边浏览器，
 * 会话窗口自动缩小一点比例，把右边展示全，实时渲染 html 内容」）。
 *
 * 独立板块：只做「盯住一个 HTML 文件，变了就推事件」这一件事，⛔ 不塞进 turn-file-watch
 * （那是回合级差异统计，回合结束就停；预览要跨回合持续跟到用户不再看为止）。
 *
 * 安全边界：
 *   · 只接受 `.html / .htm / .xhtml`，且必须落在**可信目录**（当前会话工作区 / userData /
 *     用户亲自选过的路径）内 —— 渲染层传什么都不能越界读文件；
 *   · 只监听**文件所在目录**并按 basename 过滤（比 watch 单文件稳：编辑器常用「写临时文件再
 *     rename」的原子保存，watch 文件会跟丢）；120ms 防抖合并一次保存的多条事件；
 *   · 监听器 `persistent:false`，不拖住 Node 退出；换文件/卸载域/退出时都显式 close。
 */
import fs from "node:fs";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { isInsideTrustedRoots } from "../runtime-refs";
import { broadcastHarnessEvent } from "./window-bus";

const HTML_FILE_RE = /\.(html?|xhtml)$/i;
const CHANNELS = ["html-preview:watch", "html-preview:unwatch"];

let watcher: fs.FSWatcher | null = null;
let watchedPath = "";
let debounce: NodeJS.Timeout | null = null;

function stopWatch(): void {
  if (debounce) { clearTimeout(debounce); debounce = null; }
  if (watcher) {
    try { watcher.close(); } catch { /* 已关闭 */ }
    watcher = null;
  }
  watchedPath = "";
}

function startWatch(target: string): void {
  stopWatch();
  watchedPath = target;
  const dir = path.dirname(target);
  const base = path.basename(target).toLowerCase();
  watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
    // filename 可能为 null（平台差异）⇒ 无法判断时按「可能是它」处理，交给防抖与前端 reload 消化
    const name = filename ? String(filename).toLowerCase() : "";
    if (name && name !== base) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (watchedPath !== target) return;
      broadcastHarnessEvent({ type: "html-preview:changed", path: target, at: Date.now() });
    }, 120);
  });
  watcher.on("error", () => stopWatch());
}

export const htmlPreviewFeature = defineFeature<null>({
  id: "html-preview",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("html-preview: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("html-preview:watch", (_event, input: unknown) => {
      const raw = input && typeof input === "object" ? (input as { path?: unknown }).path : "";
      const target = path.resolve(String(raw ?? ""));
      if (!target || !HTML_FILE_RE.test(target)) return { ok: false, error: "只能预览 .html / .htm / .xhtml 文件" };
      if (!isInsideTrustedRoots(target)) return { ok: false, error: "文件不在可信目录（当前工作区 / 应用数据）内，拒绝预览" };
      try {
        if (!fs.statSync(target).isFile()) return { ok: false, error: "目标不是文件" };
      } catch {
        return { ok: false, error: "文件不存在" };
      }
      try {
        startWatch(target);
      } catch (error: any) {
        stopWatch();
        return { ok: false, error: `无法监听文件：${String(error?.message ?? error)}` };
      }
      return { ok: true, path: target };
    });

    ipcHost.handle("html-preview:unwatch", () => {
      stopWatch();
      return { ok: true };
    });

    // 域卸载 / 应用退出：监听器与定时器都要收掉；通道也摘掉。
    ctx.effect(() => () => stopWatch());
    ctx.effect(() => {
      for (const channel of CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
