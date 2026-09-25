/**
 * usePart03c1 —— usePart03c 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：重启与文件预览编辑 · 并发上限与模型编辑器
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { matchModelSpec, loadExternalSpecs, formatTokenCount } from "../../../../../lib/model-specs";
import { performRelayLogin, resolveRelayAutoTarget, resolveRelayTarget, resolveRelayKeyTarget, writeRelayActive, readRelayActive, type RelayActive } from "../../../../../lib/relay";
import { OFFICIAL_MODELS } from "../../../../../lib/official-models";
import { useFilePreview } from "../../../../../hooks/useFilePreview";
import { effortLabels } from "../../../../../lib/effort-labels";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";
import type { usePart03b } from "../02-composer-memory-models";

export function usePart03c1(bag: Bag, ibB: ReturnType<typeof usePart03b>) {
  const { providerModels } = ibB;
  // 进入模型配置页直接展开「已配置好的（当前生效）供应商」，不再停在空白表单
  // ——用 ref 记账，页面关闭才复位，避免用户点「添加供应商」后被自动打开盖掉。
  const providerAutoOpenRef = useRef(false);
bag.providerAutoOpenRef = providerAutoOpenRef as typeof bag.providerAutoOpenRef;

  useEffect(() => {
    if (!bag.settingsOpen) { bag.providerAutoOpenRef.current = false; return; }
    if (bag.settingsPage !== "model" || bag.providerAutoOpenRef.current || bag.editingProvider || !bag.customModel) return;
    const target = bag.providersList.find((entry) => entry.provider === bag.customModel!.provider);
    if (!target) return;
    bag.providerAutoOpenRef.current = true;
    bag.setEditingProvider(target.provider);
    bag.setCustomDraft({ provider: target.provider, name: target.name, model: target.model, baseUrl: target.baseUrl, contextWindow: String(target.contextWindow ?? 128000), wireApi: target.wireApi ?? "responses", apiKey: "", models: target.models ?? (target.model ? [{ id: target.model }] : []), enabled: target.enabled ?? true });
  }, [bag.settingsOpen, bag.settingsPage, bag.customModel, bag.providersList, bag.editingProvider]);

  // 供应商切换「待重启生效」：切换只保存配置不重启引擎（不打断正在运行的会话），
  // 用户点 banner 的「重启生效」或下次启动时才让新供应商生效。生效前消息继续用原供应商。
  const [pendingRestart, setPendingRestart] = useState<{ provider: string; model: string; label: string; prevProvider: string; prevModel: string } | null>(null);
bag.pendingRestart = pendingRestart as typeof bag.pendingRestart; bag.setPendingRestart = setPendingRestart as typeof bag.setPendingRestart;

  const pendingRestartRef = useRef(bag.pendingRestart);
bag.pendingRestartRef = pendingRestartRef as typeof bag.pendingRestartRef;

  bag.pendingRestartRef.current = bag.pendingRestart;

  // 中转站一键切换：复用已有 key（按分组匹配）或新建 → 生成/更新供应商 → 选中生效。
  // 失败时抛回给调用方（中转站页面常驻显示错误），relay-active 只在全部成功后写入。
  const relayActivate = useCallback(async (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }, retried = false): Promise<void> => {
    bag.setRelayBusy(true);
    try {
      const resolved = explicitKey ? await resolveRelayKeyTarget(explicitKey) : await resolveRelayTarget(mode, group);
      let probeError: string = "";
      try {
        const probe = await window.codex.probeCustomModel({ provider: resolved.provider, baseUrl: resolved.gateway, apiKey: resolved.apiKey, wireApi: "responses" });
        const models: string[] = probe?.models ?? [];
        if (!models.length) throw new Error("网关探测不到可用模型，请检查站点地址");
        // 优选通用对话/代码模型，避免默认选中 auto-review 之类的附属模型
        const defaultModel = models.find((mid: string) => /gpt|codex|claude|gemini|deepseek|grok/i.test(mid) && !/auto-review/i.test(mid))
          || models.find((mid: string) => !/image|embedding|moderation|audio|tts|whisper|auto-review/i.test(mid))
          || models[0];
        const saved = await window.codex.saveCustomModel({
          provider: resolved.provider,
          name: resolved.displayName,
          model: defaultModel,
          baseUrl: resolved.gateway,
          contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 256000,
          wireApi: "responses",
          apiKey: resolved.apiKey,
          // 模型参数同步内置规格表（userData/model-specs.json 优先）：上下文/最大输出/思考档位/视觉模态
          models: models.map((mid: string) => {
            const spec = matchModelSpec(mid);
            return {
              id: mid,
              contextWindow: spec?.contextWindow ?? 256000,
              maxOutputTokens: spec?.maxOutputTokens,
              // 思考档位：规格表**明确声明过**的按声明（官方支持范围），没声明的一律**全档**
              // （09-17 用户：「新建供应商…都模型全选吧，可以勾掉」）。旧兜底是死写三档
              // 低/中/高，新建出来的模型只有三档可选，用户得逐个进编辑器补勾。
              efforts: spec?.efforts?.length ? [...spec.efforts] : [...ALL_EFFORTS],
              inputTypes: spec?.inputTypes ?? (["text"] as ("text" | "image" | "video")[]),
              outputTypes: spec?.outputTypes ?? (["text"] as ("text" | "image" | "video")[]),
            };
          }),
          enabled: true,
        });
        const id = `custom:${saved.provider}:${saved.model}`;
        bag.setModelId(id);
        bag.applyGlobalModelChoice(id);
        bag.adoptSavedProvider(saved, models);
        // switchedAt 标记本次切换时刻：即便同网关不同账号复用同一 provider 字符串，
        // 也能让输入框余额徽标、模型配置等下游 UI 强制跟着刷新，避免「切换了但没反应」。
        const active: RelayActive = { ...resolved.active, switchedAt: Date.now() };
        bag.setRelayActive(active);
        writeRelayActive(active);
        bag.setNotice(`已切换：${resolved.displayName} · 模型 ${defaultModel}`);
        // 中转站一键切换已立即重启引擎生效：清掉可能残留的「待重启生效」banner
        bag.setPendingRestart(null);
        // 互斥落盘在主进程 save handler 里做了（其他供应商 enabled=false），这里刷新
        // 渲染层供应商列表，模型设置页立即反映「只有本中转站供应商是启用态」。
        void bag.refreshActive();
      } catch (error: any) {
        probeError = String(error?.message ?? error);
        // 部分站点（如 pptoken）要求 key 必须绑定分组：无分组 key 直接 403。自动改绑第一个订阅分组重试一次。
        if (!retried && resolved.active.groupId == null && /HTTP 40[13]|assigned to any group|分组/.test(probeError)) {
          const ov = await window.codex.relayOverview().catch(() => null);
          const subs: any[] = ov?.subscriptions ?? [];
          if (subs.length) {
            const fallback = { group_id: Number(subs[0].group_id), group_name: String(subs[0].group_name ?? "默认分组") };
            bag.setNotice(`该站点要求密钥必须绑定分组，已自动改绑「${fallback.group_name}」重试…`);
            await relayActivate("plan", fallback, undefined, true);
            return;
          }
        }
        throw error;
      }
    } catch (error: any) {
      const message = "中转站切换失败：" + (error.message ?? error);
      bag.setNotice(message);
      throw new Error(error.message ?? error);
    } finally {
      bag.setRelayBusy(false);
    }
  }, [bag.adoptSavedProvider, bag.refreshActive, bag.setNotice, bag.setModelId]);
bag.relayActivate = relayActivate as typeof bag.relayActivate;

  // 启用 OpenAI 官方订阅：伪供应商 openai-official（引擎不写 model_provider，走 auth.json ChatGPT 凭据）
  const activateOfficialProvider = useCallback(async (modelsInput?: string[]) => {
    // 代理先落盘再触发引擎重启（顺序敏感：applyCustomModel 读文件注入引擎环境）
    await window.codex.openaiSetProxy(localStorage.getItem("openai-proxy") ?? "").catch(() => undefined);
    // 模型列表优先从官方接口拉真实的（跟随官方更新），失败才用静态兜底表
    const models = (modelsInput?.length ? modelsInput : await window.codex.openaiModels().catch(() => OFFICIAL_MODELS));
    const defaultModel = models[0];
    const saved = await window.codex.saveCustomModel({
      provider: "openai-official",
      name: "OpenAI 官方订阅",
      model: defaultModel,
      baseUrl: "https://chatgpt.com/backend-api/codex",
      contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 400_000,
      wireApi: "responses",
      models: models.map((mid: string) => {
        const spec = matchModelSpec(mid);
        return {
          id: mid,
          contextWindow: spec?.contextWindow ?? 400_000,
          maxOutputTokens: spec?.maxOutputTokens,
          // 同上一处：规格表明确声明过按声明，没声明的一律全档（09-17 用户「都模型全选吧，可以勾掉」）
          efforts: spec?.efforts?.length ? [...spec.efforts] : [...ALL_EFFORTS],
          inputTypes: spec?.inputTypes ?? (["text"] as ("text" | "image" | "video")[]),
          outputTypes: ["text"] as ("text" | "image" | "video")[],
        };
      }),
      enabled: true,
    });
    const id = `custom:${saved.provider}:${saved.model}`;
    bag.setModelId(id);
    bag.applyGlobalModelChoice(id);
    bag.adoptSavedProvider(saved, models);
    bag.setNotice(`已启用 OpenAI 官方订阅 · 模型 ${defaultModel}`);
  }, [bag.adoptSavedProvider, bag.setNotice, bag.setModelId]);
bag.activateOfficialProvider = activateOfficialProvider as typeof bag.activateOfficialProvider;

  // 外部模型规格（userData/model-specs.json）启动装载一次：数据与代码分离，更新模型数据无需重新构建
  useEffect(() => { void loadExternalSpecs(); }, []);

  // 启动时把 localStorage 里的 OpenAI 代理种子进主进程（引擎/官方接口要用），不依赖重新登录
  useEffect(() => {
    const proxy = localStorage.getItem("openai-proxy");
    if (proxy) void window.codex.openaiSetProxy(proxy).catch(() => undefined);
  }, []);

  // 兼容旧版本：本机已有安全保存的 API Key，但还没有登录状态标记时，自动进入主界面。
  // 明确点过“退出登录”会写 logout，不走这里。
  useEffect(() => {
    if (!bag.customModel?.hasKey) return;
    const state = localStorage.getItem("login-skipped");
    if (state == null) {
      localStorage.setItem("login-skipped", "false");
      bag.setShowLogin(false);
    }
  }, [bag.customModel?.hasKey]);

  // 欢迎页副语：使用内置文案池（按时段随机），温暖不烧 token；AI 生成机制已移除
  // （曾经的隐藏线程方案会在会话列表残留「欢迎语指令」线程，且每天启动都烧一次模型调用）

  const {
    filePreview, setFilePreview, fileTabs, closeTab, fileEditing, setFileEditing,
    fileDraft, setFileDraft, savingFile, openFile: rawOpenFile, saveFilePreview,
  } = useFilePreview({ workspace: bag.workspace, onNotice: bag.setNotice });
bag.filePreview = filePreview as typeof bag.filePreview; bag.setFilePreview = setFilePreview as typeof bag.setFilePreview; bag.fileTabs = fileTabs as typeof bag.fileTabs; bag.closeTab = closeTab as typeof bag.closeTab; bag.fileEditing = fileEditing as typeof bag.fileEditing; bag.setFileEditing = setFileEditing as typeof bag.setFileEditing; bag.fileDraft = fileDraft as typeof bag.fileDraft; bag.setFileDraft = setFileDraft as typeof bag.setFileDraft; bag.savingFile = savingFile as typeof bag.savingFile; bag.rawOpenFile = rawOpenFile as typeof bag.rawOpenFile; bag.saveFilePreview = saveFilePreview as typeof bag.saveFilePreview;

  // 包装一层：用户每次点文件卡都顺手把项目树高亮打到对应条目上；
  // 若路径是相对/裸文件名，则尝试拼 workspace 变成绝对路径再读（引擎解析相对路径基准是 cwd，裸文件名会读不到）
  const openFile = useCallback((path: string) => {
    let resolved = path;
    const looksRelative = !/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("/") && !path.startsWith("~/");
    if (looksRelative && bag.workspace) {
      const sep = bag.workspace.includes("\\") ? "\\" : "/";
      resolved = `${bag.workspace.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
    }
    bag.setHighlightedFilePath(resolved);
    // 联动：自动切到项目树面板，展开文件所在目录（树形模式下父目录惰性加载+展开，不动 root）
    const dir = resolved.replace(/[\\/][^\\/]+$/, "");
    if (dir) {
      void bag.fetchChildren(dir);
      bag.setTreeExpanded((current) => { const next = new Set(current); next.add(dir); return next; });
    }
    bag.setRightTab("tree");
    bag.setRightOpen(true);
    return bag.rawOpenFile(resolved);
  }, [bag.rawOpenFile, bag.workspace, bag.treePath]);
bag.openFile = openFile as typeof bag.openFile;

  // 档位一律**全集**（09-18 用户：「把模型配置里面思考选择删了，每个独立会话选择那个就生效那个」）：
  // 不再按模型条目声明过滤菜单 —— 档位是**会话级**选择，选哪个落到当前会话；
  // 模型/网关真不支持某档时由发送失败自动学会并降档（src/lib/effort-support.ts），
  // 而不是让用户先去模型配置里勾掉。
  const customModelEfforts: string[] = [...ALL_EFFORTS];
bag.customModelEfforts = customModelEfforts as typeof bag.customModelEfforts;

  const customModelOption: Model | null = bag.customModel ? {
    id: `custom:${bag.customModel.provider}:${bag.customModel.model}`,
    model: bag.customModel.model,
    displayName: `${bag.customModel.name} · ${bag.customModel.model}`,
    description: bag.customModel.baseUrl,
    supportedReasoningEfforts: bag.customModelEfforts.map((reasoningEffort) => ({ reasoningEffort, description: effortLabels[reasoningEffort] ?? reasoningEffort })),
    defaultReasoningEffort: DEFAULT_EFFORT,
    supportsPersonality: true,
    isDefault: false,
  } : null;
bag.customModelOption = customModelOption as typeof bag.customModelOption;

  const allModels = useMemo(() => {
    // 下拉框展示「所有启用供应商」的模型（不再只显示当前生效供应商）：
    // - 生效供应商的模型排最前（保留用户已配置顺序）
    // - 其他启用供应商的模型跟在后面，用「供应商名 · 模型」区分
    // - 每个模型 id 形如 `custom:<provider>:<model>`，跨供应商切换走 chooseModel
    const out: Model[] = [];
    const seen = new Set<string>();
    const effortsOf = (providerModels: ProviderModelConfig[] | undefined, modelId: string): { reasoningEffort: string; description: string }[] => {
      return declaredModelEfforts((providerModels ?? []).find((m) => m.id === modelId)?.efforts)
        .map((reasoningEffort) => ({ reasoningEffort, description: effortLabels[reasoningEffort] ?? reasoningEffort }));
    };
    const pushModels = (provider: string, providerName: string, providerModels: ProviderModelConfig[] | undefined, modelIds: (string | undefined)[], isActive: boolean) => {
      for (const model of modelIds) {
        if (!model || seen.has(model)) continue;
        seen.add(model);
        const modelMeta = (providerModels ?? []).find((m) => m.id === model);
        const spec4Badges = matchModelSpec(model);
        out.push({
          ...(bag.customModelOption ?? { id: "", displayName: "", description: "", supportsPersonality: true, isDefault: false }),
          id: `custom:${provider}:${model}`,
          model,
          provider,
          providerName,
          isActive,
          displayName: isActive ? model : `${providerName} · ${model}`,
          description: providerName + (isActive ? "" : "（非当前供应商）"),
          supportedReasoningEfforts: effortsOf(providerModels, model),
          defaultReasoningEffort: bag.customModelOption?.defaultReasoningEffort ?? DEFAULT_EFFORT,
          inputTypes: modelMeta?.inputTypes ?? spec4Badges?.inputTypes,
          contextWindow: modelMeta?.contextWindow ?? spec4Badges?.contextWindow,
          maxOutputTokens: modelMeta?.maxOutputTokens ?? spec4Badges?.maxOutputTokens,
        });
      }
    };
    // 当前生效供应商：models 列表 + 生效 model（排最前）
    const activeProvider = bag.customModel?.provider;
    const activeModels = [...new Set([...(bag.customModel?.models ?? []).filter((m) => m.enabled !== false).map((m) => m.id), bag.customModel?.model].filter(Boolean))] as string[];
    if (activeModels.length) pushModels(activeProvider ?? "custom", bag.customModel?.name ?? "自定义供应商", bag.customModel?.models, activeModels, true);
    // 其他启用供应商：providersList 里 enabled !== false 且 provider !== 当前
    for (const p of bag.providersList) {
      if (p.provider === activeProvider) continue;
      if (p.enabled === false) continue;
      const models = [...new Set([...(p.models ?? []).filter((m) => m.enabled !== false).map((m) => m.id), p.model].filter(Boolean))] as string[];
      if (models.length) pushModels(p.provider, p.name, p.models, models, false);
    }
    // 没有已配置模型时回退到探测到的模型列表
    if (!out.length && providerModels?.length) {
      for (const model of [...new Set(providerModels)].slice(0, 20)) pushModels(bag.customModel?.provider ?? "custom", bag.customModel?.name ?? "自定义供应商", undefined, [model], true);
    }
    return out;
  }, [providerModels, bag.customModel, bag.customModelOption, bag.providersList]);
bag.allModels = allModels as typeof bag.allModels;
  return { providerAutoOpenRef, pendingRestart, setPendingRestart, pendingRestartRef, relayActivate, activateOfficialProvider, filePreview, setFilePreview, fileTabs, closeTab, fileEditing, setFileEditing, fileDraft, setFileDraft, savingFile, rawOpenFile, saveFilePreview, openFile, customModelEfforts, customModelOption, allModels };
}
