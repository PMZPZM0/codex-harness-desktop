/**
 * AppView —— 应用主壳的**视图层**（09-22 从 src/App.tsx 分出，纯搬迁）。
 * · App() 只保留「调 useHarnessApp → earlyView 短路 → 渲染本组件」。
 * · 本文件持有原 App() 的 751 个解构绑定与 1,840 行 JSX，**逐字未改**。
 * · props 类型 = useHarnessApp() 的返回类型（type-only import ⇒ 运行时零依赖）。
 */
import { createPortal } from "react-dom";
import { hk } from "../../lib/hk";
import { basename } from "../../lib/basename";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Brain,
  QrCode,
  Star,
  Check,
  ChevronDown,
  CircleGauge,
  Clock3,
  CircleStop,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Edit3,
  FileCode2,
  FileText,
  FileWarning,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Image,
  GitBranch,
  Globe2,
  GripVertical,
  Hash,
  Info,
  KeyRound,
  LayoutGrid,
  Layers3,
  Link2,
  ListFilter,
  Maximize2,
  Megaphone,
  Menu,
  BarChart3,
  PenTool,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Quote,
  Paperclip,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Play,
  PowerOff,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Download,
  Upload,
  Search,
  Send,
  Settings2,
  Shield,
  Smartphone,
  ShieldCheck,
  Sparkles,
  Store,
  TerminalSquare,
  Target,
  Trash2,
  Type,
  Sun,
  User,
  Wrench,
  Wifi,
  X,
  ChevronUp,
  FileUp,
  Minimize2,
  Zap,
  MonitorUp,
  BookOpen,
  BookmarkPlus,
  Home,
  Lock,
  CircleCheck,
  CircleX,
  ZoomIn,
  ZoomOut,
  ListRestart,
  Keyboard,
  Server,
  WifiOff,
  UserRound,
  Rocket,
  BookMarked,
  Users,
  ListChecks,
  LoaderCircle,
  GitPullRequest,
  ShieldAlert,
  RotateCcw,
  Briefcase,
  Tag,
  Workflow,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Pin,
  Wallet,
  LogIn,
  Database,
  Headphones,
  Mic,
  Pause,
  FileQuestion,
  ClipboardList,
  DraftingCompass,
  FlaskConical,
  Crown,
  TrendingUp,
  Microscope,
  Calculator,
  Telescope,
  CircleHelp,
  Video,
  Bell,
  CheckCheck,
} from "lucide-react";
import VoiceCallFloat from "../../components/VoiceCallFloat";
import { PageInfo, HelpOpenContext } from "../../components/SettingsHead";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../lib/user-refs";
import { MarketLogo, MarketPreviewModal, SkillAvatar, SkillInstallModal, SkillRemoveModal, PluginInstallModal } from "../skills-market";
import { ImagePreview, ImageLightbox, SearchPreviewModal, PastedTextEditor } from "../preview";
import { APPROVAL_MODES, CHANNEL_STATUS_KEY, CJK_TEXT_RE, COMPOSER_FILE_CHIP_ICON, DELEGATE_RAIL_LINGER_MS, DIFF_VIRTUAL_THRESHOLD, EXPERT_CATEGORY_DEFS, EXPERT_CATEGORY_LABELS, HOOK_EVENT_LABELS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, LOCAL_MODEL_PRESETS, MEMBER_LABELS, MEMORY_CATEGORIES, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES, RRULE_DAY_NAMES, RUN_PHRASES, RUN_PHRASES_BY_ACTIVITY, SANDBOX_MODES, SHORTCUT_GROUPS, SKILL_ZH_NOTES } from "./constants";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "./helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "./types";
import type { HarnessAppApi } from "../app-state/useHarnessApp";
import { AppViewSidebarShell } from "./AppView/01-sidebar-shell";
import { AppViewMainStage } from "./AppView/02-main-stage";
import { AppViewReviewPanel } from "./AppView/03-review-panel";
import { AppViewRemoteApproval } from "./AppView/04-remote-approval";
import { AppViewRemoteConsole } from "./AppView/05-remote-console";
import { AppViewTaskComposer } from "./AppView/06-task-composer";
import { AppViewMemoryPanel } from "./AppView/07-memory-panel";
import { TeamOfficePreview } from "../team-office";
import { DramaCanvas } from "../drama-canvas";
import { UiSketchModal } from "../ui-sketch";
import { WhatsNewDialog } from "../whats-new";
import { AppViewSettingsSheet } from "./AppView/08-settings-sheet";
import { AppViewFilePreviewEditor } from "./AppView/09-file-preview-editor";
import { ModelViewerBridge } from "../model-viewer";
import { WallpaperLayer } from "../wallpaper";
// 10-04 阶段 5 渲染层插槽：插件往界面挂内容的唯一入口（未注册时渲染 null ⇒ DOM 不变）。
import { Slot } from "../../runtime/registry";
import { DeclaredPluginSlots } from "../../runtime/declared-plugin-slots";



/* ⛔ 诊断探针（09-30）：localStorage.officeProbe = "1" 时用**内置假团队**打开像素办公室 ——
   e2e profile 里没有活动专家团（办公室按钮只在选中团队时渲染），真机断言全靠它复现。
   默认关闭、只读、不碰业务数据。 */
