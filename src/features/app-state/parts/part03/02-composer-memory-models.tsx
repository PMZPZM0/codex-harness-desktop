/**
 * usePart03b（09-22：part03 按序切分出来的第 2 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../lib/effort";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../lib/prompt-images";
import { useMemory, type MemoryGatewayState, type MemoryGroup, type MemoryPriority, type MemoryRecord, groupMemoriesByThread } from "../../../../hooks/useMemory";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../components/scroll-utils";
import { useScheduler, emptyScheduleDraft } from "../../../../hooks/useScheduler";
import { useChannelBot, type ChannelDraft } from "../../../../hooks/useChannelBot";
import { useModelProviders, type UpstreamProtocol } from "../../../../hooks/useModelProviders";
import { installFocusReturn } from "../../../../lib/focus-return";
import { serializeComposerDom } from "../../../../lib/serialize-composer-dom";
import { basename } from "../../../../lib/basename";
import { QueuedMessageList, FoldHandlers, TurnFoldStream } from "../../../../features/session-queue";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Bag } from "../bag-types";

export function usePart03b(bag: Bag) {
  // 注意：这里曾有一个 `nowTick` 每秒 setState（原意给「已工作 X 秒」计时），但那个指示
  // 已删除、App 层再无任何读取点 → 唯一效果是**每秒强制 App 全量重渲染一次**
  // （App 是 1.1MB 单组件，多会话时 workStartedAt 几乎长期非空 = 常驻开销）。
  // 相对时间的显示由各子组件自持的 30s tick 负责，App 层不再需要。
  const scrollRef = useRef<HTMLDivElement>(null);
bag.scrollRef = scrollRef as typeof bag.scrollRef;

  const timelineWrapRef = useRef<HTMLDivElement>(null);
bag.timelineWrapRef = timelineWrapRef as typeof bag.timelineWrapRef;

  const searchRef = useRef<HTMLInputElement>(null);
bag.searchRef = searchRef as typeof bag.searchRef;

  const composerInputRef = useRef<HTMLDivElement>(null);
bag.composerInputRef = composerInputRef as typeof bag.composerInputRef;

  const composerWrapRef = useRef<HTMLDivElement>(null);
bag.composerWrapRef = composerWrapRef as typeof bag.composerWrapRef;

  // 编辑框 DOM 当前序列化结果：区分「用户输入回流」与「外部置值需重建」（见 ComposerEditor）
  const composerDomValueRef = useRef<string | null>(null);
bag.composerDomValueRef = composerDomValueRef as typeof bag.composerDomValueRef;

  // 输入框区块（多行撑高 / 计划审阅卡 / 队列卡 / 引用条 / 模式横幅）高度一变，
  // 消息区可视高度就被压缩——贴底跟随若不重申，底部回复会被裁在输入框上沿下
  //（用户看到的「输入框遮住消息」）。贴底时任何高度变化都立刻重新贴底；
  // 用户主动上滚（stick=false）则不打扰。
  useLayoutEffect(() => {
    const wrap = bag.composerWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // 空态（docked-center）输入框悬浮在欢迎页上，无消息可遮
      if (wrap.classList.contains("docked-center")) return;
      if (!bag.stickToBottomRef.current) return;
      const el = bag.scrollRef.current;
      if (!el) return;
      // ⛔ 落点必须走 contentTailTarget（= 内容底部，**不含**尾部留白），绝不能写 scrollHeight。
      // 这里是第二个 scrollTop owner，曾经踩实：钉顶期间用户多打一行（输入框撑高）→
      // 这个观察器按 scrollHeight 把视口推下去 64px~一整屏（推进留白），下一帧钉顶的
      // 几何纠偏又把它拉回 54px → 用户看到的就是**"下跳一下再上跳一下"**（09-13 审计确认）。
      // 钉顶进行中一律不碰滚动条：位置由 pinSentMessage 负责，这里插手就是抢 owner。
      if (bag.anchorTopRef.current) return;
      scrollToOffsetInstant(el, bag.contentTailTarget(el));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /** 生成内联附件 chip（图片 / 文件同款）：
   *  删除→清对应状态；图片点主体→预览、文件点主体→打开文件；任何变更→DOM 序列化回流状态。
   *  ⛔ 图片与文件共用这一个渲染器（用户要求"文件跟图片一样的展示"），别再分叉。 */
  const makeComposerChip = useCallback((kind: "image" | "file", path: string) => createInlineAttachmentChip(
    kind,
    path,
    (target) => { if (kind === "image") bag.setImages((current) => current.filter((entry) => entry !== target)); },
    (target) => {
      if (kind === "image") { bag.setLightbox({ path: target, alt: "待发送图片" }); return; }
      // 文件：**先问主进程"这是不是应用自己保存的粘贴文本"** —— 是就用可编辑的大窗口打开，
      // 不是（用户自己的文件）则走普通文件预览。⛔ 不靠路径前缀猜：猜错会把用户自己的 .txt
      // 当可编辑文件，一保存就改了他的文件。
      void (async () => {
        try {
          const info = await window.codex.readPastedText(target);
          if (info?.editable) { bag.setPastedText({ path: target, name: basename(target) }); return; }
        } catch { /* 判定失败就按普通文件处理 */ }
        bag.openFile(target);
      })();
    },
    () => bag.syncComposerFromDom(),
  ), []);
