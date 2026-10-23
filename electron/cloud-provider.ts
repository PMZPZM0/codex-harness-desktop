/**
 * cloud-provider（基座层，10-16）—— 云端模型在本机模型档案里的**唯一写入点**。
 *
 * 定位：不注册 IPC 通道、被 `cloud-auth`（登出时收摊）与 `cloud-models`（同步时落盘）共用 ⇒
 * 按 `docs/ARCHITECTURE-RULES.md` §1.1 属**基座层**，放 `electron/` 根。⛔ 两个域都别自己写一份档案操作。
 *
 * ⛔⛔ 本机有**两份**档案，写的时候必须同轮一致（10-16 用户实测事故的根因）：
 *   · `custom-models.json`（**复数**）= 供应商**列表**（同步写这里）；
 *   · `custom-model.json`（**单数**）= **生效**档案（`customModel:read` / `getCustomModel()` 读它）。
 *   当时只写了复数 ⇒ 生效档案停在旧集合 ⇒「面板勾了 5 个，底栏下拉 15 个」。所以下面写完列表后
 *   **无条件**把生效档案里本供应商的 models 对齐（当前模型不在集合里则回退到第一个可用）。
 *
 * ⛔ 只 upsert **自己这一行**：绝不遍历禁用其它供应商、绝不抢生效位 —— 那是 `custom-model:save`
 *   的语义（用户主动动作）。唯一的例外写在 `promoteIfVacant`：生效位**空着**时才补上，
 *   否则用户会看到"勾了却选不到"（下拉框的开启条件是 `disabled={!customModel}`）。
 *
 * ⛔ `applyCustomModel` 是**引擎配置生成器**（不是域：没有 defineFeature、没有域前缀），
 *   基座层引用它与 `compaction-watch.ts → ./features/window-bus` 同性质。它只在**真正改动了
 *   生效档案**时才调用 —— 每次同步都重写 config.toml 会无谓打断在跑的回合。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readCustomModel, readCustomModels, writeCustomModels } from "./main/01-model-catalog";
import { customModelFile } from "./runtime-paths";
import { applyCustomModel } from "./features/custom-model-apply";
import { cloudHome, encrypt, fetchIntegrations } from "./cloud-api";
import { writeCloudMemoryActivation } from "./cloud-memory-activation";
import { withExclusiveEnabled } from "./provider-exclusivity";
import { sendToWindow } from "./features/window-bus";
import type { CustomModelFile, ProviderModel } from "./features/custom-model-types";

/** 云供应商的固定 id（⛔ 只含字母数字下划线短横线：`custom-model:save` 的校验口径）。 */
export const CLOUD_PROVIDER_ID = "cloud";
/** 显示名。 */
export const CLOUD_PROVIDER_NAME = "云端模型";
/** 服务端同源代理路径后缀。⛔ **只到 `/proxy`**：引擎自带 `/v1` 前缀，若这里也以 `/v1` 结尾
 *  会拼成 `/v1/v1/chat/completions` ⇒ 服务端 404 ⇒ 界面显示"上游限流/断流"（云助手仓 20:2x 实测）。 */
export const CLOUD_PROXY_SUFFIX = "/proxy";

/** 服务端 `/models` 的一个模型条目（原样透传规格字段，别丢 —— 丢了「编辑模型配置」会退回
 *  硬编码默认值，虚标会导致长任务被上游拒或无限重试）。 */
export type CloudCatalogModel = {
  id: string;
  name?: string;
  credits?: string;
  enabled?: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
};

export type ApplyCloudResult = {
  /** 写进档案的模型数（= 服务端标记为已勾选的那些）。 */
  models: number;
  /** 档案是否真的变了（幂等判据：没变就不写盘）。 */
  changed: boolean;
  /** 本次是否把生效位从"空"补上了。 */
  promoted: boolean;
};

export async function readCloudProviderRow(): Promise<CustomModelFile | null> {
  const list = await readCustomModels();
  return list.find((row) => row.provider === CLOUD_PROVIDER_ID) ?? null;
}

