import { useCallback, useEffect, useState } from "react";
import { DEFAULT_EFFORT } from "../lib/effort";
import { matchModelSpec } from "../lib/model-specs";

export type ProviderModel = { id: string; enabled?: boolean; contextWindow?: number; maxOutputTokens?: number; inputTypes?: ("text" | "image" | "video")[]; outputTypes?: ("text" | "image" | "video")[]; efforts?: string[] };

/** 把「测试连接」的失败原文翻译成能直接照做的中文。
 *  认证失败是最容易被笼统提示吞掉的一类：供应商原文里的措辞决定排查方向不同——
 *  「API key 格式不正确」= Key 与通道/Key 类型不配套；「Invalid API key」= Key 值不对或已失效。
 *  供应商原话一律保留（最权威），后面补一句排查清单。 */
export function classifyProviderProbeFailure(raw: string): string {
  const text = String(raw ?? "").replace(/^Error invoking remote method '[^']+':\s*/i, "").trim();
  if (/认证失败|401|403|api\s*key|unauthorized|authentication/i.test(text)) {
    return `${text}\n排查：① Key 是否复制完整（末尾无空格/换行）；② Key 与 Base URL 通道是否配套（例：火山方舟 /api/plan/v3 需套餐专属 Key，普通 Key 用 /api/v3）；③ Key 是否已过期/被禁用，或该账号未开通对应模型`;
  }
  if (/域名解析失败|连接被拒绝|连接超时|ENOTFOUND|ECONNREFUSED|timeout/i.test(text)) {
    return `${text}\n排查：本机网络/代理能否直连该地址（Base URL 是否写错、服务是否在运行）`;
  }
  if (/404|405|不提供 \/models|不提供\s*\/models/i.test(text)) {
    return `${text}\n排查：Base URL 末段是否是网关要求的 /v1、/api/v3 之类前缀`;
  }
  if (/模型不存在/.test(text)) {
    return `${text}\n排查：模型 ID 是否与网关文档一致（部分网关要求带版本或接入点 ID）`;
  }
  return text;
}

export type CustomModel = { provider: string; name: string; model: string; baseUrl: string; contextWindow?: number; wireApi?: "responses" | "chat" | "auto"; hasKey?: boolean; models?: ProviderModel[]; enabled?: boolean };

export type ProviderDraft = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: string;
  wireApi: "responses" | "chat" | "auto";
  apiKey: string;
  models: ProviderModel[];
  enabled: boolean;
};

export type ProviderSummary = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow?: number;
  wireApi?: "responses" | "chat" | "auto";
  hasKey?: boolean;
  models?: ProviderModel[];
  enabled?: boolean;
};

type Options = {
  onAutoSelect: (modelId: string, effort: string) => void;
  onSelect: (modelId: string, effort?: string) => void;
  onNotice: (message: string) => void;
  /** 检测成功时弹 toast（富样式弹窗提醒，比状态行小字醒目） */
  onProbeSuccess?: (title: string, detail: string) => void;
  /** 引擎已重启并使新配置生效（供应商切换「待重启生效」banner 需随之清理） */
  onEngineApplied?: () => void;
};

function savedEffortFor(model: string | undefined) {
  if (!model) return "";
  try { return (JSON.parse(localStorage.getItem("model-efforts") ?? "{}") as Record<string, string>)[model] ?? ""; } catch { return ""; }
}

