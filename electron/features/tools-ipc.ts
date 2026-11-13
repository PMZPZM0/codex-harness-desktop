/**
 * tools-ipc（10-03 从 `features/builtin-skills-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：tools(1)
 * 通道：tools:status（自动化工具三件套的安装/内核就绪状态）
 *
 * ⛔ 浏览器自动化主通道是 ego lite（外部安装，状态走 browser:ego-status）；
 *    这里只保留随包的 Nuphus 桌面自动化；浏览器自动化走外部 Ego Lite。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import { existsSync, readFileSync } from "node:fs";
import { agentDesktopLauncher, computerUseLauncher, npmPackagePath, nuphusBinary } from "../toolchain";
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
      const nuphusPkg = npmPackagePath("@nuphus", "nuphus-mcp", "package.json");
      const nuphusBin = nuphusBinary();
      /* 11-06 用户问「这里为啥没有 computer use」：这个通道原来只回 Nuphus 一条，页面也就只画一张卡。
         两个桌面后端（Nuphus / Computer Use）都要列出来 —— 未安装的也列，用户才知道有得装。 */
      const cuLauncher = computerUseLauncher();
      const cuPkg = npmPackagePath("open-computer-use", "package.json");
      /* 11-13：agent-desktop（Vercel Labs）无障碍树后端 —— 未安装也列出，桌面自动化页才知道有得装。 */
      const adLauncher = agentDesktopLauncher();
      const adPkg = npmPackagePath("agent-desktop", "package.json");
      return [
        {
          id: "nuphus-mcp", name: "Nuphus 桌面自动化", scope: "computer",
          version: nuphusPkg ? readVersion(nuphusPkg) : "",
          installed: Boolean(nuphusPkg), binaryReady: Boolean(nuphusBin),
          detail: nuphusBin ? "35 个桌面/浏览器自动化工具就绪（屏幕、窗口、键鼠、剪贴板、OCR、Chrome CDP），经 nuphus-call 按需调用，不占模型上下文" : "未安装：到「开发工具」页对「Nuphus 桌面自动化」点一次「修复安装」",
          command: nuphusBin,
        },
        {
          id: "computer-use", name: "电脑操作（Computer Use）", scope: "computer",
          version: cuPkg ? readVersion(cuPkg) : "",
          installed: Boolean(cuPkg),
          binaryReady: Boolean(cuLauncher),
          detail: cuLauncher
            ? "9 个电脑操作工具就绪（列应用 / 读界面 / 点击 / 输入 / 按键），走系统无障碍控件清单，按元素序号操作、不猜坐标"
            : cuPkg
              ? "装了半截：缺平台主程序，到「开发工具」页点「修复安装」"
              : "未安装：到「开发工具」页安装（约 13MB，随包免下载；Windows 上作 Nuphus 的辅助后端）",
          command: cuLauncher,
        },
        {
          id: "agent-desktop", name: "Agent Desktop（无障碍树）", scope: "computer",
          version: adPkg ? readVersion(adPkg) : "",
          installed: Boolean(adPkg),
          binaryReady: Boolean(adLauncher),
          detail: adLauncher
            ? "核心 12 个无障碍树工具就绪（快照 / 查找 / 点击 / 输入 / 按键 / 滚动 / 窗口管理），按 @ref 操作、不猜坐标"
            : adPkg
              ? "装了半截：缺平台二进制，重新安装 agent-desktop"
              : "未安装：在本页点「安装 / 更新」（npm agent-desktop，约 32MB，Apache-2.0）",
          command: adLauncher,
        },
      ];
    });

    ctx.effect(() => {
      ipcHost.removeHandler("tools:status");
    });
  },
});
