/**
 * tools-ipc（10-03 从 `features/builtin-skills-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：tools(1)
 * 通道：tools:status（自动化工具三件套的安装/内核就绪状态）
 *
 * ⛔ CloakBrowser 是**三态**判定（09-16 起不随包）：未装包 → 可按需下载；
 *    装了包没内核 → 提示点内核卡片；都在 → 就绪。合成两态会让用户不知道该点哪个。
 * ⛔ CloakBrowser 内核优先查应用内置缓存，兼容旧的用户目录缓存（`~/.cloakbrowser`）。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cloakCacheDir, npmGlobalRoot, nuphusBinary, toolsRoot } from "../toolchain";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const toolsFeature = defineFeature<null>({
  id: "tools",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("tools: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("tools:status", () => {
      const readVersion = (pkgDir: string) => {
        try { return JSON.parse(readFileSync(pkgDir, "utf8")).version as string; }
        catch { return ""; }
      };
      const root = toolsRoot();
      const modules = npmGlobalRoot();
      const nuphusBin = nuphusBinary();
      // CloakBrowser 内核优先查应用内置缓存，兼容旧的用户目录缓存
      const cloakDirs = [cloakCacheDir(), path.join(os.homedir(), ".cloakbrowser")].filter(Boolean);
      let cloakBinary = false;
      for (const dir of cloakDirs) {
        try { if (readdirSync(dir).some((entry) => entry.includes("chromium"))) { cloakBinary = true; break; } } catch { /* 未下载 */ }
      }
      return [
        {
          id: "nuphus-mcp", name: "Nuphus 桌面自动化", scope: "computer",
          version: modules ? readVersion(path.join(modules, "@nuphus", "nuphus-mcp", "package.json")) : "",
          installed: Boolean(nuphusBin), binaryReady: Boolean(nuphusBin),
          detail: nuphusBin ? "35 个桌面/浏览器自动化工具就绪（屏幕、窗口、键鼠、剪贴板、OCR、Chrome CDP），经 nuphus-call 按需调用，不占模型上下文" : "未安装：到「开发工具」页对「Nuphus 桌面自动化」点一次「修复安装」",
          command: nuphusBin,
        },
        {
          id: "playwright-cli", name: "Playwright 浏览器自动化", scope: "browser",
          version: modules ? readVersion(path.join(modules, "@playwright", "cli", "package.json")) : "",
          installed: modules ? existsSync(path.join(modules, "@playwright", "cli", "package.json")) : false,
          binaryReady: existsSync(path.join(root, "pw-browsers")) && readdirSync(path.join(root, "pw-browsers")).some((entry) => entry.startsWith("chromium-")),
          detail: "命令行浏览器自动化：open / snapshot / click / type / screenshot；默认浏览器通道，内核可在「开发工具」页下载（国内镜像）",
          command: "playwright-cli",
        },
        {
          id: "cloakbrowser", name: "CloakBrowser 指纹浏览器", scope: "browser",
          version: modules ? readVersion(path.join(modules, "cloakbrowser", "package.json")) : "",
          installed: modules ? existsSync(path.join(modules, "cloakbrowser", "package.json")) : false,
          binaryReady: cloakBinary,
          // 三态（09-16 起 CloakBrowser 不随包，默认浏览器是内置视图 / playwright-cli）：
          // 未装包 → 提示可按需下载；装了包没内核 → 提示点内核卡片下载；都在 → 就绪。
          detail: !(modules && existsSync(path.join(modules, "cloakbrowser", "package.json")))
            ? "未安装（按需使用：需要过反爬站点时再到「开发工具」页下载，约 4 MB）"
            : cloakBinary
              ? "反检测 Chromium 内核已就绪（tools/cloak-cache）"
              : "npm 包已装，Chromium 内核未下载（「开发工具」页点「Cloak 指纹浏览器内核」下载）",
          command: "cloakbrowser",
        },
      ];
    });

    ctx.effect(() => {
      ipcHost.removeHandler("tools:status");
    });
  },
});
