/**
 * model-custom-ipc 的「custom-model-write」部分（09-22 从同目录 model-custom-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { app, ipcMain, safeStorage } from "electron";
import { readRelayStore, writeRelayStore } from "../../features/relay-ipc";
import { relayProviderIdOf } from "../../relay-accounts";
import { sendToWindow } from "../../features/window-bus";
import type { CustomModelFile, ProviderModel } from "../../features/custom-model-types";
import { OPENAI_FALLBACK_MODELS, fetchOpenaiModels, openaiAuthFile, openaiFetch, openaiProxyFile, openaiVaultFile, readOpenaiAuth, resetLiveProxyCache } from "../openai-auth";
import { applyCustomModel, normalizeProvider, normalizeUpstreamProtocol, readCustomModel, readCustomModels, writeCustomModels } from "../../main";
import { codexHome, customModelFile, server, upsertCustomModel } from "../../runtime-refs";
import { withModels, publicCustomModel, readOpenaiVault, writeOpenaiVault } from "./01-openai-login";
export async function disableOtherCustomProviders(provider: string) {
  const list = await readCustomModels();
  for (const other of list) {
    if (other.provider !== provider && other.enabled !== false) {
      await upsertCustomModel({ ...other, enabled: false });
    }
  }
}

export function broadcastProviderActivated(provider: string) {
  try { sendToWindow("harness:event", { type: "provider-activated", provider, at: Date.now() }); } catch { /* 窗口未就绪 */ }
}

ipcMain.handle("custom-model:set-model", async (_event, input: { provider: string; model: string; apply?: boolean; restart?: boolean }) => {
  const model = input.model.trim();
  if (!model) throw new Error("模型 ID 不能为空");
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const next = withModels({ ...target, model }, model);
  await upsertCustomModel(next);
  await disableOtherCustomProviders(input.provider);
  await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
  // apply=false 时只保存配置不重写 config.toml（最轻量，仅对齐档案文件）。
  // apply=true + restart=false：一次性写齐 custom-model.json + config.toml 顶层 + catalog，
  // 但**不重启引擎**——同供应商换模型不需要重启，重启会打断在跑的回合。
  // apply=true + restart 缺省 = 旧语义：写配置并重启引擎（供应商级切换用）。
  if (input.apply !== false) {
    await applyCustomModel(next, { restart: input.restart !== false });
    broadcastProviderActivated(input.provider);
  }
  return publicCustomModel(next);
});

ipcMain.handle("custom-model:set-effort", async (_event, input: { provider: string; model: string; effort: string }) => {
  const model = input.model.trim();
  const effort = String(input.effort ?? "").trim();
  if (!model) throw new Error("模型 ID 不能为空");
  if (effort && !["minimal", "low", "medium", "high", "ultra", "xhigh"].includes(effort)) throw new Error(`未知思考档位: ${effort}`);
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const effortPatch = effort ? { effort } : { effort: undefined };
  let models = (target.models ?? []).map((m) => m.id === model ? { ...m, ...effortPatch } : m);
  // 旧档案 models 缺当前生效模型条目时补一条，保证顶层与 models[] 永不同步分叉
  if (effort && !models.some((m) => m.id === model)) models = [...models, { id: model, effort }];
  const next: CustomModelFile = { ...target, models, ...(model === target.model ? { effort: effort || undefined } : {}) };
  await upsertCustomModel(next);
  await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
  await applyCustomModel(next, { restart: false });
  return publicCustomModel(next);
});

ipcMain.handle("custom-model:apply", async () => {
  const custom = await readCustomModel();
  if (!custom) throw new Error("尚未配置供应商");
  await applyCustomModel(custom);
  return publicCustomModel(custom);
});

ipcMain.handle("custom-model:upsert-model", async (_event, input: { provider: string; model: ProviderModel }) => {
  const id = input.model.id?.trim();
  if (!id) throw new Error("模型 ID 不能为空");
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const models = [...(target.models ?? [])];
  const index = models.findIndex((m) => m.id === id);
  if (index >= 0) models[index] = { ...models[index], ...input.model, id }; else models.push({ ...input.model, id });
  const next: CustomModelFile = { ...target, models };
  await upsertCustomModel(next);
  const current = await readCustomModel();
  // 改的是当前生效供应商：必须重写 model-catalog.json + 重启引擎，否则用户改的
  // contextWindow 不会进引擎链路 —— 引擎会继续用旧 catalog 的 fallback (~128K)，
  // 表现为「UI 显示 12.8 万，但模型配置里写的是 1M」。
  if (current?.provider === input.provider) {
    await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
    await applyCustomModel(next);
  }
  return publicCustomModel(next);
});

ipcMain.handle("custom-model:remove-model", async (_event, input: { provider: string; modelId: string }) => {
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const models = (target.models ?? []).filter((m) => m.id !== input.modelId);
  const next: CustomModelFile = { ...target, models, model: target.model === input.modelId ? (models[0]?.id ?? "") : target.model };
  await upsertCustomModel(next);
  const current = await readCustomModel();
  if (current?.provider === input.provider) {
    await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
    await applyCustomModel(next);
  }
  return publicCustomModel(next);
});

