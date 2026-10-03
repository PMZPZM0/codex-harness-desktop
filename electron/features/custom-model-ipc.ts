/**
 * custom-model-ipc（10-03 从 `features/model-custom-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：custom-model(12)
 * 通道：custom-model:read / probe / save / list / select / set-model / set-effort / apply /
 *      upsert-model / remove-model / set-enabled / remove
 *
 * ⛔⛔ 四条实证口径（本次纯搬迁，一字未改）：
 *   1. **恒 `wireApi = "responses"`**（09-16 真实引擎探针实证：写 chat 会让整份 config.toml 拒载、
 *      所有请求失败）。前端已撤协议选项，入参只为兼容旧渲染层。
 *   2. **模型列表以前端传入的全量为权威**（2026-09-08 实测反馈）：从磁盘旧列表合并会让
 *      「删除的模型保存后立即复活」。仅当完全没传 models 字段才回退磁盘兜底。
 *   3. **默认启用态取决于有没有密钥**（09-19 用户要求）：没填密钥 ⇒ 存成禁用；
 *      本机/内网自建服务例外（本来就不需要 Key，存禁用会「配好却发不出消息」且看不出原因）。
 *   4. **供应商 ↔ 账号的正反联动**必须都在：只做正向（启用供应商恢复账号）不做反向会出现
 *      「供应商生效了但账号卡显示已停用，而 disabled 又把按钮全禁用 ⇒ 用户什么都点不了」的死锁。
 * ⛔ `withModels` / `isLocalEndpoint` / `publicCustomModel` 已从 openai 域下沉到 `../custom-model-store`
 *    （两个域共用，不能留在任一域内部）；vault 读写在 `../openai-vault`。
 * ⛔ 待接缝化（阶段 2）：app / safeStorage 为宿主能力。
 */
import fs from "node:fs/promises";
import { app } from "electron";
import { probeCustomModel } from "./custom-model-probe";
import { safeProviderId } from "../provider-id";
import type { CustomModelFile, ProviderModel } from "./custom-model-types";
import type { BridgeMode } from "../responses-bridge";
import { readRelayStore, writeRelayStore } from "./relay-ipc";
import { relayProviderIdOf } from "../relay-accounts";
import { sendToWindow } from "./window-bus";
import { openaiAuthFile, readOpenaiAuth } from "./openai-auth";
import { readOpenaiVault, writeOpenaiVault } from "../openai-vault";
import { applyCustomModel, normalizeUpstreamProtocol, readCustomModel, readCustomModels, writeCustomModels } from "../main";
import { customModelFile, server, upsertCustomModel } from "../runtime-refs";
import { isLocalEndpoint, publicCustomModel, withModels } from "../custom-model-store";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

async function disableOtherCustomProviders(provider: string) {
  const list = await readCustomModels();
  for (const other of list) {
    if (other.provider !== provider && other.enabled !== false) {
      await upsertCustomModel({ ...other, enabled: false });
    }
  }
}

function broadcastProviderActivated(provider: string) {
  try { sendToWindow("harness:event", { type: "provider-activated", provider, at: Date.now() }); } catch { /* 窗口未就绪 */ }
}

const CUSTOM_MODEL_CHANNELS = [
  "custom-model:read", "custom-model:probe", "custom-model:save", "custom-model:list", "custom-model:select",
  "custom-model:set-model", "custom-model:set-effort", "custom-model:apply",
  "custom-model:upsert-model", "custom-model:remove-model", "custom-model:set-enabled", "custom-model:remove",
];

