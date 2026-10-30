/**
 * ponytail 安装自愈（10-30 立，用户实测事故驱动）。
 *
 * 事故：用户机器上 ponytail 的 6 个技能与钩子**一起消失**，控制台「写代码模式」开关点了没反应。
 * 磁盘证据：`config.toml` 里只剩 `[plugins.ponytail]`（短名）不再有 `[marketplaces.ponytail]`，
 * 插件 cache 还在。根因：引擎 0.16x 起要求 marketplace 目录**带清单文件**
 * （`.agents/plugins/marketplace.json`），旧做法「把 marketplaces 指到插件目录本身」会被丢掉
 * ⇒ 引擎不知道有 ponytail ⇒ 插件/技能/钩子全没了；开关写的是 `~/.config/ponytail/config.json`，
 * 钩子本身没加载，所以“联动”不起来。
 *
 * 自愈做的事（幂等，任何一步失败都不抛出）：
 *   ① `ensurePonytailPlugin` 重建 cache + 本地市场目录 + 清单 + config 注册段（新布局）；
 *   ② 引擎在跑就 `plugin/install` 注册（按清单**文件**路径）；
 *   ③ 写回 `plugins."ponytail@ponytail".enabled = true`；
 *   ④ 按 `hooks/list` 的 currentHash 信任它的钩子（否则执行为 0）。
 * ⛔ 只在「用户已经想要它」时调用（安装按钮 / 写代码模式非 off / 启动时 mode≠off）——
 *   不给没装的人偷偷装（09-27 用户令：ponytail 默认不装）。
 */
import path from "node:path";
import { codexHome, server } from "./runtime-refs";
import { existingToolPath, toolsRoot } from "./toolchain";
import { ensurePonytailPlugin } from "./ponytail-plugin";
import { trustUntrustedHooks } from "./hooks-trust";

let healing: Promise<{ ok: boolean; message: string }> | null = null;

export function healPonytailInstall(options: { restart?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  if (healing) return healing;
  healing = (async () => {
    const bundled = existingToolPath("ponytail-plugin") || path.join(toolsRoot(), "ponytail-plugin");
    const seeded = await ensurePonytailPlugin(codexHome, bundled);
    if (!seeded) return { ok: false, message: "随包 ponytail 插件目录缺失，无法自愈" };
    const notes: string[] = [];
    try {
      await server.request("plugin/install", { pluginName: "ponytail", marketplacePath: seeded.manifestPath });
    } catch (error: any) {
      // 引擎没起来（启动早期）时这里必然失败：文件已落盘，引擎下次启动会自己扫到
      notes.push(`引擎注册未完成：${error?.message ?? error}`);
    }
    try {
      await server.request("config/value/write", {
        filePath: path.join(codexHome, "config.toml"),
        keyPath: 'plugins."ponytail@ponytail".enabled',
        value: true,
        mergeStrategy: "replace",
      });
    } catch { /* 引擎没起来时忽略；注册段已写进文件 */ }
    try {
      const trust = await trustUntrustedHooks(codexHome);
      if (trust.failures.length) notes.push(`钩子信任部分失败：${trust.failures.join("；")}`);
    } catch { /* 同上 */ }
    if (options.restart) {
      try { await server.restart(); } catch (error: any) { notes.push(`重启引擎失败：${error?.message ?? error}`); }
    }
    return { ok: true, message: notes.length ? notes.join(" · ") : "ponytail 已就绪" };
  })().finally(() => { healing = null; });
  return healing;
}
