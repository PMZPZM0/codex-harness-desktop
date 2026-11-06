/**
 * 模型下拉的「可选模型」口径 —— 主对话与群聊共用。
 *
 * ⛔ 11-07 用户实测：群聊输入框下拉列出了 8 个模型，主对话只有 1 个。
 *   根因：群聊直接遍历 `listCustomModels().providers`，**没按 enabled 过滤**
 *   ⇒ 早就停用的旧供应商（cloud / wbm）的模型又冒出来了。
 *
 * 与主对话 `allModels` 完全同口径：
 *   ① 只列 `enabled !== false` 的供应商；
 *   ② 供应商内只列 `enabled !== false` 的模型，并补上该供应商当前的 `model`；
 *   ③ 生效供应商排最前；
 *   ④ 按**裸模型名**全局去重（同名模型跨供应商只出现一次）。
 */

/**
 * @param {Array<{provider?: string, name?: string, model?: string, enabled?: boolean, source?: string, models?: Array<{id?: string, enabled?: boolean, credits?: string, inputTypes?: string[], contextWindow?: number, maxOutputTokens?: number}>}>} providers
 * @param {string|null|undefined} current 当前生效供应商 id
 * @returns {Array<{modelId: string, provider: string, providerName: string, isActive: boolean, credits?: string, inputTypes?: string[], contextWindow?: number, maxOutputTokens?: number}>}
 */
export function collectModelChoices(providers, current) {
  const all = (Array.isArray(providers) ? providers : []).filter(Boolean);
  /* ⛔ 与主对话一致：**生效供应商即使被标停用也照常列出**（它此刻就是当前配置），
     其余供应商只列启用中的。 */
  const activeProvider = all.find((p) => p.provider === current) || null;
  const list = all.filter((p) => p.enabled !== false);
  const out = [];
  const seen = new Set();

  const pushProvider = (provider, isActive) => {
    if (!provider) return;
    const models = Array.isArray(provider.models) ? provider.models : [];
    const ids = [...new Set([
      ...models.filter((m) => m && m.enabled !== false).map((m) => String(m.id ?? "").trim()),
      String(provider.model ?? "").trim(),
    ].filter(Boolean))];
    for (const modelId of ids) {
      if (seen.has(modelId)) continue;
      seen.add(modelId);
      const meta = models.find((m) => m && m.id === modelId);
      /* 倍率只给账户登录自动生成的供应商（与主对话 allModels 同口径）。 */
      const sourceKind = provider.source ?? (provider.provider === "cloud" ? "cloud" : undefined);
      out.push({
        modelId,
        provider: String(provider.provider ?? ""),
        providerName: String(provider.name ?? provider.provider ?? ""),
        isActive: Boolean(isActive),
        credits: sourceKind === "cloud" || sourceKind === "relay" ? meta?.credits : undefined,
        inputTypes: meta?.inputTypes,
        contextWindow: meta?.contextWindow,
        maxOutputTokens: meta?.maxOutputTokens,
      });
    }
  };

  pushProvider(activeProvider, true);
  for (const provider of list) if (provider !== activeProvider) pushProvider(provider, false);
  return out;
}