bag.makeComposerChip = makeComposerChip as typeof bag.makeComposerChip;

  /** 编辑框 DOM → 状态：序列化 prompt（images 跟随占位符，chip 被退格删除时同步收敛）。
   *  文件不必镜像状态 —— 它只以 [文件:path] 占位符存在，需要时用 promptFilePaths 现算。 */
  function syncComposerFromDom() {
    const el = bag.composerInputRef.current;
    if (!el) return;
    const next = serializeComposerDom(el);
    bag.composerDomValueRef.current = next;
    bag.setImages(promptImagePaths(next));
    bag.onPromptChange(next);
  }
bag.syncComposerFromDom = syncComposerFromDom as typeof bag.syncComposerFromDom;

  // 覆盖层焦点归还：设置页/删除确认框等遮罩关闭后，浏览器把焦点丢给 body，
  // 输入框随之失焦（表现为删除完回到对话框打字没反应）。统一在遮罩关闭时把焦点
  // 还给打开前的元素，卸载掉了就还给输入框；原生 confirm/alert 同样兜住。
  useEffect(() => {
    return installFocusReturn({
      doc: document,
      win: window as unknown as Record<string, unknown>,
      schedule: (callback) => requestAnimationFrame(() => callback()),
      getFallback: () => bag.composerInputRef.current,
    });
  }, []);

  // 消息操作回调走 ref 转发：身份永远稳定，memo 化的回合视图不会因回调重建而失效，
  // 同时内部始终读取最新闭包（thread/sending 等状态不会过期）
  const messageHandlersRef = useRef<FoldHandlers | null>(null);