/* ⭐ 普通会话打开办公室的哨兵值（10-04 引入；⛔ 10-05 起**定义搬到了 team-office 域**的 barrel）。
   入口已从本文件的浮动按钮挪进 `02-main-stage/01-timeline.tsx` 的右侧轨道 ⇒ 常量只在
   timeline 侧使用（放在本文件会形成 AppView ⇄ timeline 的循环 import）。 */

const OFFICE_PROBE_TEAM = {
  teamId: "__office-probe__",
  displayName: { zh: "诊断用团队", en: "Probe Team" },
  profession: { zh: "诊断", en: "Probe" },
  lead: { id: "probe-lead", name: "执舵", profession: { zh: "统筹", en: "Lead" } },
  members: [0, 1, 2, 3].map((i) => ({
    id: `probe-m${i}`,
    name: ["观澜", "察本", "衡值", "执绳"][i],
    profession: { zh: ["工程", "风控", "行情", "文档"][i], en: "-" },
  })),
} as unknown as ExpertTeamConfig;

export function AppView({ app }: { app: HarnessAppApi }) {


  // ↓ useHarnessApp() 暴露的视图接口（751 个名字；与原实现的局部作用域逐个对应）
  const {
    TURNS_PAGE, TURN_WINDOW, accountDraft, accountEditing,
    accountMenuOpen, accountMenuRef, accountMenuSub, accountNameRef,
    activateOfficialProvider, activeBotId, activeMember, activeMemberTeam,
    activeThreadRunning, activeTurnId, activityLabel, adaptiveTone,
    addContextItem, addSkillReference, agentAsk, allModels,
    anchorSpacerRef, appConfirm, appPrompt, appPromptInputRef,
    applyGlobalPermissionMode, applyGroup, applyModelIdInput, applyPendingRestart,
    approvalPolicy, archiveToast, attachSubmenu, attachedFiles,
    attachmentMenuOpen, autoCompactRatio, autoFormVisible, availableContextItems,
    awayFromBottom, backupBusy, batchSetConnectorsEnabled, batchSetMcpServersEnabled,
    batchSetPluginEnabled, batchSetSkillEnabled, bootReady, botBindings,
    botChannelPick, botManagerOpen, botStream, bots,
    browserAuto, browserHome, browserOpenReq, cancelPendingRestart,
    cancelPlanExecution, cancelPromptEnhance, cancelQuote, cancelRateLimitRetry,
    capabilityError, capabilityHint, capabilityRows, changeAdaptiveTone,
    changeApproval, changeDownloadSource, changeEffort, changeHardwareAccel,
    changePermissionMode, changePersonality, changePlugin, changeSandbox,
    channelOnline, checkEngineUpdateNow, chooseFiles, chooseModel,
    chooseTeamCwd, chooseWorkspace, clearSelectedMemory, clearTeamCwd,
    closeTab, clusterSplit, codexIdentity, collapsedSections,
    commandBusy, commandBusyKey, commandDelete, commandEditor,
    commandFilter, commandMatches, commandSearch, compactPendingRef,
    compactSpacerRef, compactToast, composerDomValueRef, composerInputRef,
    composerWrapRef, confirmDeleteCommand, confirmPlanExecution, connectorBatchBusy,
    connectorChecked, connectorDraft, connectorEditorOpen, connectorOAuth,
    connectorSaving, connectorSearch, connectorSecret, connectorStatusBusy,
    connectorTemplateModal, connectorTemplateSaving, connectorTemplateValues, connectorTemplates,
    connectors, connectorsManageOnly, contentTailTarget, contextItems,
    contextOpen, copyImage, copyThreadReferenceId, ctxBtnRef, ctxMenuOpen, ctxMenuStyle, currentModelId,
    currentProvider, customCommands, customDraft, customModel,
    delegatedPopupId, delegatedPopupRun, deleteExpertTeam,
    deleteMemoryGroup, deleteMemoryRecord, deleteQueued, deleteSchedule,
    deleteSubAgent, deleteThreadsByCwd, desktopAuto, devRuntimes,
    dictationBaseRef, diff, dismissEnhanceHint, dismissNotice,
    doneExpanded, downloadSource, dramaCanvasOpen, duplicateSshEntry, earlierLoadingId,
    editSchedule, editingProvider, effort, emptySshDraft,
    emptySshJump, engineCheck, engineUpdateLog, engineUpdatePercent,
    engineUpdateResult, engineUpdateStageText, engineUpdating, engineVersion,
    enhanceBusy, enhanceHint, envCheckOpen, envInstalling,
    envItems, envPercent, envProgress, envSpeed,
    envQueueDone, envQueueTotal, envSkipped, skipEnvItem,
    envStage, executeRateLimitRetry, expandedProjects, expertQuery,
    expertTeamDraft, expertTeamEditorOpen, expertTeamMemberDirect, expertTeamMemberRunning,
    expertTeamRunning, expertTeams, exportSshEntries, exportThreadsBackup,
    exportThreadsMarkdown, fileDraft, fileEditing, filePreview,
    fileTabs, fileTruncated, forgetPendingImport, globalPermApproval,
    goalStatus, goalText, goalsAutoGone, goalsDocked,
    goalsExpanded, goalsOpen, greetSub, greeting,
    groupBusy, handleLogout, hardwareAccel,
    hasEnhanceBackup, helpKey, highlightedFilePath, historyMemberRuns,
    hookBusy, hookPulse, hookTrusting, images,
    importConversationMarkdown, importSkill, importSshEntries, importThreadsBackup,
    infoModal, inlineRename, inlineRenameRef, insertComposerFiles,
    installDevRuntime, installEnvMissing, installMarketPlugin, installMarketSkill,
    installMcpServer, installedTotalCount, installingMarketPlugin, installingMarketSkill,
    interrupt, interruptedTurns, interrupting, isEmpty,
    jumpToTurnInWindow, keepAwake, lastUsage, latestCompletedTurn,
    lightbox, linkedBusy, listThreads, loadEarlierTurns,
    loadPairStates, loadTree, loading, localSkills,
    makeComposerChip, marketLoading, marketPage, marketPageSize,
    marketPreview, marketSkills, marketTotal, mcpMarketCategory,
    mcpMarketSearch, mcpOverrides, mcpServerBatchBusy, mcpServerChecked,
    mcpServerSearch, mcpServerStatusBusy, mcpToolPermissions, memories,
    memoryCategory, memoryCenterOpen, memoryCenterTab, memoryConfigOpen,
    memoryDistilling, memoryDraft, memoryEnabled, memoryGateway,
    memoryGatewayAction, memoryGroups, memoryGroupsFiltered, memoryLayerDirty,
    memoryLayerDraft, memoryLayerSavedAt, memoryLayerScope, memoryLayers,
    memoryManagementWorkspace, memoryMode, memoryPreview, memoryProjectEnabled,
    memoryProjectMenuOpen, memoryProjectOptions, memoryProjectPickerRef, memoryProjectWorkspace,
    memorySaveCategory, memorySavedAt, memoryStatus, memoryVisibleRecords,
    mergedSkillCatalog, messageHandlers, mobileNav, mobileRemoteOpen,
    modelEditor, modelId, modelSuggestions, narrow,
    notices, onComposerKeyDown, onPromptChange, onTimelineScroll,
    openAppConfirm, openAppPrompt, openEditExpertTeam, openEditSubAgent,
    openFeedbackPage, openFile, openInBrowserPane, openModelEditor,
    openNewExpertTeam, openNewSubAgent, openPanelTab, openThread,
    openaiActiveAcct, optimisticConfirmed, optimisticInput, pairApproved,
    pairCode, pairPending, paletteOpen, paletteQuery,
    paletteSections, paletteTab, panelWidth, pasteImage,
    pasteLongText, pastedText, pending, pendingImportThreads,
    pendingRestart, performEngineUpdateNow, persistCommand, personality,
    pinnedThreads, planArmed, planConfirm, planFeedback,
    planOnceRef, planRunning, planSteps, pluginBatchBusy,
    pluginBusy, pluginChecked, pluginInstall, pluginInstalledOnly,
    pluginMarketCategory, pluginMarketItems, pluginMarketLoading, pluginMarketPage,
    pluginMarketPageSize, pluginMarketSearch, pluginMarketTotal, pluginSearch,
    plusSpinTick, ponytailOn, popoutThreadId, popupRun,
    pptokenCardOff, probeActiveProvider, probeOneModel, probeProvider,
    probingProvider, projectFilter, projectGroups, projectMenu,
    prompt, providerAutoOpenRef, providerStatus, providersList,
    queue, queueDragIndex, quickMenuFlipUp, quickMenuPanelRef,
    quickMenuRef,
    quoteItem, railLastByMember, railRunningByMember, railTeam,
    releaseToUserRef,
    rateLimitRetries, rawOpenFile, readMood, recentCompaction,
    refreshActive, refreshCommands, refreshExpertTeams, refreshMarketSkills,
    refreshPluginsPage, refreshSettingsResources, refreshSubAgents, refreshThreads,
    relaunchCountdown, relayActivate, relayActive, relayBusy,

    remoteQr, remoteUrl, removeConnector, removeContextItem,
    removeLocalSkill, removeProvider, removeSshEntries, renameDraft,
    renderClusterList, reorderQueued, resetExpertTeams, resourceError,
    resourceLoading, restartPending, reviewBusy, reviewReport,
    rightOpen, rightTab, rpaRecipes, rpaRunning,
    runActivity, runMemoryDistill, runPhrase, runPromptEnhance,
    runSchedule, runSlashCommand, runUpdateCheck, runUpdateDownload,
    runtimeInstalling, runtimeModal, runtimePercent, runtimeProgress,
    runtimeSpeed, runtimeStage, sandbox, saveAccountName,
    saveConnector, saveConnectorFromTemplate, saveCustomDraft, saveCustomModel,
    saveExpertTeam, saveFilePreview, saveInlineRename, saveMemoryGateway,
    saveMemoryLayer, saveMemoryRecord, saveModelEditor, saveQueued,
    saveSchedule, saveSshEntry, saveSubAgent, savingFile,
    savingSettings, scheduleDraft, scheduleStatus, scheduleSubmenu,
    scheduleSubmenuClose, scheduledTasks, scrollRef, searchPreview,
    selectedModel, selectedSkills, send, sending, paletteHandlersRef, pendingCommandTextRef,
    serverStatus, setAccountDraft, setAccountEditing, setAccountMenuOpen,
    setAccountMenuSub, setActiveBotId, setAgentAsk, setAppConfirm,
    setAppPrompt, setArchiveToast, setAttachSubmenu, setAttachmentMenuOpen,
    setAutoCompactRatio, setAutoFormVisible, setBotBinding, setBotChannelPick,
    setBotManagerOpen, setBotsPersist, setBrowserDraft, setBrowserHome,
    setChannelOnline, setCommandDelete, setCommandEditor, setCommandFilter,
    setCommandSearch, setCompactEventState, setCompactToast, setConnectorChecked,
    setConnectorDraft, setConnectorEditorOpen, setConnectorEnabled, setConnectorMenuOpen,
    setConnectorOAuth, setConnectorSearch, setConnectorSecret, setConnectorTemplateModal,
    setConnectorTemplateValues, setConnectorsManageOnly, setContextOpen, setCtxMenuOpen, setCustomDraft,
    setDelegatedPopupId, setDoneExpanded, setDramaCanvasOpen, setEditingProvider, setEnvCheckOpen,
    setExpertQuery, setExpertTeamDraft, setExpertTeamEditorOpen, setFileDraft,
    setFileEditing, setFilePreview, setGoalText, setGoalsDocked,
    setGoalsExpanded, setGoalsOpen, setHelpKey, setHookEnabled,
    setInfoModal, setInlineRename, setKeepAwake, setLightbox,
    setLinkedEnabled, setLocalSkills, setMarketPage, setMarketPreview,
    setMcpMarketCategory, setMcpMarketSearch, setMcpServerChecked, setMcpServerEnabled,
    setMcpServerSearch, setMcpToolPermission, setMemoryCategory, setMemoryCenterOpen,
    setMemoryCenterTab, setMemoryConfigOpen, setMemoryDraft, setMemoryEnabled,
    setMemoryGateway, setMemoryLayerDraft, setMemoryLayerScope, setMemoryPreview,
    setMemoryProjectEnabled, setMemoryProjectMenuOpen, setMemoryProjectWorkspace, setMemorySaveCategory,
    setMemoryStatus, setMobileNav, setMobileRemoteOpen, setModelEditor,
    setNotice, setOpenaiActiveAcct, setPairCode, setPairPending,
    setPaletteOpen, setPaletteQuery, setPaletteTab, setPastedText,
    setPending, setPlanArmed, setPlanFeedback, setPluginChecked,
    setPluginEnabled, setPluginInstall, setPluginInstalledOnly, setPluginMarketCategory,
    setPluginMarketPage, setPluginMarketSearch, setPluginSearch, setPlusSpinTick,
    setPptokenCardOff, setProjectFilter, setProjectMenu, setPrompt,
    setProviderEnabled, setQueueDragIndex, setRemoteDevices, setRemoteQr,
    setRemoteStatus, setRemoteUrl, setRenameDraft, setRightOpen,
    setRightTab, setRpaRecipes, setRpaRunning, setRuntimeModal,
    setScheduleDraft, setScheduledTasks, setSearchPreview, setSelectedSkills,
    setSidebarCollapsed, setSidebarFlyout, setSkillChecked,
    setSettingsOpen, setSettingsPage, setShortcutsOpen, setShowApiKey,

    setSkillHubCategory, setSkillHubFilterCategory, setSkillHubSearch, setSkillInstall,
    setSkillManageSearch, setSkillMenuOpen, setSkillQuery, setSkillRemove,
    setSkillsManageOnly, setSshChecked, setSshDraft, setSshEditorTest,
    setSshExecTarget, setSshFilter, setSshQuery, setSshTerminal,
    setSubAgentDraft, setSubAgentEditorOpen, setTaskList, setTeamHistoryMember,
    setTeamPopupRunId, setTheme, setThreadFileQuery, setUiFont,
    setUiLang, setUiSketchOpen, setUiZoom, setUpdateNotice, setUsageStats,
    setUserAvatar, setUsername, setViewTab, setWelcomeCwdMenuOpen,
    setWelcomeScratchDir, settingsContentReady, settingsOpen, settingsPage,
    settingsResources, shellRef, shortcutsOpen, showApiKey,
    showLogin, showToast, sidebarAllCollapsed,

    sidebarCollapsed, sidebarFlyout, skillBatchBusy, skillChecked,
    skillCommandMatches, skillHubCategory, skillHubFilterCategory, skillHubSearch,
    skillInstall, skillManageSearch, skillQuery, skillRemove,
    skillsManageOnly, sshBatchBusy, sshBusyId, sshChecked,
    sshCheckedSet, sshDraft, sshDraftValid, sshEditorTest,
    sshExecTarget, sshFilter, sshQuery, sshSaving,
    sshServers, sshTerminal, sshTestingId, sshToggleChecked,
    sshVisible, startConnectorOAuth, startMemberDirectSession, startNewThread,
    startPanelDrag, startQueued, startReview, startTeamSession,
    stats, stickToBottomRef, stopGoalLoop, stoppedElapsed,
    subAgentDraft, subAgentEditorOpen, subAgentRunning, subAgents,
    submenuFlip, submenuTop, submitPlanFeedback, switchingFading,
    switchingMeta, switchingModel, switchingThreadId, systemEvents,
    targetProviderHint, taskList, teamCwdMap, teamHistoryMember,
    testMemoryGateway, testSshBatch, testSshDraft, testSshEntry,
    theme, thread, threadCacheRef, threadFileCandidates,
    threadFileQuery, threads, threadsLoading, timelineWrapRef,
    toggleAllSidebarSections, toggleBrowserAuto, toggleDesktopAuto, toggleExpertTeamEnabled,
    togglePinned, toggleProjectExpanded, toggleSchedule, toggleSection,
    toggleSkillEnabled, toggleSshBatch, toggleSshEntry, toggleSshFavorite,
    toggleSubAgentEnabled, toggleTreeDir, tokenUsage, toolsStatus,
    topbarActionsNode, treeChildren, treeExpanded, treeLoading,
    treePath, trustAllHooks, turnWindow, turnsCursorRef,
    uiFont, uiLang, uiSketchOpen, uiZoom, uninstallDevRuntime,
    updateBotStream, updateChecking, updateCurrentVersion, updateDownloading,
    updateError, updateInfo, updateMemoryMode, updateNotice,
    updateProgress, upstreamRetries, usage, useCommand,
    userAvatar, userDataPath, username, viewTab,
    voiceDictating, waitingForApproval, waitingForInput, welcomeCwdMenuOpen,
    welcomeScratchDir, workspace, workspaceMemoryEnabled,
  } = app;
  /* 办公室成员（10-05 用户报「我调度了一个专家，办公室预览里面没有更新成员」）：
     取本会话派出的**委托登记表**（含已完成），⛔ 不是头像轨的 live 表 ——
     委托跑得极快（真机实测 3.7 秒），用 live 表 / 按 running 过滤 ⇒ 点开办公室时
     人已经"下班"了，办公室里永远是空的。 */
  const officeDelegates = Object.values(app.delegateRecords)
    .filter((record) => record.originThreadId === thread?.id && !record.archived)
    .sort((a, b) => a.startedAt - b.startedAt);
  return (
    // 设置页的「?」要能打开完整帮助弹窗（气泡里的「查看完整帮助」）：用 context 注入 setHelpKey。
    // 不走逐页 prop —— 二十多个设置页头部每处都传一遍回调，漏传的那个会静默点不开。
    <HelpOpenContext.Provider value={setHelpKey}>
    <div
      ref={shellRef}
      className={`app-shell ${rightOpen ? "with-context" : ""} ${sidebarCollapsed ? "side-collapsed" : ""} ${narrow ? "narrow" : ""} ${popoutThreadId ? "popout-shell" : ""}`}
      // 右侧上下文面板仅在用户显式开启后参与网格；收起左栏时不能塞入一个 0px 首列，
      // 否则 CSS Grid 会保留隐式轨道，把 workspace 挤到最右侧。
      style={rightOpen ? { gridTemplateColumns: popoutThreadId ? `minmax(0, 1fr) 1px ${panelWidth}px` : sidebarCollapsed ? `minmax(0, 1fr) 1px ${panelWidth}px` : `256px minmax(0, 1fr) 1px ${panelWidth}px` } : undefined}
    >
      {/* 壁纸层（wallpaper 域）：app-shell 首子元素 + isolation 堆叠上下文，负 z 层透出在
          全应用表面（侧栏/聊天/输入框周边）之下、内容之上；用户关掉时不在 DOM。 */}
      <WallpaperLayer />
      {/* 思考浮窗宿主（10-06 夜，用户实测「办公室预览被运行中的思考板块盖住」）：思考浮窗原来
          portal 到 body、以 z-index:8 参加**根层**竞争 —— 而 app-shell 是 isolation 层，壳内
          一切 z（办公室 400、设置 80~97、画布 90）都只在壳内比较 ⇒ 全被外面那个 8 压住。
          修法：浮窗改 portal 到**壳内这个宿主**（60 档：高于消息流 <30、低于设置页/画布/整屏浮层）。
          ⛔ 必须挂在壳根（壁纸层旁），不许塞进任何回合卡里 —— .turn-group 上有恒等 transform
          （containing block），fixed 会当场退化（同本轮审查弹窗事故）。 */}
      <div className="reasoning-float-host" aria-hidden />
      {!popoutThreadId && sidebarCollapsed && <div className="sidebar-hotzone" aria-hidden onMouseEnter={() => setSidebarFlyout(true)} />}
        <header className="topbar">
        {sidebarCollapsed && !narrow && <button className="icon-button sidebar-reveal" title="展开侧边栏" onClick={() => { setSidebarCollapsed(false); setSidebarFlyout(false); localStorage.setItem("sidebar-collapsed", "false"); }}><Menu size={18} /></button>}
        <button className="icon-button mobile-menu" title="打开导航" onClick={() => setMobileNav(!mobileNav)}><Menu size={18} /></button>
        <div className={`task-title ${activeThreadRunning ? "running" : "ready"}`}>
          {/* 工作区上下文（📁）：10-06 夜七轮从右侧操作簇挪到**标题最前**（用户：「把文件图标放到最前面」，
              截图圈的就是右簇那个 📁）。点击开菜单 = 选择/切换工作区目录；窄屏（≤760px）隐藏规则
              见 09-settings-workspace-memory.css；守卫【250】的覆盖率清单跟着本位置走。 */}
          <div className="ctx-picker">
            <button ref={ctxBtnRef} className="icon-button tb-workspace" title="工作区上下文（当前会话使用的项目目录）" onClick={() => setCtxMenuOpen((current) => !current)}><FolderOpen size={16} /></button>
            {ctxMenuOpen && <>
              <div className="menu-backdrop" onClick={() => setCtxMenuOpen(false)} />
              {createPortal(
                <div className="task-menu ctx-menu ctx-menu-fixed" role="menu" style={ctxMenuStyle}>
                  <button onClick={() => { setCtxMenuOpen(false); void chooseWorkspace(); }}><FolderOpen size={14} />{workspace ? "选择其他目录…" : "选择工作区目录"}</button>
                  {workspace && <button onClick={() => setCtxMenuOpen(false)}><FolderOpen size={14} /><span className="ctx-current-name">资源管理器 · {basename(workspace)}</span><Check size={14} className="ctx-check" /></button>}
                </div>,
                document.body,
              )}
            </>}
          </div>
          {inlineRename ? <input ref={inlineRenameRef} value={renameDraft} aria-label="任务名称" onChange={(event) => setRenameDraft(event.target.value)} onBlur={saveInlineRename} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveInlineRename(); } if (event.key === "Escape") { event.preventDefault(); setInlineRename(false); } }} /> : <strong title="双击修改任务名称" onDoubleClick={() => { if (!thread) return; setRenameDraft(cleanThreadDisplayTitle(thread.name, { preview: thread.preview })); setInlineRename(true); queueMicrotask(() => { inlineRenameRef.current?.focus(); inlineRenameRef.current?.select(); }); }}>{cleanThreadDisplayTitle(thread?.name, { preview: thread?.preview, fallback: cleanThreadDisplayTitle(switchingMeta?.name, { preview: switchingMeta?.preview, fallback: "新任务" }) })}</strong>}
          <span>{workspace || "尚未选择工作区"}</span>
          {subAgentRunning && <span className="subagent-badge" title={`子智能体「${subAgentRunning}」执行中`}><Bot size={13} className="subagent-pulse" /><em>{subAgentRunning}</em><i>执行中</i></span>}
        </div>
        <div className="topbar-actions">{topbarActionsNode}</div>
        {/* 10-04 渲染层插槽：插件可往标题栏右侧挂按钮（标题栏是 titleBarOverlay 的绘制区，
            插件按钮会落进窗口拖拽区右侧，不影响拖动）。守卫【268】盯它有真实消费点。 */}
        <Slot id="topbar.end" loader={() => import("../../runtime/plugin-slots")} />
      </header>
      <AppViewSidebarShell app={app} onOpenSettings={(page) => { setSearchPreview(null); setMemoryCenterOpen(false); setSettingsPage(page as SettingsPage); setSettingsOpen(true); }} />
      {popoutThreadId && <div className="" aria-hidden />}

      <AppViewMainStage app={app} />

      {rightOpen && <div className="panel-divider" onMouseDown={startPanelDrag} />}

      <AppViewReviewPanel app={app} />

      {paletteOpen && <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
        <div className="palette">
          <div className="palette-input"><Search size={14} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setPaletteOpen(false); if (event.key === "Enter") (document.querySelector(".palette-row") as HTMLElement | null)?.click(); }} placeholder="搜索操作、任务或文件" /></div>
          <div className="palette-tabs">
            {[["all", "全部", LayoutGrid], ["ops", "操作", Wrench], ["tasks", "任务", MessageSquare], ["files", "文件", FolderOpen]].map(([key, label, Icon]: any) => <button key={key} className={paletteTab === key ? "active" : ""} onClick={() => setPaletteTab(key)}><Icon size={12} />{label}</button>)}
          </div>
          {paletteSections.map((section) => <div key={section.group}>
            <div className="palette-section">{section.group}</div>
            {section.rows.map((row: any) => { const Icon = row.icon; return (
              <button className="palette-row" key={row.label} onClick={() => { setPaletteOpen(false); row.run(); }}>
                <Icon size={14} />
                <span className="palette-label">{row.label}</span>
                {row.shortcut && <kbd>{hk(row.shortcut)}</kbd>}
              </button>
            ); })}
          </div>)}
          {!paletteSections.length && <div className="switcher-empty">没有匹配的结果</div>}
        </div>
      </div>}
      {/* 10-04 渲染层插槽：全局浮层出口。插件要挂「不依附任何页面」的浮层
      （确认框 / 托盘气泡 / 全局进度）挂这里 —— 页面级插槽只活在那个页面的渲染树里。 */}
      <Slot id="overlay.root" />
      {/* 10-04 B 档：声明式插件的注册器。常驻在这里（不需要被哪个页面加载），
          它自己渲染 null，只把「用户目录里的 JSON 清单」注册进各个插槽。
          ⛔ 与 plugin-slots.tsx 那个自检出口不同：这个有真实消费者（用户能放 JSON 进来）。 */}
      <DeclaredPluginSlots />
      <AppViewRemoteApproval app={app} />
      <AppViewRemoteConsole app={app} />
{/* 更新到新版本后的「新功能介绍」（whats-new 域）：自包含，该不该弹由主进程判定 ⇒
    这里**无条件挂载**、组件自己决定画不画。⛔ 别在 AppView 里再判一次版本（判定只能一处）。 */}
      <WhatsNewDialog />