/** 「勾选 = 下拉框可见」：只取服务端 `enabled` 为真的模型。 */
function buildModels(rows: CloudCatalogModel[]): ProviderModel[] {
  return rows
    .filter((m) => m.enabled && m.id)
    .map((m) => ({
      id: m.id,
      ...(typeof m.contextLength === "number" ? { contextWindow: m.contextLength } : {}),
      ...(typeof m.maxOutputTokens === "number" ? { maxOutputTokens: m.maxOutputTokens } : {}),
      ...(typeof m.supportsImages === "boolean"
        ? { inputTypes: (m.supportsImages ? ["text", "image"] : ["text"]) as ("text" | "image" | "video")[] }
        : {}),
    }));
}

function shapeOf(row: CustomModelFile): string {
  return JSON.stringify({
    models: row.models ?? [],
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    key: row.encryptedKey ?? "",
  });
}

/**
 * 把云端目录写成本机供应商行（幂等）。
 * @param rows  服务端 `/models` 返回的模型列表
 * @param baseUrl 账号服务基址（不含尾斜杠）
 * @param encryptedKey safeStorage 加密后的代理令牌；空串 = 本次没拿到（**保留原有 Key**，不写坏）
 */
/* ── 推理上游：**单一决策点**（10-16）────────────────────────────────────────
   ⛔⛔ 为什么必须集中：这一行的 `baseUrl`/`key` 有**两个写入者** ——
     · `cloud-models` 的定期同步（每 10 分钟）会把「纯模型」地址写回去；
     · 记忆域开关要把地址切到带记忆的端点（`memapi` + 该账号 userKey）。
   两处各写一次就必然互相覆盖，症状是**开了记忆、过十分钟自己又变回不带记忆**（最难查的那类）。
   ⇒ 落盘只经本文件：两份意图各存一个文件，行里永远是它们的**合成结果**。
     · `cloud-upstream.json` = 「纯模型」上游（由 `applyCloudProvider` 的调用方给）
     · `memory-upstream.json` = 「记忆增强」上游（由记忆域写；⛔ 不存在 = 关闭）
     生效值 = 记忆增强 ?? 纯模型。 */

/** 「记忆增强」上游意图（`cloudHome()/memory-upstream.json`）。 */
export type MemoryUpstream = { baseUrl: string; encryptedUserKey: string };

function cloudUpstreamFile(): string { return path.join(cloudHome(), "cloud-upstream.json"); }
function memoryUpstreamFile(): string { return path.join(cloudHome(), "memory-upstream.json"); }

async function readJsonFile<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return null; }
}

/** 读「记忆增强」意图；null = 关闭记忆（走纯模型上游）。 */
export async function readMemoryUpstream(): Promise<MemoryUpstream | null> {
  const raw = await readJsonFile<MemoryUpstream>(memoryUpstreamFile());
  return raw && raw.baseUrl && raw.encryptedUserKey ? raw : null;
}

/** 记下/清除「记忆增强」意图。⛔ 这里**只写意图**，不动行 —— 落盘统一走 `resyncCloudUpstream()`。 */
export async function setMemoryUpstream(next: MemoryUpstream | null): Promise<void> {
  const file = memoryUpstreamFile();
  if (!next) { await fs.unlink(file).catch(() => undefined); return; }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ ...next, savedAt: Date.now() }, null, 2), { mode: 0o600 });
}

/** 把「纯模型」上游记下来（记忆开着的时候行里存的是记忆端点，没有这份就回不去）。 */
async function writeModelUpstream(input: { baseUrl: string; encryptedKey: string }): Promise<void> {
  const file = cloudUpstreamFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify({ ...input, savedAt: Date.now() }, null, 2), { mode: 0o600 });
}

/** 生效上游 = 记忆增强 ?? 纯模型。⛔ 记忆端点一律**去掉尾部 `/v1`** ——
 *  引擎自己会拼 `/v1/chat/completions`，留着就会变成 `/v1/v1/...`（此前踩过一次同类坑）。 */
async function resolveUpstream(): Promise<{ baseUrl: string; encryptedKey: string } | null> {
  const memory = await readMemoryUpstream();
  if (memory) return { baseUrl: memory.baseUrl.replace(/\/v1\/?$/, ""), encryptedKey: memory.encryptedUserKey };
  return readJsonFile<{ baseUrl: string; encryptedKey: string }>(cloudUpstreamFile());
}

/**
 * 按当前意图**重算**云供应商那一行的推理上游。
 * ⛔ 记忆开关切换后调它；`cloud-models` 同步落盘后也由 `applyCloudProvider` 内部调它（同一个决策点）。
 * 只在**真变了**的时候写盘 + 重生成引擎配置（换上游必须重启引擎才会重新读配置）。
 */