bag.messageHandlersRef = messageHandlersRef as typeof bag.messageHandlersRef;

  bag.messageHandlersRef.current = {
    onCopy: (text) => void bag.copyMessage(text),
    onQuote: (text) => bag.quoteMessage(text),
    onImageCopy: (path) => void bag.copyImage(path),
    onFork: (turnId) => void bag.forkFromTurn(turnId),
    onEdit: (turnId, item) => void bag.editResend(turnId, item),
    onOpenFile: (path) => void bag.openFile(path),
    onOpenThread: (id) => void bag.openThread(id),
    // 计划可编辑构件的出口：把用户改后的计划**填进输入框**，不自动发送。
    // ⛔ 不自动发：立刻发会花掉一次模型调用，且用户可能还想接着改别的；填进输入框是可见、可撤销的
    //    （与项目里"不擅自动作"的一贯口径一致）。
    onApplyPlan: (markdown) => {
      bag.setPrompt(`我按你的计划做了这些修改，请以修改后的为准执行：\n\n${markdown}`);
      bag.showToast("计划已放入输入框", "确认后按回车发送给 Codex");
    },
  };

  const messageHandlers = useMemo<FoldHandlers>(() => ({
    onCopy: (text) => bag.messageHandlersRef.current?.onCopy(text),
    onQuote: (text) => bag.messageHandlersRef.current?.onQuote(text),
    onImageCopy: (path) => bag.messageHandlersRef.current?.onImageCopy(path),
    onFork: (turnId) => bag.messageHandlersRef.current?.onFork(turnId),
    onEdit: (turnId, item) => bag.messageHandlersRef.current?.onEdit(turnId, item),
    onOpenFile: (path) => bag.messageHandlersRef.current?.onOpenFile(path),
    onOpenThread: (id) => bag.messageHandlersRef.current?.onOpenThread?.(id),
    onApplyPlan: (markdown) => bag.messageHandlersRef.current?.onApplyPlan?.(markdown),
  }), []);
bag.messageHandlers = messageHandlers as typeof bag.messageHandlers;

  const {
    memoryEnabled, memories, setMemories, memoryCategory, setMemoryCategory, memorySaveCategory, setMemorySaveCategory, memorySavedAt,
    memoryDraft, setMemoryDraft, memoryStatus, setMemoryStatus,
    memoryGateway, setMemoryGateway, memoryGatewayAction,
    memoryMode, updateMemoryMode, workspaceMemoryEnabled, updateWorkspaceMemory,
    saveMemoryRecord, deleteMemoryRecord, deleteMemoryGroup, resetMemory,
    testMemoryGateway, saveMemoryGateway, setMemoryEnabled,
  } = useMemory({ threadId: bag.thread?.id, activeTurnId: bag.activeTurnId, workspace: bag.workspace });
bag.memoryEnabled = memoryEnabled as typeof bag.memoryEnabled; bag.memories = memories as typeof bag.memories; bag.setMemories = setMemories as typeof bag.setMemories; bag.memoryCategory = memoryCategory as typeof bag.memoryCategory; bag.setMemoryCategory = setMemoryCategory as typeof bag.setMemoryCategory; bag.memorySaveCategory = memorySaveCategory as typeof bag.memorySaveCategory; bag.setMemorySaveCategory = setMemorySaveCategory as typeof bag.setMemorySaveCategory; bag.memorySavedAt = memorySavedAt as typeof bag.memorySavedAt; bag.memoryDraft = memoryDraft as typeof bag.memoryDraft; bag.setMemoryDraft = setMemoryDraft as typeof bag.setMemoryDraft; bag.memoryStatus = memoryStatus as typeof bag.memoryStatus; bag.setMemoryStatus = setMemoryStatus as typeof bag.setMemoryStatus; bag.memoryGateway = memoryGateway as typeof bag.memoryGateway; bag.setMemoryGateway = setMemoryGateway as typeof bag.setMemoryGateway; bag.memoryGatewayAction = memoryGatewayAction as typeof bag.memoryGatewayAction; bag.memoryMode = memoryMode as typeof bag.memoryMode; bag.updateMemoryMode = updateMemoryMode as typeof bag.updateMemoryMode; bag.workspaceMemoryEnabled = workspaceMemoryEnabled as typeof bag.workspaceMemoryEnabled; bag.updateWorkspaceMemory = updateWorkspaceMemory as typeof bag.updateWorkspaceMemory; bag.saveMemoryRecord = saveMemoryRecord as typeof bag.saveMemoryRecord; bag.deleteMemoryRecord = deleteMemoryRecord as typeof bag.deleteMemoryRecord; bag.deleteMemoryGroup = deleteMemoryGroup as typeof bag.deleteMemoryGroup; bag.resetMemory = resetMemory as typeof bag.resetMemory; bag.testMemoryGateway = testMemoryGateway as typeof bag.testMemoryGateway; bag.saveMemoryGateway = saveMemoryGateway as typeof bag.saveMemoryGateway; bag.setMemoryEnabled = setMemoryEnabled as typeof bag.setMemoryEnabled;

  const memoryProjectOptions = useMemo(() => {
    const paths = new Set<string>();
    if (bag.workspace) paths.add(bag.workspace);
    for (const entry of bag.threads) if (entry.cwd) paths.add(entry.cwd);
    for (const entry of bag.memories) if (entry.workspace) paths.add(entry.workspace);
    return [...paths].sort((a, b) => basename(a).localeCompare(basename(b), "zh-CN") || a.localeCompare(b));
  }, [bag.memories, bag.threads, bag.workspace]);
