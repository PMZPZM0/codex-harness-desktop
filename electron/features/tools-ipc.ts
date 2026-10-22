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
import { readFileSync } from "node:fs";
import { npmPackagePath, nuphusBinary } from "../toolchain";
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
      return [
        {
          id: "nuphus-mcp", name: "Nuphus 桌面自动化", scope: "computer",
          version: nuphusPkg ? readVersion(nuphusPkg) : "",
          installed: Boolean(nuphusPkg), binaryReady: Boolean(nuphusBin),
          detail: nuphusBin ? "35 个桌面/浏览器自动化工具就绪（屏幕、窗口、键鼠、剪贴板、OCR、Chrome CDP），经 nuphus-call 按需调用，不占模型上下文" : "未安装：到「开发工具」页对「Nuphus 桌面自动化」点一次「修复安装」",
          command: nuphusBin,
        },
      ];
    });

    ctx.effect(() => {
      ipcHost.removeHandler("tools:status");
    });
  },
});
