/**
 * MainStageTimeline —— AppViewMainStage 的 JSX 第 1 段（09-22 从 02-main-stage.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { PPTokenEndpoints } from "../../../../lib/pptoken-endpoints";
import { avatarToneOf, AVATAR_GRADIENTS, registerThreadTeam, unregisterThreadTeam, resolveTeamMember } from "../../../../lib/entity-avatar";
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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../../components/CardShell";
import { BootSplash, type BootStage } from "../../../../components/BootSplash";
import { HelpDialog, type HelpTopic } from "../../../../components/HelpDialog";
import { ModelSetupGuide } from "../../../../components/ModelSetupGuide";
import { EnvCheckDialog, ENV_CHECK_SPEC, ENV_CHECK_OPTOUT_KEY, type EnvCheckState } from "../../../../components/EnvCheckDialog";
import { CodexAvatar, useCodexName } from "../../../../components/CodexAvatar";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../components/scroll-utils";
import { visibleTurnWindow, mergeTurnListsById } from "../../../../lib/turn-order.mjs";
import { ExpertTeamEditorModal, SubAgentEditorModal, TeamMemberRail, TeamMemberHistory, DelegatedRail, DelegatedRunPopup, TeamRunPopup } from "../../../experts-teams";
import { expertRoleLabel } from "../../../../lib/expert-role-label";
import { ImportedRecordCard, PendingImportSlot } from "../../../import-records";
import { ImagePreview, ImageLightbox, SearchPreviewModal, PastedTextEditor } from "../../../preview";
import { Markdown, MdCode, MdBlock, FilePreviewCode } from "../../../markdown";
import { ItemView } from "../../../session-queue";
import { TurnView, MemoTurnView, MessageRuler, MemoMessageRuler } from "../../../session-turn";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../helpers";
import type { HarnessAppApi } from "../../../app-state/useHarnessApp";

export function MainStageTimeline({ app }: { app: HarnessAppApi }) {
  const {
    TURNS_PAGE,
    TURN_WINDOW,
    activeMember,
    activeMemberTeam,
    activeTurnId,
    activityLabel,
    anchorSpacerRef,
    awayFromBottom,
    bootReady,
    codexIdentity,
    compactSpacerRef,
    compactToast,
    contentTailTarget,
    copyImage,
    customModel,
    delegatedPopupId,
    delegatedPopupRun,
    delegatedRailRuns,
    earlierLoadingId,
    envCheckOpen,
    envInstalling,
    envItems,
    envPercent,
    envProgress,
    envSpeed,
    envStage,
    forgetPendingImport,
    greetSub,
    greeting,
    helpKey,
    historyMemberRuns,
    hookPulse,
    installEnvMissing,
    interruptedTurns,
    isEmpty,
    jumpToTurnInWindow,
    lastUsage,
    latestCompletedTurn,
    lightbox,
    loadEarlierTurns,
    messageHandlers,
    onTimelineScroll,
    optimisticConfirmed,
    optimisticInput,
    pastedText,
    pendingImportThreads,
    popupRun,
    quickSetup,
    quickSetupBusy,
    quickSetupError,
    railLastByMember,
    railRunningByMember,
    railTeam,
    relayQuickLogin,
    relaySetupBusy,
    relaySetupError,
    releaseToUserRef,
    runActivity,
    runPhrase,
    scrollRef,
    sending,
    serverStatus,
    setCompactToast,
    setDelegatedPopupId,
    setEnvCheckOpen,
    setHelpKey,
    setLightbox,
    setPastedText,
    setSettingsOpen,
    setSettingsPage,
    setShowModelGuide,
    setTeamHistoryMember,
    setTeamPopupRunId,
    showLogin,
    showModelGuide,
    stickToBottomRef,
    stoppedElapsed,
    subAgentRunning,
    switchingFading,
    switchingMeta,
    switchingThreadId,
    systemEvents,
    teamHistoryMember,
    thread,
    threadsLoading,
    timelineWrapRef,
    tokenUsage,
    turnWindow,
    turnsCursorRef,
    waitingForApproval,
    waitingForInput,
  } = app;
  return (
    <div className="timeline-wrap" ref={timelineWrapRef}>
                  {thread && <MemoMessageRuler turns={thread.turns} scrollRef={scrollRef} containerRef={timelineWrapRef} onJump={jumpToTurnInWindow} />}
                  <div className={`timeline ${isEmpty ? "empty-state" : ""}`} ref={scrollRef} onScroll={onTimelineScroll}>
                  {isEmpty ? (
                    <div className="welcome-state">
                      <div className="welcome-mark"><Code2 strokeWidth={0.5} size={96} /></div>
                      <h1 className="welcome-greet">{greeting}</h1>
                      <p className="welcome-sub">{greetSub}</p>
                    </div>
                  ) : null}
                  {/* 导入会话记录后、尚未发送首条消息：记录预览卡常驻消息区顶部；发送后转为消息内的导入卡 */}
                  {thread && (thread.turns ?? []).length === 0 && pendingImportThreads[thread.id] ? <PendingImportSlot key={thread.id} threadId={thread.id} onDiscard={() => forgetPendingImport(thread.id)} /> : null}
                  {/* 长会话窗口化：默认只挂最近 TURN_WINDOW 个回合，更早的滚动到顶/点按钮增量加载
                      （每次一页，内存展开优先）。软件渲染下全量挂载几千个回合是「切换会话慢」的主因。 */}
                  {thread && (thread.turns.length > (turnWindow[thread.id] ?? TURN_WINDOW) || turnsCursorRef.current.get(thread.id)) && (
                    <button type="button" className="load-earlier-turns" onClick={() => void loadEarlierTurns(thread.id)}>
                      <ChevronDown size={13} style={{ transform: "rotate(180deg)" }} />
                      {thread.turns.length - (turnWindow[thread.id] ?? TURN_WINDOW) > 0
                        ? `显示更早的 ${Math.min(thread.turns.length - (turnWindow[thread.id] ?? TURN_WINDOW), TURNS_PAGE * 5)} 条消息`
                        : "加载更早的消息"}
                      <small>向上滚动到此也会自动继续加载</small>
                    </button>
                  )}
                  {thread && earlierLoadingId === thread.id && (
                    <div className="load-earlier-hint" role="status">正在载入更早的消息…</div>
                  )}
                  {(() => {
                    // ⛔ 09-15：渲染前按时序规范化（防合并乱序——「更早消息按钮与内容对不上」的兜底），
                    // isLastTurn / 窗口切片都以规范序列为准
                    const { ordered, visible } = visibleTurnWindow(thread?.turns, thread ? (turnWindow[thread.id] ?? TURN_WINDOW) : TURN_WINDOW);
                    const lastId = String(ordered[ordered.length - 1]?.id ?? "");
                    return visible.map((turn) => <MemoTurnView turn={turn} isLastTurn={String(turn.id) === lastId} usage={turn.usage ?? (turn.id === latestCompletedTurn?.id ? lastUsage : null)} tokenUsage={turn.id === latestCompletedTurn?.id || turn.id === activeTurnId ? tokenUsage : null} fallbackWindow={customModel?.contextWindow} waitingForApproval={waitingForApproval && turn.id === activeTurnId} interruptedAt={interruptedTurns[turn.id]} elapsedSeconds={stoppedElapsed[turn.id]} handlers={messageHandlers} hooks={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? hookPulse.hooks : null} key={turn.id} />);
                  })()}
                  {/* ⛔ 状态条（run-activity-bar）必须排在 #chat-anchor（乐观气泡）**之后**（09-17 用户实测
                      「这个怎么到这个位置了」）：原先它排在最前面，于是「发送后 · 引擎回声前」这段时间里，
                      状态条显示在刚发出的那条消息**上方**；而气泡阶段时间线里只有「你的消息 + 状态条」，
                      正确顺序应当是 消息 → 状态条（与真实阶段的「回合内容 → 状态条」一致）。见下方插入处。 */}
                  {optimisticInput && !optimisticConfirmed && <>
                    <div id="chat-anchor"><ItemView item={optimisticInput} pending onCopy={messageHandlers.onCopy} onQuote={messageHandlers.onQuote} onImageCopy={messageHandlers.onImageCopy} onOpenFile={messageHandlers.onOpenFile} /></div>
                    {/* 乐观回合标识：引擎回声前就先把 Codex 的「头像 + 名字」摆出来 —— 09-17 用户
                        「Codex 名字和头像没有第一时间出来」。引擎要 1~2s 才 turn/started + userMessage 落地
                        （实测：1002ms 回合已在跑、1904ms userMessage 才到），这段窗口原先只有气泡和状态条。
                        与 TurnView 的 .turn-head 同构同位置，回声后由真实回合接管，视觉上不跳。
                        ⛔ 这里**不放**「正在处理 N 秒」：那段计时归真实回合的 .running-process-time，
                        两处都挂会各自从 0 计时、接管时数字跳回去。 */}
                    <div className="turn-head">
                      <span className="turn-head-avatar"><CodexAvatar size={22} /></span>
                      <span className="turn-head-name">{codexIdentity.name}</span>
                    </div>
                  </>}
                  {/* 生成过程状态条：**必须排在乐观气泡之后**（09-17 用户实测「这个怎么到这个位置了」）——
                      排在前面时，发送后那段「你的消息已上屏、引擎还没回声」的窗口里状态条会显示在消息**上方**；
                      气泡阶段时间线里只有「你的消息 + 状态条」，顺序应与真实阶段「回合内容 → 状态条」一致。
                      运行时反证：改回原顺序 → 气泡 top=80 / 状态条 top=51（正是用户截图的比例）。 */}
                  {runActivity && (
                    <div className="run-activity-bar" role="status" aria-live="polite">
                      <span className="run-activity-spinner" aria-hidden><i /><i /><i /></span>
                      <span className="run-activity-text shimmer-text" key={runActivity}>{runActivity}</span>
                      {runPhrase && <span className="run-activity-phrase">· {runPhrase}</span>}
                    </div>
                  )}
                  {lightbox && <ImageLightbox path={lightbox.path} alt={lightbox.alt} onClose={() => setLightbox(null)} onCopy={() => void copyImage(lightbox.path)} />}
                  {pastedText && <PastedTextEditor path={pastedText.path} name={pastedText.name} onClose={() => setPastedText(null)} />}
                  {/* 设置页使用帮助（09-17 用户要求）：模型/插件/技能/MCP/专家团/语音/开发工具 + 设置总览 */}
                  {/* 模型配置引导（09-17，09-19 升级为「小白快速上手」）：
                      只在没有生效模型时出现，配好即不再弹。⛔ 弹窗里内嵌「粘 Key 一键配好」快路——
                      原先只给两个跳转按钮，新手跳过去还是要填完整供应商表单（用户反馈「联动性差」）。 */}
                  {showModelGuide && (
                    <ModelSetupGuide
                      lines={PPTokenEndpoints}
                      busy={quickSetupBusy}
                      error={quickSetupError}
                      onQuickSetup={(info) => void quickSetup(info)}
                      relayBusy={relaySetupBusy}
                      relayError={relaySetupError}
                      onRelayLogin={(info) => void relayQuickLogin(info)}
                      onGoManual={() => { setShowModelGuide(false); setSettingsPage("model"); setSettingsOpen(true); }}
                      onGoSubscription={() => { setShowModelGuide(false); setSettingsPage("openai"); setSettingsOpen(true); }}
                      onRegister={() => void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S").catch(() => undefined)}
                      onClose={() => setShowModelGuide(false)}
                    />
                  )}
                  {/* 首次启动「环境体检」（09-17 用户要求）：必备项缺失时列出「缺什么 / 为什么 / 多大」并一键补齐 */}
                  {envCheckOpen && (
                    <EnvCheckDialog
                      items={envItems}
                      installing={envInstalling}
                      progress={envProgress}
                      percent={envPercent}
                      stage={envStage}
                      speed={envSpeed}
                      onInstall={(ids) => void installEnvMissing(ids)}
                      onGo={() => {
                        // 只剩模型一项会跳转（09-20 工作区已移出体检）；去模型页配置
                        setEnvCheckOpen(false);
                        setSettingsPage("model");
                        setSettingsOpen(true);
                      }}
                      onClose={(dontAsk) => {
                        if (dontAsk) { try { localStorage.setItem(ENV_CHECK_OPTOUT_KEY, "1"); } catch { /* 隐私模式等写入失败不影响关闭 */ } }
                        setEnvCheckOpen(false);
                      }}
                    />
                  )}
                  {/* 后台安装角标（09-18 用户要求）：一键安装点下去弹窗就收起，安装转后台；
                      角标实时显示进度、点开可回到弹窗；装完随 envInstalling=false 自动消失。
                      安装中途手动关掉弹窗也一样——关闭 ≠ 取消，角标还在、结果照常通知。 */}
                  {envInstalling && !envCheckOpen && (
                    <button type="button" className="env-install-pill" onClick={() => setEnvCheckOpen(true)}>
                      <RefreshCw size={13} className="spin" />
                      <span className="env-install-pill-text">{envProgress || "正在准备下载…"}</span>
                      <em>后台安装中 · 点开查看</em>
                    </button>
                  )}
                  {/* 归档后提示浮层已挪到 composer（09-23 用户：「放对话框上方正中间」）——
                     见 02-main-stage/03-composer.tsx 里 `.composer-wrap` 内的 ArchiveToast。 */}
                  <HelpDialog helpKey={helpKey}
                    onClose={() => setHelpKey(null)}
                    onNavigate={(page) => {
                      // 总览里的页名 = settingsNav 的展示文案，反查回页面 key 后跳转
                      const hit = settingsNav.flatMap((group) => group.items).find(([, label]) => label === page);
                      if (hit) setSettingsPage(hit[0]);
                    }}
                  />
                  {/* 启动加载页（渲染层接手段）：挂载瞬间从 index.html 那份手里接过来，
                      盖到首屏会话数据到达（或需要登录）才淡出。实测挂载后还要等 1.3~2.1s，
                      此前这段界面上什么反馈都没有。阶段由真实状态驱动，不是放假进度条。 */}
                  <BootSplash
                    stage={!serverStatus || serverStatus === "starting" ? "starting" : serverStatus !== "ready" ? "engine" : threadsLoading ? "threads" : "ready"}
                    done={bootReady || Boolean(showLogin)}
                  />
                  {systemEvents.map((event) => <div className={`system-event ${event.tone ?? "info"}`} key={event.id}><strong>{event.tone === "success" ? <CircleCheck size={13} className="system-event-icon" /> : null}{event.title}</strong><Markdown>{event.text}</Markdown></div>)}
                  {/* 上下文压缩分隔线：两边虚线 + 中间文字，状态切换带过渡；success/error 常驻可手动关闭，
                      只属于发起压缩的会话。成功态若时间线里已有 contextCompaction 项（同样渲染为成功分隔线），
                      跳过这条 toast 避免重复显示常驻卡 */}
                  {compactToast && compactToast.state !== "running" && compactToast.threadId === thread?.id && !(compactToast.state === "success" && (thread?.turns ?? []).some((t) => (t.items ?? []).some((i) => i.type === "contextCompaction"))) && (
                    <div className={`compact-divider compact-divider--${compactToast.state} compact-divider--settled`} role="status" aria-label="上下文压缩状态">
                      <i className="compact-divider-line" aria-hidden />
                      <span className="compact-divider-text">
                        {compactToast.state === "error" ? <CircleX size={13} /> : <CircleCheck size={13} />}
                        {compactToast.message}
                      </span>
                      <button type="button" className="compact-divider-close" title="关闭此条记录" aria-label="关闭" onClick={() => setCompactToast(null)}><X size={12} /></button>
                      <i className="compact-divider-line" aria-hidden />
                    </div>
                  )}
                  {compactToast && compactToast.state === "running" && compactToast.threadId === thread?.id && !(thread?.turns ?? []).some((t) => (t.items ?? []).some((i) => i.type === "contextCompaction" && (i.status === "inProgress" || i.status === "running"))) && (
                    <div className={`compact-divider compact-divider--running`} role="status" aria-label="上下文压缩状态">
                      <i className="compact-divider-line" aria-hidden />
                      <span className="compact-divider-text">
                        <LoaderCircle size={13} className="spin" />
                        {compactToast.message}
                      </span>
                      <i className="compact-divider-line" aria-hidden />
                    </div>
                  )}
                  {/* ⛔ 审批卡已迁到 composer-wrap（贴输入框上方，09-13 用户定稿：原消息流内的大卡
                      太占屏、弹窗窗口里也看不到——贴输入框的卡片与 agent-ask 同款布局，主窗/弹窗一致） */}
                  {activityLabel && <div className={`working-indicator ${waitingForApproval || waitingForInput ? "paused" : ""}`}>
                    {activeMember
                      ? <span className="expert-working-avatar" style={{ background: AVATAR_GRADIENTS[avatarToneOf(activeMember.id || activeMember.name)] }} aria-hidden="true">{expertRoleLabel(activeMember, activeMember.id === activeMemberTeam?.lead.id).slice(0, 1)}</span>
                      : waitingForApproval ? <ShieldCheck size={15} />
                      : waitingForInput ? <MessageSquarePlus size={15} />
                      : subAgentRunning ? <Bot className="process-running-icon subagent-pulse" size={15} />
                      : <Bot className="process-running-icon" size={15} />}
                    <span>{activityLabel}</span>
                  </div>}
                  {/* 底部留白只按回合状态：活跃回合给 compact 跟随留白；空闲态一律不留空白。
                      乐观气泡不再触发大缓冲（它会在服务端消息确认后消失，大缓冲会残留成空白）。
                      ⚠️ 留白**不参与落点计算**：contentBottomOf 会扣掉它的高度（见该函数注释）。 */}
                  {(activeTurnId || sending || (optimisticInput && !optimisticConfirmed)) ? <div className="timeline-bottom-spacer compact" ref={compactSpacerRef} aria-hidden />
                    : null}
                  {/* ⛔ 排队消息**不再**在对话区里渲染（用户 09-13 定稿：「排队消息只贴在输入框上面展示就行」）。
                      原来这里还有一份 `.timeline-queue` 浅色气泡，与输入框上方那张管理卡是**同一份数据的两处展示**
                      —— 既是重复展示的来源（引擎把它变成真实气泡后本地没摘干净就并存两份），
                      也让队列管理有两个入口。队列只有输入框上方一处（QueuedMessageList，>2 条自动折叠）。 */}
                  {/* 锚顶留白（高度由钉顶逻辑按「视口高 − 锚点高」动态设置）：
                      让短消息下方也有一屏空间，scrollTop 才够得着锚点、消息才能钉在顶部。
                      非钉顶时高度为 0（inline style 控制），不占位、不影响贴底。
                      注意它必须排在 #chat-anchor（乐观气泡）之后。 */}
                  <div className="timeline-bottom-spacer anchor-pad" ref={anchorSpacerRef} style={{ height: 0 }} aria-hidden />
                </div>
                  {switchingThreadId && (
                    <div className={`thread-switch-overlay ${switchingFading ? "fading" : ""}`} role="status">
                      <Spinner /><span>正在恢复会话…</span>
                      {/* 09-14（学 WorkBuddy 骨架优先）：冷加载时先把这个会话的形态画出来——
                          列表里已有的名称与预览先行占位，用户立刻知道"打开的是哪个会话"，
                          而不是盯着一句「正在恢复会话…」的纯等待。真实内容到达后整体替换。 */}
                      {switchingMeta && (
                        <div className="thread-switch-skeleton" aria-hidden="true">
                          {switchingMeta.name ? <div className="skeleton-line title">{switchingMeta.name}</div> : null}
                          {switchingMeta.preview ? <div className="skeleton-line">{switchingMeta.preview.slice(0, 120)}</div> : null}
                          <div className="skeleton-line short" />
                        </div>
                      )}
                    </div>
                  )}
                  {awayFromBottom && (
                    <button
                      className="jump-bottom"
                      title="回到底部"
                      onClick={() => { releaseToUserRef.current("button"); stickToBottomRef.current = true; const el = scrollRef.current; if (el) scrollToOffsetInstant(el, contentTailTarget(el)); }}
                    ><ArrowDown size={16} /></button>
                  )}
                  {/* 专家团成员头像轨 + 成员工作弹窗 + 历史记录（09-14 用户要求）。
                      头像轨是 timeline-wrap 的 flex 子项（占 92px / 紧凑 52px，容器窄了自动收起）；
                      两个面板绝对定位浮在消息区上，不遮输入框。 */}
                  {railTeam && (
                    <TeamMemberRail
                      team={railTeam}
                      containerRef={timelineWrapRef}
                      runningByMember={railRunningByMember}
                      lastByMember={railLastByMember}
                      activeMemberId={teamHistoryMember || popupRun?.memberId || ""}
                      onOpenMember={(memberId) => { setTeamPopupRunId(""); setTeamHistoryMember(memberId); }}
                    />
                  )}
                  {railTeam && popupRun && (
                    <TeamRunPopup
                      team={railTeam}
                      run={popupRun}
                      onClose={() => setTeamPopupRunId("")}
                      onOpenHistory={(memberId) => { setTeamPopupRunId(""); setTeamHistoryMember(memberId); }}
                    />
                  )}
                  {railTeam && teamHistoryMember && (
                    <TeamMemberHistory
                      team={railTeam}
                      memberId={teamHistoryMember}
                      runs={historyMemberRuns}
                      onClose={() => setTeamHistoryMember("")}
                    />
                  )}
                  {/* 调度头像轨 + 工作内容弹窗（09-16，与专家团一致）：运行中亮头像，跑完即消失。
                      专家团会话不会走到这里（railTeam 优先且受限会话根本开不了调度），两者不重叠。 */}
                  {delegatedRailRuns.length > 0 && (
                    <DelegatedRail
                      containerRef={timelineWrapRef}
                      runs={delegatedRailRuns}
                      activeId={delegatedPopupId}
                      onOpen={(tid) => setDelegatedPopupId(tid)}
                    />
                  )}
                  {delegatedPopupRun && delegatedPopupRun.originThreadId === thread?.id && (
                    <DelegatedRunPopup run={delegatedPopupRun} onClose={() => setDelegatedPopupId("")} />
                  )}
                </div>
  );
}
