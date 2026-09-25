/**
 * usePart03c2 —— usePart03c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：重启与文件预览编辑 · 并发上限与模型编辑器
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { matchModelSpec, loadExternalSpecs, formatTokenCount } from "../../../../../lib/model-specs";
import { concurrencyExceeded, DEFAULT_MAX_CONCURRENCY, normalizeMaxConcurrency } from "../../../../../lib/concurrency.mjs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart03c2(bag: Bag) {
  // 模型兜底：当前选择不在可用列表里时（如曾选中探测出来的无效模型），自动回落到
  // 已配置的默认模型，避免 turn/start 带上无效模型导致引擎不回复。
  // 这里**只改内存里的当前选择，不落任何持久化**：供应商列表是异步加载的，加载完成前
  // allModels 里只有生效供应商的模型，此时「不在列表里」并不等于模型无效；一旦落盘，会把
  // 用户刚改的全局默认、以及会话自己记着的模型一起冲掉（「切换的模型没生效」的隐藏来源）。
  useEffect(() => {
    if (!bag.customModel?.model) return;
    if (bag.allModels.some((entry) => entry.id === bag.modelId || entry.model === bag.modelId)) return;
    bag.setModelId(`custom:${bag.customModel.provider}:${bag.customModel.model}`);
  }, [bag.customModel, bag.allModels, bag.modelId]);

  // 档案 100% 同步（09-11「切换的不够干净，必须 100% 同步」）：custom-model.json 顶层
  // model 是模型自查「我是什么模型」的依据，也是 config.toml 顶层 model 的源头；它滞后于
  // 当前选择时模型自报就会撒谎（实测：引擎已跑新模型，模型却自报旧模型）。这里盯着内存里
  // 的当前选择 modelId（= 打开的会话自己的模型，或无会话时的全局默认）：指向生效供应商的
  // 某个模型而档案还停在旧值（旧版本遗留 / 从别的端改过）→ 就地写齐档案 + config.toml。
  // restart:false 不重启引擎、不碰在跑的回合。同一次对账只写一次，
  // 防止与 chooseModel 里的直接写重复落盘。
  const archiveSyncRef = useRef<string>("");
bag.archiveSyncRef = archiveSyncRef as typeof bag.archiveSyncRef;

  useEffect(() => {
    // ⛔ 多会话/多窗口作用域（09-14 用户实测「模型还是串全局的」的**次因**）：
    // 有会话打开时 `modelId` 是**该会话自己**的模型，绝不能拿它去写全局档案
    // （setProviderModel 会就地改写 custom-model.json 顶层 model + config.toml 顶层 model +
    //  model-catalog.json）。而「模型自查我是谁」读的正是这两处 → 写进去之后，别的会话
    // （或另一个弹窗）自报的模型就变成这个会话的模型，两个窗口还会互相覆盖。
    // 用户定稿的规则：全局档案只在「无会话时选默认」「跨供应商切换」两条路径上更新。
    // 这条对账从此只负责**无会话时的遗留漂移修正**（modelId 此时就等于全局默认）。
    if (bag.threadRef.current?.id) return;
    const provider = bag.customModel?.provider;
    if (!provider || !bag.customModel?.model) return;
    const match = bag.modelId.match(/^custom:([^:]+):(.+)$/);
    if (!match || match[1] !== provider || match[2] === bag.customModel.model) return;
    const stamp = `${match[1]}:${match[2]}`;
    if (bag.archiveSyncRef.current === stamp) return;
    bag.archiveSyncRef.current = stamp;
    void window.codex
      .setProviderModel({ provider, model: match[2], apply: true, restart: false })
      .catch(() => { bag.archiveSyncRef.current = ""; });
  }, [bag.customModel, bag.modelId, bag.thread?.id]);

  // 思考等级对账（与上面模型对账同型）：档案里记了当前生效模型的档位、而当前上下文
  // 没有更具体的显式值（会话无 thread-effort 记录）→ 应用档案档位。用户在会话里显式
  // 选过档位时以会话记录为准（每会话独立优先级，与 model 的规则一致）。
  useEffect(() => {
    const archived = bag.customModel?.effort;
    if (!archived) return;
    const tid = bag.threadRef.current?.id;
    if (tid && loadThreadEffort(tid)) return;
    bag.setEffort((current) => normalizeEffort(current) === archived ? current : archived);
  }, [bag.customModel?.effort, bag.customModel?.model, bag.thread?.id]);

  // 供应商下已配置的模型清单：已保存的 models + 输入框里尚未保存的那个
  // probe 拉到的可用模型只属于探测时的那家供应商，换供应商后不再用于补全
  const modelSuggestions = bag.modelSourceProvider === bag.customDraft.provider ? (bag.providerModels ?? []) : [];
bag.modelSuggestions = modelSuggestions as typeof bag.modelSuggestions;

  // ── 并发闸门（09-19 加该旋钮；09-25 用户要求默认值 3 → 10 = 上限，仍可在界面调到 1~10）──
  // ⛔ 根因：限流是**同一个 API Key 的共享配额**。实测（引擎 TRACE 日志）6 分钟内 4 个会话
  //   同时打上游 **333 次**请求 ⇒ 配额瞬间打满 ⇒ 429 爆发。
  //   这里把"同时在跑的会话数"限制在该供应商配置的上限内：超限时**不放行**并明确告知原因
  //   （不静默排队 —— 静默排队会让用户以为卡死，且 send 路径的挂起容易引入状态机 bug）。
  // ⛔ 与「会话完全独立」不冲突：会话的**状态**依然各自独立（互不读写）；
  //   这里限制的是**共享资源（Key 配额）的调度**，属于物理约束，不是状态耦合。
  const maxConcurrencyRef = useRef(DEFAULT_MAX_CONCURRENCY);
bag.maxConcurrencyRef = maxConcurrencyRef as typeof bag.maxConcurrencyRef;

  bag.maxConcurrencyRef.current = normalizeMaxConcurrency(bag.customModel?.maxConcurrency);

  /** 该供应商允许的最大并发（当前生效值，供界面显示） */
  const maxConcurrency = bag.maxConcurrencyRef.current;
