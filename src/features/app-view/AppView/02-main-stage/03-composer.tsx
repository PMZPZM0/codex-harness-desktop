/**
 * MainStageComposer —— AppViewMainStage 的 JSX 第 3 段（09-22 从 02-main-stage.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { createPortal } from "react-dom";
import { isRateLimitError, rateLimitBackoffMs, RATE_LIMIT_MAX_ATTEMPTS } from "../../../../lib/rate-limit-retry";
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
import VoiceWaveform from "../../../../components/VoiceWaveform";
import { Markdown, MdCode, MdBlock, FilePreviewCode } from "../../../markdown";
import { QueuedMessageList, FoldHandlers, TurnFoldStream } from "../../../session-queue";
import { GoalBar, TurnStatusCapsule } from "../../../status";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../helpers";
import type { HarnessAppApi } from "../../../app-state/useHarnessApp";
import { ComposerComposerCardStack } from "./03-composer/01-composer-card-stack";
import { ArchiveToast } from "../../../../components/ArchiveToast";
import { ComposerComposerForm } from "./03-composer/02-composer-form";

export function MainStageComposer({ app }: { app: HarnessAppApi }) {
  const {
    activeThreadRunning,
    activeTurnId,
    addContextItem,
    addSkillReference,
    agentAsk,
    allModels,
    applyPendingRestart,
    approvalPolicy,
    attachSubmenu,
    attachedFiles,
    attachmentMenuOpen,
    availableContextItems,
    cancelPendingRestart,
    cancelPlanExecution,
    cancelPromptEnhance,
    cancelQuote,
    cancelRateLimitRetry,
    changeEffort,
    changePermissionMode,
    chooseFiles,
    chooseModel,
    chooseWorkspace,
    commandMatches,
    compactPendingRef,
    composerDomValueRef,
    composerInputRef,
    composerWrapRef,
    confirmPlanExecution,
    connectorSearch,
    connectors,
    contextItems,
    contextOpen,
    currentModelId,
    customModel,
    deleteQueued,
    dictationBaseRef,
    dismissEnhanceHint,
    dismissNotice,
    effort,
    enhanceBusy,
    enhanceHint,
    executeRateLimitRetry,
    expertQuery,
    expertTeams,
    goalStatus,
    goalText,
    hasEnhanceBackup,
    images,
    infoModal,
    insertComposerFiles,
    interrupt,
    interrupting,
    isEmpty,
    makeComposerChip,
    mergedSkillCatalog,
    messageHandlers,
    modelId,
    notices,
    onComposerKeyDown,
    onPromptChange,
    openModelEditor,
    openThread,
    openaiActiveAcct,
    pasteImage,
    pasteLongText,
    pending,
    pendingRestart,
    planArmed,
    planConfirm,
    planFeedback,
    planOnceRef,
    planRunning,
    plusSpinTick,
    prompt,
    queue,
    queueTimers,
    setQueuedTimer,
    queueDragIndex,
    quickMenuFlipUp,
    quickMenuPanelRef,
    quickMenuRef,
    quoteItem,
    rateLimitRetries,
    recentCompaction,
    relayActive,
    removeContextItem,
    reorderQueued,
    runPromptEnhance,
    runSlashCommand,
    runUpdateDownload,
    sandbox,
    saveQueued,
    scheduleSubmenu,
    scheduleSubmenuClose,
    selectedSkills,
    send,
    setAgentAsk,
    setAttachSubmenu,
    setAttachmentMenuOpen,
    setCompactEventState,
    setConnectorMenuOpen,
    setConnectorSearch,
    setContextOpen,
    setExpertQuery,
    setInfoModal,
    setLocalSkills,
    setNotice,
    setPending,
    setPlanArmed,
    setPlanFeedback,
    setPlusSpinTick,
    setPrompt,
    setQueueDragIndex,
    setSelectedSkills,
    setSettingsOpen,
    setSettingsPage,
    setSkillMenuOpen,
    openAppPrompt,
    setSkillQuery,
    setThreadFileQuery,
    setUpdateNotice,
    setWelcomeCwdMenuOpen,
    setWelcomeScratchDir,
    showToast,
    skillCommandMatches,
    skillQuery,
    startMemberDirectSession,
    startQueued,
    stopGoalLoop,
    submenuFlip,
    submenuTop,
    submitPlanFeedback,
    taskList,
    thread,
    threadFileCandidates,
    threadFileQuery,
    tokenUsage,
    updateDownloading,
    updateNotice,
    updateProgress,
    upstreamRetries,
    voiceDictating,
    welcomeCwdMenuOpen,
    welcomeScratchDir,
    workspace,
    // 归档后提示浮层（09-23 从 timeline 挪到这里：要贴在**对话框上方正中间**，见下方 JSX 注释）
    archiveToast,
    setArchiveToast,
  } = app;
  /* 目标条动作（10-06 夜五轮，用户对照 Qoder 的目标条）。⛔ 暂停/继续走 `thread/goal/set`
     的 status 字段（10-06 隔离引擎实测支持；引擎**没有** thread/goal/pause|resume 两个方法，
     别改回去）；暂停时若回合在跑补一发 interrupt —— 引擎的 paused 只停"下一次自动续跑"。 */
  const editGoal = () => {
    if (!thread || !goalText) return;
    void openAppPrompt("编辑目标", goalText).then((next) => {
      const text = String(next ?? "").trim();
      if (!text || text === goalText) return;
      void window.codex.request("thread/goal/set", { threadId: thread.id, objective: text, status: goalStatus === "paused" ? "paused" : "active" })
        .then(() => showToast("目标已更新", text))
        .catch((error: any) => showToast("目标更新失败", error?.message ?? String(error)));
    });
  };
  const toggleGoalPause = () => {
    if (!thread || !goalText) return;
    const nextPaused = goalStatus !== "paused";
    void window.codex.request("thread/goal/set", { threadId: thread.id, objective: goalText, status: nextPaused ? "paused" : "active" })
      .then(() => {
        showToast(nextPaused ? "目标已暂停" : "目标已继续", nextPaused ? "自动推进已停止；点「继续」随时恢复" : "引擎将继续朝目标自动推进");
        if (nextPaused && activeThreadRunning) void interrupt();
      })
      .catch((error: any) => showToast(nextPaused ? "暂停失败" : "继续失败", error?.message ?? String(error)));
  };
  return (
    <div ref={composerWrapRef} className={`composer-wrap ${isEmpty ? "docked-center" : ""}`}>
                  {/* 归档后提示浮层（09-17 建；09-23 用户三轮定稿：**窗口顶部居中** + 3 秒自动消失）：
                      位置 = `fixed` + `top: 54px` + `left: 50%` + `translateX(-50%)`（见 `.archive-toast`）。
                      ⛔ **必须 portal 到 document.body**：`.composer-wrap.docked-center`（空态）自带
                      `transform: translate(-50%,-50%)`，而带 transform 的祖先把成为 `position: fixed` 的
                      包含块 ⇒ 留在 composer 里会让浮层按输入框定位，与"窗口顶部居中"完全不是一回事。
                      ⛔ 之前放在 timeline 里（右上角）——位置由 CSS `.archive-toast` 决定，别只改一处。 */}
                  {archiveToast && createPortal(
                    <ArchiveToast
                      token={archiveToast.token}
                      threadName={archiveToast.name}
                      onOpenArchive={() => { setSettingsPage("archive"); setSettingsOpen(true); }}
                      onClose={() => setArchiveToast(null)}
                    />,
                    document.body,
                  )}
                  {/* /plan 计划模式确认条：方案回合结束后出现，确认后才执行 */}
                  {planConfirm && planConfirm.threadId === thread?.id && (
                    <div className="agent-ask-inline plan-review" role="dialog" aria-label="方案确认">
                      <header><ListChecks size={15} /><strong>方案已生成，请审阅</strong></header>
                      {planConfirm.text && <p className="plan-review-summary" title="点击查看方案全文" onClick={() => setInfoModal({ title: "执行方案预览", body: planConfirm.text || "未捕获到方案正文，请查看对话中最后一条回复。", markdown: true })}>{planConfirm.text}</p>}
                      <div className="plan-review-actions">
                        <button className="primary-setting" onClick={confirmPlanExecution}>开始执行</button>
                        <button onClick={() => setInfoModal({ title: "执行方案预览", body: planConfirm.text || "未捕获到方案正文，请查看对话中最后一条回复。", markdown: true })}>查看方案</button>
                        <button onClick={cancelPlanExecution}>取消</button>
                      </div>
                      <form className="plan-review-feedback" onSubmit={(event) => { event.preventDefault(); submitPlanFeedback(); }}>
                        <input value={planFeedback} onChange={(event) => setPlanFeedback(event.target.value)} placeholder="对方案提意见，让它再改一版（如：换成高铁、预算砍半）…" />
                        <button type="submit" className="primary-setting" disabled={!planFeedback.trim()}>提意见</button>
                      </form>
                    </div>
                  )}
                  {/* /goal 目标条（10-06 夜五轮，用户对照 Qoder）：贴输入框上方、与输入框同宽、软粉底；
                      左「🎯 目标 · 计时 + 内容」，尾部 编辑 / 删除 / 暂停-继续（动作处理在上方，画在 GoalBar） */}
                  {thread && goalText && (
                    <GoalBar threadId={thread.id} goalText={goalText} goalStatus={goalStatus} running={Boolean(activeThreadRunning)}
                      onEdit={editGoal} onTogglePause={toggleGoalPause} onDelete={stopGoalLoop} />
                  )}
                  {/* Agent 提问卡：贴输入框上方、与输入框同宽；只属于发起它的会话，不跨会话弹窗 */}
                  {agentAsk && agentAsk.threadId === thread?.id && (
                    <div className="agent-ask-inline" role="dialog" aria-label="Agent 提问">
                      <header><Sparkles size={15} /><strong>Agent 想问你</strong></header>
                      <p className="agent-ask-question">{agentAsk.question}</p>
                      <div className="agent-ask-options">
                        {agentAsk.options.map((option, index) => (
                          <button key={index} className={option === agentAsk.recommended ? "agent-ask-option recommended" : "agent-ask-option"} onClick={() => { agentAsk.resolve(option); setAgentAsk(null); }}>
                            {option === agentAsk.recommended && <span className="agent-ask-badge">推荐</span>}
                            {option}
                          </button>
                        ))}
                      </div>
                      {agentAsk.allowFree && (
                        <form className="agent-ask-free" onSubmit={(e) => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("freeText") as HTMLInputElement); if (input.value.trim()) { agentAsk.resolve(input.value.trim()); setAgentAsk(null); } }}>
                          <input name="freeText" placeholder="或者输入你的想法…" />
                          <button type="submit" className="primary-setting"><Check size={14} />回复</button>
                        </form>
                      )}
                    </div>
                  )}
                  {/* 回合状态胶囊（10-06 夜三轮，用户对照 Qoder）：「步骤 N/M · X 个文件已修改 +A -D」——
                      左区悬停展开步骤清单（Codex 自己维护的 task_add/task_update 清单）、右区悬停展开
                      文件清单；有任务清单就有（收尾后仍在），与排队/询问/审批卡是**上下排序关系**
                      （栈里的一行，不互相遮）。原「目标与进程」面板已按用户令撤掉。 */}
                  <TurnStatusCapsule taskList={taskList} runningTurnId={activeThreadRunning ? (activeTurnId || thread?.turns?.[thread.turns.length - 1]?.id || null) : null} />
                  {/* 审批卡：贴输入框上方（与 agent-ask 同款布局，09-13 从消息流大卡迁来）。
                      主窗口与独立会话窗口走同一渲染逻辑——各自的 pending 里属于本窗口当前会话的
                      请求都会在这里出现，弹窗里也能审批。 */}
                  {/* 09-14：多条审批收进 `.approval-stack`（整体限高 + 滚动）——以前每条都是一张
                      大卡直接往下堆，两条就把输入框上方占满；现在一条只占一行，点摘要才展开看内容。 */}
                  {(() => {
                    const mine = pending.filter((request) => !request.params?.threadId || request.params.threadId === thread?.id);
                    if (!mine.length) return null;
                    return (
                      <div className="approval-stack" data-count={mine.length}>
                        {mine.map((request) => <RequestCard request={request} key={request.id} onDone={() => setPending((current) => current.filter((entry) => entry.id !== request.id))} />)}
                      </div>
                    );
                  })()}
                  <ComposerComposerCardStack app={app} />
                  {/* 启动静默检查发现新版本 → 通知卡片（非阻塞，可稍后/关闭） */}
                  {updateNotice && createPortal(
                    <div className="update-card" role="status" aria-label="发现新版本">
                      <div className="update-card-head">
                        <span className="update-card-icon"><Download size={16} /></span>
                        <div className="update-card-title">
                          <strong>发现新版本 v{updateNotice.version}</strong>
                          <span className="update-card-sub">{updateNotice.mandatory ? "建议尽快更新" : "有新版本可用"}</span>
                        </div>
                        <button title="关闭" onClick={() => setUpdateNotice(null)}><X size={13} /></button>
                      </div>
                      {updateNotice.changelog ? <div className="update-card-body">{updateNotice.changelog}</div> : null}
                      <div className="update-card-actions">
                        <button onClick={() => setUpdateNotice(null)}>稍后</button>
                        <button className="primary" onClick={() => void runUpdateDownload()} disabled={updateDownloading}>
                          {updateDownloading ? (updateProgress > 0 ? `下载中 ${Math.round(updateProgress * 100)}%` : "下载中…") : "立即更新"}
                        </button>
                      </div>
                    </div>,
                    document.body,
                  )}
                  {infoModal && createPortal(
                    <div className="info-modal-mask" onClick={() => setInfoModal(null)}>
                      <div className="info-modal" role="dialog" aria-label={infoModal.title} onClick={(event) => event.stopPropagation()}>
                        <header><Info size={15} className="info-modal-icon" /><strong>{infoModal.title}</strong><button title="关闭" onClick={() => setInfoModal(null)}><X size={14} /></button></header>
                        {infoModal.markdown ? <div className="info-modal-markdown"><Markdown>{infoModal.body}</Markdown></div> : <pre>{infoModal.body}</pre>}
                      </div>
                    </div>,
                    document.body,
                  )}
                  {/* 未配模型提示已移入输入框**内部顶部**（见下方 form 内）——用户 09-19 要求
                      「不要那么长的长条」「不要改动项目地址选项的位置」：项目地址 chip 是浮在
                      框外的独立图层，提示放框内则两层互不干扰，chip 位置一丝不动。 */}
                  {/* 429 限流自动重试状态条（**只显示当前会话自己的重试**）。
                      ⛔⛔ 09-19 用户实测「重试弹窗跟别的会话串了，多开会话一起串、一直报错重试，
                      正在跑的会话被这个条挡住，点停止还影响别的会话」：原实现当前会话没有重试时
                      **回退显示别的会话的重试**（"另一会话限流"），既误导（自己明明在跑）又让人
                      误操作。现在：别的会话的重试只在**侧栏那一行**用小标记表示，绝不占用当前会话
                      输入框上方的位置。 */}
                  {(() => {
                    const own = thread?.id ? rateLimitRetries[thread.id] : undefined;
                    if (!own || !thread) return null;
                    return (
                      <div className="rate-limit-retry-bar" role="status" aria-label="限流自动重试中">
                        <LoaderCircle size={15} className="spin" />
                        <span className="rate-limit-retry-text">
                          模型限流（429），
                          <b>第 {own.attempt}/{RATE_LIMIT_MAX_ATTEMPTS}</b> 次重试将在{" "}
                          <b>{Math.max(0, Math.ceil((own.retryAt - Date.now()) / 1000))}s</b> 后自动进行
                          {Object.keys(rateLimitRetries).length > 1 ? `（另有 ${Object.keys(rateLimitRetries).length - 1} 个会话也在重试，见侧栏标记）` : ""}
                        </span>
                        <button type="button" onClick={() => void executeRateLimitRetry(thread.id)}>立即重试</button>
                        <button type="button" onClick={() => cancelRateLimitRetry(thread.id)}>停止</button>
                      </div>
                    );
                  })()}
                  {/* 引擎上游重连提示（**只对当前会话显示**，别的会话各显示各的） */}
                  {thread && upstreamRetries[thread.id] && (
                    <div className="rate-limit-retry-bar" role="status" aria-label="上游重连中">
                      <LoaderCircle size={15} className="spin" />
                      <span className="rate-limit-retry-text">
                        上游限流 / 断流，引擎正在自动重连（<b>第 {upstreamRetries[thread.id].no}/{upstreamRetries[thread.id].total} 次</b>）——
                        恢复后自动继续，无需操作
                      </span>
                    </div>
                  )}
                  {thread && <QueuedMessageList entries={queue} timers={queueTimers[thread.id] ?? {}} onSetTimer={(entry, runAt) => void setQueuedTimer(thread.id, entry.id, runAt)} onOpenFile={messageHandlers.onOpenFile} onQuote={messageHandlers.onQuote} onDelete={(id) => void deleteQueued(id)} onStart={(id) => void startQueued(id)} onSave={(entry, text) => void saveQueued(entry, text)} onReorder={(from, to) => void reorderQueued(from, to)} dragIndex={queueDragIndex} setDragIndex={setQueueDragIndex} />}
                  {/* 图片与文件都在输入框内联 chip 里展示（09-18 用户：「把文件展示不要在输入框上面了，
                      改成在输入框里面的 chip，跟图片一样的展示」）——原先这里那条 .attachment-strip
                      已删除，别再恢复。 */}
                  {commandMatches.length > 0 && <div className="command-palette" role="listbox" aria-label="Codex 指令">{commandMatches.map(([name, description]) => <button type="button" role="option" key={name} onClick={() => { if (["rename", "review", "goal", "plan", "effort", "personality", "sandbox", "approval", "fork"].includes(name)) setPrompt(`/${name} `); else void runSlashCommand(`/${name}`); }}><code>/{name}</code><span className="command-desc">{description}</span></button>)}</div>}
                  {/* 「#」技能面板：与「/」命令面板同款展示（等宽技能名 + 中文注释列），点击即引用该技能 */}
                  {skillCommandMatches.length > 0 && <div className="command-palette skill-palette" role="listbox" aria-label="可用技能">{(() => {
                    /* 来源分组（09-30 用户：「已安装技能，和本地技能，和市场技能都进行分类一下」；
                       10-01 补「专家专属」组：专家市场包带来的元技能与子技能单列，别混进市场安装）：
                       专家专属 → 引擎内置 → 市场安装 → 本地导入，空组不显示；组内仍按 matchSkillCatalog 的相关度排序。 */
                    const groupLabels: [string, string][] = [["expert", "专家专属"], ["engine", "引擎内置"], ["market", "市场安装"], ["local", "本地导入"]];
                    return groupLabels.map(([key, label]) => {
                      const group = skillCommandMatches.filter((skill: any) => (skill.source ?? "engine") === key);
                      if (!group.length) return null;
                      return <div key={key} className="skill-palette-group">
                        <div className="skill-palette-group-label">{label}<small>{group.length}</small></div>
                        {group.map((skill: any) => <button type="button" role="option" key={skill.name} title={`${skill.name}：${skill.note}`} onClick={() => addSkillReference(skill)}><code>#{skill.name}</code><span className="command-desc">{skill.note}</span></button>)}
                      </div>;
                    });
                  })()}</div>}
                  {contextOpen && <div className="context-picker" role="listbox" aria-label="引用本次对话上下文">
                    <div className="context-picker-head"><span>引用本次对话</span><small>选择后会随本条消息发送</small></div>
                    {availableContextItems.length ? availableContextItems.map((item) => <button type="button" role="option" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => addContextItem(item)}><b>{item.role}</b><span>{item.text}</span></button>) : <p>没有匹配的历史消息</p>}
                  </div>}
                  {/* 供应商切换「待重启生效」banner：切换只保存配置，重启前不打断任何会话 */}
                  {pendingRestart && (
                    <div className="provider-restart-banner">
                      <div className="provider-restart-banner-text">
                        <RefreshCw size={13} />
                        <span>已选择 <b>{pendingRestart.label}</b>，<b>重启后生效</b> —— 当前会话继续使用原供应商，正在运行的任务不受影响</span>
                      </div>
                      <div className="provider-restart-banner-actions">
                        <button type="button" className="provider-restart-banner-btn primary" onClick={() => void applyPendingRestart()}><RefreshCw size={13} />重启生效</button>
                        <button type="button" className="provider-restart-banner-btn" onClick={() => void cancelPendingRestart()}><X size={13} />撤销</button>
                      </div>
                    </div>
                  )}
                  {/* 实时语音舞台：彩色波浪 + 中英字幕，只在通话中显示（状态来自 voice/wave-level 广播） */}
                  <VoiceWaveform />
                  <ComposerComposerForm app={app} />
                  {isEmpty && (
                    <div className="suggest-row">
                      {[["📊", "周报总结", "汇总本周的提交与改动，生成一份周报总结"], ["🐞", "报错修复", "定位并修复项目里最近的报错，并补充回归测试"], ["🎞️", "PPT 制作", "根据 README 制作一份项目介绍 PPT"], ["⏰", "闲时任务", "规划一个闲时后台自动化任务"]].map(([emoji, label, prompt]: any) => (
                        <button key={label} onClick={() => { if (label === "闲时任务") { setSettingsPage("schedule"); setSettingsOpen(true); } else setPrompt(prompt); }}><span className="suggest-emoji">{emoji}</span>{label}</button>
                      ))}
                    </div>
                  )}
                  {/* AI 内容提示（09-20 用户要求：「在输入框下面空白居中位置加一排字」）。
                      ⛔ 只放**静态一行**，不参与任何布局计算：`.composer-wrap` 被 ResizeObserver 观察
                      （高度一变就重申贴底），这里是常量高度 ⇒ 只在挂载时触发一次；钉顶期间那个观察器
                      本来就直接 return。别给它加条件渲染或动态高度（会变成反复贴底抖动）。
                      位置 = `.composer-wrap` 的最后一个子节点 ⇒ 落在输入框下方的空白处、随输入框那一列居中。 */}
                  <p className="composer-disclaimer">内容由AI生成，请核实重要信息</p>
                </div>
  );
}
