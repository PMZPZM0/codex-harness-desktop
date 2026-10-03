/**
 * plugins-ipc（10-03 从 `features/builtin-skills-ipc/03-...` + `04-...` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：plugins(6)
 * 通道：plugins:market-list / market-install / market-uninstall / market-installed /
 *      set-linked-enabled / set-enabled
 *
 * ⛔⛔ 三条实证口径（本次纯搬迁，一字未改）：
 *   1. **`installedDir` 必须传**（10-03 报障）：卡片「已安装」标记取自**本地 manifest**（权威），
 *      不传就退化成"只看引擎 plugin/list" ⇒ 引擎没认领时用户装完仍看到「+」。
 *   2. **市场插件 ID 形如 `ponytail@ponytail`（id@市场名）**：调用方可能传短名，必须先从
 *      `plugin/list` 解析真实 ID，否则 config 写错键、钩子/技能归属全部匹配不上。
 *   3. **卸载是两侧**：引擎侧（plugin/uninstall，没认领会报错 → 忽略）+ 文件侧照删。
 *      `plugins:market-installed` 只扫本地目录、**零网络**，用来补齐"引擎没认领但文件已落盘"那批。
 * ⛔ `escapeHookKey` / `writeHookEnabled` 从 `./hooks-ipc` 复用（同一份配置写入口径）；
 *    `setSkillEnabledSilent` 从基座层 `../skill-store`（skills 域也用）。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { codexMarketDir, ensureCodexMarketplaceSection, installCodexMarketPlugin, listInstalledMarketPlugins, listMarketPlugins, removeCodexMarketPluginFiles } from "../codex-market";
import type { CodexMarketPlugin } from "../codex-market";
import { sendToWindow } from "./window-bus";
import { escapeHookKey, writeHookEnabled } from "./hooks-ipc";
import { userSkillsDir } from "../main";
import { codexHome, server } from "../runtime-refs";
import { setSkillEnabledSilent } from "../skill-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const PLUGINS_CHANNELS = [
  "plugins:market-list", "plugins:market-install", "plugins:market-uninstall", "plugins:market-installed",
  "plugins:set-linked-enabled", "plugins:set-enabled",
];

export const pluginsFeature = defineFeature<null>({
  id: "plugins",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("plugins: 缺少 ipc 服务（宿主未提供）");

    // 插件市场清单：Gitee 官方镜像源（2026-10-01 二次换源；SkillHub 源插件几乎全为 DSH 生态已弃）
    // ⛔ 10-03：installedDir 必须传 —— 卡片「已安装」标记取自**本地 manifest**（权威），
    //   不传就退化成"只看引擎 plugin/list"，引擎没认领时用户装完仍看到「+」（原报障）。
    ipcHost.handle("plugins:market-list", (_event, input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) => listMarketPlugins({ ...input, installedDir: codexMarketDir(codexHome) }));

    ipcHost.handle("plugins:market-install", async (_event, plugin: CodexMarketPlugin) => {
      const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "plugin-install", pluginId: plugin.slug, stage, message, at: Date.now() });
      // ⛔ Gitee 镜像源的插件全部自带 .claude-plugin/plugin.json（清单里 pluginPath 已定位），无需再探。
      // 幂等注册本地 marketplace 段（缺才写），返回插件落盘目录
      const destinationRoot = await ensureCodexMarketplaceSection(codexHome);
      const installed = await installCodexMarketPlugin({
        plugin,
        destinationRoot,
        onProgress: ({ stage, message }) => emit(stage, message),
      });
      // 引擎实证：光把文件写进本地 marketplace 引擎不认（plugin/list 返回空），
      // 必须调 plugin/install 让引擎把它拷进 plugins/cache/... 并置 installed=true。
      emit("engine", "正在通过引擎注册插件");
      try {
        await server.request("plugin/install", { pluginName: installed.marketId ?? plugin.slug, marketplacePath: installed.manifestPath });
      } catch (error: any) {
        emit("pending", `引擎注册插件未成功：${error?.message ?? error}（文件已落盘，重启引擎后会重新扫描）`);
      }
      emit("engine", "正在重启 Codex 引擎并注册插件");
      await server.restart();
      emit("verify", "正在确认 Codex 是否已发现该插件");
      let engineRegistered = false;
      let engineCheckMessage = "插件目录已写入，重启 Codex 后生效";
      try {
        const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
        const base = (value: string) => String(value ?? "").split("@")[0];
        const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
          .find((entry: any) => entry?.installed && (base(entry.id) === plugin.slug || entry.name === plugin.slug || entry.name === plugin.name));
        engineRegistered = Boolean(found);
        if (!engineRegistered) engineCheckMessage = "插件已写入本地插件目录；引擎已刷新，但当前列表未返回该插件，新建会话后仍会重新扫描。";
      } catch (error: any) {
        engineCheckMessage = `插件已安装且引擎已重启，但自动确认暂时不可用：${error.message}`;
      }
      emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
      return { ...installed, engineRegistered, engineCheckMessage };
    });

    ipcHost.handle("plugins:market-uninstall", async (_event, slug: string) => {
      const slugText = String(slug ?? "").trim();
      if (!slugText) return { ok: false, reason: "缺少插件标识" };
      const marketDir = codexMarketDir(codexHome);
      // ① 引擎侧：认领了就让它停用（plugin/uninstall 会更新引擎自己的注册表，无需重启引擎）。
      //    没认领（本地 manifest 有、引擎 plugin/list 没有）会报错 —— 忽略，文件侧照删。
      let engineRemoved = false;
      for (const pluginId of [`${slugText}@codex-market`, slugText]) {
        try {
          await server.request("plugin/uninstall", { pluginId });
          engineRemoved = true;
          break;
        } catch { /* 试下一个 id 形态；都不成 = 引擎未认领 */ }
      }
      // ② 文件侧（safeFolder 归一 + 目录内校验在函数内部）
      const removed = await removeCodexMarketPluginFiles(slugText, marketDir);
      if (!removed.ok) return { ok: false, reason: removed.reason, engineRemoved };
      return { ok: true, engineRemoved };
    });

    // 本地已装市场插件清单（10-03）：**只扫本地目录、零网络**。
    // 用它补齐「引擎 plugin/list 没认领、但文件已落盘」的那批插件 ——
    // 缺了它们，用户装完在已安装页里根本找不到（10-03 报障）。
    ipcHost.handle("plugins:market-installed", async () => {
      const map = await listInstalledMarketPlugins(codexMarketDir(codexHome));
      return [...map.entries()].map(([slug, info]) => ({ slug, version: info.version, description: info.description }));
    });

    ipcHost.handle("plugins:set-linked-enabled", async (_event, input: { pluginId: string; enabled: boolean }) => {
      const pluginId = String(input?.pluginId ?? "");
      if (!pluginId) throw new Error("缺少插件 ID");
      const enabled = Boolean(input.enabled);
      const failures: string[] = [];

      // 市场安装的插件真实 ID 形如 "ponytail@ponytail"（id@市场名），调用方可能传短名。
      // 先从 plugin/list 解析出真实 ID，否则 config 写错键、钩子/技能归属全部匹配不上。
      let targetId = pluginId;
      try {
        const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
        const base = (value: string) => String(value ?? "").split("@")[0];
        const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
          .find((plugin: any) => plugin.installed && (plugin.id === pluginId || base(plugin.id) === base(pluginId)));
        if (found?.id) targetId = String(found.id);
      } catch { /* 列表失败时保留原 ID */ }

      // 1. 插件本体
      try {
        await server.request("config/value/write", {
          filePath: path.join(codexHome, "config.toml"),
          keyPath: `plugins."${escapeHookKey(targetId)}".enabled`,
          value: enabled,
          mergeStrategy: "replace",
        });
      } catch (error: any) { failures.push(`插件：${error.message}`); }

      // 2. 该插件提供的钩子（按 pluginId 过滤，用户自定义钩子 source=user 不受影响）
      try {
        const result: any = await server.request("hooks/list", { cwds: [] });
        const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
        for (const hook of hooks.filter((hook: any) => hook.pluginId === targetId)) {
          try { await writeHookEnabled(hook.key, enabled); }
          catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
        }
      } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }

      // 3. 该插件提供的技能（.plugin.json 的 pluginId 可能带市场后缀，按 base 名归一化匹配）
      try {
        const base = (value: string) => String(value ?? "").split("@")[0];
        const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
        for (const entry of entries.filter((entry) => entry.isDirectory())) {
          const dir = path.join(userSkillsDir, entry.name);
          let owner: string | undefined;
          try { owner = JSON.parse(await fs.readFile(path.join(dir, ".plugin.json"), "utf8"))?.pluginId || undefined; } catch { /* 没有归属清单 */ }
          if (!owner || base(owner) !== base(targetId)) continue;
          try { await setSkillEnabledSilent(entry.name, enabled); }
          catch (error: any) { failures.push(`技能 ${entry.name}：${error.message}`); }
        }
      } catch { /* 技能目录不存在时跳过 */ }

      await server.restart();
      return { ok: failures.length === 0, failures };
    });

    ipcHost.handle("plugins:set-enabled", async (_event, input: { pluginIds: string[]; enabled: boolean }) => {
      const ids = (Array.isArray(input?.pluginIds) ? input.pluginIds : []).map((id) => String(id ?? "")).filter(Boolean);
      if (!ids.length) return { changed: 0, failures: [] };
      const configPath = path.join(codexHome, "config.toml");
      const failures: string[] = [];
      const idSet = new Set(ids);
      for (const id of ids) {
        try {
          await server.request("config/value/write", {
            filePath: configPath,
            keyPath: `plugins."${escapeHookKey(id)}".enabled`,
            value: Boolean(input.enabled),
            mergeStrategy: "replace",
          });
        } catch (error: any) {
          failures.push(`${id}：${error.message}`);
        }
      }
      // 联动：插件停用后它提供的钩子在 UI 上也应显示成停用，否则两页状态打架
      try {
        const result: any = await server.request("hooks/list", { cwds: [] });
        const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
        for (const hook of hooks.filter((hook: any) => hook.pluginId && idSet.has(hook.pluginId))) {
          try { await writeHookEnabled(hook.key, Boolean(input.enabled)); }
          catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
        }
      } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }
      return { changed: ids.length - failures.length, failures };
    });

    ctx.effect(() => {
      for (const ch of PLUGINS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