ipcMain.handle("custom-model:set-enabled", async (_event, input: { provider: string; enabled: boolean }) => {
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const current = await readCustomModel();
  const isCurrent = current?.provider === input.provider;
  // 全局互斥：一次只能启用一个供应商。启用 A 时若 B 在生效 → 自动禁用所有其他启用中的
  // 供应商，并把 A 写为当前生效（引擎重启，切换语义）。UI 置灰是第一道防线，这里是兜底。
  if (input.enabled) {
    for (const other of list) {
      if (other.provider !== input.provider && other.enabled !== false) {
        await upsertCustomModel({ ...other, enabled: false });
      }
    }
    const next: CustomModelFile = { ...target, enabled: true };
    await upsertCustomModel(next);
    if (!isCurrent) {
      await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
      await applyCustomModel(next);
    }
    // 正向联动：在「模型供应商」列表启用 → 对应账号库里被停用的账号同步恢复启用。
    // 不补这一步会出现死锁（实测反馈）：供应商生效了，但账号卡仍显示「已停用」，
    // 而账号的 disabled 又会把开关/「启用订阅/设为当前」按钮一起禁用 → 用户回到订阅页什么都点不了。
    try {
      if (input.provider === "openai-official") {
        const vault = await readOpenaiVault();
        let changed = false;
        for (const account of vault) {
          if ((account as any).disabled) { delete (account as any).disabled; changed = true; }
        }
        if (changed) await writeOpenaiVault(vault);
      } else if (input.provider.startsWith("relay-")) {
        const store = await readRelayStore();
        let changed = false;
        for (const account of store.accounts) {
          if (!account.disabled) continue;
          // 网关匹配用 relayProviderIdOf（与账号开关/删除收尾同一套命名，别再各抄一遍）
          if (relayProviderIdOf(account.baseUrl) === input.provider) { account.disabled = false; changed = true; }
        }
        if (changed) await writeRelayStore(store);
      }
    } catch { /* 账号库不存在等：跳过联动，不影响启用主流程 */ }
    broadcastProviderActivated(input.provider);
    return publicCustomModel(next);
  }
  const next: CustomModelFile = { ...target, enabled: false };
  await upsertCustomModel(next);
  if (isCurrent) {
    await fs.writeFile(customModelFile, "null", "utf8");
    await server.restart();
  }
  // 反向联动：停用 relay-<host> 供应商 → 对应网关的中转站账号开关同步关
  //（正向联动已有：停用账号会禁用同网关供应商；这里是供应商→账号方向）
  if (input.provider.startsWith("relay-")) {
    try {
      const store = await readRelayStore();
      let changed = false;
      for (const account of store.accounts) {
        if (account.disabled) continue;
        if (relayProviderIdOf(account.baseUrl) === input.provider) {
          account.disabled = true;
          if (store.activeId === account.id) store.activeId = null;
          changed = true;
        }
      }
      if (changed) await writeRelayStore(store);
    } catch { /* relay store 不存在等，跳过联动 */ }
  }
  // 反向联动：停用 openai-official 供应商 → 订阅账号一并置为「已停用」（与中转站账号同语义）
  if (input.provider === "openai-official") {
    try {
      const vault = await readOpenaiVault();
      let changed = false;
      for (const account of vault) {
        if (!(account as any).disabled) { (account as any).disabled = true; changed = true; }
      }
      if (changed) await writeOpenaiVault(vault);
      // ⛔ 与 `openai:toggle-account` 对齐：停用供应商必须同时清掉 auth.json 的登录态，
      //    否则卡片会同时显示「使用中 + 已停用」（账号卡失效判据读的是 auth.json 的 email），
      //    引擎也会继续拿着凭据跑 —— 这就是用户在中转站侧报的同一类矛盾态。
      const current = await readOpenaiAuth();
      if (current?.loggedIn) await fs.writeFile(openaiAuthFile(), "null", "utf8");
    } catch { /* 跳过 */ }
  }
  return publicCustomModel(next);
});

ipcMain.handle("custom-model:remove", async (_event, providerId: string) => {
  const list = await readCustomModels();
  const next = list.filter((entry) => entry.provider !== providerId);
  await writeCustomModels(next);
  const current = await readCustomModel();
  if (current?.provider === providerId) {
    // 删除当前供应商只改变模型配置，绝不能触碰 codex-home/sessions。
    // 还有可用供应商时直接切到下一家，避免引擎短暂进入“无模型”状态；没有时
    // 才清空当前模型。两条路径都会保留同一个 CODEX_HOME，因此本地会话仍可列出。
    const fallback = next.find((entry) => entry.enabled !== false) ?? null;
    if (fallback) {
      const normalized = withModels(fallback);
      await fs.writeFile(customModelFile, JSON.stringify(normalized, null, 2), "utf8");
      await applyCustomModel(normalized);
      return { ok: true, current: publicCustomModel(normalized) };
    }
    await fs.writeFile(customModelFile, "null", "utf8");
    await server.restart();
    return { ok: true, current: null };
  }
  return { ok: true, current: current ? publicCustomModel(current) : null };
});
