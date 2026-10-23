/**
 * 供应商自动配置（10-24）—— 「登录/填密钥 → 自动检测 → 勾选模型 → 保存并启用 → 重启」的
 * **唯一编排实现**。登录页、模型设置页、云账号页共用这一份，⛔ 不许各处再写一条。
 *
 * 两条落盘通道：
 *  · 云账号：勾选写**服务端**（cloud-models:set-enabled）再 activate —— 换台机器登录也一致；
 *  · 其它供应商：custom-model:save（模型列表以前端全量为权威），主进程的互斥实现会自动停用旧供应商。
 * ⛔ 云目录探测**不走 probeCustomModel**：代理网关不提供 /models（10-23 实测），走它只会报假错误。
 */
import { ALL_EFFORTS } from "./effort";
import { matchModelSpec } from "./model-specs";
import { OFFICIAL_MODELS } from "./official-models";

export type SetupSource = "cloud" | "relay" | "openai" | "custom";

export type SetupModel = {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputTypes: ("text" | "image" | "video")[];
  outputTypes: ("text" | "image" | "video")[];
  efforts?: string[];
  enabled?: boolean;
};

export type DetectedSetup = {
  models: SetupModel[];
  /** 初始勾选：云端按服务端 enabled，其它供应商全选。 */
  selected: string[];
  persist: "cloud" | "local";
  detail: string;
};

export type SetupSaveResult = {
  saved: any;
  models: string[];
  /** 本次保存后自动停用的旧供应商显示名。 */
  disabled: string[];
  /** 保存前正在生效的供应商名。 */
  previous: string;
  /** 保存后仍然启用的其他供应商（互斥失效时非空，界面要如实提示）。 */
  others: string[];
};

/** 通用聊天模型优先（避免默认落到 auto-review / embedding 之类附属模型）。 */
export function pickDefaultModel(models: SetupModel[]): string {
  return models.find((m) => !/image|embedding|moderation|audio|tts|whisper|auto-review/i.test(m.id))?.id
    || models[0]?.id
    || "";
}

export function buildSetupModels(ids: string[], fallbackContext = 256000): SetupModel[] {
  const seen = new Set<string>();
  const out: SetupModel[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const spec = matchModelSpec(id);
    out.push({
      id,
      contextWindow: spec?.contextWindow ?? fallbackContext,
      maxOutputTokens: spec?.maxOutputTokens,
      efforts: spec?.efforts?.length ? [...spec.efforts] : [...ALL_EFFORTS],
      inputTypes: spec?.inputTypes ? [...spec.inputTypes] : ["text"],
      outputTypes: spec?.outputTypes ? [...spec.outputTypes] : ["text"],
    });
  }
  return out;
}

/** 云端目录条目 → 统一模型结构（保留服务端规格，缺的按内置规格表补）。 */
function buildCloudModels(rows: any[]): SetupModel[] {
  const seen = new Set<string>();
  const out: SetupModel[] = [];
  for (const row of rows ?? []) {
    const id = String(row?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const spec = matchModelSpec(id);
    const supportsImages = row?.supportsImages === true || Boolean(spec?.inputTypes?.includes("image"));
    out.push({
      id,
      contextWindow: Number(row?.contextLength) || spec?.contextWindow,
      maxOutputTokens: Number(row?.maxOutputTokens) || spec?.maxOutputTokens,
      efforts: spec?.efforts?.length ? [...spec.efforts] : [...ALL_EFFORTS],
      inputTypes: supportsImages ? ["text", "image"] : (spec?.inputTypes ? [...spec.inputTypes] : ["text"]),
      outputTypes: spec?.outputTypes ? [...spec.outputTypes] : ["text"],
      enabled: row?.enabled !== false,
    });
  }
  return out;
}

/**
 * 自动检测模型。
 * @param input.provider 供应商 id（云 = cloud，官方订阅 = openai-official）
 * @param input.source   登录来源，决定落盘通道
 */
export async function detectSetupModels(input: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  source: SetupSource;
}): Promise<DetectedSetup> {
  if (input.source === "cloud" || input.provider === "cloud") {
    /* ⛔ force:false —— 强制同步会重签代理令牌，可能把同账号其它设备挤出 3 枚令牌环。 */
    const sync = await window.codex.cloudModelsSync({ force: false });
    if (!sync?.ok) throw new Error(sync?.error || "云端模型同步失败");
    const catalog: any = await window.codex.cloudModelsCatalog().catch(() => null);
    const rows = Array.isArray(catalog?.models) ? catalog.models : [];
    let models = buildCloudModels(rows);
    let selected: string[] = rows.filter((m: any) => m?.enabled && m?.id).map((m: any) => String(m.id));
    if (!models.length) {
      const { providers } = await window.codex.listCustomModels();
      const row = providers.find((p) => p.provider === "cloud");
      models = buildCloudModels((row?.models ?? []).map((m) => ({ ...m, enabled: true })));
      selected = models.map((m) => m.id);
    }
    if (!models.length) throw new Error("云端还没有勾选任何模型 —— 先到云用户中心勾选，或点「重新检测」");
    const selectedNow = selected.filter((id) => models.some((m) => m.id === id));
    return {
      models,
      selected: selectedNow.length ? selectedNow : models.map((m) => m.id),
      persist: "cloud",
      detail: `云端目录 ${models.length} 个模型 · 已勾选 ${selectedNow.length || models.length} 个`,
    };
  }

  if (input.provider === "openai-official") {
    const ids = await window.codex.openaiModels().catch(() => OFFICIAL_MODELS);
    const models = buildSetupModels((ids ?? []).length ? ids : OFFICIAL_MODELS, 400_000);
    if (!models.length) throw new Error("没有获取到任何官方订阅模型");
    return { models, selected: models.map((m) => m.id), persist: "local", detail: `官方订阅目录 ${models.length} 个模型` };
  }

  const probe = await window.codex.probeCustomModel({
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    wireApi: "responses",
  });
  const ids: string[] = probe?.models ?? [];
  if (!ids.length) throw new Error("网关没有返回任何模型，请检查地址/密钥或稍后重试");
  const models = buildSetupModels(ids);
  return {
    models,
    selected: models.map((m) => m.id),
    persist: "local",
    detail: `网关返回 ${models.length} 个模型${probe?.via === "official" ? "（官方目录）" : ""}`,
  };
}

