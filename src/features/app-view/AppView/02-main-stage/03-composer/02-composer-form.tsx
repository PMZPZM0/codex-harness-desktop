/**
 * ComposerComposerForm —— MainStageComposer 的 JSX 第 2 段（09-22 从 03-composer.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { RelayBalanceBadge, RelayCenterPage } from "../../../../relay";
import { OpenaiBalanceBadge, OpenaiSubscriptionPage } from "../../../../openai";
import { avatarToneOf, AVATAR_GRADIENTS, registerThreadTeam, unregisterThreadTeam, resolveTeamMember } from "../../../../../lib/entity-avatar";
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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../../../components/CardShell";
import { EffortPicker } from "../../../../../components/EffortPicker";
import { ComposerEditor, ComposerMenu, ThreadFilePicker } from "../../../../composer";
import { basename } from "../../../../../lib/basename";
import { effortLabels } from "../../../../../lib/effort-labels";
import { expertRoleLabel } from "../../../../../lib/expert-role-label";
import { RunningProcessTime, CompletedChanges, ContextRing, UsageCounterSnapshot, ContextUsageBadge } from "../../../../status";
import { requestVoiceDictation, setVoiceDictationSendHandler, setVoiceOpenSettingsHandler, subscribeVoiceStage } from "../../../../../voice/wave-level";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../helpers";
import type { HarnessAppApi } from "../../../../app-state/useHarnessApp";

export function ComposerComposerForm({ app }: { app: HarnessAppApi }) {
  const {
    activeThreadRunning,
    addContextItem,
    addSkillReference,
    allModels,
    approvalPolicy,
    attachSubmenu,
    attachedFiles,
    attachmentMenuOpen,
    availableContextItems,
    cancelPromptEnhance,
    cancelQuote,
    changeEffort,
    changePermissionMode,
    chooseFiles,
    chooseModel,
    chooseWorkspace,
    compactPendingRef,
    composerDomValueRef,
    composerInputRef,
    connectorSearch,
    connectors,
    contextItems,
    contextOpen,
    currentModelId,
    customModel,
    dictationBaseRef,
    dictationWrittenRef,
    dismissEnhanceHint,
    effort,
    enhanceBusy,
    enhanceHint,
    expertQuery,
    expertTeams,
    favoriteQuery,
    favorites,
    goalStatus,
    goalText,
    hasEnhanceBackup,
    images,
    insertComposerFiles,
    insertFavorite,
    interrupt,
    interrupting,
    isEmpty,
    makeComposerChip,
    mergedSkillCatalog,
    modelId,
    onComposerKeyDown,
    onPromptChange,
    openModelEditor,
    openaiActiveAcct,
    pasteImage,
    pasteLongText,
    planArmed,
    planOnceRef,
    planRunning,
    plusSpinTick,
    prompt,
    quickMenuFlipUp,
    quickMenuPanelRef,
    quickMenuRef,
    quoteItem,
    recentCompaction,
    refreshFavorites,
    relayActive,
    removeContextItem,
    runPromptEnhance,
    sandbox,
    scheduleSubmenu,
    scheduleSubmenuClose,
    selectedSkills,
    send,
    sendFavorite,
    setAttachSubmenu,
    setAttachmentMenuOpen,
    setCompactEventState,
    setConnectorMenuOpen,
    setConnectorSearch,
    setContextOpen,
    setExpertQuery,
    setFavoriteQuery,
    setLocalSkills,
    setNotice,
    setPlanArmed,
    setPlusSpinTick,
    setPrompt,
    setSelectedSkills,
    setSettingsOpen,
    setSettingsPage,
    setSkillMenuOpen,
    setSkillQuery,
    setThreadFileQuery,
    setWelcomeCwdMenuOpen,
    setWelcomeScratchDir,
    showToast,
    skillCommandMatches,
    skillQuery,
    startMemberDirectSession,
    stopGoalLoop,
    submenuFlip,
    submenuTop,
    thread,
    threadFileCandidates,
    threadFileQuery,
    tokenUsage,
    voiceDictating,
    welcomeCwdMenuOpen,
    welcomeScratchDir,
    workspace,
  } = app;
  return (
    <form className="composer" onSubmit={send}>
                        {/* ⛔ 09-19 用户明令删除输入框内的「还没配模型」提示条（原话：「排版太丑，不要吸在
                            输入框上面吧」「输入框里面的删了」）。入口改为**左侧栏的「模型配置」菜单**
                            （sidebar-tabs），那里才是配置类功能的固定位置。别再把它塞回输入框。 */}
            {/* 欢迎页「项目地址」选择（仅空态显示，发送首条消息后随欢迎态消失）：
                            与右上角 📁 同一全局 workspace 联动；「无项目」模式每次自动新建独立临时目录 */}
                        {isEmpty && (
                          <div className="welcome-cwd-picker">
                            <button type="button" className={`welcome-cwd-chip ${welcomeScratchDir ? "scratch" : ""}`} title={welcomeScratchDir ? "无项目 · 本会话使用独立临时目录（点击更改）" : "项目地址：" + (workspace || "未选择（点击选择）")} onClick={() => setWelcomeCwdMenuOpen((open) => !open)}>
                              {welcomeScratchDir ? <FileQuestion size={12} /> : <FolderOpen size={12} />}
                              <span>{welcomeScratchDir ? "无项目 · 临时目录" : workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() || "项目地址" : "选择项目地址"}</span>
                              <ChevronDown size={11} className={welcomeCwdMenuOpen ? "up" : ""} />
                            </button>
                            {welcomeCwdMenuOpen && (
                              <div className="welcome-cwd-menu" role="menu">
                                {/* 09-14 用户反馈改版：三段式 + 重排——历史项目地址（有才显示）→ 新项目地址 → 不使用项目地址。
                                    「新项目地址」副文案**不得透出历史路径**（旧版显示 D:\test1 让用户误会点进去就是它）；
                                    「历史项目地址」副文案才显示当前 workspace 路径。 */}
                                {workspace && (
                                  <button type="button" role="menuitem" className={!welcomeScratchDir ? "active" : ""} onClick={async () => {
                                    setWelcomeCwdMenuOpen(false);
                                    setWelcomeScratchDir(null);
                                    // 已有历史项目地址：直接沿用（不再弹选择框）
                                    showToast("已使用历史项目地址", workspace);
                                  }}>
                                    <FolderOpen size={15} />
                                    <span>历史项目地址<small>{workspace}</small></span>
                                  </button>
                                )}
                                <button type="button" role="menuitem" className={!workspace && !welcomeScratchDir ? "active" : ""} onClick={async () => {
                                  setWelcomeCwdMenuOpen(false);
                                  setWelcomeScratchDir(null);
                                  await chooseWorkspace();
                                }}>
                                  <FolderPlus size={15} />
                                  <span>新项目地址<small>{workspace ? "另选一个目录作为本次的项目地址" : "选择一个目录作为本次的项目地址"}</small></span>
                                </button>
                                <button type="button" role="menuitem" className={welcomeScratchDir ? "active" : ""} onClick={async () => {
                                  setWelcomeCwdMenuOpen(false);
                                  if (welcomeScratchDir) return;
                                  try {
                                    const dir = await window.codex.createScratchDir();
                                    setWelcomeScratchDir(dir);
                                    showToast("无项目模式", "本次会话将使用自动创建的独立临时目录");
                                  } catch (error: any) { setNotice(`临时目录创建失败：${error.message}`); }
                                }}>
                                  <FileQuestion size={15} />
                                  <span>不使用项目地址<small>自动创建独立临时目录（每个会话单独一个）</small></span>
                                </button>
                              </div>
                            )}
                            </div>
                          )}
                        {quoteItem && <div className="quote-bar">
                          <Quote size={13} className="quote-bar-icon" />
                          <span className="quote-bar-label">引用</span>
                          <em className="quote-bar-text" title={quoteItem.text}>{quoteItem.text}</em>
                          <button type="button" title="取消引用" onClick={cancelQuote}><X size={13} /></button>
                        </div>}
                        {(contextItems.length > 0 || selectedSkills.length > 0) && <div className="context-chip-row" aria-label="已引用上下文与技能">{contextItems.map((item) => <span className="context-chip" key={item.id}><Quote size={12} /><b>{item.role}</b><em>{item.text}</em><button type="button" title="移除引用" onClick={() => removeContextItem(item.id)}><X size={12} /></button></span>)}{selectedSkills.map((skill) => <span className="context-chip" key={skill.name}><Zap size={12} /><b>技能</b><em>{skill.name}</em><button type="button" title="移除技能" onClick={() => setSelectedSkills((current) => current.filter((entry) => entry.name !== skill.name))}><X size={12} /></button></span>)}</div>}
                        <div className="composer-input-shell">
                        {(planArmed || planRunning) && <button type="button" className={`mode-chip-float chip-plan ${planRunning ? "running" : ""}`} title={planRunning ? "计划模式 · 方案生成中（点击中断）" : "计划模式 · 下一条消息先出方案（点击退出）"} onClick={() => { if (planRunning) { void interrupt(); } else { planOnceRef.current = false; setPlanArmed(false); showToast("计划模式已退出", "下一条消息按普通模式执行"); } }}><ListChecks size={13} /></button>}
                          {thread && goalText && goalStatus !== "complete" && <button type="button" className="mode-chip-float chip-goal" title="目标模式 · 自动推进中（点击停止）" onClick={stopGoalLoop}><Target size={13} /></button>}
                          <ComposerEditor value={prompt} placeholder="向 Codex 提问，使用 / 选择命令、@ 引用上下文、# 引用技能" editorRef={composerInputRef} domValueRef={composerDomValueRef} makeChip={makeComposerChip} onValueInput={onPromptChange} onKeyDown={(event) => { if (skillCommandMatches.length && event.key === "Enter") { event.preventDefault(); addSkillReference(skillCommandMatches[0]); return; } if (skillCommandMatches.length && event.key === "Escape") { event.preventDefault(); setPrompt(""); return; } if (contextOpen && event.key === "Enter" && availableContextItems[0]) { event.preventDefault(); addContextItem(availableContextItems[0]); return; } if (event.key === "Escape" && contextOpen) { event.preventDefault(); setContextOpen(false); return; } onComposerKeyDown(event); }} onBlur={() => setTimeout(() => setContextOpen(false), 120)} onPasteImage={(text) => void pasteImage(text)}                   onPasteFiles={(paths) => {
                                const added = paths.filter((p) => !attachedFiles.includes(p));
                                if (!added.length) return;
                                insertComposerFiles(added);
                                setNotice(`已粘贴 ${added.length} 个文件附件`);
                              }} onPasteLongText={(text) => void pasteLongText(text)} />
                        </div>
                        <div className="composer-actions">
                          <div className="composer-left">
                            <div className="composer-quick-menu" ref={quickMenuRef}>
                              <button
                                type="button"
                                className="icon-button plus-spin-button"
                                title="添加文件、技能或连接器"
                                aria-expanded={attachmentMenuOpen}
                                onClick={() => {
                                  setPlusSpinTick((tick) => tick + 1);
                                  setAttachmentMenuOpen((current) => {
                                    if (current) setAttachSubmenu("none");
                                    return !current;
                                  });
                                  setSkillMenuOpen(false);
                                  setConnectorMenuOpen(false);
                                }}
                              ><Plus key={plusSpinTick} size={19} className="plus-spin" /></button>
                              {attachmentMenuOpen && <div ref={quickMenuPanelRef} className={`composer-quick-pop ${quickMenuFlipUp ? "flip-main-up" : ""}`}>
                                <button type="button" data-submenu-open={attachSubmenu === "files" || undefined} onMouseEnter={() => scheduleSubmenu("files")} onMouseLeave={scheduleSubmenuClose} onClick={() => setAttachSubmenu((current) => current === "files" ? "none" : "files")}><Plus size={16} /><span>添加文件</span><ChevronDown size={14} className="submenu-chevron" /></button>
                                <button type="button" data-submenu-open={attachSubmenu === "thread-files" || undefined} onMouseEnter={() => scheduleSubmenu("thread-files")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "thread-files" ? "none" : "thread-files"); setThreadFileQuery(""); }}><Quote size={16} /><span>引用对话中的文件</span><ChevronDown size={14} className="submenu-chevron" /></button>
                                <button type="button" data-submenu-open={attachSubmenu === "experts" || undefined} onMouseEnter={() => scheduleSubmenu("experts")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "experts" ? "none" : "experts"); setExpertQuery(""); }}><Users size={16} /><span>专家</span><ChevronDown size={14} className="submenu-chevron" /></button>
                                <button type="button" data-submenu-open={attachSubmenu === "skills" || undefined} onMouseEnter={() => { scheduleSubmenu("skills"); // 打开时实时刷新已安装技能：localSkills 只在启动时拉一次，中途装的技能不刷新就看不到（同步问题）
                                  void window.codex.listLocalSkills().then(setLocalSkills).catch(() => undefined); }} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "skills" ? "none" : "skills"); setSkillQuery(""); void window.codex.listLocalSkills().then(setLocalSkills).catch(() => undefined); }}><Zap size={16} /><span>技能</span><ChevronDown size={14} className="submenu-chevron" /></button>
                                <button type="button" data-submenu-open={attachSubmenu === "connectors" || undefined} onMouseEnter={() => scheduleSubmenu("connectors")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "connectors" ? "none" : "connectors"); setConnectorSearch(""); }}><Link2 size={16} /><span>连接器</span><ChevronDown size={14} className="submenu-chevron" /></button>
                                {/* 收藏夹（09-24）：列出收藏，点一下插入输入框，右侧箭头一键发送。
                                    打开时实时刷新一次 —— 与技能子菜单同款：收藏可能被设置页/另一个窗口
                                    改过，镜像不刷新就会显示过期列表（删掉的还在、新加的看不到）。 */}
                                <button type="button" data-submenu-open={attachSubmenu === "favorites" || undefined} onMouseEnter={() => { scheduleSubmenu("favorites"); void refreshFavorites(); }} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "favorites" ? "none" : "favorites"); setFavoriteQuery(""); void refreshFavorites(); }}><Star size={16} /><span>收藏夹</span>{favorites.length > 0 && <em className="submenu-count">{favorites.length}</em>}<ChevronDown size={14} className="submenu-chevron" /></button>
            
                            {/* 添加文件子菜单：暂只保留本地文件（云端入口待定，不留占位） */}
                            {attachSubmenu === "files" && <div className={`composer-quick-pop submenu-pop files-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="files" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <button type="button" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); void chooseFiles(); }}><FileUp size={15} /><span>本地文件</span></button>
                            </div>}
                            {/* 引用对话中的文件：带搜索框的子面板（过滤当前会话消息里出现过的文件路径） */}
                            {attachSubmenu === "thread-files" && <div className={`composer-quick-pop submenu-pop thread-files-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="thread-files" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <ThreadFilePicker
                                query={threadFileQuery}
                                onQuery={setThreadFileQuery}
                                candidates={threadFileCandidates}
                                onPick={(path) => { if (!attachedFiles.includes(path)) insertComposerFiles([path]); setAttachmentMenuOpen(false); setAttachSubmenu("none"); setNotice(`已引用文件：${basename(path)}`); }}
                                onClose={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}
                              />
                            </div>}
                            {/* 专家子面板：搜索 + 专家团成员列表 + 召唤更多（进专家团设置页） */}
                            {attachSubmenu === "experts" && <div className={`composer-quick-pop submenu-pop experts-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="experts" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <div className="submenu-search"><Search size={13} /><input autoFocus value={expertQuery} onChange={(event) => setExpertQuery(event.target.value)} placeholder="搜索专家" /></div>
                              <div className="submenu-list">
                                {expertTeams.filter((team) => team.enabled).flatMap((team) => [team.lead, ...team.members].filter((member) => !expertQuery.trim() || expertRoleLabel(member, member.id === team.lead.id).includes(expertQuery.trim())).map((member) => (
                                  <button type="button" key={`${team.teamId}:${member.id}`} onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); void startMemberDirectSession(team, member); }}>
                                    <span className={`expert-menu-avatar${member.id === team.lead.id ? " is-lead" : ""}`} style={member.id === team.lead.id ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}>{expertRoleLabel(member, member.id === team.lead.id).slice(0, 1)}</span>
                                    <span className="expert-menu-name">{expertRoleLabel(member, member.id === team.lead.id)}</span>
                                    <small>{team.profession.zh || team.displayName.zh}</small>
                                  </button>
                                )))}
                                {!expertTeams.some((team) => team.enabled) && <p className="submenu-empty">还没有启用的专家团</p>}
                              </div>
                              <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("teams"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>召唤更多专家</span></button>
                            </div>}
                            {/* 技能子面板：搜索 + 已安装技能列表 + 管理入口（贴一级菜单，同专家面板形态） */}
                            {attachSubmenu === "skills" && <div className={`composer-quick-pop submenu-pop skills-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="skills" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <div className="submenu-search"><Search size={13} /><input autoFocus value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="搜索已安装技能" /></div>
                              <div className="submenu-list">
                                {(() => {
                                  // 数据源统一走 mergedSkillCatalog（本地 + 引擎，规范化去重，附中文注释）：
                                  // 原先此处只显示前 8 条，列表一长就看不到后面的技能（自我进化技能就是这样"没透"）。
                                  // 面板本身有 max-height + overflow-y，直接全量展示由滚动承载。
                                  const q = skillQuery.trim().toLowerCase();
                                  return mergedSkillCatalog
                                    .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.note.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
                                    .map((skill) => <button type="button" key={skill.name} title={`${skill.name}：${skill.note}`} onClick={() => { addSkillReference(skill); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}><Zap size={15} /><span className="expert-menu-name">{skill.name}</span><small>{skill.note}</small></button>);
                                })()}
                                {!skillQuery.trim() && !mergedSkillCatalog.length && <p className="submenu-empty">还没有安装技能</p>}
                              </div>
                              <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("skills"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>管理技能中心</span></button>
                            </div>}
                            {/* 连接器子面板：搜索 + 已配置连接器列表 + 管理入口 */}
                            {attachSubmenu === "connectors" && <div className={`composer-quick-pop submenu-pop connectors-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="connectors" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <div className="submenu-search"><Search size={13} /><input autoFocus value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} placeholder="搜索已配置连接器" /></div>
                              <div className="submenu-list">
                                {connectors.filter((connector) => connector.name.includes(connectorSearch) || connector.id.includes(connectorSearch)).slice(0, 8).map((connector) => <button type="button" key={connector.id} onClick={() => { setPrompt((current) => `${current}${current ? "\n" : ""}[本轮可使用连接器：${connector.name}]`); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}><Link2 size={15} /><span className="expert-menu-name">{connector.name}</span><small>{connector.transport === "stdio" ? connector.command : connector.url}</small></button>)}
                                {!connectors.length && <p className="submenu-empty">尚未配置真实 MCP 连接器</p>}
                              </div>
                              <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("mcp"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>管理连接器</span></button>
                            </div>}
                            {/* 收藏架子面板（09-24）：搜索 + 列表（点行=插入，箭头=一键发送）+ 管理入口。
                                形态刻意与技能/连接器面板一致 —— 同一套一级菜单里的子面板不该有三种交互语言。 */}
                            {attachSubmenu === "favorites" && <div className={`composer-quick-pop submenu-pop favorites-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="favorites" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                              <div className="submenu-search"><Search size={13} /><input autoFocus value={favoriteQuery} onChange={(event) => setFavoriteQuery(event.target.value)} placeholder="搜索收藏（标题 / 内容 / 标签）" /></div>
                              <div className="submenu-list">
                                {(() => {
                                  const q = favoriteQuery.trim().toLowerCase();
                                  const list = favorites.filter((item) => !q
                                    || item.title.toLowerCase().includes(q)
                                    || item.content.toLowerCase().includes(q)
                                    || item.tags.some((tag) => tag.toLowerCase().includes(q)));
                                  if (!list.length) return <p className="submenu-empty">{favorites.length ? "没有匹配的收藏" : "还没有收藏 —— 在任意消息上点 ☆ 即可收藏"}</p>;
                                  return list.map((item) => (
                                    <div className="favorite-row" key={item.id}>
                                      <button type="button" className="favorite-main" title={`插入到输入框：${item.content}`} onClick={() => { insertFavorite(item); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}>
                                        {item.kind === "image" ? <Image size={14} /> : item.kind === "file" ? <FileText size={14} /> : item.kind === "link" ? <Link2 size={14} /> : <Quote size={14} />}
                                        <span className="favorite-title">{item.title || item.content.slice(0, 40)}</span>
                                        <small>{item.content.replace(/\s+/g, " ").slice(0, 40)}</small>
                                      </button>
                                      <button type="button" className="favorite-send" title="一键发送" aria-label="一键发送" onClick={() => { void sendFavorite(item); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}><Send size={13} /></button>
                                    </div>
                                  ));
                                })()}
                              </div>
                              <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("favorites"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>管理收藏夹</span></button>
                            </div>}
                              </div>}
                            </div>
                            <ComposerMenu icon={ShieldCheck} label="权限" title="权限模式" tone={sandbox === "danger-full-access" ? "danger" : undefined} value={sandbox === "danger-full-access" ? "never" : approvalPolicy} options={approvalMenuOptions(sandbox === "danger-full-access")} onChange={changePermissionMode} />
                          </div>
                          <div className="composer-right">
                            <div className="model-controls">
                              {relayActive && customModel?.provider === relayActive.provider && <RelayBalanceBadge active={relayActive} />}
                              {customModel?.provider === "openai-official" && <OpenaiBalanceBadge accountKey={openaiActiveAcct ?? "openai-official"} />}
                              <ContextUsageBadge tokenUsage={tokenUsage} fallbackWindow={customModel?.models?.find((m) => m.id === customModel?.model)?.contextWindow ?? customModel?.contextWindow} recentCompaction={recentCompaction} onCompact={() => { if (thread?.id) { compactPendingRef.current.add(thread.id); setCompactEventState("running"); window.codex.request("thread/compact/start", { threadId: thread.id }).catch((error: any) => { compactPendingRef.current.delete(thread.id); setCompactEventState("error", error.message); }); } }} />
                              <ComposerMenu icon={Bot} label="模型" title="模型" disabled={!customModel} value={modelId} width={330} options={[...allModels.map((model) => ({
                                value: model.id,
                                title: model.model,
                                // 当前供应商不需要重复说明；跨供应商模型只补充供应商名称用于区分。
                                desc: model.isActive ? "" : model.providerName,
                                // 徽标顺序刻意「能不能看图 → 能吞多少」：新用户最关心的两件事排前两位
                                badges: modelBadges(model),
                              })), { value: "__model_settings__", title: "更多设置…", desc: "打开模型配置（档位在输入框底栏的「思考强度」里选，按会话各自记忆）" }]} toneOf={(option) => option.value === "__model_settings__" ? undefined : avatarToneOf(option.desc || option.title)} onChange={(value) => {
                                if (value === "__model_settings__") { setSettingsPage("model"); setSettingsOpen(true); const live = customModel?.models?.find((m) => m.id === customModel?.model); if (live) openModelEditor(live); return; }
                                chooseModel(value);
                              }} />
                              {/* 思考强度：底栏一个档位按钮，点开是**宽彩色动态条**的弹窗（09-17 用户两次要求：
                                  「改成彩色横向拖动进度条，每个等级颜色都不一样」→「弹窗拖动，不是输入框直接
                                  一个长条，gpt 那种宽的彩色动态条」）。档位**恒为全集**（09-18 起不再按模型
                                  声明过滤 —— 档位是会话级选择），不支持的档位由发送失败自动降档兜底
                                  （effort-support.ts）。拖动中只跟手、释放才提交，原因见 EffortPicker 注释。 */}
                              <EffortPicker
                                levels={[...ALL_EFFORTS]}
                                value={effort}
                                labels={effortLabels}
                                modelId={currentModelId}
                                onCommit={changeEffort}
                              />
                            </div>
                            {/* 增强按钮：只要输入框有内容（或还有可还原的原文备份）就显示。
                                ⛔ 不再按「回合是否在跑」隐藏（09-23 用户要求）：运行中输入框里输入的
                                是**下一条**消息的草稿，增强改的是草稿本身，与在跑的回合互不相干；
                                以前按 running 隐藏，用户在长任务里写草稿时按钮凭空消失。 */}
                            {(prompt.trim() || hasEnhanceBackup) && (
                              <div className="enhance-wrap">
                                {enhanceHint && (
                                  /* 气泡本体是 div 而非 button：内部还要放一个关闭按钮，
                                     button 里嵌 button 是无效的嵌套交互元素（键盘与读屏都会乱）。 */
                                  <div
                                    className="enhance-hint"
                                    role="button"
                                    tabIndex={0}
                                    title="点击开始优化"
                                    onClick={() => { dismissEnhanceHint(); void runPromptEnhance(); }}
                                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dismissEnhanceHint(); void runPromptEnhance(); } }}
                                  >
                                    <span className="enhance-hint-text">{enhanceHint}</span>
                                    <button type="button" className="enhance-hint-close" aria-label="不再提示" title="关掉这条提示" onClick={(event) => { event.stopPropagation(); dismissEnhanceHint(); }}><X size={11} /></button>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  className={`enhance-button ${enhanceBusy ? "loading" : ""} ${hasEnhanceBackup && !enhanceBusy ? "revert" : ""}`}
                                  title={enhanceBusy ? "增强中，点击取消" : hasEnhanceBackup ? "还原为原文" : "AI 优化提示词"}
                                  aria-label={enhanceBusy ? "增强中，点击取消" : hasEnhanceBackup ? "还原为原文" : "AI 优化提示词"}
                                  disabled={enhanceBusy ? false : !prompt.trim()}
                                  onClick={() => {
                                    dismissEnhanceHint();   // 用户已经知道这个按钮是干什么的了，不必再提醒
                                    if (enhanceBusy) { cancelPromptEnhance(); return; }
                                    void runPromptEnhance();
                                  }}
                                >
                                  {enhanceBusy ? <Spinner /> : hasEnhanceBackup ? <RotateCcw size={16} /> : <Sparkles size={16} />}
                                </button>
                              </div>
                            )}
                            {/* 输入框语音听写：只展示图标。点击一次开始/停止，识别字幕实时回填 composer。 */}
                            <button
                              type="button"
                              className={`composer-mic-button ${voiceDictating ? "recording" : ""}`}
                              title={voiceDictating ? "结束语音输入" : "语音输入（长按快捷键也可说话）"}
                              aria-label={voiceDictating ? "结束语音输入" : "语音输入"}
                              onClick={() => {
                                if (!voiceDictating) {
                                  dictationBaseRef.current = prompt;
                                  // 新一轮听写：位标清零（否则会拿上一条字幕当"我们写过的内容"去比对）
                                  dictationWrittenRef.current = "";
                                }
                                requestVoiceDictation();
                              }}
                            >
                              {voiceDictating ? <span className="composer-recording-bars" aria-hidden><i /><i /><i /></span> : <Mic size={18} />}
                            </button>
            
                            {/* 始终只有一个主操作按钮：
                                - 空闲：发送图标
                                - 运行中且输入框为空：暂停/停止图标
                                - 运行中输入了新内容：同一个按钮平滑过渡成发送图标，点击加入排队
                                - 排队发送后输入框清空：同一个按钮自动过渡回暂停图标 */}
                            {(() => {
                              const hasDraft = Boolean(prompt.trim() || quoteItem || images.length || attachedFiles.length);
                              const runningCanQueue = activeThreadRunning && hasDraft;
                              const showPause = activeThreadRunning && !hasDraft;
                              return (
                                <button
                                  type={runningCanQueue || !activeThreadRunning ? "submit" : "button"}
                                  className={`send-button morph-action ${showPause ? "is-pause" : "is-send"}`}
                                  title={showPause ? "停止当前任务" : runningCanQueue ? "发送（任务运行中，将加入排队）" : "发送"}
                                  aria-label={showPause ? "停止当前任务" : "发送"}
                                  disabled={showPause ? interrupting : !hasDraft}
                                  onClick={showPause ? () => void interrupt() : undefined}
                                >
                                  <span className="morph-action-icon">
                                    {interrupting && showPause ? <Spinner /> : showPause ? <Pause size={18} fill="currentColor" /> : <Send size={18} />}
                                  </span>
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </form>
  );
}