bag.memoryProjectOptions = memoryProjectOptions as typeof bag.memoryProjectOptions;

  const memoryManagementWorkspace = bag.memoryProjectWorkspace === "__all__" ? "" : bag.memoryProjectWorkspace;
bag.memoryManagementWorkspace = memoryManagementWorkspace as typeof bag.memoryManagementWorkspace;

  useEffect(() => {
    let cancelled = false;
    if (!bag.memoryManagementWorkspace) { bag.setMemoryProjectEnabled(false); return () => { cancelled = true; }; }
    void window.codex.readWorkspaceMemoryEnabled(bag.memoryManagementWorkspace).then((enabled) => {
      if (!cancelled) bag.setMemoryProjectEnabled(Boolean(enabled));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [bag.memoryManagementWorkspace]);

  const memoryEntryBelongsToProject = useCallback((entry: MemoryRecord, project: string) => {
    if (!project || project === "__all__") return true;
    return !entry.workspace || entry.workspace === project || Boolean(entry.sourceThreadId && bag.threads.some((thread) => thread.id === entry.sourceThreadId && thread.cwd === project));
  }, [bag.threads]);
bag.memoryEntryBelongsToProject = memoryEntryBelongsToProject as typeof bag.memoryEntryBelongsToProject;

  const memoryVisibleRecords = useMemo(
    () => bag.memories.filter((entry) => bag.memoryEntryBelongsToProject(entry, bag.memoryProjectWorkspace)),
    [bag.memories, bag.memoryProjectWorkspace, bag.memoryEntryBelongsToProject],
  );
bag.memoryVisibleRecords = memoryVisibleRecords as typeof bag.memoryVisibleRecords;

  // 记忆按会话（threadId）聚合 + P 级漏斗分层。
  // threads 来自 refreshThreads（侧边栏同一份数据），手动保存的（无 sourceThreadId）独立成组。
  const memoryTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of bag.threads) {
      const name = (t.name ?? "").trim() || `会话 ${t.id.slice(0, 8)}`;
      map.set(t.id, name);
    }
    return (id: string) => map.get(id);
  }, [bag.threads]);
bag.memoryTitleById = memoryTitleById as typeof bag.memoryTitleById;

  const memoryGroups = useMemo(() => groupMemoriesByThread(bag.memoryVisibleRecords, bag.memoryTitleById), [bag.memoryVisibleRecords, bag.memoryTitleById]);
bag.memoryGroups = memoryGroups as typeof bag.memoryGroups;

  // 按当前选中的分类筛选（漏斗内仍展示，但只显示该分类下的组）
  const memoryGroupsFiltered = useMemo(
    () => bag.memoryCategory ? bag.memoryGroups.filter((g) => g.items.some((it) => it.category === bag.memoryCategory)) : bag.memoryGroups,
    [bag.memoryGroups, bag.memoryCategory],
  );