export async function resyncCloudUpstream(): Promise<{ changed: boolean; memory: boolean }> {
  const list = await readCustomModels();
  const index = list.findIndex((row) => row.provider === CLOUD_PROVIDER_ID);
  if (index < 0) return { changed: false, memory: false };
  const target = await resolveUpstream();
  if (!target) return { changed: false, memory: false };
  const row = list[index];
  const memory = Boolean(await readMemoryUpstream());
  /* ⛔⛔ 切到记忆端点**之前**，先把"当前行"记成「纯模型上游」——
     此刻它还指着纯模型地址，是唯一可靠的取样点。漏了这步就会出现：
     开记忆正常、**关记忆切不回去**（`cloud-upstream.json` 只有 cloud-models 同步写过才有，
     而它可能还没跑过）。⛔ 只在「行还没被切成记忆地址」时取样，否则会把记忆地址记成"纯模型"。 */
  if (memory && !(await readJsonFile(cloudUpstreamFile())) && row.baseUrl !== target.baseUrl) {
    await writeModelUpstream({ baseUrl: row.baseUrl, encryptedKey: String(row.encryptedKey || "") });
  }
  const same = row.baseUrl === target.baseUrl && String(row.encryptedKey || "") === String(target.encryptedKey || "");
  if (same) return { changed: false, memory };
  list[index] = { ...row, baseUrl: target.baseUrl, ...(target.encryptedKey ? { encryptedKey: target.encryptedKey } : {}) };
  await writeCustomModels(list);
  /* 生效档案也要跟上（它才是 `customModel:read` 的口径）：只在本行确实是生效供应商时才动。 */
  const active = await readCustomModel();
  if (active && active.provider === CLOUD_PROVIDER_ID) {
    await fs.writeFile(customModelFile, JSON.stringify({
      ...active,
      baseUrl: target.baseUrl,
      ...(target.encryptedKey ? { encryptedKey: target.encryptedKey } : {}),
    }, null, 2), "utf8");
  }
  await refreshEngineProviders();
  return { changed: true, memory };
}

/* ── 10-19（清单 1/5）：重签后的两件事都收在这里，别在域里各写一份 ─────────────── */

/**
 * 把**新签发的代理令牌**写进云供应商行（列表 + 生效档案两份同轮），并重生成引擎配置。
 * ⛔ 只改 key：模型列表 / 生效位 / baseUrl 都不动（那是 applyCloudProvider / 记忆上游的地盘）。
 */
export async function updateCloudProviderKey(encryptedKey: string): Promise<boolean> {
  if (!encryptedKey) return false;
  /* ⛔ 记忆上游开着时，行里的 key 是**记忆 userKey**（合成结果），不能被代理令牌覆盖 ——
     覆盖后又恰好碰上 /integrations 拉取失败，就会留下「memapi 地址 + 代理令牌」的必 401 组合。
     那一侧的刷新由 refreshMemoryUpstreamFromIntegrations → resyncCloudUpstream 落盘。 */
  if (await readMemoryUpstream()) return false;
  const list = await readCustomModels();
  const index = list.findIndex((row) => row.provider === CLOUD_PROVIDER_ID);
  if (index < 0) return false;
  const row = list[index];
  if (String(row.encryptedKey || "") === encryptedKey) return false;
  list[index] = { ...row, encryptedKey };
  await writeCustomModels(list);
  const active = await readCustomModel();
  if (active && active.provider === CLOUD_PROVIDER_ID) {
    await fs.writeFile(customModelFile, JSON.stringify({ ...active, encryptedKey }, null, 2), "utf8");
  }
  await refreshEngineProviders();
  return true;
}

/**
 * 重新拉一次 `/integrations` 并把**记忆上游**刷新成服务端当前下发的那把 userKey。
 * 用途：重签/自愈时用户刚开通或轮换了记忆空间 —— 只换代理令牌不会更新记忆 key，
 * 表现就是「点了重签还是 401」（10-19 实测）。未开通/已停用 ⇒ 清掉记忆意图（回落纯模型）。
 */
