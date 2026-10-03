/**
 * hooks-ipc（10-03 从 `features/builtin-skills-ipc/03-...` + `04-...` 合并成单前缀板块，
 * 同时改为**插件形态**）
 *
 * 域：hooks(2)
 * 通道：hooks:trust（批量信任待信任钩子）/ hooks:set-enabled（启停指定钩子）
 *
 * ⛔⛔ 钩子 key 里含 Windows 路径反斜杠，**写进 TOML 点路径前必须转义**（`escapeHookKey`），
 *    否则反斜杠会被吞掉、信任记录匹配不上 —— 表现为「点了信任但下次还提示未信任」。
 * ⛔ 本文件导出 `escapeHookKey` / `writeHookEnabled` 供 `plugins-ipc` 复用（插件停用要连带
 *    停用它提供的钩子）。两者同属"配置写入"口径，只留一份。
 * ⛔ 待接缝化（阶段 2）：无宿主能力依赖，仅经 server 下发。
 */
import path from "node:path";
import { codexHome, server } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

export function escapeHookKey(key: string) {
  return String(key).split("\\").join("\\\\").split('"').join('\\"');
}

export async function writeHookEnabled(key: string, enabled: boolean) {
  await server.request("config/value/write", {
    filePath: path.join(codexHome, "config.toml"),
    keyPath: `hooks.state."${escapeHookKey(key)}".enabled`,
    value: Boolean(enabled),
    mergeStrategy: "replace",
  });
}

const HOOKS_CHANNELS = ["hooks:trust", "hooks:set-enabled"];

export const hooksFeature = defineFeature<null>({
  id: "hooks",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("hooks: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("hooks:trust", async (_event, input: { cwds?: string[] } = {}) => {
      const result: any = await server.request("hooks/list", { cwds: input.cwds ?? [] });
      const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
      const targets = hooks.filter((hook: any) => hook.trustStatus !== "trusted" && hook.currentHash && hook.key);
      if (!targets.length) return { total: hooks.length, trusted: 0, alreadyTrusted: hooks.length, failures: [] };
      const configPath = path.join(codexHome, "config.toml");
      const failures: string[] = [];
      for (const hook of targets) {
        // 钩子 key 里含 Windows 路径反斜杠，写进 TOML 点路径前必须转义，否则会被吞掉、信任记录匹配不上
        const escaped = String(hook.key).split("\\").join("\\\\");
        try {
          await server.request("config/value/write", {
            filePath: configPath,
            keyPath: `hooks.state."${escaped}".trusted_hash`,
            value: hook.currentHash,
            mergeStrategy: "replace",
          });
        } catch (error: any) {
          failures.push(`${hook.eventName ?? hook.key}：${error.message}`);
        }
      }
      return { total: hooks.length, trusted: targets.length - failures.length, alreadyTrusted: hooks.length - targets.length, failures };
    });

    ipcHost.handle("hooks:set-enabled", async (_event, input: { hookKeys: string[]; enabled: boolean }) => {
      const keys = (Array.isArray(input?.hookKeys) ? input.hookKeys : []).map((key) => String(key ?? "")).filter(Boolean);
      const failures: string[] = [];
      for (const key of keys) {
        try { await writeHookEnabled(key, Boolean(input.enabled)); }
        catch (error: any) { failures.push(`${key}：${error.message}`); }
      }
      return { changed: keys.length - failures.length, failures };
    });

    ctx.effect(() => {
      for (const ch of HOOKS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