bag.memoryGroupsFiltered = memoryGroupsFiltered as typeof bag.memoryGroupsFiltered;

  // ── 记忆分层：L0 用户档案 / L1 项目记忆 / L2 每日日志 ──
  // 这三层是「常驻注入」的，和上面 memory.json 的碎片检索池（L3，按需召回）互不替代。
  const [memoryLayers, setMemoryLayers] = useState<MemoryLayersSnapshot | null>(null);
bag.memoryLayers = memoryLayers as typeof bag.memoryLayers; bag.setMemoryLayers = setMemoryLayers as typeof bag.setMemoryLayers;

  const [memoryLayerScope, setMemoryLayerScope] = useState<"user" | "background" | "project">("user");
bag.memoryLayerScope = memoryLayerScope as typeof bag.memoryLayerScope; bag.setMemoryLayerScope = setMemoryLayerScope as typeof bag.setMemoryLayerScope;

  const [memoryLayerDraft, setMemoryLayerDraft] = useState("");
bag.memoryLayerDraft = memoryLayerDraft as typeof bag.memoryLayerDraft; bag.setMemoryLayerDraft = setMemoryLayerDraft as typeof bag.setMemoryLayerDraft;

  const [memoryLayerSavedAt, setMemoryLayerSavedAt] = useState<number | null>(null);
bag.memoryLayerSavedAt = memoryLayerSavedAt as typeof bag.memoryLayerSavedAt; bag.setMemoryLayerSavedAt = setMemoryLayerSavedAt as typeof bag.setMemoryLayerSavedAt;

  const [memoryDistilling, setMemoryDistilling] = useState(false);
bag.memoryDistilling = memoryDistilling as typeof bag.memoryDistilling; bag.setMemoryDistilling = setMemoryDistilling as typeof bag.setMemoryDistilling;

  const applyMemoryLayers = useCallback((snapshot: MemoryLayersSnapshot, scope: "user" | "background" | "project") => {
    bag.setMemoryLayers(snapshot);
    bag.setMemoryLayerDraft(scope === "user" ? snapshot.user : scope === "background" ? snapshot.background : snapshot.project);
  }, []);
