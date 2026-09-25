/**
 * AppView —— 应用主壳的**视图层**（09-22 从 src/App.tsx 分出，纯搬迁）。
 * · App() 只保留「调 useHarnessApp → earlyView 短路 → 渲染本组件」。
 * · 本文件持有原 App() 的 751 个解构绑定与 1,840 行 JSX，**逐字未改**。
 * · props 类型 = useHarnessApp() 的返回类型（type-only import ⇒ 运行时零依赖）。
 */
import { hk } from "../../lib/hk";
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
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "./helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "./types";
import type { HarnessAppApi } from "../app-state/useHarnessApp";
import { AppViewSidebarShell } from "./AppView/01-sidebar-shell";
import { AppViewMainStage } from "./AppView/02-main-stage";
import { AppViewReviewPanel } from "./AppView/03-review-panel";
import { AppViewRemoteApproval } from "./AppView/04-remote-approval";
import { AppViewRemoteConsole } from "./AppView/05-remote-console";
import { AppViewTaskComposer } from "./AppView/06-task-composer";
import { AppViewMemoryPanel } from "./AppView/07-memory-panel";
import { CompanyModeView } from "../company-mode/CompanyModeView";
import { AppViewSettingsSheet } from "./AppView/08-settings-sheet";
import { AppViewFilePreviewEditor } from "./AppView/09-file-preview-editor";

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
    contextOpen, copyImage, copyThreadReferenceId, currentModelId,
    currentProvider, customCommands, customDraft, customModel,
    delegatedPopupId, delegatedPopupRun, delegatedRailRuns, deleteExpertTeam,
    deleteMemoryGroup, deleteMemoryRecord, deleteQueued, deleteSchedule,
    deleteSubAgent, deleteThreadsByCwd, desktopAuto, devRuntimes,
    dictationBaseRef, diff, dismissEnhanceHint, dismissNotice,
    doneExpanded, downloadSource, duplicateSshEntry, earlierLoadingId,
    editSchedule, editingProvider, effort, emptySshDraft,
    emptySshJump, engineCheck, engineUpdateLog, engineUpdatePercent,
    engineUpdateResult, engineUpdateStageText, engineUpdating, engineVersion,
    enhanceBusy, enhanceHint, envCheckOpen, envInstalling,
    envItems, envPercent, envProgress, envSpeed,
    envStage, executeRateLimitRetry, expandedProjects, expertQuery,
    expertTeamDraft, expertTeamEditorOpen, expertTeamMemberDirect, expertTeamMemberRunning,
    expertTeamRunning, expertTeams, exportSshEntries, exportThreadsBackup,
    exportThreadsMarkdown, fileDraft, fileEditing, filePreview,
    fileTabs, fileTruncated, forgetPendingImport, globalPermApproval,
    goalStatus, goalText, goalsAutoGone, goalsDocked,
    goalsExpanded, goalsOpen, greetSub, greeting,
    groupBusy, groupedThreads, handleLogout, hardwareAccel,
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
    quickMenuRef, quickSetup, quickSetupBusy, quickSetupError,
    quoteItem, railLastByMember, railRunningByMember, railTeam,
    rateLimitRetries, rawOpenFile, readMood, recentCompaction,
    refreshActive, refreshCommands, refreshExpertTeams, refreshMarketSkills,
    refreshPluginsPage, refreshSettingsResources, refreshSubAgents, refreshThreads,
    relaunchCountdown, relayActivate, relayActive, relayBusy,
    relayQuickLogin, relaySetupBusy, relaySetupError, releaseToUserRef,
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
    selectedModel, selectedSkills, send, sending,
    serverStatus, setAccountDraft, setAccountEditing, setAccountMenuOpen,
    setAccountMenuSub, setActiveBotId, setAgentAsk, setAppConfirm,
    setAppPrompt, setArchiveToast, setAttachSubmenu, setAttachmentMenuOpen,
    setAutoCompactRatio, setAutoFormVisible, setBotBinding, setBotChannelPick,
    setBotManagerOpen, setBotsPersist, setBrowserDraft, setBrowserHome,
    setChannelOnline, setCommandDelete, setCommandEditor, setCommandFilter,
    setCommandSearch, setCompactEventState, setCompactToast, setConnectorChecked,
    setConnectorDraft, setConnectorEditorOpen, setConnectorEnabled, setConnectorMenuOpen,
    setConnectorOAuth, setConnectorSearch, setConnectorSecret, setConnectorTemplateModal,
    setConnectorTemplateValues, setConnectorsManageOnly, setContextOpen, setCustomDraft,
    setDelegatedPopupId, setDoneExpanded, setEditingProvider, setEnvCheckOpen,
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
    setSettingsOpen, setSettingsPage, setShortcutsOpen, setShowApiKey,
    setShowModelGuide, setSidebarCollapsed, setSidebarFlyout, setSkillChecked,
    setSkillHubCategory, setSkillHubFilterCategory, setSkillHubSearch, setSkillInstall,
    setSkillManageSearch, setSkillMenuOpen, setSkillQuery, setSkillRemove,
    setSkillsManageOnly, setSshChecked, setSshDraft, setSshEditorTest,
    setSshExecTarget, setSshFilter, setSshQuery, setSshTerminal,
    setSubAgentDraft, setSubAgentEditorOpen, setTaskList, setTeamHistoryMember,
    setTeamPopupRunId, setTheme, setThreadFileQuery, setUiFont,
    setUiLang, setUiZoom, setUpdateNotice, setUsageStats,
    setUserAvatar, setUsername, setViewTab, setWelcomeCwdMenuOpen,
    setWelcomeScratchDir, settingsContentReady, settingsOpen, settingsPage,
    settingsResources, shellRef, shortcutsOpen, showApiKey,
    showLogin, showModelGuide, showToast, sidebarAllCollapsed,
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
    uiFont, uiLang, uiZoom, uninstallDevRuntime,
    updateBotStream, updateChecking, updateCurrentVersion, updateDownloading,
    updateError, updateInfo, updateMemoryMode, updateNotice,
    updateProgress, upstreamRetries, usage, useCommand,
    userAvatar, userDataPath, username, viewTab,
    voiceDictating, waitingForApproval, waitingForInput, welcomeCwdMenuOpen,
    welcomeScratchDir, workspace, workspaceMemoryEnabled,
  } = app;
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
      {!popoutThreadId && sidebarCollapsed && <div className="sidebar-hotzone" aria-hidden onMouseEnter={() => setSidebarFlyout(true)} />}
        <header className="topbar">
        {sidebarCollapsed && !narrow && <button className="icon-button sidebar-reveal" title="展开侧边栏" onClick={() => { setSidebarCollapsed(false); setSidebarFlyout(false); localStorage.setItem("sidebar-collapsed", "false"); }}><Menu size={18} /></button>}
        <button className="icon-button mobile-menu" title="打开导航" onClick={() => setMobileNav(!mobileNav)}><Menu size={18} /></button>
        <div className={`task-title ${activeThreadRunning ? "running" : "ready"}`}>
          {inlineRename ? <input ref={inlineRenameRef} value={renameDraft} aria-label="任务名称" onChange={(event) => setRenameDraft(event.target.value)} onBlur={saveInlineRename} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveInlineRename(); } if (event.key === "Escape") { event.preventDefault(); setInlineRename(false); } }} /> : <strong title="双击修改任务名称" onDoubleClick={() => { if (!thread) return; setRenameDraft(cleanThreadDisplayTitle(thread.name, { preview: thread.preview })); setInlineRename(true); queueMicrotask(() => { inlineRenameRef.current?.focus(); inlineRenameRef.current?.select(); }); }}>{cleanThreadDisplayTitle(thread?.name, { preview: thread?.preview, fallback: cleanThreadDisplayTitle(switchingMeta?.name, { preview: switchingMeta?.preview, fallback: "新任务" }) })}</strong>}
          <span>{workspace || "尚未选择工作区"}</span>
          {subAgentRunning && <span className="subagent-badge" title={`子智能体「${subAgentRunning}」执行中`}><Bot size={13} className="subagent-pulse" /><em>{subAgentRunning}</em><i>执行中</i></span>}
        </div>
        <div className="topbar-actions">{topbarActionsNode}</div>
      </header>
      <AppViewSidebarShell app={app} />
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
      <AppViewRemoteApproval app={app} />
      <AppViewRemoteConsole app={app} />
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
      {/* 公司模式（09-25）：专家团的公司化组织架构可视化 —— 中间对话框保持正常，这里只是「第三只眼」 */}
      <CompanyModeView
        open={app.companyModeOpen}
        onClose={() => app.setCompanyModeOpen(false)}
        teams={app.expertTeams}
        threads={app.threads}
        runningThreadIds={app.runningThreadIds}
        openThread={(threadId) => void openThread(threadId)}
        onOpenTeamCenter={() => { app.setSettingsPage("agentteam"); app.setSettingsOpen(true); }}
      />
      {shortcutsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}><div className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="键盘快捷键"><header><div><Keyboard size={17} /><strong>键盘快捷键</strong><span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setShortcutsOpen(false)}><X size={17} /></button></header><div className="shortcuts-body">{SHORTCUT_GROUPS.map((group) => <section className="shortcuts-group" key={group.group}><h3>{group.group}</h3>{group.shortcuts.map((item) => <div className="shortcuts-row" key={item.keys.join("+")}><span className="shortcut-desc">{item.desc}</span><span className="shortcut-keys">{item.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span></div>)}</section>)}<footer><span className="muted">部分快捷键在输入框聚焦时优先用于文本编辑。</span></footer></div></div></div>}
      {marketPreview && <MarketPreviewModal state={marketPreview} onClose={() => setMarketPreview(null)} />}
      {skillInstall && <SkillInstallModal state={skillInstall} onClose={() => setSkillInstall(null)} onUse={() => { const skill = { name: skillInstall.skill.name, description: skillInstall.skill.description }; setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, skill]); setSkillInstall(null); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); }} />}
      {skillRemove && <SkillRemoveModal state={skillRemove} onClose={() => setSkillRemove(null)} />}
      {pluginInstall && <PluginInstallModal state={pluginInstall} onClose={() => setPluginInstall(null)} />}
      <AppViewFilePreviewEditor app={app} />
      {/* 悬浮球右键菜单里的「语音设置」：把「打开设置并跳到语音页」注册给 VoiceCallFloat
      （悬浮球是 body portal，拿不到这里的 setSettingsPage） */}
      <VoiceCallFloat threadId={thread?.id ?? ""} />
      <VoiceSettingsBridge onOpen={() => { setSettingsPage("voice"); setSettingsOpen(true); }} />
    </div>
    </HelpOpenContext.Provider>
  );
}