function dedupModels(models: ProviderModel[] | undefined): ProviderModel[] {
  if (!models?.length) return [];
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const m of models) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export function useModelProviders({ onAutoSelect, onSelect, onNotice, onProbeSuccess, onEngineApplied }: Options) {
  const [customModel, setCustomModel] = useState<CustomModel | null>(null);
  const [customDraft, setCustomDraft] = useState<ProviderDraft>({ provider: "custom", name: "Custom Provider", model: "", baseUrl: "", contextWindow: "128000", wireApi: "auto", apiKey: "", models: [], enabled: true });
  const [providersList, setProvidersList] = useState<ProviderSummary[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [modelSourceProvider, setModelSourceProvider] = useState<string | null>(null);
  const [probingProvider, setProbingProvider] = useState<"list" | "test" | null>(null);
  const [providerStatus, setProviderStatus] = useState("");
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);

  function adoptSavedProvider(saved: CustomModel, probedModels: string[] = []) {
    setCustomModel(saved);
    setCustomDraft({ ...saved, contextWindow: String(saved.contextWindow ?? 128000), wireApi: saved.wireApi ?? "responses", apiKey: "", models: saved.models ?? (saved.model ? [{ id: saved.model }] : []), enabled: saved.enabled ?? true });
    const entry = { provider: saved.provider, name: saved.name, model: saved.model, baseUrl: saved.baseUrl, wireApi: saved.wireApi ?? "responses", hasKey: saved.hasKey, models: saved.models, enabled: saved.enabled ?? true };
    setProvidersList((current) => {
      const index = current.findIndex((provider) => provider.provider === saved.provider);
      return index >= 0 ? current.map((provider) => provider.provider === saved.provider ? entry : provider) : [...current, entry];
    });
    if (saved.enabled !== false) {
      setCurrentProvider(saved.provider);
      setEditingProvider(saved.provider);
      // 保存供应商配置不抢模型选择：仅当用户从未选过模型时才初始化下拉
      onAutoSelect(`custom:${saved.provider}:${saved.model}`, DEFAULT_EFFORT);
    }
    const modelIds = [...new Set([...(saved.models ?? []).map((model) => model.id), ...probedModels, saved.model].filter(Boolean))];
    setProviderModels(modelIds);
    setModelSourceProvider(saved.provider);
  }

  useEffect(() => {
    void window.codex.listCustomModels()
      .then(({ providers, current }) => { setProvidersList(providers); setCurrentProvider(current); })
      .catch(() => undefined);
  }, []);

  // 引入 refreshActive：供外部在设置页打开等时机刷新生效供应商（防状态过期导致互斥误判）
  const refreshActive = useCallback(() => {
    void window.codex.listCustomModels()
      .then(({ providers, current }) => { setProvidersList(providers); setCurrentProvider(current); })
      .catch(() => undefined);
    void window.codex.getCustomModel().then((result) => { setCustomModel(result); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.codex.getCustomModel()
      .then((result) => {
        if (!result) return;
        setCustomModel(result);
        setCustomDraft({ ...result, contextWindow: String(result.contextWindow ?? 128000), wireApi: result.wireApi ?? "responses", apiKey: "", models: result.models ?? (result.model ? [{ id: result.model }] : []), enabled: result.enabled ?? true });
        setProviderModels((current) => current.includes(result.model) ? current : [result.model, ...current]);
        // 默认 high 而不是顶格：ultra 档的推理 token 会让上游多花数秒才吐首字
        onAutoSelect(`custom:${result.provider}:${result.model}`, savedEffortFor(result.model) || DEFAULT_EFFORT);
        void window.codex.probeCustomModel(result).then((probe) => setProviderModels(probe.models)).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  async function saveCustomModel() {
    await saveCustomDraft();
  }

  /** 保存：不传参用当前 customDraft；模型编辑器"一次保存直生效"场景传入合并后的完整草稿（规避 setState 异步读旧值） */
  async function saveCustomDraft(override?: any) {
    setSavingSettings(true);
    try {
      const source = override ?? customDraft;
      const dedupedDraft = { ...source, models: dedupModels(source.models) };
      const enabled = dedupedDraft.models.filter((model: any) => model.enabled !== false);
      // 配置界面不展示“默认模型”；引擎仍需要一个当前模型作为启动入口，
      // 有勾选模型时仅在保存时内部选择第一项；允许供应商暂时没有模型。
      const effectiveModel = enabled.length === 0 ? "" : enabled.some((model: any) => model.id === dedupedDraft.model) ? dedupedDraft.model : enabled[0].id;
      const saved = await window.codex.saveCustomModel({ ...dedupedDraft, model: effectiveModel });
      adoptSavedProvider(saved);
      onEngineApplied?.();
      onNotice(saved.enabled === false ? "供应商已保存（保持禁用）" : "自定义模型已保存，Codex 服务已重新加载");
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function probeProvider(mode: "list" | "test") {
    setProbingProvider(mode);
    setProviderStatus("");
    try {
      const result = await window.codex.probeCustomModel({ ...customDraft, model: customDraft.model, wireApi: customDraft.wireApi ?? "responses" });
      // 自动跟随上游：探测确定实际协议后回写草稿（下拉从「自动」变为实际值），保存即落定
      const wireUsed = (result as any).wireUsed as "responses" | "chat" | undefined;
      if (customDraft.wireApi === "auto" && wireUsed) setCustomDraft((current) => ({ ...current, wireApi: wireUsed }));
      if (result.models?.length) {
        // 拉全量 /models 时整体替换（避免上一家供应商的模型混进来）；只测单个模型时并入列表
        setProviderModels((current) => customDraft.model ? [...new Set([...result.models, ...current])] : [...new Set(result.models)]);
        setModelSourceProvider(customDraft.provider);
        // 把探测到的模型并进草稿 models（带上下文窗口兜底），供勾选生效
        if (mode === "list") {
          setCustomDraft((current) => {
            const existing = new Set((current.models ?? []).map((m) => m.id));
            const merged = [...(current.models ?? [])];
            for (const id of result.models) {
              const spec = matchModelSpec(id);
              if (!existing.has(id)) {
                // 已知模型自动回填推荐规格（思考档位/上下文/最大输出/输入输出模态），未知模型用用户填写的兜底值
                merged.push({
                  id,
                  enabled: false,
                  contextWindow: spec?.contextWindow ?? (Number(current.contextWindow) || undefined),
                  maxOutputTokens: spec?.maxOutputTokens,
                  efforts: spec ? [...spec.efforts] : undefined,
                  inputTypes: spec?.inputTypes ? [...spec.inputTypes] : ["text"],
                  outputTypes: spec?.outputTypes ? [...spec.outputTypes] : ["text"],
                });
              } else if (spec) {
                // 刷新即校准：存量条目缺参数字段的按内置规格补齐（用户显式改过的字段不动）
                const idx = merged.findIndex((m) => m.id === id);
                const cur = merged[idx];
                merged[idx] = {
                  ...cur,
                  contextWindow: cur.contextWindow ?? spec.contextWindow,
                  maxOutputTokens: cur.maxOutputTokens ?? spec.maxOutputTokens,
                  efforts: cur.efforts?.length ? cur.efforts : [...spec.efforts],
                  inputTypes: cur.inputTypes?.length ? cur.inputTypes : [...(spec.inputTypes ?? ["text"])],
                  outputTypes: cur.outputTypes?.length ? cur.outputTypes : [...(spec.outputTypes ?? ["text"])],
                };
              }
            }
            // 探测只更新候选列表，不替用户指定“默认模型”；勾选状态由用户统一决定。
            return { ...current, models: merged };
          });
        }
      }
      const viaNote = result.via === "official" ? "（已从 OpenAI 官方目录获取最新清单）" : result.via === "official-fallback" ? "（官方目录获取失败，当前为内置兜底清单）" : result.via === "builtin" ? "（该网关不提供列表接口，已加载内置推荐清单，可手动增删）" : result.via === "stream" ? "（网关未提供 /models，已实测模型连通）" : "";
      setProviderStatus(mode === "test" ? `连接成功 · HTTP ${result.status} · ${result.latencyMs} ms · ${result.models.length} 个模型` : `已获取 ${result.models.length} 个模型${viaNote}，勾选要生效的模型后保存`);
      // 成功弹 toast 醒目提醒（状态行小字保留作留痕）
      onProbeSuccess?.(
        mode === "test" ? "连接成功" : "模型列表已获取",
        mode === "test"
          ? `${customDraft.name || customDraft.provider} · HTTP ${result.status} · ${result.latencyMs} ms · ${result.models.length} 个模型可用`
          : `${customDraft.name || customDraft.provider} · ${result.models.length} 个模型${viaNote}，勾选要生效的模型后保存`,
      );
    } catch (error: any) {
      // 失败也要醒目弹提示：状态行是行内小字，容易被忽略——用户看到的只是「换了供应商还是用不了」。
      const failure = classifyProviderProbeFailure(String(error?.message ?? error));
      setProviderStatus(`连接失败：${failure}`);
      onNotice(`连接失败（${customDraft.name || customDraft.provider}）：${failure}`);
    } finally {
      setProbingProvider(null);
    }
  }

  /** 测试「当前生效」的供应商：不必先打开编辑器——切换供应商后最常用的动作。
   *  复用已存的 Key（probeCustomModel 在 provider+baseUrl 与生效档一致时会解密复用）。 */
  async function probeActiveProvider() {
    const current = customModel;
    if (!current) { onNotice("当前没有生效的供应商，先启用一个再测试"); return; }
    setProbingProvider("test");
    setProviderStatus("");
    try {
      const result = await window.codex.probeCustomModel({ provider: current.provider, baseUrl: current.baseUrl, model: current.model, wireApi: current.wireApi ?? "responses" });
      const detail = `HTTP ${result.status} · ${result.latencyMs} ms · ${result.models?.length ?? 0} 个模型可用`;
      setProviderStatus(`当前供应商连接正常：${detail}`);
      onProbeSuccess?.("当前供应商连接正常", `${current.name} · ${current.model} · ${detail}`);
    } catch (error: any) {
      const failure = classifyProviderProbeFailure(String(error?.message ?? error));
      setProviderStatus(`当前供应商连接失败：${failure}`);
      onNotice(`当前供应商（${current.name}）连接失败：${failure}`);
    } finally {
      setProbingProvider(null);
    }
  }

  async function selectProvider(providerId: string) {
    try {
      const selected = await window.codex.selectCustomModel(providerId);
      setCurrentProvider(providerId);
      setCustomModel(selected);
      onSelect(`custom:${selected.provider}:${selected.model}`);
      onNotice("已切换到 " + selected.name);
    } catch (error: any) {
      onNotice(error.message);
    }
  }

  async function removeProvider(provider: ProviderSummary) {
    try {
      const result = await window.codex.removeCustomModel(provider.provider);
      const remaining = providersList.filter((entry) => entry.provider !== provider.provider);
      setProvidersList(remaining);
      if (provider.provider === currentProvider) {
        setCurrentProvider(result.current?.provider ?? null);
        setCustomModel(result.current);
        if (result.current) {
          setCustomDraft({ ...result.current, contextWindow: String(result.current.contextWindow ?? 128000), wireApi: result.current.wireApi ?? "responses", apiKey: "", models: result.current.models ?? (result.current.model ? [{ id: result.current.model }] : []), enabled: result.current.enabled ?? true });
          setEditingProvider(result.current.provider);
          onSelect(`custom:${result.current.provider}:${result.current.model}`);
        } else {
          setEditingProvider(remaining[0]?.provider ?? null);
        }
      } else if (editingProvider === provider.provider) {
        setEditingProvider(remaining[0]?.provider ?? null);
      }
      onNotice(result.current ? `已删除 ${provider.name}，已切换到 ${result.current.name}` : `已删除 ${provider.name}，本地会话记录已保留`);
    } catch (error: any) {
      onNotice(`删除供应商失败：${error.message}`);
    }
  }

  /** 在同一供应商内切换生效模型，立即写入 config.toml 并重启 Codex */
  async function setProviderModel(providerId: string, model: string) {
    setSwitchingModel(model);
    try {
      const updated = await window.codex.setProviderModel({ provider: providerId, model });
      setCustomModel(updated);
      setCurrentProvider(providerId);
      setProvidersList((current) => current.map((p) => p.provider === providerId ? { ...p, model: updated.model, models: updated.models } : p));
      setCustomDraft((current) => ({ ...current, model: updated.model, models: updated.models ?? current.models }));
      onSelect(`custom:${updated.provider}:${updated.model}`);
      onNotice(`已生效：${updated.name} · ${updated.model}`);
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setSwitchingModel(null);
    }
  }

  /** 从供应商模型列表里移除一个；若移除的正是生效模型，后端会自动切到剩下的第一个 */
  async function removeProviderModel(providerId: string, modelId: string) {
    setSwitchingModel(modelId);
    try {
      const wasCurrent = customModel?.provider === providerId;
      const updated = await window.codex.removeProviderModel({ provider: providerId, modelId });
      setProvidersList((current) => current.map((p) => p.provider === providerId ? { ...p, model: updated.model, models: updated.models } : p));
      setCustomDraft((current) => ({ ...current, model: current.provider === providerId ? updated.model : current.model, models: current.provider === providerId ? (updated.models ?? []) : current.models }));
      if (wasCurrent) {
        setCustomModel(updated);
        onSelect(`custom:${updated.provider}:${updated.model}`);
      }
      onNotice(`已移除模型 ${modelId}`);
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setSwitchingModel(null);
    }
  }

  /** 添加或更新供应商下的一个模型配置（图二弹窗保存入口） */
  async function upsertProviderModel(providerId: string, model: ProviderModel) {
    try {
      const updated = await window.codex.upsertProviderModel({ provider: providerId, model });
      setProvidersList((current) => current.map((p) => p.provider === providerId ? { ...p, models: updated.models } : p));
      setCustomDraft((current) => ({ ...current, models: updated.models ?? current.models }));
      if (customModel?.provider === providerId) setCustomModel((current) => current ? { ...current, models: updated.models } : current);
      onNotice(`模型 ${model.id} 已保存`);
    } catch (error: any) {
      onNotice(error.message);
    }
  }

  /** 启用/禁用供应商；禁用当前供应商会清空生效配置 */
  async function setProviderEnabled(providerId: string, enabled: boolean) {
    try {
      const updated = await window.codex.setProviderEnabled({ provider: providerId, enabled });
      setProvidersList((current) => current.map((p) => p.provider === providerId ? { ...p, enabled: updated.enabled } : p));
      if (enabled) {
        setCurrentProvider(providerId);
        // 启用即生效（引擎层已互斥禁用其他供应商）：同步 customModel，否则中转站/OpenAI
        // 页的互斥判断还看着旧值，出现「全禁用死锁」——谁都开不了
        setCustomModel(updated);
        setCustomDraft((current) => ({ ...current, enabled: updated.enabled ?? true }));
      } else {
        if (currentProvider === providerId) {
          setCurrentProvider(null);
          // 停用当前生效供应商：清空生效状态（custom-model.json 已写 null），解锁其他供应商的启用
          setCustomModel(null);
        }
        setCustomDraft((current) => current.provider === providerId ? { ...current, enabled: updated.enabled ?? true } : current);
      }
      onNotice(enabled ? `已启用 ${updated.name}` : `已禁用 ${updated.name}`);
    } catch (error: any) {
      onNotice(error.message);
    }
  }

  /** 测试供应商下某个具体模型的连通性 */
  async function probeOneModel(providerId: string, modelId: string) {
    setSwitchingModel(modelId);
    setProviderStatus("");
    try {
      const result = await window.codex.probeCustomModel({ provider: providerId, baseUrl: customDraft.baseUrl, apiKey: customDraft.apiKey, model: modelId, wireApi: customDraft.wireApi ?? "responses" });
      setProviderStatus(`${modelId} 连接成功 · HTTP ${result.status} · ${result.latencyMs} ms${result.via === "stream" ? " · 实测请求连通" : " · 模型列表确认"}`);
      onProbeSuccess?.(`${modelId} 连接成功`, `HTTP ${result.status} · ${result.latencyMs} ms${result.via === "stream" ? " · 实测请求连通" : " · 模型列表确认"}`);
    } catch (error: any) {
      setProviderStatus(`${modelId} 连接失败：${error.message}`);
    } finally {
      setSwitchingModel(null);
    }
  }

  return {
    customModel,
    setCustomModel,
    customDraft,
    setCustomDraft,
    providersList,
    refreshActive,
    currentProvider,
    editingProvider,
    setEditingProvider,
    savingSettings,
    providerModels,
    modelSourceProvider,
    probingProvider,
    providerStatus,
    switchingModel,
    saveCustomModel,
    probeProvider,
    probeActiveProvider,
    selectProvider,
    removeProvider,
    setProviderModel,
    removeProviderModel,
    upsertProviderModel,
  setProviderEnabled,
  probeOneModel,
  adoptSavedProvider,
  saveCustomDraft,
};
}