async function enabledProviders() {
  const { providers, current } = await window.codex.listCustomModels();
  return { providers: providers ?? [], current };
}

/**
 * 保存勾选并启用。
 * @returns saved = 生效档案（进入主界面时用它初始化模型下拉）。
 */
export async function applySetupSelection(input: {
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  source: SetupSource;
  models: SetupModel[];
  selected: string[];
}): Promise<SetupSaveResult> {
  const ids = [...new Set(input.selected.map(String).filter(Boolean))];
  if (!ids.length) throw new Error("请至少勾选一个模型");
  const before = await enabledProviders();
  const previous = before.providers.find((p) => p.provider === before.current)?.name ?? "";

  let saved: any = null;
  if (input.source === "cloud" || input.provider === "cloud") {
    const persisted = await window.codex.cloudModelsSetEnabled({ ids });
    if (!persisted?.ok) throw new Error(persisted?.error || "保存云端模型勾选失败");
    if (persisted.sync && persisted.sync.ok === false) {
      throw new Error(`云端勾选已保存，但本机模型同步失败：${persisted.sync.error || "未知原因"}`);
    }
    const activated = await window.codex.cloudModelsActivate();
    if (!activated?.ok) throw new Error(activated?.error || "切换云端模型失败");
    saved = await window.codex.getCustomModel();
    if (!saved) throw new Error("云端供应商已启用，但读取生效档案失败 —— 请重启应用后重试");
  } else {
    const chosen = input.models.filter((m) => ids.includes(m.id));
    if (!chosen.length) throw new Error("勾选的模型不在检测结果里，请重新检测");
    const model = pickDefaultModel(chosen);
    saved = await window.codex.saveCustomModel({
      provider: input.provider,
      name: input.name,
      model,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      contextWindow: chosen.find((m) => m.id === model)?.contextWindow ?? chosen[0]?.contextWindow ?? 256000,
      wireApi: "responses",
      apiKey: input.apiKey || "",
      models: chosen,
      enabled: true,
    });
    /* 主进程对「没填 Key 的第三方供应商」会存成停用（本地/内网服务除外）。
       这里必须如实报错，不能界面显示已启用、实际档案是停用。 */
    if (saved?.enabled === false) throw new Error("已保存为停用状态：第三方供应商需要填写 API Key（本机服务可留空）");
  }

  const after = await enabledProviders();
  const stillEnabled = after.providers.filter((p) => p.provider !== input.provider && p.enabled !== false);
  const disabled = before.providers
    .filter((p) => p.provider !== input.provider && p.enabled !== false && !stillEnabled.some((x) => x.provider === p.provider))
    .map((p) => p.name);
  return {
    saved,
    models: ids,
    disabled,
    previous,
    others: stillEnabled.map((p) => p.name),
  };
}