bag.maxConcurrency = maxConcurrency as typeof bag.maxConcurrency;

  /** 除指定会话外，当前有几个会话在跑 */
  function runningCountExcept(threadId?: string): number {
    let n = 0;
    for (const id of bag.runningThreadIdsRef.current) if (id !== threadId) n++;
    return n;
  }
bag.runningCountExcept = runningCountExcept as typeof bag.runningCountExcept;

  /** 是否已达并发上限（判据在 src/lib/concurrency.mjs，纯函数、可被离线预检确定性覆盖） */
  function atConcurrencyLimit(threadId?: string): boolean {
    return concurrencyExceeded({
      runningCount: bag.runningCountExcept(threadId),
      maxConcurrency: bag.maxConcurrencyRef.current,
      threadAlreadyRunning: Boolean(threadId) && bag.runningThreadIdsRef.current.has(threadId as string),
    });
  }
bag.atConcurrencyLimit = atConcurrencyLimit as typeof bag.atConcurrencyLimit;

  /** 统一的超限提示（send / 编辑重发 / 排队启动 / 限流重试 共用一套说法） */
  function notifyConcurrencyLimit(threadId?: string): void {
    const used = bag.runningCountExcept(threadId);
    bag.showToast(
      "已达并发上限，未发送",
      `该供应商最多同时运行 ${bag.maxConcurrencyRef.current} 个任务（当前 ${used} 个在跑）。` +
      `等其中一个完成再发，或到「设置 → 模型 → 供应商」把「最大并发」调大。`,
    );
  }