export const customModelFeature = defineFeature<null>({
  id: "custom-model",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // 宿主能力经接缝取（10-03 阶段 2b）：safeStorage 触碰系统密钥库，
    // 域直取等于"插件自选加解密策略" ⇒ 锁进容器（守卫【266】零容忍）。
    const { secure } = ctx.get<HostCaps>("host")!;
    if (!ipcHost) throw new Error("custom-model: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("custom-model:read", async () => publicCustomModel(await readCustomModel()));

    ipcHost.handle("custom-model:probe", (_event, input: { provider?: string; baseUrl: string; apiKey?: string; model?: string; wireApi?: "responses" | "chat" | "auto" }) => probeCustomModel(input));

    ipcHost.handle("custom-model:save", async (_event, input: { provider: string; name: string; model: string; baseUrl: string; contextWindow?: string | number; wireApi?: "responses" | "chat"; apiKey?: string; models?: ProviderModel[]; enabled?: boolean; upstreamProtocol?: BridgeMode }) => {
      const provider = safeProviderId(input.provider.trim());
      const name = input.name.trim();
      const requestedModel = input.model.trim();
      const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
      const contextWindow = Number(input.contextWindow ?? 128000);
      if (!/^[a-zA-Z0-9_-]+$/.test(provider)) throw new Error("供应商 ID 只能包含字母、数字、下划线和短横线");
      if (!name) throw new Error("供应商名称不能为空");
      if (!Number.isSafeInteger(contextWindow) || contextWindow < 1024) throw new Error("上下文额度必须是大于等于 1024 的整数");
      const parsedUrl = new URL(baseUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Base URL 必须使用 http 或 https");
      const previous = await readCustomModel();
      let encryptedKey = previous?.encryptedKey;
      if (input.apiKey) {
        if (!secure.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
        encryptedKey = secure.encryptString(input.apiKey).toString("base64");
      }
      // ⛔ 恒 responses（09-16 真实引擎探针实证：写 chat 会让整份 config.toml 拒载、所有请求失败）。
      // 前端也不再传 chat（UI 已撤掉协议选项），这里保留入参只为兼容旧渲染层，统一归一。
      const wireApi = "responses" as const;
      // 官方订阅：chatgpt 后端只认 ChatGPT 登录凭据，绝不能把任何 API Key 带上（含「留空沿用上一供应商」的复用逻辑）
      // 带上会 401 "api_key_not_supported" → 流无限重连（实证）
      if (provider === "openai-official") encryptedKey = undefined;
      // 模型列表以「前端传入的完整列表」为权威：前端保存时总是带全量 models（模型设置页、
      // 中转站/官方订阅切换、登录页都一样），其中不含的模型即视为「被用户删除」——绝不能
      // 再从磁盘旧列表合并回来，否则删除的模型保存后立即复活（2026-09-08 实测反馈）。
      // 仅当调用方完全没传 models 字段时才回退到磁盘旧列表兜底（老调用方兼容）。
      const list = await readCustomModels();
      const existing = list.find((entry) => entry.provider === provider);
      const seen = new Set<string>();
      const mergedModels: ProviderModel[] = [];
      for (const m of input.models ?? []) {
        const id = typeof m === "string" ? m : m?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        mergedModels.push(typeof m === "string" ? { id, contextWindow } : m);
      }
      if (!Array.isArray(input.models)) {
        for (const m of existing?.models ?? []) {
          const id = typeof m === "string" ? m : m?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          mergedModels.push(typeof m === "string" ? { id, contextWindow: existing?.contextWindow } : m);
        }
      }
      const enabledModels = mergedModels.filter((entry) => entry.enabled !== false);
      const model = requestedModel || enabledModels[0]?.id || "";
      if (!model) throw new Error("请先在「模型列表」添加并勾选至少一个生效模型，再保存");
      // ⛔ 新供应商的**默认启用态取决于有没有密钥**（09-19 用户要求：首次安装/未配置时不要默认启用）。
      //   ⚠️ 本机/内网自建服务例外（09-19 代码审查发现）：它们本来就不需要 Key，
      //   存成禁用会让「配好本地模型却发不出消息」且看不出原因。判定与 publicCustomModel 同源。
      const keylessThirdPartySave = !encryptedKey && provider !== "openai-official" && !isLocalEndpoint(baseUrl);
      // 上游协议（09-19）：归一为 auto/chat/responses；未传（旧渲染层）时沿用已有值，兜底 auto。
      const upstreamProtocol = normalizeUpstreamProtocol(input.upstreamProtocol ?? existing?.upstreamProtocol);
      const saved = withModels({ provider, name, model, baseUrl, contextWindow, wireApi, encryptedKey, upstreamProtocol, enabled: keylessThirdPartySave ? false : (input.enabled ?? existing?.enabled ?? true), models: mergedModels }, model);
      await upsertCustomModel(saved);
      const current = await readCustomModel();
      if (saved.enabled === false && current?.provider !== provider) {
        // 禁用状态的供应商不抢生效位
        return publicCustomModel(saved);
      }
      // 全局互斥：保存为启用状态的供应商成为唯一生效者，其他启用中的全部禁用
      //（UI 置灰是第一道防线，这里是兜底——中转站/官方订阅/设置页保存都汇到这个 handler）
      if (saved.enabled !== false) {
        for (const other of list) {
          if (other.provider !== provider && other.enabled !== false) {
            await upsertCustomModel({ ...other, enabled: false });
          }
        }
      }
      await fs.writeFile(customModelFile, JSON.stringify(saved, null, 2), "utf8");
      await applyCustomModel(saved);
      broadcastProviderActivated(provider);
      return publicCustomModel(saved);
    });

    ipcHost.handle("custom-model:list", async () => {
      const list = await readCustomModels();
      const current = await readCustomModel();
      const providers = list.length ? list.map(publicCustomModel) : (current ? [publicCustomModel(current)] : []);
      return { providers, current: current?.provider ?? null };
    });

    ipcHost.handle("custom-model:select", async (_event, providerId: string) => {
      const list = await readCustomModels();
      const target = list.find((entry) => entry.provider === providerId);
      if (!target) throw new Error("未找到该供应商");
      const next = withModels(target);
      if (next !== target) await upsertCustomModel(next);
      await disableOtherCustomProviders(providerId);
      await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
      await applyCustomModel(next);
      broadcastProviderActivated(providerId);
      return publicCustomModel(next);
    });

    ipcHost.handle("custom-model:set-model", async (_event, input: { provider: string; model: string; apply?: boolean; restart?: boolean }) => {
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

    ipcHost.handle("custom-model:set-effort", async (_event, input: { provider: string; model: string; effort: string }) => {
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

    ipcHost.handle("custom-model:apply", async () => {
      const custom = await readCustomModel();
      if (!custom) throw new Error("尚未配置供应商");
      await applyCustomModel(custom);
      return publicCustomModel(custom);
    });

    ipcHost.handle("custom-model:upsert-model", async (_event, input: { provider: string; model: ProviderModel }) => {
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

    ipcHost.handle("custom-model:remove-model", async (_event, input: { provider: string; modelId: string }) => {
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

    ipcHost.handle("custom-model:set-enabled", async (_event, input: { provider: string; enabled: boolean }) => {
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

    ipcHost.handle("custom-model:remove", async (_event, providerId: string) => {
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

    ctx.effect(() => {
      for (const ch of CUSTOM_MODEL_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
