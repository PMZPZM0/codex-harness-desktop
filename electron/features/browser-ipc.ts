/**
 * browser-ipc（10-03 从 `features/settings-app-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：browser(3)
 * 通道：browser:open-cloak / browser:cloak-status / browser:popout
 *
 * ⛔ `cloakStatus` 是本域私有的模块级状态（只被 cloak 两通道读写）⇒ 随板块走。
 *    `cloakProc` 走 `mutableState` 访问器（ESM 里 import 的绑定不可赋值）—— 这层间接不能去掉。
 * ⛔⛔ `browser:popout` 的 URL 校验与 `external:open` 同口径：只放行 http/https 或经
 *    `filePreviewAllowed` 放行的本地预览地址；窗口开 `contextIsolation + sandbox`（安全边界不放宽）。
 * ⛔ 待接缝化（阶段 2）：BrowserWindow / spawn / fs 均为宿主能力，将来经 `"window"` / `"subprocess"` 注入。
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { BrowserWindow } from "electron";
import { bundledNode, cloakOpenHelper, npmGlobalRoot, toolchainEnv } from "../toolchain";
import { filePreviewAllowed, mutableState } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

let cloakStatus: { event?: string; message?: string; url?: string; title?: string } = {};

export const browserFeature = defineFeature<null>({
  id: "browser",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("browser: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("browser:open-cloak", (_event, url: string) => {
      const modules = npmGlobalRoot();
      if (!modules || !existsSync(path.join(modules, "cloakbrowser", "package.json"))) {
        return { ok: false, detail: "CloakBrowser 未安装（按需下载）：到「设置 → 开发工具」下载「CloakBrowser 指纹浏览器」（约 4 MB）后再用；日常浏览走内置浏览器视图" };
      }
      if (!mutableState.cloakProc || mutableState.cloakProc.exitCode !== null) {
        const helper = cloakOpenHelper();
        if (!helper || !existsSync(helper)) return { ok: false, detail: "缺少 resources/tools/cloak-open.mjs 助手脚本" };
        const node = bundledNode() || "node";
        mutableState.cloakProc = spawn(node, [helper], { windowsHide: true, env: { ...toolchainEnv(), CLOAK_NPM_ROOT: modules } });
        mutableState.cloakProc.stdout?.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString().split("\n")) {
            if (!line.trim()) continue;
            try { cloakStatus = JSON.parse(line); } catch { /* 非 JSON 行 */ }
          }
        });
        mutableState.cloakProc.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) cloakStatus = { event: "error", message: text.slice(0, 300) };
        });
        mutableState.cloakProc.once("error", (error) => { cloakStatus = { event: "error", message: error.message }; mutableState.cloakProc = null; });
        mutableState.cloakProc.once("exit", (code) => {
          if (cloakStatus.event !== "error") cloakStatus = { event: "exit", ...(code ? { message: `浏览器进程退出（${code}）` } : {}) };
          mutableState.cloakProc = null;
        });
        mutableState.cloakProc.stdin?.on("error", () => { /* EPIPE：进程刚退出 */ });
        cloakStatus = { event: "launching" };
      }
      try {
        mutableState.cloakProc.stdin?.write(`${url.trim()}\n`);
        return { ok: true, detail: "已提交给 CloakBrowser" };
      } catch (error: any) {
        return { ok: false, detail: error.message };
      }
    });
    ipcHost.handle("browser:cloak-status", () => cloakStatus);
    ipcHost.handle("browser:popout", async (_event, value: string) => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:" && !filePreviewAllowed(url)) throw new Error("Unsupported URL");
      const pop = new BrowserWindow({
        width: 1180,
        height: 800,
        minWidth: 480,
        minHeight: 320,
        title: "预览",
        autoHideMenuBar: true,
        backgroundColor: "#1b1b1a",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      pop.setMenuBarVisibility(false);
      void pop.loadURL(url.toString());
      return { ok: true };
    });

    ctx.effect(() => {
      for (const ch of ["browser:open-cloak", "browser:cloak-status", "browser:popout"]) ipcHost.removeHandler(ch);
    });
  },
});
