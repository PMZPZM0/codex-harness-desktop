/**
 * 钩子信任（10-30 从 hooks-ipc 抽出的基座函数）。
 *
 * 为什么下沉：ponytail 的「修复/安装」也要把它的 SessionStart 钩子标记为已信任
 * （引擎对 untrusted 钩子**列出但不执行** ⇒ 装了等于没装）。信任判据只有一处：
 * `hooks/list` 返回的 `currentHash`，按 key 写进 `[hooks.state."<key>"].trusted_hash`。
 * ⛔ 不要再用写死的 sha256 常量 —— 引擎按**当前钩子文件**算哈希，插件版本一变就失配。
 */
import path from "node:path";
import { server } from "./runtime-refs";

export type HookTrustResult = { total: number; trusted: number; alreadyTrusted: number; failures: string[] };

export async function trustUntrustedHooks(codexHome: string, cwds: string[] = []): Promise<HookTrustResult> {
  const result: any = await server.request("hooks/list", { cwds });
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
      failures.push(`${hook.eventName ?? hook.key}：${error?.message ?? error}`);
    }
  }
  return { total: hooks.length, trusted: targets.length - failures.length, alreadyTrusted: hooks.length - targets.length, failures };
}