bag.notifyConcurrencyLimit = notifyConcurrencyLimit as typeof bag.notifyConcurrencyLimit;

  // —— 模型设置页（图一/图二排版）状态 ——
  const [modelEditor, setModelEditor] = useState<{ mode: "add" | "edit"; originalId: string | null; paramsDirty?: boolean; draft: { id: string; contextWindow: string; maxOutputTokens: string; inputTypes: ("text" | "image" | "video")[]; outputTypes: ("text" | "image" | "video")[] } } | null>(null);
bag.modelEditor = modelEditor as typeof bag.modelEditor; bag.setModelEditor = setModelEditor as typeof bag.setModelEditor;

  const [showApiKey, setShowApiKey] = useState(false);
bag.showApiKey = showApiKey as typeof bag.showApiKey; bag.setShowApiKey = setShowApiKey as typeof bag.setShowApiKey;

  // ⛔ 这里曾有一个 editingName state（顶部重命名供应商用）；09-17 名字挪到表单字段后它没用了。
  //    注意：editingProvider/setEditingProvider 是**从上面的 useCustomProviders() 解构来的**，
  //    不要在这个位置再 useState 定义一次（会重复声明）。
  /** 模型 ID 变化 → 按内置规格回填上下文 / 最大输出 / 输入输出模态。
   *  ⛔ 用函数式 setState：Tab 补全会让 id 一次跳一长串，若沿用闭包里的 modelEditor，
   *    同一 tick 内落地的两次更新会互相覆盖（补全后参数没回填就是这么来的）。
   *  ⛔ 用户手动改过参数（paramsDirty）就不再自动覆盖，第一次填错型号也能改回来。
   *  ⛔ 不动思考档位：档位纯会话级（09-18），规格表里的 efforts 一律不读。 */
  const applyModelIdInput = (id: string) => {
    bag.setModelEditor((editor) => {
      if (!editor) return editor;
      const spec = matchModelSpec(id);
      if (spec && !editor.paramsDirty) {
        return {
          ...editor,
          draft: {
            ...editor.draft,
            id,
            contextWindow: String(spec.contextWindow),
            maxOutputTokens: spec.maxOutputTokens ? String(spec.maxOutputTokens) : "",
            inputTypes: [...(spec.inputTypes ?? ["text"])],
            outputTypes: [...(spec.outputTypes ?? ["text"])],
          },
        };
      }
      return { ...editor, draft: { ...editor.draft, id } };
    });
  };
bag.applyModelIdInput = applyModelIdInput as typeof bag.applyModelIdInput;

  const openModelEditor = (m?: { id: string; contextWindow?: number; maxOutputTokens?: number; inputTypes?: ("text" | "image" | "video")[]; outputTypes?: ("text" | "image" | "video")[] }) => bag.setModelEditor({
    mode: m ? "edit" : "add",
    originalId: m?.id ?? null,
    paramsDirty: false,
    draft: {
      id: m?.id ?? "",
      contextWindow: String(m?.contextWindow ?? (Number(bag.customDraft.contextWindow) || 128000)),
      maxOutputTokens: m?.maxOutputTokens ? String(m.maxOutputTokens) : "",
      inputTypes: m?.inputTypes ?? ["text"],
      outputTypes: m?.outputTypes ?? ["text"],
      // 档位不再属于模型条目（09-18：档位纯会话级，见 EffortPicker）——这里不要再加 efforts
    },
  });
bag.openModelEditor = openModelEditor as typeof bag.openModelEditor;

  // 编辑器标题里显示的供应商名：编辑已存供应商时显示它的名字，防止同名模型改错供应商
  const targetProviderHint = bag.modelEditor?.originalId && (bag.customModel?.models ?? []).some((m) => m.id === bag.modelEditor!.originalId) && bag.customModel?.provider !== bag.customDraft.provider ? bag.customModel?.name : "";