export async function refreshMemoryUpstreamFromIntegrations(): Promise<{ memory: boolean; changed: boolean }> {
  try {
    const res = await fetchIntegrations();
    /* ⛔⛔ 连不上 / 服务端 5xx 属于**暂时性失败**：保留既有上游意图、也不下开通结论。
       旧实现在这里无条件 `setMemoryUpstream(null)` —— 断网一次就把用户的云端记忆清成纯模型端点，
       症状是「突然不记得我」，而用户什么都没改（与 cloud-memory-ipc 的 unreachable 分支同一条纪律）。 */
    const transient = !res.ok && (res.status === 0 || res.status >= 500);
    if (transient) return { memory: Boolean(await readMemoryUpstream()), changed: false };
    const mem = res.ok ? (res.data?.memory ?? {}) : {};
    if (!mem.ok || !mem.baseUrl || !mem.userKey) {
      await setMemoryUpstream(null);
      const cleared = await resyncCloudUpstream();
      /* ⛔ 这里是**自愈/重签**链路上的第二次确认 ⇒ 也要落开通结论，否则设置页还显示旧状态。 */
      const err = String(res.error || "");
      writeCloudMemoryActivation({
        entitled: false,
        reason: res.status === 401 || err === "unauthorized" || err === "not-logged-in"
          ? "not-logged-in"
          : mem.error === "not-activated" ? "not-activated" : "no-credentials",
      });
      return { memory: false, changed: cleared.changed };
    }
    const encryptedUserKey = encrypt(String(mem.userKey));
    if (!encryptedUserKey) {
      writeCloudMemoryActivation({ entitled: true, mode: "rest-only", reason: "storage-unavailable" });
      return { memory: Boolean(await readMemoryUpstream()), changed: false };
    }
    await setMemoryUpstream({ baseUrl: String(mem.baseUrl), encryptedUserKey });
    const applied = await resyncCloudUpstream();
    writeCloudMemoryActivation({ entitled: true, mode: "rest-only" });
    return { memory: true, changed: applied.changed };
  } catch {
    return { memory: Boolean(await readMemoryUpstream()), changed: false };
  }
}

