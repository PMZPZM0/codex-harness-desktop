import { useEffect, useState } from "react";
import { DEFAULT_EFFORT } from "../lib/effort";

export type ProviderModel = { id: string; enabled?: boolean; contextWindow?: number; maxOutputTokens?: number; inputTypes?: ("text" | "image" | "video")[]; outputTypes?: ("text" | "image" | "video")[]; efforts?: string[] };

export type CustomModel = { provider: string; name: string; model: string; baseUrl: string; contextWindow?: number; wireApi?: "responses" | "chat"; hasKey?: boolean; models?: ProviderModel[]; enabled?: boolean };

export type ProviderDraft = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: string;
  wireApi: "responses" | "chat";
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
  wireApi?: "responses" | "chat";
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

export function useModelProviders({ onAutoSelect, onSelect, onNotice, onProbeSuccess }: Options) {
  const [customModel, setCustomModel] = useState<CustomModel | null>(null);
  const [customDraft, setCustomDraft] = useState<ProviderDraft>({ provider: "custom", name: "Custom Provider", model: "", baseUrl: "", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: true });
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
      onSelect(`custom:${saved.provider}:${saved.model}`, DEFAULT_EFFORT);
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
    setSavingSettings(true);
    try {
      const dedupedDraft = { ...customDraft, models: dedupModels(customDraft.models) };
      const enabled = dedupedDraft.models.filter((model) => model.enabled !== false);
      // 配置界面不展示“默认模型”；引擎仍需要一个当前模型作为启动入口，
      // 有勾选模型时仅在保存时内部选择第一项；允许供应商暂时没有模型。
      const effectiveModel = enabled.length === 0 ? "" : enabled.some((model) => model.id === dedupedDraft.model) ? dedupedDraft.model : enabled[0].id;
      const saved = await window.codex.saveCustomModel({ ...dedupedDraft, model: effectiveModel });
      adoptSavedProvider(saved);
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
              if (!existing.has(id)) merged.push({ id, enabled: true, contextWindow: Number(current.contextWindow) || undefined });
            }
            // 探测只更新候选列表，不替用户指定“默认模型”；勾选状态由用户统一决定。
            return { ...current, models: merged };
          });
        }
      }
      setProviderStatus(mode === "test" ? `连接成功 · HTTP ${result.status} · ${result.latencyMs} ms · ${result.models.length} 个模型` : `已获取 ${result.models.length} 个模型${result.via === "stream" ? "（网关未提供 /models，已实测模型连通）" : ""}，勾选要生效的模型后保存`);
      // 成功弹 toast 醒目提醒（状态行小字保留作留痕）
      onProbeSuccess?.(
        mode === "test" ? "连接成功" : "模型列表已获取",
        mode === "test"
          ? `${customDraft.name || customDraft.provider} · HTTP ${result.status} · ${result.latencyMs} ms · ${result.models.length} 个模型可用`
          : `${customDraft.name || customDraft.provider} · ${result.models.length} 个模型${result.via === "stream" ? "（实测连通）" : ""}，勾选要生效的模型后保存`,
      );
    } catch (error: any) {
      setProviderStatus(`连接失败：${error.message}`);
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
      if (enabled) setCurrentProvider(providerId); else if (currentProvider === providerId) setCurrentProvider(null);
      setCustomDraft((current) => current.provider === providerId ? { ...current, enabled: updated.enabled ?? true } : current);
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
    selectProvider,
    removeProvider,
    setProviderModel,
    removeProviderModel,
    upsertProviderModel,
    setProviderEnabled,
    probeOneModel,
    adoptSavedProvider,
  };
}
