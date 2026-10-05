/**
 * AppViewMemoryPanel —— AppView 的 JSX 第 7 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { MemoryFunnel, MemoryLayersEditor, MemoryConfigModal, MemoryHygienePanel, MemoryPyramid, MemoryInjectPreview } from "../../memory";
import { MemoryWorkbench } from "../../memory-ui";
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
import { GlobalSearchView } from "../../../components/IndexLibrary";
import { basename } from "../../../lib/basename";
import { APPROVAL_MODES, CHANNEL_STATUS_KEY, CJK_TEXT_RE, COMPOSER_FILE_CHIP_ICON, DELEGATE_RAIL_LINGER_MS, DIFF_VIRTUAL_THRESHOLD, EXPERT_CATEGORY_DEFS, EXPERT_CATEGORY_LABELS, HOOK_EVENT_LABELS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, LOCAL_MODEL_PRESETS, MEMBER_LABELS, MEMORY_CATEGORIES, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES, RRULE_DAY_NAMES, RUN_PHRASES, RUN_PHRASES_BY_ACTIVITY, SANDBOX_MODES, SHORTCUT_GROUPS, SKILL_ZH_NOTES } from "../constants";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../types";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewMemoryPanel({ app }: { app: HarnessAppApi }) {
  const {
    clearSelectedMemory,
    deleteMemoryGroup,
    deleteMemoryRecord,
    localSkills,
    memories,
    memoryCategory,
    memoryCenterOpen,
    memoryCenterTab,
    memoryDistilling,
    memoryDraft,
    memoryGateway,
    memoryGroupsFiltered,
    memoryLayerDirty,
    memoryLayerDraft,
    memoryLayerSavedAt,
    memoryLayerScope,
    memoryLayers,
    memoryManagementWorkspace,
    memoryMode,
    memoryProjectEnabled,
    memoryProjectMenuOpen,
    memoryProjectOptions,
    memoryProjectPickerRef,
    memoryProjectWorkspace,
    memorySaveCategory,
    memorySavedAt,
    memoryStatus,
    memoryVisibleRecords,
    openAppConfirm,
    openThread,
    runMemoryDistill,
    saveMemoryLayer,
    saveMemoryRecord,
    scheduledTasks,
    setMemoryCategory,
    setMemoryCenterOpen,
    setMemoryCenterTab,
    setMemoryConfigOpen,
    setMemoryDraft,
    setMemoryLayerDraft,
    setMemoryLayerScope,
    setMemoryPreview,
    setMemoryProjectEnabled,
    setMemoryProjectMenuOpen,
    setMemoryProjectWorkspace,
    setMemorySaveCategory,
    setMemoryStatus,
    setSearchPreview,
    setSettingsOpen,
    setSettingsPage,
    threads,
    togglePinned,
    updateMemoryMode,
  } = app;
  return (
    memoryCenterOpen && <div className="modal-backdrop memory-center-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemoryCenterOpen(false); }}>
            <section className="memory-center-modal" role="dialog" aria-modal="true" aria-label="记忆中心">
              <header className="memory-center-head">
                <div className="memory-center-heading">
                  <span className="memory-center-logo"><Brain size={18} /></span>
                  <div><strong>记忆中心</strong><span>常驻记忆每轮对话自动注入；记忆条目在发消息时按需召回；存储决定条目保存在本地还是云端。</span></div>
                </div>
                <div className="memory-center-tabs" role="tablist" aria-label="记忆中心视图">
                  <button role="tab" aria-selected={memoryCenterTab === "library"} className={`memory-center-tab ${memoryCenterTab === "library" ? "active" : ""}`} onClick={() => setMemoryCenterTab("library")}><Archive size={14} />记忆库</button>
                  <button role="tab" aria-selected={memoryCenterTab === "search"} className={`memory-center-tab ${memoryCenterTab === "search" ? "active" : ""}`} onClick={() => setMemoryCenterTab("search")}><Search size={14} />全局搜索</button>
                  <button role="tab" aria-selected={memoryCenterTab === "layers"} className={`memory-center-tab ${memoryCenterTab === "layers" ? "active" : ""}`} onClick={() => setMemoryCenterTab("layers")}><BookOpen size={14} />常驻记忆</button>
                  <button role="tab" aria-selected={memoryCenterTab === "storage"} className={`memory-center-tab ${memoryCenterTab === "storage" ? "active" : ""}`} onClick={() => setMemoryCenterTab("storage")}><Cloud size={14} />存储与同步</button>
                </div>
                <button className="icon-button" title="关闭记忆中心" onClick={() => setMemoryCenterOpen(false)}><X size={18} /></button>
              </header>
              <div className="memory-center-body">
                <div className="memory-project-context">
                  <div className="memory-project-context-copy"><FolderOpen size={14} /><div><strong>当前管理项目</strong><span>{memoryManagementWorkspace ? "项目背景、项目记忆、日志和条目都按这个项目管理" : "全部项目总览；选择具体项目后才能编辑项目背景或项目记忆"}</span></div></div>
                  <div className={`memory-project-picker ${memoryProjectMenuOpen ? "open" : ""}`} ref={memoryProjectPickerRef}>
                    <button type="button" className="memory-project-picker-button" aria-haspopup="listbox" aria-expanded={memoryProjectMenuOpen} onClick={() => setMemoryProjectMenuOpen((current) => !current)}>
                      <FolderOpen size={14} aria-hidden="true" />
                      <span className="memory-project-picker-current"><strong>{memoryManagementWorkspace ? basename(memoryManagementWorkspace) : "全部项目"}</strong><small>{memoryManagementWorkspace || "跨项目总览"}</small></span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    {memoryProjectMenuOpen && <div className="memory-project-picker-menu" role="listbox" aria-label="选择记忆项目">
                      <button type="button" role="option" aria-selected={memoryProjectWorkspace === "__all__"} className={`memory-project-option ${memoryProjectWorkspace === "__all__" ? "selected" : ""}`} onClick={() => { setMemoryProjectWorkspace("__all__"); setMemoryLayerScope("user"); setMemoryProjectMenuOpen(false); }}>
                        <span className="memory-project-option-icon"><Layers3 size={14} /></span><span className="memory-project-option-copy"><strong>全部项目</strong><small>跨项目总览与全局记忆</small></span>{memoryProjectWorkspace === "__all__" && <Check size={14} />}
                      </button>
                      {memoryProjectOptions.map((cwd) => <button type="button" role="option" aria-selected={memoryProjectWorkspace === cwd} className={`memory-project-option ${memoryProjectWorkspace === cwd ? "selected" : ""}`} key={cwd} onClick={() => { setMemoryProjectWorkspace(cwd); setMemoryLayerScope("background"); setMemoryProjectMenuOpen(false); }}>
                        <span className="memory-project-option-icon"><FolderOpen size={14} /></span><span className="memory-project-option-copy"><strong>{basename(cwd)}</strong><small title={cwd}>{cwd}</small></span>{memoryProjectWorkspace === cwd && <Check size={14} />}
                      </button>)}
                      {!memoryProjectOptions.length && <div className="memory-project-option-empty">还没有发现项目，请先打开一个工作区</div>}
                    </div>}
                  </div>
                </div>
                {memoryCenterTab === "library" && <div className="memory-center-pane">
                  {/* ⭐ 10-05 统一记忆（fabric）：**新的主入口**，放在旧记忆库上方。
                      ⛔ 为什么要分区而不是混在一起排：会话记忆与项目记忆的**可见范围完全不同**
                      （一个只属于一个会话、一个全体共享）⇒ 混排时用户无法判断"这条会不会被别的会话读到"。
                      ⛔ 旧记忆库（下方）是碎片池 + P0–P3 分层，仍在用，⛔ 不删（不擅自改既有语义）。 */}
                  <div className="memory-center-block">
                    <MemoryWorkbench workspace={memoryManagementWorkspace} onOpenThread={(id) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(id); }} />
                  </div>
                  <div className="memory-center-block">
                    {/* ⛔⛔ 10-05 用户定稿：「记忆只能由智能体自身在运行过程中自动新增，
                        不提供用户手动新增 / 编辑 / 删除的入口」⇒ 手动保存表单已移除。
                        ⛔ 查看仍然保留（用户要能看），⛔ 写只能由模型在干活时自己决定。 */}
                    <div className="memory-center-block-head"><div><strong>记忆由智能体自己写</strong><span>记忆只能由智能体在干活时自己记下（对话里说「记住这个」，或让它自己判断什么值得记）。这里可以查看，但不能手动增删改。</span></div></div>
                  </div>
                  <div className="memory-library">
                    <div className="memory-library-head">
                      <div className="memory-library-title"><h3>记忆库</h3><p>按重要度 P0–P3 分层，点击条目可看全文；★ 置顶的核心记忆不会被自动清理。</p><button className="secondary-setting" title="到全局搜索里按关键词找会话、记忆、任务与技能" onClick={() => setMemoryCenterTab("search")}><Search size={13} />到全局搜索找</button></div>
                      <div className="memory-toolbar">
                        <span className="memory-count">{memoryVisibleRecords.length} 条 · {memoryMode === "cloud" ? "云端同步 / 本地缓存" : "本地"}</span>
                      </div>
                    </div>
                    <div className="memory-funnel-toolbar">
                      <span className="memory-funnel-toolbar-label">分类筛选</span>
                      <div className="memory-funnel-chips" role="tablist" aria-label="按分类筛选">
                        <button role="tab" aria-selected={memoryCategory === ""} className={`memory-funnel-chip ${memoryCategory === "" ? "active" : ""}`} onClick={() => setMemoryCategory("")}>全部</button>
                        {MEMORY_CATEGORIES.map((cat) => <button key={cat.name} role="tab" aria-selected={memoryCategory === cat.name} className={`memory-funnel-chip ${memoryCategory === cat.name ? "active" : ""}`} onClick={() => setMemoryCategory(memoryCategory === cat.name ? "" : cat.name)}>{cat.name}</button>)}
                      </div>
                    </div>
                    <MemoryFunnel
                      groups={memoryGroupsFiltered}
                      emptyHint={{ totalElsewhere: memories.length - memoryVisibleRecords.length, scopeLabel: memoryProjectWorkspace === "__all__" ? "全部项目" : basename(memoryProjectWorkspace) }}
                      onShowAll={() => setMemoryProjectWorkspace("__all__")}
                      onPreview={(entry) => setMemoryPreview(entry)}
                      onTogglePin={togglePinned}
                      onDeleteOne={(id) => void deleteMemoryRecord(id)}
                      onDeleteGroup={(group) => void deleteMemoryGroup((entry) => (entry.sourceThreadId ?? "__manual") === group.key).then((count) => { if (count > 0) setMemoryStatus(`已从「${group.threadTitle}」删除 ${count} 条记忆`); else setMemoryStatus("没有可删除的记忆（可能已被删除）"); })}
                      readOnly
                      onOpenThread={(threadId) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(threadId); }}
                    />
                  </div>
                </div>}
                {memoryCenterTab === "search" && (
                  <GlobalSearchView
                    threads={(memoryManagementWorkspace ? threads.filter((entry) => entry.cwd === memoryManagementWorkspace) : threads).map((entry) => ({ id: entry.id, title: entry.name, preview: entry.preview, updatedAt: entry.updatedAt, turnCount: entry.turns?.length }))}
                    memories={memories.map((entry) => ({ id: entry.id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, createdAt: entry.updatedAt }))}
                    tasks={(memoryManagementWorkspace ? scheduledTasks.filter((task) => task.workspace === memoryManagementWorkspace) : scheduledTasks).map((task) => ({ id: task.id, name: task.name, prompt: task.prompt, enabled: task.enabled, schedule: describeSchedule(task) }))}
                    skills={localSkills.map((skill) => ({ name: skill.name, description: skill.description }))}
                    onPreview={setSearchPreview}
                    onOpenThread={(threadId) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(threadId); }}
                    onOpenSettings={(page) => { setMemoryCenterOpen(false); setSettingsPage(page as SettingsPage); }}
                  />
                )}
                {memoryCenterTab === "layers" && <div className="memory-center-pane">
                    <MemoryPyramid
                      snapshot={memoryLayers}
                      distilling={memoryDistilling}
                      onJump={(layerId) => {
                        if (layerId === "L0") { setMemoryLayerScope("user"); return; }
                        if (layerId === "L3") { setMemoryLayerScope("background"); return; }
                        if (layerId === "L1") { setMemoryLayerScope("project"); return; }
                        if (layerId === "L7") { setMemoryCenterTab("library"); return; }
                        if (layerId === "L4" || layerId === "L5" || layerId === "L6") { setMemoryCenterTab("search"); return; }
                        setMemoryStatus(`${layerId} 由捕获链 / 蒸馏自动写入，见下方「记忆整洁」与「近期日志」。`);
                      }}
                      onDistill={() => void runMemoryDistill()}
                      records={memories}
                      onOpenThread={(threadId) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(threadId); }}
                      onReveal={(path) => void window.codex.shellReveal(path)}
                    />
                    <MemoryInjectPreview workspace={memoryManagementWorkspace} />
                    <MemoryLayersEditor
                      snapshot={memoryLayers}
                      scope={memoryLayerScope}
                      draft={memoryLayerDraft}
                      dirty={memoryLayerDirty}
                      distilling={memoryDistilling}
                      hasWorkspace={Boolean(memoryManagementWorkspace)}
                      savedAt={memoryLayerSavedAt}
                      onScope={setMemoryLayerScope}
                      onDraft={setMemoryLayerDraft}
                      onSave={() => void saveMemoryLayer()}
                      onDistill={() => void runMemoryDistill()}
                    />
                    {/* 记忆整洁与清理规则（09-22）：水位 / 待办 / 三个动作（危险动作二次确认） */}
                    <MemoryHygienePanel snapshot={memoryLayers} workspace={memoryManagementWorkspace} onStatus={setMemoryStatus} />
                </div>}
                {memoryCenterTab === "storage" && <div className="memory-center-pane">
                  <div className="memory-center-block">
                      <div className="memory-center-block-head">
                      <div><strong>记忆保存在哪</strong><span>本地模式只保存在本机 memory.json；云端同步模式会通过 TencentDB Gateway 召回与保存，并保留本机缓存。</span></div>
                      <button className="secondary-setting" onClick={() => setMemoryConfigOpen(true)}><Settings2 size={13} />云端配置</button>
                    </div>
                    <div className="memory-mode-switch" role="tablist" aria-label="记忆来源">
                      <button role="tab" aria-selected={memoryMode === "local"} className={`memory-mode-card ${memoryMode === "local" ? "active" : ""}`} onClick={() => updateMemoryMode("local")}>
                        <div className="memory-mode-icon"><CloudOff size={15} /></div>
                        <div className="memory-mode-body"><strong>本地记忆</strong><span>仅保存在本机 memory.json</span></div>
                        <span className="memory-mode-tag">{memories.length} 条</span>
                      </button>
                      <button role="tab" aria-selected={memoryMode === "cloud"} className={`memory-mode-card ${memoryMode === "cloud" ? "active" : ""}`} onClick={() => updateMemoryMode("cloud")}>
                        <div className="memory-mode-icon"><Cloud size={15} /></div>
                        <div className="memory-mode-body"><strong>云端同步</strong><span>TencentDB Gateway，云端召回并保留本地缓存</span></div>
                        <span className="memory-mode-tag">{memoryGateway.endpoint ? "已配置" : "未配置"}</span>
                      </button>
                    </div>
                    <div className="workspace-memory-row">
                      <div className="workspace-memory-info">
                        <strong>工作区记忆</strong>
                        <span>在当前项目中复用长期上下文；新会话开始时生效。</span>
                      </div>
                      <label className="channel-enable"><input type="checkbox" checked={memoryProjectEnabled} disabled={!memoryManagementWorkspace} onChange={(event) => { const enabled = event.target.checked; setMemoryProjectEnabled(enabled); void window.codex.setWorkspaceMemoryEnabled({ workspace: memoryManagementWorkspace, enabled }).then(() => setMemoryStatus(enabled ? "该项目记忆已开启" : "该项目记忆已关闭：背景、项目记忆、日志不会注入或捕获")).catch((error: any) => setMemoryStatus(`保存项目记忆开关失败：${error.message}`)); }} /><span>{memoryManagementWorkspace ? (memoryProjectEnabled ? "已开启" : "已关闭") : "先选项目"}</span></label>
                    </div>
                  </div>
                </div>}
                {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
              </div>
            </section>
          </div>
  );
}
