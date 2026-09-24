/**
 * model-custom-ipc 的「openai-accounts」部分（09-22 从同目录 model-custom-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { app, ipcMain, safeStorage } from "electron";
import { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, openaiVaultFile, readOpenaiAuth, resetLiveProxyCache } from "../openai-auth";
import { applyCustomModel, normalizeProvider, normalizeUpstreamProtocol, readCustomModel, readCustomModels, writeCustomModels } from "../../main";
import { codexHome, customModelFile, server, upsertCustomModel } from "../../runtime-refs";
import { readOpenaiVault, writeOpenaiVault } from "./01-openai-login";
import { openaiJwtClaims } from "./02-openai-vault-import";
ipcMain.handle("openai:accounts", async () => {
  const [accounts, current] = await Promise.all([readOpenaiVault(), readOpenaiAuth()]);
  return accounts.map((a) => {
    const authClaims = openaiJwtClaims(a.tokens?.id_token)?.["https://api.openai.com/auth"] ?? {};
    const disabled = Boolean((a as any).disabled);
    // ⛔ 停用的账号**永不**「使用中」（09-21 与中转站侧同一不变量）：账号卡的生效判据读 auth.json
    //    的 email，只要有一处忘了清 auth.json，卡片就会同时出现「使用中 + 已停用」。
    const active = Boolean(!disabled && current?.loggedIn && current.email && current.email === a.email);
    return {
      id: a.id,
      email: a.email,
      savedAt: a.savedAt,
      active,
      disabled,
      planType: String(authClaims.chatgpt_plan_type ?? ""),
      subscriptionUntil: String(authClaims.chatgpt_subscription_active_until ?? ""),
    };
  });
});

ipcMain.handle("openai:toggle-account", async (_e, input: { id: string; disabled: boolean }) => {
  const accounts = await readOpenaiVault();
  const account = accounts.find((a) => a.id === input.id);
  if (!account) throw new Error("账号不存在");
  (account as any).disabled = input.disabled || undefined;
  await writeOpenaiVault(accounts);
  if (input.disabled) {
    const current = await readOpenaiAuth();
    if (current?.loggedIn && current.email && current.email === account.email) {
      const list = await readCustomModels();
      const entry = list.find((e) => e.provider === "openai-official");
      if (entry && entry.enabled !== false) await upsertCustomModel({ ...entry, enabled: false });
      await fs.writeFile(openaiAuthFile(), "null", "utf8");
      await fs.writeFile(customModelFile, "null", "utf8");
      await server.restart();
      return { ok: true, disabled: true, deactivated: true };
    }
  }
  return { ok: true, disabled: Boolean((account as any).disabled) };
});

ipcMain.handle("openai:account-remove", async (_e, id: string) => {
  const accounts = (await readOpenaiVault()).filter((a) => a.id !== id);
  await writeOpenaiVault(accounts);
  return { ok: true, total: accounts.length };
});

ipcMain.handle("openai:account-switch", async (_e, id: string) => {
  // 切换 = 把该账号 tokens 写回 CODEX_HOME/auth.json 并重启引擎
  const account = (await readOpenaiVault()).find((a) => a.id === id);
  if (!account) throw new Error("账号不存在");
  if ((account as any).disabled) throw new Error("该账号已停用，请先在卡片上重新启用");
  await fs.writeFile(openaiAuthFile(), JSON.stringify({ OPENAI_API_KEY: null, tokens: account.tokens, last_refresh: new Date().toISOString() }, null, 2), "utf8");
  await server.restart();
  return { ok: true, email: account.email };
});