export async function applyCloudProvider(
  rows: CloudCatalogModel[],
  opts: { baseUrl: string; encryptedKey?: string },
): Promise<ApplyCloudResult> {
  const models = buildModels(rows);
  const list = await readCustomModels();
  const index = list.findIndex((row) => row.provider === CLOUD_PROVIDER_ID);
  const previous = index >= 0 ? list[index] : null;

  const key = String(opts.encryptedKey || "");
  /* ⛔ 先把「纯模型」上游记下来（记忆开着时行里存的是记忆端点，没有这份就回不去），
     再用**合成结果**（记忆增强 ?? 纯模型）决定行里写什么 —— 见文件头「单一决策点」。 */
  const modelBaseUrl = `${opts.baseUrl.replace(/\/+$/, "")}${CLOUD_PROXY_SUFFIX}`;
  if (key) await writeModelUpstream({ baseUrl: modelBaseUrl, encryptedKey: key });
  const effective = (await resolveUpstream()) ?? { baseUrl: modelBaseUrl, encryptedKey: key };
  /* ⛔ 10-15 修「两个绿开关」（用户：云管理新增的供应商，上面的豆包没有自动停用）：
     云端行**不再无条件 enabled** —— 只有 ① 它本来就是生效供应商，或 ② 列表里没有任何别的供应商
     启用（空场，promoteIfVacant 会把它顶上）时才置 true；否则保持停用。
     ⛔ 否则同步（每 10 分钟）会把用户刚切走的供应商**顶回来** ⇒「反向」永远不成立。 */
  const activeRow = await readCustomModel();
  const cloudActive = activeRow?.provider === CLOUD_PROVIDER_ID;
  const othersEnabled = list.some((row) => row.provider !== CLOUD_PROVIDER_ID && row.enabled !== false);
  const enabled = models.length > 0 && (cloudActive || !othersEnabled);
  const next: CustomModelFile = {
    ...(previous ?? {
      provider: CLOUD_PROVIDER_ID,
      name: CLOUD_PROVIDER_NAME,
      model: "",
      baseUrl: "",
      contextWindow: 256000,
      enabled: false,
    }),
    provider: CLOUD_PROVIDER_ID,
    name: CLOUD_PROVIDER_NAME,
    /* model 只保留"原本就选中且仍在勾选列表里"的那个，否则留空（留空 = 不抢任何人的生效位）。 */
    model: previous && models.some((m) => m.id === previous.model) ? previous.model : "",
    baseUrl: effective.baseUrl,
    /* ⛔⛔ `wireApi` 是**写给引擎**的字段 —— 引擎只会发 **Responses**（0.163 起更严格：
       写 `chat` 会让整份配置拒载，表现为「测试连接成功、发送却失败」）。
       上游（memapi 网关）真实只认 Chat ⇒ 用 `upstreamProtocol` 告诉**本地桥**去翻
       （`bridge-dial` + `upstream-protocols`），⛔ 不要往引擎字段里塞 chat。 */
    wireApi: "responses",
    upstreamProtocol: "chat",
    models,
    /* ⛔ 10-15 起 `enabled` 由上面的条件决定（生效中 / 空场才为真），**不再恒 true**：
       恒 true 会让云端行与用户当前生效的供应商同时绿（用户截图两个开关都亮）。 */
    enabled,
    ...(effective.encryptedKey ? { encryptedKey: effective.encryptedKey } : {}),
  } as CustomModelFile;

  /* 令牌会轮换（重签 / 换绑 / 服务端清记录）⇒ 旧 key 留在行里会变成"本机静默 401、界面显示已保存"。
     所以判据落在**令牌串有没有变**上，而不是"有没有 key"。没拿到新令牌时沿用原值。 */
  const changed = !previous || shapeOf(previous) !== shapeOf(next);
  if (index >= 0) list[index] = next; else list.push(next);
  /* 互斥（唯一实现）：云端行启用 ⇒ 其余供应商一律停用。 */
  const exclusive = enabled ? withExclusiveEnabled(list, CLOUD_PROVIDER_ID) : { list, changed: false };
  if (changed || exclusive.changed) await writeCustomModels(exclusive.list);

  await alignActiveFile(models);
  const promoted = await promoteIfVacant(next);
  /* ⛔⛔ 变更后必须**重生成引擎配置**：`applyCustomModel` 会把**全部已保存供应商**（含未启用的）
     写成 `[model_providers.*]` 段，而旧线程的 rollout 里记着创建时的 `model_provider` ——
     只加档案不写段，那些会话 resume 会直接报 "Model provider not found"（内容全空）。
     promoteIfVacant 命中时它自己已经调过一次，别重复调。 */
  if (changed && !promoted) await refreshEngineProviders();
  return { models: models.length, changed, promoted };
}

/**
 * 云端供应商是否是**当前生效**的那个（界面据此决定要不要显示「设为当前供应商」）。
 */
/** 一次性纠偏（10-17）：旧版本把云模型的 `wireApi` 写成了 `chat`。
 *  ⛔ 引擎只会发 **Responses**，`wireApi: "chat"` 会让整份配置拒载 —— 用户侧表现为
 *     「测试连接成功（那是按 Chat 探的）、真正发送却报错」。
 *  ⛔ 只改**两个协议字段**；⛔ 不碰 key / 模型列表 / 生效位（那是别的写入者的地盘）。 */
export async function repairCloudProviderProtocol(): Promise<boolean> {
  try {
    const list = await readCustomModels();
    const i = list.findIndex((row) => row.provider === CLOUD_PROVIDER_ID);
    if (i < 0) return false;
    const row = list[i] as CustomModelFile & { upstreamProtocol?: string };
    if (row.wireApi === "responses" && row.upstreamProtocol === "chat") return false;
    list[i] = { ...row, wireApi: "responses", upstreamProtocol: "chat" } as CustomModelFile;
    await writeCustomModels(list);
    return true;
  } catch { return false; }
}

export async function isCloudActive(): Promise<boolean> {
  const active = await readCustomModel();
  return active?.provider === CLOUD_PROVIDER_ID;
}

/**
 * 让引擎配置（config.toml）与档案保持一致。
 * 以**当前生效档案**为入口调 `applyCustomModel`（它内部会把列表里所有供应商都写成段）。
 * `restart:false` —— 只是补段，不必打断在跑的回合。
 */
export async function refreshEngineProviders(): Promise<boolean> {
  const active = await readCustomModel();
  if (!active) return false;
  await applyCustomModel(active, { restart: false });
  return true;
}