bag.applyMemoryLayers = applyMemoryLayers as typeof bag.applyMemoryLayers;

  // 打开记忆设置页或切换工作区时拉一次快照；切 tab 也要重载，否则会拿另一个作用域的内容覆盖草稿
  useEffect(() => {
    if (bag.settingsPage !== "memory") return;
    let cancelled = false;
    bag.setMemoryLayers(null);
    void window.codex.readMemoryLayers(bag.memoryManagementWorkspace || undefined)
      .then((snapshot) => { if (!cancelled) bag.applyMemoryLayers(snapshot, bag.memoryLayerScope); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bag.settingsPage, bag.memoryManagementWorkspace, bag.memoryLayerScope, bag.applyMemoryLayers]);

  const memoryLayerDirty = useMemo(
    () => (bag.memoryLayers ? bag.memoryLayerDraft !== (bag.memoryLayerScope === "user" ? bag.memoryLayers.user : bag.memoryLayerScope === "background" ? bag.memoryLayers.background : bag.memoryLayers.project) : false),
    [bag.memoryLayerDraft, bag.memoryLayers, bag.memoryLayerScope],
  );
bag.memoryLayerDirty = memoryLayerDirty as typeof bag.memoryLayerDirty;

  async function saveMemoryLayer() {
    const scope = bag.memoryLayerScope;
    if ((scope === "project" || scope === "background") && !bag.memoryManagementWorkspace) { bag.setMemoryStatus("请先在记忆中心选择项目"); return; }
    try {
      bag.applyMemoryLayers(await window.codex.writeMemoryLayer({ scope, content: bag.memoryLayerDraft, workspace: bag.memoryManagementWorkspace || undefined }), scope);
      bag.setMemoryLayerSavedAt(Date.now());
      window.setTimeout(() => bag.setMemoryLayerSavedAt(null), 2200);
      bag.setMemoryStatus(scope === "user" ? "用户档案已保存 · 下一条消息起生效" : scope === "background" ? "项目背景已保存 · 该项目的新会话会优先读取" : "项目记忆已保存 · 下一条消息起生效");
    } catch (error: any) { bag.setMemoryStatus(error.message); }
  }
bag.saveMemoryLayer = saveMemoryLayer as typeof bag.saveMemoryLayer;

  async function runMemoryDistill() {
    if (!bag.memoryManagementWorkspace) { bag.setMemoryStatus("请先在记忆中心选择项目"); return; }
    bag.setMemoryDistilling(true);
    try {
      const result = await window.codex.distillMemory(bag.memoryManagementWorkspace);
      bag.applyMemoryLayers(await window.codex.readMemoryLayers(bag.memoryManagementWorkspace), bag.memoryLayerScope);
      bag.setMemoryStatus(`蒸馏完成：${result.dates.length} 天日志已提炼进项目记忆（${result.added} 字）`);
    } catch (error: any) { bag.setMemoryStatus(error.message); }
    finally { bag.setMemoryDistilling(false); }
  }
bag.runMemoryDistill = runMemoryDistill as typeof bag.runMemoryDistill;

  async function togglePinned(id: string) {
    const entry = bag.memories.find((item) => item.id === id);
    if (!entry) return;
    try {
      const saved = await window.codex.saveMemory({ id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, pinned: !(entry as any).pinned, workspace: (entry as any).workspace });
      bag.setMemories((current) => current.map((item) => item.id === id ? saved : item));
      bag.setMemoryStatus(saved.pinned ? "已置顶为核心记忆" : "已取消置顶");
    } catch (error: any) { bag.setMemoryStatus(error.message); }
  }
bag.togglePinned = togglePinned as typeof bag.togglePinned;

  async function clearSelectedMemory() {
    if (bag.memoryProjectWorkspace === "__all__") {
      await bag.resetMemory();
      return;
    }
    const count = await bag.deleteMemoryGroup((entry) => bag.memoryEntryBelongsToProject(entry, bag.memoryProjectWorkspace) && Boolean(entry.workspace || entry.sourceThreadId));
    bag.setMemoryStatus(count ? `已清空项目「${basename(bag.memoryProjectWorkspace)}」的 ${count} 条记忆（全局记忆未删除）` : `项目「${basename(bag.memoryProjectWorkspace)}」没有可清理的项目记忆`);
  }
bag.clearSelectedMemory = clearSelectedMemory as typeof bag.clearSelectedMemory;

  const {
    scheduledTasks, setScheduledTasks, scheduleDraft, setScheduleDraft,
    autoFormVisible, setAutoFormVisible, scheduleStatus,
    saveSchedule, toggleSchedule, deleteSchedule, runSchedule,
    editSchedule,
  } = useScheduler();
bag.scheduledTasks = scheduledTasks as typeof bag.scheduledTasks; bag.setScheduledTasks = setScheduledTasks as typeof bag.setScheduledTasks; bag.scheduleDraft = scheduleDraft as typeof bag.scheduleDraft; bag.setScheduleDraft = setScheduleDraft as typeof bag.setScheduleDraft; bag.autoFormVisible = autoFormVisible as typeof bag.autoFormVisible; bag.setAutoFormVisible = setAutoFormVisible as typeof bag.setAutoFormVisible; bag.scheduleStatus = scheduleStatus as typeof bag.scheduleStatus; bag.saveSchedule = saveSchedule as typeof bag.saveSchedule; bag.toggleSchedule = toggleSchedule as typeof bag.toggleSchedule; bag.deleteSchedule = deleteSchedule as typeof bag.deleteSchedule; bag.runSchedule = runSchedule as typeof bag.runSchedule; bag.editSchedule = editSchedule as typeof bag.editSchedule;

  const {
    channelBot, setChannelBot, channelDraft, setChannelDraft,
    channelAction, channelStatus, setChannelStatus,
    saveChannelBot, testChannelBot, chooseChannelWorkspace,
  } = useChannelBot();
bag.channelBot = channelBot as typeof bag.channelBot; bag.setChannelBot = setChannelBot as typeof bag.setChannelBot; bag.channelDraft = channelDraft as typeof bag.channelDraft; bag.setChannelDraft = setChannelDraft as typeof bag.setChannelDraft; bag.channelAction = channelAction as typeof bag.channelAction; bag.channelStatus = channelStatus as typeof bag.channelStatus; bag.setChannelStatus = setChannelStatus as typeof bag.setChannelStatus; bag.saveChannelBot = saveChannelBot as typeof bag.saveChannelBot; bag.testChannelBot = testChannelBot as typeof bag.testChannelBot; bag.chooseChannelWorkspace = chooseChannelWorkspace as typeof bag.chooseChannelWorkspace;

  const {
    customModel, setCustomModel, customDraft, setCustomDraft, providersList, currentProvider,
    editingProvider, setEditingProvider, savingSettings, providerModels, modelSourceProvider,
    refreshActive,
    probingProvider, providerStatus, switchingModel, saveCustomModel, probeProvider, probeActiveProvider,
    selectProvider, removeProvider, setProviderModel, removeProviderModel,
    upsertProviderModel, setProviderEnabled, probeOneModel, adoptSavedProvider, saveCustomDraft,
  } = useModelProviders({
    onAutoSelect: (modelId, effort) => {
      bag.setModelId((current) => current || modelId);
      bag.setEffort((current) => current || effort || DEFAULT_EFFORT);
    },
    onSelect: (modelId, effort) => {
      bag.setModelId(modelId);
      // 设置页/供应商页选「生效模型」= 全局默认变更：新会话用它，当前会话一并跟过去，
      // 其它会话各自保持（作用域规则见 src/lib/model-scope.mjs）
      bag.applyGlobalModelChoice(modelId);
      if (effort) bag.setEffort(effort);
    },
    onNotice: bag.setNotice,
    onProbeSuccess: (title, detail) => bag.showToast(title, detail),
    // 设置页保存等路径已触发引擎重启生效：清掉「待重启生效」banner，避免残留误导
    onEngineApplied: () => bag.setPendingRestart(null),
  });
bag.customModel = customModel as typeof bag.customModel; bag.setCustomModel = setCustomModel as typeof bag.setCustomModel; bag.customDraft = customDraft as typeof bag.customDraft; bag.setCustomDraft = setCustomDraft as typeof bag.setCustomDraft; bag.providersList = providersList as typeof bag.providersList; bag.currentProvider = currentProvider as typeof bag.currentProvider; bag.editingProvider = editingProvider as typeof bag.editingProvider; bag.setEditingProvider = setEditingProvider as typeof bag.setEditingProvider; bag.savingSettings = savingSettings as typeof bag.savingSettings; bag.providerModels = providerModels as typeof bag.providerModels; bag.modelSourceProvider = modelSourceProvider as typeof bag.modelSourceProvider; bag.refreshActive = refreshActive as typeof bag.refreshActive; bag.probingProvider = probingProvider as typeof bag.probingProvider; bag.providerStatus = providerStatus as typeof bag.providerStatus; bag.switchingModel = switchingModel as typeof bag.switchingModel; bag.saveCustomModel = saveCustomModel as typeof bag.saveCustomModel; bag.probeProvider = probeProvider as typeof bag.probeProvider; bag.probeActiveProvider = probeActiveProvider as typeof bag.probeActiveProvider; bag.selectProvider = selectProvider as typeof bag.selectProvider; bag.removeProvider = removeProvider as typeof bag.removeProvider; bag.setProviderModel = setProviderModel as typeof bag.setProviderModel; bag.removeProviderModel = removeProviderModel as typeof bag.removeProviderModel; bag.upsertProviderModel = upsertProviderModel as typeof bag.upsertProviderModel; bag.setProviderEnabled = setProviderEnabled as typeof bag.setProviderEnabled; bag.probeOneModel = probeOneModel as typeof bag.probeOneModel; bag.adoptSavedProvider = adoptSavedProvider as typeof bag.adoptSavedProvider; bag.saveCustomDraft = saveCustomDraft as typeof bag.saveCustomDraft;

  /** 当前激活供应商的 ref 镜像：流事件处理器（401 自动迁移）是常驻闭包，直接取 state 会拿旧值。 */
  const activeProviderRef = useRef<{ provider: string; model: string; name: string; baseUrl: string; wireApi?: string } | null>(null);
bag.activeProviderRef = activeProviderRef as typeof bag.activeProviderRef;

  useEffect(() => {
    bag.activeProviderRef.current = bag.customModel ? { provider: bag.customModel.provider, model: bag.customModel.model, name: bag.customModel.name, baseUrl: bag.customModel.baseUrl, wireApi: bag.customModel.wireApi } : null;
  }, [bag.customModel]);

  // 进入中转站/官方订阅/模型页时刷新生效供应商：这些页的互斥判断依赖 customModel，
  // 状态过期（如另一处刚停用/启用）会导致「明明没有生效供应商却全灰」的死锁
  useEffect(() => {
    if (bag.settingsOpen && (bag.settingsPage === "relay" || bag.settingsPage === "openai" || bag.settingsPage === "model")) bag.refreshActive();
  }, [bag.settingsOpen, bag.settingsPage, bag.refreshActive]);
  return { scrollRef, timelineWrapRef, searchRef, composerInputRef, composerWrapRef, composerDomValueRef, makeComposerChip, syncComposerFromDom, messageHandlersRef, messageHandlers, memoryEnabled, memories, setMemories, memoryCategory, setMemoryCategory, memorySaveCategory, setMemorySaveCategory, memorySavedAt, memoryDraft, setMemoryDraft, memoryStatus, setMemoryStatus, memoryGateway, setMemoryGateway, memoryGatewayAction, memoryMode, updateMemoryMode, workspaceMemoryEnabled, updateWorkspaceMemory, saveMemoryRecord, deleteMemoryRecord, deleteMemoryGroup, resetMemory, testMemoryGateway, saveMemoryGateway, setMemoryEnabled, memoryProjectOptions, memoryManagementWorkspace, memoryEntryBelongsToProject, memoryVisibleRecords, memoryTitleById, memoryGroups, memoryGroupsFiltered, memoryLayers, setMemoryLayers, memoryLayerScope, setMemoryLayerScope, memoryLayerDraft, setMemoryLayerDraft, memoryLayerSavedAt, setMemoryLayerSavedAt, memoryDistilling, setMemoryDistilling, applyMemoryLayers, memoryLayerDirty, saveMemoryLayer, runMemoryDistill, togglePinned, clearSelectedMemory, scheduledTasks, setScheduledTasks, scheduleDraft, setScheduleDraft, autoFormVisible, setAutoFormVisible, scheduleStatus, saveSchedule, toggleSchedule, deleteSchedule, runSchedule, editSchedule, channelBot, setChannelBot, channelDraft, setChannelDraft, channelAction, channelStatus, setChannelStatus, saveChannelBot, testChannelBot, chooseChannelWorkspace, customModel, setCustomModel, customDraft, setCustomDraft, providersList, currentProvider, editingProvider, setEditingProvider, savingSettings, providerModels, modelSourceProvider, refreshActive, probingProvider, providerStatus, switchingModel, saveCustomModel, probeProvider, probeActiveProvider, selectProvider, removeProvider, setProviderModel, removeProviderModel, upsertProviderModel, setProviderEnabled, probeOneModel, adoptSavedProvider, saveCustomDraft, activeProviderRef };
}
