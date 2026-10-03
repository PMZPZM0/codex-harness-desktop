/**
 * plugin-ipc（10-03 从 `features/builtin-skills-ipc/01-...` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：plugin(1)
 * 通道：plugin:validate（校验一个本地插件目录是否合规）
 *
 * 只读校验，不改任何状态。三处清单都认：`.codex-plugin/plugin.json` / `plugin.json` /
 * `.codebuddy-plugin/plugin.json`。
 * ⛔ 待接缝化（阶段 2）：fs 为宿主能力。
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { dirEntries } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export const pluginFeature = defineFeature<null>({
  id: "plugin",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("plugin: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("plugin:validate", async (_event, input: { path?: string }) => {
      const root = input?.path ? String(input.path) : "";
      if (!root) return { ok: false, root: "", issues: ["未提供插件目录路径"], inventory: {} };
      if (!existsSync(root)) return { ok: false, root, issues: [`目录不存在：${root}`], inventory: {} };
      const manifestCandidates = [".codex-plugin/plugin.json", "plugin.json", ".codebuddy-plugin/plugin.json"];
      const manifestPath = manifestCandidates.map((rel) => path.join(root, rel)).find((full) => existsSync(full)) ?? "";
      const issues: string[] = [];
      let manifest: any = null;
      if (manifestPath) {
        try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (error: any) { issues.push(`清单解析失败：${manifestPath} — ${error.message}`); }
      } else {
        issues.push("缺少插件清单（.codex-plugin/plugin.json 或 plugin.json）");
      }
      if (manifest && !manifest.name) issues.push("清单缺少 name 字段");
      const count = (rel: string) => dirEntries(path.join(root, rel))?.length ?? 0;
      const inventory = { skills: count("skills"), commands: count("commands"), agents: count("agents"), hooks: existsSync(path.join(root, "hooks", "hooks.json")) ? 1 : 0 };
      if (!inventory.skills && !inventory.commands && !inventory.agents && !inventory.hooks) issues.push("插件没有任何能力目录（skills / commands / agents / hooks）");
      return { ok: issues.length === 0, root, manifestPath, issues, inventory, name: manifest?.name ?? "" };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("plugin:validate");
    });
  },
});
