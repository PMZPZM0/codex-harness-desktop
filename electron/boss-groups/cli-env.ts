/**
 * 群聊 CLI 成员的运行环境（11-06 用户令：「群聊里面 cli 智能体肯定也要自动配置」）。
 *
 * 与 @ 调度的 CLI 会话同一口径：增强 PATH + 主会话的供应商 / 模型（OPENAI_* / ANTHROPIC_*）。
 * ⛔ Key 只进子进程环境：不进提示词、不落 boss-groups.json、不进 rollout。
 * ⛔ 读不到供应商配置就什么都不加，退回 CLI 自己的登录态（不注入空值把人家配置顶掉）。
 */
import { safeStorage } from "electron";
import { readCustomModel } from "../main/01-model-catalog";
import { cliCodexHome, cliModelEnv, cliProcessEnv } from "../cli-agents";
import { isLocalBaseUrl } from "../../src/lib/cli-provider-config.mjs";

export async function cliMemberEnv(input: { bossModel?: string; memberModel?: string }): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...cliProcessEnv() };
  /* ⛔ Codex CLI 用应用自己的独立 home（供应商同步写入的 provider），不碰用户 ~/.codex。 */
  env.CODEX_HOME = cliCodexHome();
  try {
    const custom = await readCustomModel();
    const apiKey = custom?.encryptedKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(custom.encryptedKey, "base64"))
      : "";
    const provider = custom?.provider ?? "openai";
    /* 模型优先级与成员派活一致：boss 会话模型 → 成员自己配的 → 全局激活模型。 */
    const model = String(input?.bossModel ?? "") || String(input?.memberModel ?? "") || String(custom?.model ?? "");
    const local = isLocalBaseUrl(custom?.baseUrl);
    Object.assign(env, cliModelEnv({ provider, baseUrl: custom?.baseUrl, model, local }, apiKey));
  } catch { /* 读不到就沿用 CLI 自己的配置 */ }
  return env;
}