bag.targetProviderHint = targetProviderHint as typeof bag.targetProviderHint;

  const saveModelEditor = async () => {
    if (!bag.modelEditor) return;
    const id = bag.modelEditor.draft.id.trim();
    if (!id) { bag.setNotice("模型 ID 不能为空"); return; }
    // 编辑「已保存供应商」的模型时（含输入框「更多」直达的编辑弹窗），editingProvider
    // 可能为空——此时按 originalId 归属回落到 customModel 的供应商，否则只进本地草稿、
    // 永远不持久化（表现：勾了最高保存后，思考菜单里不出现该档位，2026-09-04 反馈）。
    const targetProvider = bag.editingProvider ?? ((bag.modelEditor.originalId && (bag.customModel?.models ?? []).some((m) => m.id === bag.modelEditor!.originalId)) ? bag.customModel!.provider : null);
    if (bag.modelEditor.mode === "edit" && bag.modelEditor.originalId && bag.modelEditor.originalId !== id) await bag.removeProviderModel(targetProvider ?? bag.customDraft.provider, bag.modelEditor.originalId);
    if (targetProvider) {
      await bag.upsertProviderModel(targetProvider, {
        id,
        contextWindow: Number(bag.modelEditor.draft.contextWindow) || undefined,
        maxOutputTokens: Number(bag.modelEditor.draft.maxOutputTokens) || undefined,
        inputTypes: bag.modelEditor.draft.inputTypes,
        outputTypes: bag.modelEditor.draft.outputTypes,
        // ⛔ 不再写 efforts（09-18：档位不再是模型条目的属性，纯会话级）
      });
      bag.setModelEditor(null);
      return;
    }
    // 新供应商还没保存：合并出完整草稿直接持久化——一次保存即生效，不再要求外层再点一次保存
    const model: ProviderModelConfig = {
      id,
      enabled: true,
      contextWindow: Number(bag.modelEditor.draft.contextWindow) || undefined,
      maxOutputTokens: Number(bag.modelEditor.draft.maxOutputTokens) || undefined,
      inputTypes: bag.modelEditor.draft.inputTypes,
      outputTypes: bag.modelEditor.draft.outputTypes,
      // ⛔ 不再写 efforts（09-18：档位不再是模型条目的属性，纯会话级；
      //    模型不支持的档位由发送失败时自动学习，见 src/lib/effort-support.mjs）
    };
    // ⛔ 去重（09-18 用户实测「点删除删掉的是另一个」）：原实现只按 originalId 过滤，
    //   于是「添加模型 / 把模型改名成一个已存在的 id」会在草稿里留下**两份同 id 条目**。
    //   而列表渲染用的是去重后的数组（`unique`，只显示第一条），删除/批量删除却作用在
    //   **全部同 id 副本**上 —— 你看到的那一行与实际被删的不是同一个东西（表现为
    //   「没勾选的删不掉 / 删一次却把勾选的那个带走了」）。这里按 id 归一（同名覆盖），
    //   与主进程 upsertProviderModel 的语义一致。
    const duplicated = (bag.customDraft.models ?? []).some((m) => m.id === id && m.id !== bag.modelEditor!.originalId);
    if (duplicated) bag.showToast("已按同名覆盖", `「${id}」已在模型列表中——本次保存会覆盖它（不会产生重复条目）。`);
    const mergedDraft = { ...bag.customDraft, models: [...(bag.customDraft.models ?? []).filter((m) => m.id !== bag.modelEditor!.originalId && m.id !== id), model] };
    bag.setCustomDraft(mergedDraft);
    bag.setModelEditor(null);
    void bag.saveCustomDraft(mergedDraft);
  };
bag.saveModelEditor = saveModelEditor as typeof bag.saveModelEditor;

  const selectedModel = bag.allModels.find((entry) => entry.id === bag.modelId || entry.model === bag.modelId);
bag.selectedModel = selectedModel as typeof bag.selectedModel;
  return { archiveSyncRef, modelSuggestions, maxConcurrencyRef, maxConcurrency, runningCountExcept, atConcurrencyLimit, notifyConcurrencyLimit, modelEditor, setModelEditor, showApiKey, setShowApiKey, applyModelIdInput, openModelEditor, targetProviderHint, saveModelEditor, selectedModel };
}
