/**
 * model-custom-ipc 的「custom-model-read」部分（09-22 从同目录 model-custom-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, safeStorage } from "electron";
import { probeCustomModel } from "../../features/custom-model-probe";
import { safeProviderId } from "../../provider-id";
import type { CustomModelFile, ProviderModel } from "../../features/custom-model-types";
import type { BridgeMode } from "../../responses-bridge";
import { applyCustomModel, normalizeProvider, normalizeUpstreamProtocol, readCustomModel, readCustomModels, writeCustomModels } from "../../main";
import { codexHome, customModelFile, server, upsertCustomModel } from "../../runtime-refs";
import { withModels, isLocalEndpoint, publicCustomModel } from "./01-openai-login";
import { disableOtherCustomProviders, broadcastProviderActivated } from "./05-custom-model-write";
ipcMain.handle("model-specs:read", async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "model-specs.json"), "utf8")); } catch { return null; }
});

ipcMain.handle("custom-model:read", async () => publicCustomModel(await readCustomModel()));

ipcMain.handle("custom-model:probe", (_event, input: { provider?: string; baseUrl: string; apiKey?: string; model?: string; wireApi?: "responses" | "chat" | "auto" }) => probeCustomModel(input));

ipcMain.handle("custom-model:save", async (_event, input: { provider: string; name: string; model: string; baseUrl: string; contextWindow?: string | number; wireApi?: "responses" | "chat"; apiKey?: string; models?: ProviderModel[]; enabled?: boolean; upstreamProtocol?: BridgeMode }) => {
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
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
    encryptedKey = safeStorage.encryptString(input.apiKey).toString("base64");
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
  // ⛔ 新供应商的**默认启用态取决于有没有密钥**（09-19 用户要求：首次安装/未配置时不要默认启用）：
  //   没填密钥就保存（或从推荐卡进来还没填）→ 存成禁用；填了密钥 → 启用（配置完即可用）。
  //   原来无条件 `?? true`：未配置密钥的供应商也会带着「已启用」落盘，于是和新配的那个同时亮。
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

ipcMain.handle("custom-model:list", async () => {
  const list = await readCustomModels();
  const current = await readCustomModel();
  const providers = list.length ? list.map(publicCustomModel) : (current ? [publicCustomModel(current)] : []);
  return { providers, current: current?.provider ?? null };
});

ipcMain.handle("custom-model:select", async (_event, providerId: string) => {
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