<AppViewTaskComposer app={app} />
      {appPrompt && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { appPrompt.resolve(null); setAppPrompt(null); } }}>
        <div className="agent-ask-card" role="dialog" aria-modal="true" aria-label={appPrompt.title}>
          <header><PenLine size={16} /><strong>{appPrompt.title}</strong></header>
          <form className="agent-ask-free app-prompt-form" onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("promptText") as HTMLInputElement | HTMLTextAreaElement; appPrompt.resolve(input.value); setAppPrompt(null); }}>
            {appPrompt.multiline
              ? <textarea ref={(node) => { appPromptInputRef.current = node; }} name="promptText" rows={6} defaultValue={appPrompt.value} />
              : <input ref={(node) => { appPromptInputRef.current = node; }} name="promptText" defaultValue={appPrompt.value} />}
            <div className="app-prompt-actions">
              <button type="button" className="secondary-setting" onClick={() => { appPrompt.resolve(null); setAppPrompt(null); }}>取消</button>
              <button type="submit" className="primary-setting"><Check size={14} />确定</button>
            </div>
          </form>
        </div>
      </div>}
      {appConfirm && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { appConfirm.resolve(false); setAppConfirm(null); } }}>
        <div className="agent-ask-card app-confirm-card" role="dialog" aria-modal="true" aria-label={appConfirm.title}>
          <header><Trash2 size={16} /><strong>{appConfirm.title}</strong></header>
          <p>{appConfirm.text}</p>
          <div className="app-prompt-actions">
            <button type="button" className="secondary-setting" onClick={() => { appConfirm.resolve(false); setAppConfirm(null); }}>取消</button>
            <button type="button" className="danger primary-setting" onClick={() => { appConfirm.resolve(true); setAppConfirm(null); }}>{appConfirm.confirmLabel}</button>
          </div>
        </div>
      </div>}
      {memoryPreview && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemoryPreview(null); }}>
        <div className="agent-ask-card memory-preview-card" role="dialog" aria-modal="true" aria-label="记忆全文">
          <header>
            <span className="memory-category-pill">{memoryPreview.category}</span>
            <strong>记忆全文</strong>
            <button className="icon-button relay-modal-close" title="关闭" onClick={() => setMemoryPreview(null)}><X size={16} /></button>
          </header>
          <div className="memory-preview-body">{memoryPreview.content}</div>
          <small>
            {memoryPreview.sourceThreadId ? `来源 ${memoryPreview.sourceThreadId.slice(0, 8)}` : "手动保存"} · 保存于 {new Date(memoryPreview.updatedAt ?? Date.now()).toLocaleString("zh-CN")}
            {memoryPreview.sourceThreadId && <button className="memory-preview-open" title="跳转到这条记忆来源的会话" onClick={() => { setMemoryPreview(null); void openThread(memoryPreview.sourceThreadId!); }}><MessageSquare size={11} />打开源会话</button>}
          </small>
        </div>
      </div>}
      {searchPreview && (
        <SearchPreviewModal
          target={searchPreview}
          onClose={() => setSearchPreview(null)}
          onOpenThread={(id) => { setSearchPreview(null); setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(id); }}
          onOpenSettings={(page) => { setSearchPreview(null); setMemoryCenterOpen(false); setSettingsPage(page as SettingsPage); }}
          onCopyThreadId={(id) => { void copyThreadReferenceId({ id }); }}
        />
      )}
      {/* 记忆中心：设置页「记忆」只做总览，条目浏览 / 常驻记忆编辑 / 存储切换都在这个大弹窗里完成 */}
      <AppViewMemoryPanel app={app} />
      <AppViewSettingsSheet app={app} />
      {/* 专家团像素办公室（v19）：成员流转轨「办公室」按钮进入。数据面 = teams + railRuns 的
          运行态（引擎事件流归约），无新 IPC；交互只有「点角色 → 打开该成员会话」。 */}
      {/* ⭐ 入口位置（10-05 用户定稿）：**专家团会话** = 成员流转轨末位节点；
          **普通会话** = 调度头像轨末位节点。两处共用 `OfficeRailNode`（`02-rails.tsx`），
          位置/图标一致 —— 原来普通会话那个"左下角浮动胶囊"（`.office-entry-btn`）已整体删除。
          ⛔ 别再把入口挂回 AppView：浮层开在这里，但**开浮层的按钮属于轨道**（轨道在 timeline 里）。 */}
      <TeamOfficePreview
        teamId={app.companyPreviewTeamId}
        onClose={() => app.setCompanyPreviewTeamId(null)}
        teams={app.expertTeams}
        runningByMember={app.railRunningByMember}
        lastByMember={app.railLastByMember}
        /* 普通会话也能开办公室 —— 传本会话派出的子会话（**委托登记表**，含已完成的，
           见文件上方 `officeDelegates` 的由来）。 */
        delegatedRuns={officeDelegates}
        /* ⭐ 「我」的工位（10-05 晚）：非专家团模式下把**本会话自己**也放进办公室 ——
           否则本会话的事件（对话框里那些工具步骤）没有任何显示器可演，
           "所有事件接入显示器"就只兑现了一半。 */
        self={thread ? { threadId: thread.id, name: String(thread.name ?? ""), running: Boolean(app.sending || app.activeTurnId) } : null}
        openThread={(threadId) => void openThread(threadId)}
      />
      {typeof localStorage !== "undefined" && localStorage.getItem("officeProbe") === "1" && (
        <TeamOfficePreview
          teamId="__office-probe__"
          onClose={() => { try { localStorage.removeItem("officeProbe"); } catch { /* 忽略 */ } }}
          teams={[OFFICE_PROBE_TEAM]}
          runningByMember={{ "probe-m1": { runId: "p1", leadThreadId: "", teamId: "__office-probe__", memberId: "probe-m1", memberName: "察本", profession: "风控", role: "member", memberThreadId: "", query: "", output: "", status: "running", startedAt: 0 } }}
          lastByMember={{}}
          openThread={() => { /* 探针不跳会话 */ }}
        />
      )}
      {/* AI 短剧无限画布（09-27）：与「专家团办公室预览」同一个档位的整屏浮层 —— 画布需要
          一大片连续空间，塞进右栏或中央主区分栏都会被挤成缩略图。工作区传进去是因为
          分镜表副本与素材要落到 <workspace>/.drama-canvas/ 下（引擎读的就是那份）。 */}
      {dramaCanvasOpen && (
        <DramaCanvas
          onClose={() => setDramaCanvasOpen(false)}
          workspace={workspace}
          /* 画布上「去配置生图/视频」→ 直接开「设置 → 插件」页（生图插件卡 + 视频接口卡都在这页）。
             ⛔ 不关画布：配完关掉设置就回到画布，接着生成。 */
          onOpenPluginSettings={() => { setSettingsPage("plugins"); setSettingsOpen(true); }}
          threads={threads}
          onAskAgent={(text, threadId) => {
            /* 闭环：画布选好目标会话 → 这里切过去（或新建）→ 用 pendingCommandTextRef 塞任务
               （⛔ 它是 ref，不受 setPrompt 状态滞后影响，send 首选消费它）→ 直接发送。 */
            setDramaCanvasOpen(false);
            void (async () => {
              try {
                if (threadId) await openThread(threadId);
                else paletteHandlersRef.current?.startNewThread();
                pendingCommandTextRef.current = text;
                await send();
              } catch { setPrompt(text); /* 切会话失败兜底：塞进输入框由用户手动发 */ }
            })();
          }}
          onSummonTeam={(teamId, text) => {
            /* 召唤内置专家团（视频制作 / 生图）：teams:start-session 会新建团队会话并跑 task。 */
            setDramaCanvasOpen(false);
            window.codex.startTeamSession({ teamId, task: text, cwd: workspace || undefined }).catch((error: any) => {
              setNotice(`召唤专家失败：${String(error?.message ?? error).slice(0, 120)}`);
            });
          }}
        />
      )}
      {/* 前端开发（10-05，嵌 m3e-canvas；两轮改名：界面草图 → 手机前端UI → 前端开发）：与画布同档的整屏浮层，从侧栏「···更多」开。
          「交给 Codex 实现」走的是画布那条已验证的通路 —— 关浮层 → 塞 pendingCommandTextRef
          （⛔ 它是 ref，不受 setPrompt 状态滞后影响）→ 直接发送；发送失败兜底成填输入框。 */}
      {uiSketchOpen && (
        <UiSketchModal
          onClose={() => setUiSketchOpen(false)}
          onAskAgent={(text) => {
            setUiSketchOpen(false);
            pendingCommandTextRef.current = text;
            void (async () => {
              try {
                await send();
              } catch {
                setPrompt(text);
              }
            })();
          }}
        />
      )}
      {shortcutsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}><div className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="键盘快捷键"><header><div><Keyboard size={17} /><strong>键盘快捷键</strong><span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setShortcutsOpen(false)}><X size={17} /></button></header><div className="shortcuts-body">{SHORTCUT_GROUPS.map((group) => <section className="shortcuts-group" key={group.group}><h3>{group.group}</h3>{group.shortcuts.map((item) => <div className="shortcuts-row" key={item.keys.join("+")}><span className="shortcut-desc">{item.desc}</span><span className="shortcut-keys">{item.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span></div>)}</section>)}<footer><span className="muted">部分快捷键在输入框聚焦时优先用于文本编辑。</span></footer></div></div></div>}
      {marketPreview && <MarketPreviewModal state={marketPreview} onClose={() => setMarketPreview(null)} />}
      {skillInstall && <SkillInstallModal state={skillInstall} onClose={() => setSkillInstall(null)} onUse={() => { const skill = { name: skillInstall.skill.name, description: skillInstall.skill.description }; setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, skill]); setSkillInstall(null); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); }} />}
      {skillRemove && <SkillRemoveModal state={skillRemove} onClose={() => setSkillRemove(null)} />}
      {pluginInstall && <PluginInstallModal state={pluginInstall} onClose={() => setPluginInstall(null)} />}
      <AppViewFilePreviewEditor app={app} />
      {/* 3D 预览弹窗（model-viewer 域）：自挂载，监听 model-viewer:open 推送（引擎 preview_3d） */}
      <ModelViewerBridge />
      {/* 悬浮球右键菜单里的「语音设置」：把「打开设置并跳到语音页」注册给 VoiceCallFloat
      （悬浮球是 body portal，拿不到这里的 setSettingsPage） */}
      <VoiceCallFloat threadId={thread?.id ?? ""} />
      <VoiceSettingsBridge onOpen={() => { setSettingsPage("voice"); setSettingsOpen(true); }} />
    </div>
    </HelpOpenContext.Provider>
  );
}