/**
 * 把云端供应商**设为当前生效**（用户在面板上显式点的动作，因此允许抢生效位）。
 * ⛔ 与自动同步的分界：同步**绝不**抢位（那是 `custom-model:save` 的语义）；
 *   只有这里、且只由用户点击触发。
 * `restart:true`：切换供应商会换 Key 与 base_url，引擎必须重启才会重新读配置。
 */
export async function activateCloudProvider(): Promise<{ ok: boolean; model: string; error?: string }> {
  const row = await readCloudProviderRow();
  if (!row) return { ok: false, model: "", error: "not-registered" };
  const models = row.models ?? [];
  if (!models.length) return { ok: false, model: "", error: "no-models" };
  const picked: CustomModelFile = { ...row, model: row.model || models[0]?.id || "", enabled: true };
  /* ⛔ 10-15：显式切到云端 = 互斥收敛（其余供应商停用）—— 以前只写生效档案，
     列表里原来那个供应商的开关仍是绿的（用户截图「豆包没有自动停用」）。 */
  const { list: exclusiveList, changed: exclusiveChanged } = withExclusiveEnabled(await readCustomModels(), CLOUD_PROVIDER_ID);
  if (exclusiveChanged) await writeCustomModels(exclusiveList);
  await fs.writeFile(customModelFile, JSON.stringify(picked, null, 2), "utf8");
  await applyCustomModel(picked, { restart: true });
  /* 10-24：云端「选择模型并启用」也要广播 provider-activated —— 渲染层据此刷新供应商列表
     并把当前会话模型跟到云端（与 custom-model:save / set-enabled 同一条事件，⛔ 不另开一套）。 */
  try { sendToWindow("harness:event", { type: "provider-activated", provider: CLOUD_PROVIDER_ID, at: Date.now() }); } catch { /* 窗口未就绪 */ }
  return { ok: true, model: picked.model };
}

/** 把**生效档案**（单数）里本供应商的 models 对齐 —— 10-16 事故的防线，见文件头。 */
async function alignActiveFile(models: ProviderModel[]): Promise<void> {
  const active = await readCustomModel();
  if (!active || active.provider !== CLOUD_PROVIDER_ID) return;
  const ids = models.map((m) => m.id);
  const model = ids.includes(active.model) ? active.model : (ids[0] ?? "");
  if (JSON.stringify(active.models ?? []) === JSON.stringify(models) && active.model === model) return;
  await fs.writeFile(customModelFile, JSON.stringify({ ...active, models, model }, null, 2), "utf8");
}

/**
 * 生效位**空着**时把本行提升为生效供应商。判据极窄（沿用 `limited-benefit` 域的既有实现）：
 * 单数档案不存在、或其 provider 已不属于"仍启用的行"。⛔ 生效位有活着的别人 ⇒ 直接返回 false。
 */
async function promoteIfVacant(row: CustomModelFile): Promise<boolean> {
  if (!row.models?.length) return false;
  const active = await readCustomModel();
  if (active && active.provider !== row.provider) {
    const alive = (await readCustomModels()).some((r) => r.provider === active.provider && r.enabled !== false);
    if (alive) return false;
  }
  const picked: CustomModelFile = { ...row, model: row.model || row.models[0]?.id || "" };
  if (active?.provider === row.provider && active.encryptedKey === picked.encryptedKey) return false;
  await fs.writeFile(customModelFile, JSON.stringify(picked, null, 2), "utf8");
  /* restart:false —— 只是把空位填上，不必打断任何在跑的回合（引擎下次读配置即生效）。 */
  await applyCustomModel(picked, { restart: false });
  return true;
}

/**
 * 收摊（登出/切号时调）：只把本行标记为**停用**，⛔ **保留模型列表**（用户重新登录后勾选还在）。
 * ⛔ 不动生效档案：把它抹掉会让引擎的 config.toml 指向一个不存在的供应商，
 *   而旧会话的 rollout 里记着 provider 名 —— 那是"历史会话打不开"的经典成因。
 */
export async function disableCloudProvider(): Promise<boolean> {
  const list = await readCustomModels();
  const index = list.findIndex((row) => row.provider === CLOUD_PROVIDER_ID);
  if (index < 0 || list[index].enabled === false) return false;
  list[index] = { ...list[index], enabled: false };
  await writeCustomModels(list);
  return true;
}
