/**
 * artcraft-ipc（11-16）—— Craft 全家桶（ArtCraft Launcher）宿主域。
 *
 * 域：artcraft(3)
 * 通道：status / open / sync
 *
 * ⛔ Launcher 只负责装 App；宿主不代装、不代卸 19 个创作 App（避免绕过它自己的 UAC 与安装目录约定）。
 * ⛔ MCP 段 `[mcp_servers.ArtCraft]` 只在网关二进制存在时由 applyCustomModel 生成（见 electron/artcraft.ts）。
 *    sync = 网关刚出现时立刻重写 config.toml（引擎需重启才加载 MCP；卡片会提示）。
 */
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import {
  ARTCRAFT_APPS_HOME,
  ARTCRAFT_HOME,
  artcraftConfigSnippet,
  artcraftInstalledVersion,
  artcraftLauncherPath,
  artcraftMcpRegistered,
  artcraftPaths,
  craftAiMcpPath,
  openArtCraftLauncher,
} from "../artcraft";
import { dirSizeBytes } from "../toolchain";

const ARTCRAFT_CHANNELS = ["artcraft:status", "artcraft:open", "artcraft:sync"];

/** 网关刚出现 → 立刻重写 config.toml（与 PhotoCraft 的 refreshConfigForGatewayTools 同一条链）。 */
async function rewriteConfig(): Promise<void> {
  try {
    const { readCustomModel } = await import("../main/01-model-catalog");
    const { applyCustomModel } = await import("./custom-model-apply");
    const model = await readCustomModel();
    if (model) await applyCustomModel(model, { restart: false });
  } catch { /* 没有模型档案时跳过：下一次启动 applyCustomModel 会按网关状态收敛 */ }
}

export const artcraftFeature = defineFeature<null>({
  id: "artcraft",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("artcraft: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("artcraft:status", async () => {
      const paths = artcraftPaths();
      const installed = Boolean(artcraftLauncherPath());
      const gateway = craftAiMcpPath();
      return {
        installed,
        version: artcraftInstalledVersion(),
        launcherPath: installed ? paths.launcher : "",
        gatewayPath: gateway,
        gatewayReady: Boolean(gateway),
        mcpRegistered: artcraftMcpRegistered(),
        configSnippet: artcraftConfigSnippet(),
        platform: process.platform,
        sizeBytes: installed ? dirSizeBytes(paths.root) : 0,
        attribution: { license: "MIT OR Apache-2.0", home: ARTCRAFT_HOME, apps: ARTCRAFT_APPS_HOME },
      };
    });

    ipcHost.handle("artcraft:open", async () => openArtCraftLauncher());

    ipcHost.handle("artcraft:sync", async () => {
      const gatewayReady = Boolean(craftAiMcpPath());
      if (gatewayReady && !artcraftMcpRegistered()) await rewriteConfig();
      return { gatewayReady, mcpRegistered: artcraftMcpRegistered() };
    });

    ctx.effect(() => {
      for (const channel of ARTCRAFT_CHANNELS) ipcHost.removeHandler(channel);
    });
  },
});
