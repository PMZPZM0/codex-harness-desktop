/**
 * codex-official-market-ipc —— **Codex 官方插件市场**（GitHub `openai/plugins`，国内镜像读取）的 IPC 面。
 *
 * 域：codex-official-market(5)
 * 通道：codex-official-market:list / categories / install / uninstall / installed
 *
 * 与 `plugins-ipc.ts`（Gitee 镜像市场）是**两个板块、两个数据源**：清单格式、落盘目录、marker 文件名都不同。
 * 装完的插件在「已安装」列表里由引擎 `plugin/list` 认领，启停沿用 `plugins:set-enabled` /
 * `plugins:set-linked-enabled`（那两条按 `id@市场名` 的 base 段匹配，不需要为新市场再加通道）。
 * ⛔ 进度事件类型是 `official-plugin-install`（**不是** `plugin-install`）：两者形状相同但归属不同，
 *   共用一个 type 会让 Gitee 那边的弹层认错了插件（上游 slug 有重名：linear / github 都撞）。
 * ⛔ 三条引擎实证照搬 plugins-ipc：`marketplacePath` 传清单文件（目录报 os error 5）、
 *   写完文件必须 `plugin/install` + 重启引擎、已装真相源是本地 marker。
 */
import {
  codexOfficialMarketDir,
  ensureOfficialMarketplaceSection,
  installOfficialMarketPlugin,
  listInstalledOfficialPlugins,
  listOfficialMarketCategories,
  listOfficialMarketPlugins,
  removeOfficialMarketPluginFiles,
} from "../codex-official-market";
import type { OfficialMarketPlugin } from "../codex-official-market";
import { sendToWindow } from "./window-bus";
import { codexHome, server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const OFFICIAL_MARKET_CHANNELS = [
  "codex-official-market:list", "codex-official-market:categories", "codex-official-market:install",
  "codex-official-market:uninstall", "codex-official-market:installed",
];
const MARKETPLACE_NAME = "codex-official-market";

export const codexOfficialMarketFeature = defineFeature<null>({
  id: "codex-official-market",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("codex-official-market: 缺少 ipc 服务（宿主未提供）");

    // ⛔ installedDir 必传：卡片「已安装」取自本地 marker（权威），不传就退化成只看引擎列表
    ipcHost.handle("codex-official-market:list", (_event, input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) =>
      listOfficialMarketPlugins({ ...input, installedDir: codexOfficialMarketDir(codexHome) }));

    ipcHost.handle("codex-official-market:categories", async () => listOfficialMarketCategories());

    ipcHost.handle("codex-official-market:install", async (_event, plugin: OfficialMarketPlugin) => {
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "official-plugin-install", pluginId: plugin?.slug, stage, message, at: Date.now() });
      // 幂等注册本地 marketplace 段（缺才写），返回插件落盘根目录
      const marketDir = await ensureOfficialMarketplaceSection(codexHome);
      const installed = await installOfficialMarketPlugin({
        plugin,
        marketDir,
        onProgress: ({ stage, message }) => emit(stage, message),
      });
      emit("engine", "正在通过引擎注册插件");
      try {
        await server.request("plugin/install", { pluginName: installed.marketId ?? plugin.slug, marketplacePath: installed.manifestPath });
      } catch (error: any) {
        emit("pending", `引擎注册插件未成功：${error?.message ?? error}（文件已落盘，重启引擎后会重新扫描）`);
      }
      emit("engine", "正在重启 Codex 引擎并注册插件");
      await server.restart();
      emit("verify", "正在确认 Codex 是否已发现该插件");
      const check = await findInstalledPlugin(plugin.slug);
      const engineRegistered = check.found;
      const engineCheckMessage = engineRegistered
        ? "Codex 已发现该插件"
        : check.listFailed
          ? "插件已安装且引擎已重启，但自动确认暂时不可用"
          : "插件已写入本地插件目录；引擎已刷新，但当前列表未返回该插件，新建会话后仍会重新扫描。";
      emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
      return { ...installed, engineRegistered, engineCheckMessage };
    });

    ipcHost.handle("codex-official-market:uninstall", async (_event, slug: string) => {
      const slugText = String(slug ?? "").trim();
      if (!slugText) return { ok: false, reason: "缺少插件标识" };
      const marketDir = codexOfficialMarketDir(codexHome);
      // ① 引擎侧：认领了就让它停用（plugin/uninstall 会更新引擎自己的注册表，无需重启引擎）；
      //    没认领（marker 有、引擎 plugin/list 没有）会报错 —— 忽略，文件侧照删。
      let engineRemoved = false;
      for (const pluginId of [`${slugText}@${MARKETPLACE_NAME}`, slugText]) {
        try {
          await server.request("plugin/uninstall", { pluginId });
          engineRemoved = true;
          break;
        } catch { /* 试下一个 id 形态；都不成 = 引擎未认领 */ }
      }
      // ② 文件侧（safeFolder 归一 + 目录内校验在函数内部）
      const removed = await removeOfficialMarketPluginFiles(slugText, marketDir);
      if (!removed.ok) return { ok: false, reason: removed.reason, engineRemoved };
      return { ok: true, engineRemoved };
    });

    // 本地已装清单：**只扫本地目录、零网络**（补齐「引擎没认领、但文件已落盘」那批）。
    // 刻意不并进 list —— list 要拉上游 65 条，不该出现在「刷新页面资源」这种快路径上。
    ipcHost.handle("codex-official-market:installed", async () => {
      const map = await listInstalledOfficialPlugins(codexOfficialMarketDir(codexHome));
      return [...map.entries()].map(([slug, info]) => ({ slug, version: info.version, description: info.description }));
    });

    ctx.effect(() => {
      for (const ch of OFFICIAL_MARKET_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});

/**
 * 引擎是否真的认领了这个官方插件。
 * 市场插件 ID 形如 `linear@codex-official-market`，按 `@` 前的 base 段匹配；
 * ⛔ 先只认本市场（Gitee 那边 slug 有重名：linear / github 都撞），本市场没命中再宽松回落一次，
 *   回落只用于「引擎换了市场名」这种形态变化，不影响已装判定（marker 才是真相源）。
 */
async function findInstalledPlugin(slug: string): Promise<{ found: boolean; listFailed: boolean }> {
  const base = (value: string) => String(value ?? "").split("@")[0];
  let list: any = null;
  try {
    list = await server.request("plugin/list", { cwds: [], forceRefetch: false });
  } catch { return { found: false, listFailed: true }; }
  const marketplaces: any[] = list?.marketplaces ?? [];
  const matches = (marketplaceName: string) => marketplaces
    .filter((marketplace) => !marketplaceName || String(marketplace?.name ?? "") === marketplaceName)
    .flatMap((marketplace) => marketplace.plugins ?? [])
    .some((entry: any) => entry?.installed && (base(entry.id) === slug || entry?.name === slug));
  return { found: matches(MARKETPLACE_NAME) || matches(""), listFailed: false };
}
