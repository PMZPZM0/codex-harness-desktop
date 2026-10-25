/**
 * MainStageTimeline —— AppViewMainStage 的 JSX 第 1 段（09-22 从 02-main-stage.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { isCompactionItem } from "../../../../lib/compaction-item.mjs";
import { compactionStateOf, reportCompactionState } from "../../../../lib/compaction-state.mjs";
import { compactionRecordFor, compactionVersion, subscribeCompactions } from "../../../../lib/compaction-records.mjs";
import { resolveCompactionAnchor } from "../../../../lib/compaction-anchor.mjs";
import { Fragment, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { BossThreadIntro, getBossThreads, subscribeBossThreads } from "../../../boss-group-view";
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
// 启动页分派（10-11）：档位开启时播 550C 片头，否则回落既有启动页。逻辑属外观域，经其 barrel 消费。
import { BootIntroGate } from "../../../settings-appearance";
import { HelpDialog, type HelpTopic } from "../../../../components/HelpDialog";
import { CodexAvatar, useCodexName } from "../../../../components/CodexAvatar";
import { contentOffsetTop, historyPinStateFor, jumpToBottom, scrollToOffsetInstant } from "../../../../components/scroll-utils";
import { visibleTurnWindow, mergeTurnListsById, turnHistoryPlan } from "../../../../lib/turn-order.mjs";
import { setTurnHeightEstimate, setTurnWindowTail, subscribeTurnHistory, turnHistoryFor, turnHistoryVersion } from "../../../../lib/turn-history.mjs";
import { ExpertTeamEditorModal, SubAgentEditorModal, TeamMemberRail, TeamMemberHistory, DelegatedRail, DelegatedRunPopup, TeamRunPopup } from "../../../experts-teams";
/* ⭐ 10-05：普通会话的办公室入口迁到本文件的右侧轨道上 ⇒ 需要那个哨兵 teamId
   （从 team-office 域的 barrel 取，域间只许走 barrel）。 */
import { OFFICE_SESSION_TEAM_ID } from "../../../team-office";
import { expertRoleLabel } from "../../../../lib/expert-role-label";
import { ImportedRecordCard, PendingImportSlot } from "../../../import-records";
import { ImagePreview, ImageLightbox, SearchPreviewModal, PastedTextEditor, type TextEditorTransport } from "../../../preview";
import { decodeText } from "../../../../hooks/useFilePreview";

/** 会话工作区文件的弹窗编辑读写通道（pastedText.kind==="file" 时用）：读 = fs:read（base64→
 *  与右栏预览同一 decodeText 口径，GBK 兜底）；写 = fs:write（可信根校验在主进程，root 参数不参与判定）。 */
/** ⛔ 10-18 预览修复：路径在会话工作区之外时，主进程返回 OUTSIDE_TRUST:<dir>（机器可读）。
 *  这里弹一次确认，用户同意后调 fs:allow 放行**该目录**（主进程持久化，重启仍有效），再重试一次。
 *  ⛔ 只在用户点击打开文件这条路径上发生 —— 不是模型能触发的放行。 */
const fileEditTransport: TextEditorTransport = {
  read: async (path: string) => {
    /* ⛔ 越界（OUTSIDE_TRUST:<dir>）不在这一层处理：⛔ 原生 confirm 被守卫【191】禁（吞焦点）。
       授权 UI 在编辑器里（PastedTextEditor 内联按钮），这里原样抛出让 UI 识别前缀。 */
    const result = await window.codex.readFile(path);
    const binary = atob(result.dataBase64 ?? "");
    return decodeText(Uint8Array.from(binary, (value) => value.charCodeAt(0)));
  },
  save: (path: string, content: string) => window.codex.writeFile(path, content, ""),
};

import { Markdown, MdCode, MdBlock, FilePreviewCode } from "../../../markdown";
import { ItemView } from "../../../session-queue";
import { TurnView, MemoTurnView, MessageRuler, MemoMessageRuler } from "../../../session-turn";
import { SelectionActionBar } from "../../../shared/SelectionActionBar";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../helpers";
import type { HarnessAppApi } from "../../../app-state/useHarnessApp";

export function MainStageTimeline({ app }: { app: HarnessAppApi }) {
  /* 10-25 用户令：BOSS 会话的空态要有自己的引导语（「你好 BOSS…」），发送后自然消失。
     ⛔ 用共享 store 判断，别在这里再拉一次 listBossGroups。 */
  const bossThreads = useSyncExternalStore(subscribeBossThreads, getBossThreads);
  const {
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
    forgetPendingImport,
    greetSub,
    greeting,
    helpKey,
    historyMemberRuns,
    hookPulse,
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
    railLastByMember,
    railRunningByMember,
    railTeam,
    releaseToUserRef,
    runActivity,
    runPhrase,
    scrollRef,
    selfScrollUntilRef,
    sending,
    serverStatus,
    setCompactToast,
    setDelegatedPopupId,
    setHelpKey,
    setLightbox,
    setPastedText,
    setSettingsOpen,
    setSettingsPage,
    setCompanyPreviewTeamId,
    setTeamHistoryMember,
    setTeamPopupRunId,
    showLogin,
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
  /* 压缩记录变化 ⇒ 本组件主动重渲染（10-07）：广播/重播到达时若恰好没有其它 state 更新，
     压缩线要等下一次被动重渲染才出现（竞态）。订阅记录模块的版本号，一变即重渲染；
     线本体仍在下方的 IIFE 里按 thread 取（这里只负责触发）。 */
  void useSyncExternalStore(subscribeCompactions, compactionVersion);
  /* 虚拟滚动条（10-21）：订阅后台拉回的全量回合元数据。它只影响滚动高度与「还剩多少条」
     文案，不影响真实回合内容（内容仍按 turnWindow 窗口懒渲染）。 */
  void useSyncExternalStore(subscribeTurnHistory, turnHistoryVersion, turnHistoryVersion);
  const renderedTurnLimit = thread ? (turnWindow[thread.id] ?? TURN_WINDOW) : TURN_WINDOW;
  const timelineWindow = visibleTurnWindow(thread?.turns, renderedTurnLimit);
  const historySnapshot = thread ? turnHistoryFor(thread.id) : null;
  const hasEarlierCursor = thread ? Boolean(turnsCursorRef.current.get(thread.id) ?? (thread as any).__turnsCursor) : false;
  const historyTail = thread ? (historySnapshot?.windowTail ?? 0) : 0;
  const historyPlan = turnHistoryPlan(historySnapshot?.stubs, timelineWindow.ordered, renderedTurnLimit, hasEarlierCursor, historyTail);
  /* 每个未水合回合的估算高度：打开会话后量一次（最后 6 个真实回合并取平均）并固定下来。
     ⛔ 不要每帧重算 —— 占位区高度随流式/折叠变化会让滚动条本身变成新的抖动源。 */
  const historyTurnEstimate = historySnapshot?.estimate || 420;
  const historySpacerHeight = Math.round(historyPlan.hiddenCount * historyTurnEstimate);
  /* 窗口后面的已加载回合也折成占位高度。顶部与底部都用同一个估算值 ⇒ 窗口滑动时
     一个变矮、一个变高，总高度不变，滚动条长度不会跟着抖。 */
  const historyBottomSpacerHeight = Math.round(historyPlan.hiddenBelow * historyTurnEstimate);
  useLayoutEffect(() => {
    const id = thread?.id;
    const el = scrollRef.current;
    if (!id || !el) return;
    if (turnHistoryFor(id).estimate > 0) return;
    const nodes = [...el.querySelectorAll<HTMLElement>(".timeline > .turn-group")].slice(-6);
    const heights = nodes.map((node) => node.getBoundingClientRect().height).filter((height) => height > 60);
    if (!heights.length) return;
    const average = heights.reduce((sum, height) => sum + height, 0) / heights.length;
    setTurnHeightEstimate(id, Math.max(160, Math.min(8000, Math.round(average))));
  }, [thread?.id, thread?.turns.length, scrollRef]);
  /* 历史水合的首帧补偿（10-21）：loadEarlierTurns 在 setState 前登记锚点状态，这里在
     **paint 之前**把"上方新增内容 − 占位区收缩"的净高度补进 scrollTop。
     ⛔ 只靠 rAF 会晚一帧（大会话渲染时可能是一整屏的闪跳）；后续延迟布局
     （图片/代码块）仍由 loadEarlierTurns 的 rAF 循环继续跟。 */
  useLayoutEffect(() => {
    const id = thread?.id;
    const el = scrollRef.current;
    if (!id || !el) return;
    const pin = historyPinStateFor(el);
    if (!pin || pin.threadId !== id || pin.applied) return;
    const tailNow = historyTail;
    const lengthNow = timelineWindow.ordered.length;
    if (pin.direction > 0) {
      if (tailNow < pin.expectedTail || lengthNow < pin.expectedLength) return;
    } else if (tailNow > pin.expectedTail) return;
    if (pin.inSpacer) {
      const spacer = el.querySelector<HTMLElement>(".timeline-history-spacer");
      const height = spacer?.offsetHeight ?? 0;
      if (Math.abs(height - pin.spacerBefore) <= 1) return;
      selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, Math.max(0, height));
      pin.applied = true;
      return;
    }
    const anchor = pin.anchorId ? document.getElementById(pin.anchorId) : null;
    if (!anchor || !el.contains(anchor)) {
      /* 锚点不在新窗口里：落到新窗口上沿（顶部占位区下边缘），别停在空白占位区。 */
      const spacer = el.querySelector<HTMLElement>(".timeline-history-spacer");
      selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, Math.max(0, spacer?.offsetHeight ?? 0));
      pin.applied = true;
      return;
    }
    const contentNow = contentOffsetTop(anchor, el);
    const delta = contentNow - pin.contentBefore;
    if (Math.abs(delta) <= 0.5) return;
    selfScrollUntilRef.current = Date.now() + 80;
    scrollToOffsetInstant(el, el.scrollTop + delta);
    pin.contentBefore = contentNow;
    pin.applied = true;
  }, [thread?.id, renderedTurnLimit, thread?.turns.length, historyTail, scrollRef, selfScrollUntilRef]);
  /* 贴底时收缩渲染窗口（把已看过的回合换回占位高度）会让上方内容瞬间变矮/占位变高；
     在 layout effect 里、首帧绘制前把内容底部贴回视口底，避免「回到底部时画面先跳一下」。
     ⛔ 只在窗口变小（collapse）且确实处于贴底时生效；上滚扩窗走 loadEarlierTurns 的锚点补偿。 */
  const prevRenderedLimitRef = useRef<{ id: string; limit: number }>({ id: "", limit: 0 });
  useLayoutEffect(() => {
    const id = thread?.id ?? "";
    const prev = prevRenderedLimitRef.current;
    prevRenderedLimitRef.current = { id, limit: renderedTurnLimit };
    const el = scrollRef.current;
    if (!el || !id || prev.id !== id) return;
    if (renderedTurnLimit < prev.limit && stickToBottomRef.current) {
      selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, contentTailTarget(el));
    }
  }, [thread?.id, renderedTurnLimit, scrollRef, contentTailTarget, stickToBottomRef, selfScrollUntilRef]);
  /* 滑窗收回到 tail=0（贴底时的 collapse / 点「回到底部」）同样要贴回真底：
     窗口大小没变（仍是 5），但顶部占位区变高、底部占位区消失。 */
  const prevTailRef = useRef<{ id: string; tail: number }>({ id: "", tail: 0 });
  useLayoutEffect(() => {
    const id = thread?.id ?? "";
    const prev = prevTailRef.current;
    prevTailRef.current = { id, tail: historyTail };
    const el = scrollRef.current;
    if (!el || !id || prev.id !== id) return;
    if (historyTail === 0 && prev.tail > 0 && stickToBottomRef.current) {
      selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, contentTailTarget(el));
    }
  }, [historyTail, thread?.id, scrollRef, contentTailTarget, stickToBottomRef, selfScrollUntilRef]);
  /* 新回合追加到底部时，若用户正在读历史（tail>0），把 tail 同步增大同样多 ——
     否则窗口会整体往下滑、正在看的那几行被顶走。 */
  const prevTurnsLenRef = useRef<{ id: string; len: number }>({ id: "", len: 0 });
  useLayoutEffect(() => {
    const id = thread?.id ?? "";
    const len = thread?.turns.length ?? 0;
    const prev = prevTurnsLenRef.current;
    prevTurnsLenRef.current = { id, len };
    if (!id || prev.id !== id || len <= prev.len) return;
    if (historyTail > 0 && !stickToBottomRef.current) {
      const rendered = turnWindow[id] ?? TURN_WINDOW;
      setTurnWindowTail(id, Math.min(Math.max(0, len - rendered), historyTail + (len - prev.len)));
    }
  }, [thread?.id, thread?.turns.length, historyTail, turnWindow, stickToBottomRef]);
  /* 刻度尺上的绿色压缩标记（10-18 用户：「刻度线里面如那两个中间产生压缩线，就在那两个中间产生一个绿色线」）。
     ⛔ 与时间线压缩线**同源**：同一个状态推导 + 同一个纯函数 ⇒ 两处口径不可能分叉。 */
  /* ⛔ 压缩 toast 是**全局一份**、切换会话不会清（成功提示要留给用户看）⇒ 用它推导状态前
     必须先按 threadId 过滤。否则在 A 会话做过压缩后切到 B，B 的刻度尺会凭空长出一条绿线
     （10-24 用户实测：「这个绿色线，我没有压缩啊」）。 */
  const threadCompactToast = thread && compactToast && compactToast.threadId === thread.id ? compactToast : null;
  const compactionMark = (() => {
    if (!thread) return { turnId: "", atEnd: false };
    /* 刻度尺/压缩线也跟**滑动窗口**走（不是“尾巴最后 5 个”）。 */
    const win = { ordered: timelineWindow.ordered, visible: historyPlan.visible };
    const cs = compactionStateOf(win.ordered, threadCompactToast?.state);
    const record = compactionRecordFor(thread.id);
    const boundary = cs.turnId || String(record?.turnId ?? "");
    const at = resolveCompactionAnchor(win.visible, boundary, { compactionAt: Number(record?.at ?? 0) });
    if (at < 0) return { turnId: "", atEnd: false };
    /* ⛔ 刻度尺只给**用户消息**画刻度：压缩落在空回合（手动压缩）上时，锚点那个回合没有刻度 ⇒
       绿色段要挂在「锚点位置之后第一个有用户消息的回合」的刻度之前；后面一个都没有 = 末尾。 */
    const hasUser = (turn: any) => ((turn?.items ?? []) as any[]).some((item) => item?.type === "userMessage");
    let j = at;
    while (j < win.visible.length && !hasUser(win.visible[j])) j += 1;
    return { turnId: j < win.visible.length ? String(win.visible[j]?.id ?? "") : "", atEnd: j >= win.visible.length };
  })();
  /* BOSS 会话的空态判定（10-25）：当前会话是某群 boss 线程，或刚点「BOSS 会话」还没落 id（pending）。 */
  const isBossEmpty = bossThreads.pending || (Boolean(thread?.id) && bossThreads.bossIds.includes(String(thread?.id)));

  return (
    <div className="timeline-wrap" ref={timelineWrapRef}>
                  {thread && <MemoMessageRuler turns={thread.turns} scrollRef={scrollRef} containerRef={timelineWrapRef} onJump={jumpToTurnInWindow} compactionTurnId={compactionMark.turnId} compactionAtEnd={compactionMark.atEnd} />}
                  {/* BOSS 会话的空白态：与 timeline 同级（绝对定位相对 .timeline-wrap），
                     不进滚动内容流 —— 普通会话完全不受影响。 */}
                  {isEmpty && isBossEmpty ? <BossThreadIntro onPick={(text) => { app.setPrompt(text); app.composerInputRef?.current?.focus(); }} /> : null}
                  <div className={`timeline ${isEmpty ? "empty-state" : ""}`} ref={scrollRef} onScroll={onTimelineScroll} data-history-hidden={historyPlan.hiddenCount} data-history-below={historyPlan.hiddenBelow} data-history-total={historyPlan.hiddenStubs + timelineWindow.ordered.length}>
                  {/* BOSS 会话的空白态是**它自己的一套**（10-25 用户令：跟欢迎界面没关系）——
                     普通会话仍走 welcome-state，这里两者互不影响。 */}
                  {isEmpty && !isBossEmpty ? (
                    <div className="welcome-state">
                      <div className="welcome-mark"><Code2 strokeWidth={0.5} size={96} /></div>
                      <h1 className="welcome-greet">{greeting}</h1>
                      <p className="welcome-sub">{greetSub}</p>
                    </div>
                  ) : null}
                  {/* 导入会话记录后、尚未发送首条消息：记录预览卡常驻消息区顶部；发送后转为消息内的导入卡 */}
                  {thread && (thread.turns ?? []).length === 0 && pendingImportThreads[thread.id] ? <PendingImportSlot key={thread.id} threadId={thread.id} onDiscard={() => forgetPendingImport(thread.id)} /> : null}
                  {/* 长会话窗口化 + 虚拟滚动条（10-21）：
                      · 未水合回合全部折成顶部一段占位高度 = 回合数 × 平均回合高 ⇒ 滚动条长度覆盖整段历史；
                      · 只挂最近 TURN_WINDOW 个回合；滚动到占位区边界时按页水合（内存展开优先，其次拉游标）。
                      ⛔ 占位区是**空白**，不会渲染几千个骨架节点；水合时占位区同步变矮、真实内容长高，
                         两边高度差由 loadEarlierTurns 的锚点补偿吃掉 ⇒ 视口不跳。 */}
                  {thread && historyPlan.hiddenCount > 0 && (
                    <div className="timeline-history-spacer" style={{ height: historySpacerHeight }} data-hidden-turns={historyPlan.hiddenCount} aria-hidden="true">
                      {/* 占位区只参与滚动几何，不挂真实回合；底部给几行骨架，快滚到边界时
                          不会看到「一片空白」——它表示更早的回合还等着按页水合。 */}
                      <div className="timeline-history-skeleton"><i /><i /><i /></div>
                    </div>
                  )}
                  {/* ⛔ 空会话不显示「加载更早」（10-25 用户令：没有消息的时候可以隐藏掉）——
                      空会话里那条按钮既没有可加载的内容，又把欢迎语顶下去。 */}
                  {thread && !isEmpty && (historyPlan.hiddenCount > 0 || hasEarlierCursor) && (
                    <button type="button" className="load-earlier-turns" aria-busy={earlierLoadingId === thread.id} onClick={() => void loadEarlierTurns(thread.id)}>
                      <ChevronDown size={13} style={{ transform: "rotate(180deg)" }} />
                      {earlierLoadingId === thread.id
                        ? "正在载入更早的消息…"
                        : historyPlan.hiddenCount > 0
                          ? `显示更早的 ${historyPlan.hiddenCount} 条消息`
                          : "加载更早的消息"}
                      <small>向上滚动会自动继续加载</small>
                    </button>
                  )}
                  {thread && earlierLoadingId === thread.id && historyPlan.hiddenCount === 0 && (
                    <div className="load-earlier-hint" role="status">正在载入更早的消息…</div>
                  )}
                  {(() => {
                    // ⛔ 09-15：渲染前按时序规范化（防合并乱序——「更早消息按钮与内容对不上」的兜底），
                    // isLastTurn / 窗口切片都以规范序列为准
                    const ordered = timelineWindow.ordered;
                    /* ⛔ 渲染必须用滑窗切片（historyPlan.visible），不是 visibleTurnWindow
                       的“最后 N 个”—— 否则窗口滑动时占位区在动、真实内容却一直是最新 5 个。 */
                    const visible = historyPlan.visible;
                    const lastId = String(ordered[ordered.length - 1]?.id ?? "");
                    // ⛔ 压缩线 timeline 层归位（09-26 二次修 + 10-07 夜十一轮改锚点）：
                    //    09-26 的修法 = 插在「**最新一条**用户消息回合」正上方 —— 当时解决了「线被引擎
                    //    末尾的压缩回合带到新消息下面」；但它每帧重算 ⇒ 之后每来一条新消息，线都跟着
                    //    往下跑（永远黏在最新消息上方），不随历史一起上移（用户 10-07：「这个压缩线跟着
                    //    历史消息往上走」）。
                    //    10-07 改锚 = **以压缩 item 自己所在回合为界**，取该回合（含）之前最近一条用户
                    //    消息回合的正上方 —— 新消息到来时线**不动**（它是历史项，随内容一起被顶上去）；
                    //    再次压缩时新 item 在后 => 锚点随新边界下移，语义正确。
                    //    与 pruneSupersededCompactions 同口径：只渲染最新一条。
                    let compactionLine: ReactNode = null;
                    let insertBefore = -1;
                    if (thread) {
                      /* ⛔ 压缩状态统一由 compaction-state.mjs 推导（10-17 用户令：四态可观测）。
                         之前这里自己扫一遍 item 判 in-progress，与 ItemView / compactToast 三处各写一份 ⇒
                         形状一变只有一处断（症状：没有压缩线、只剩通用工具卡）。 */
                      const cs = compactionStateOf(ordered, threadCompactToast?.state);
                      reportCompactionState(thread.id, cs);
                      const lastCompaction: any = cs.state === "done" ? cs.item : null;
                      const lastCompactionTurnId = cs.state === "done" ? cs.turnId : "";
                      const runningCompactionTurnId = cs.state === "compacting" ? cs.turnId : "";
                      /* 压缩线第三源（10-07）：当前引擎的压缩 item 不进 turns API/事件流（实测）——
                         引擎 item 找不到时，退回主进程 `compaction-watch` 的侦测记录（thread-compacted-host，
                         宿主侧按 rollout 对账、落盘、resume 重播）。锚点语义与引擎 item 完全一致：以压缩
                         所在回合为界、取该回合(含)之前最近一条用户消息的正上方。 */
                      const hostCompaction = lastCompaction ? null : compactionRecordFor(thread.id);
                      const boundaryTurnId = lastCompactionTurnId || String(hostCompaction?.turnId ?? "");
                      /* ⛔ 10-18：锚点计算收进纯函数（守卫【165】跑真值表）。旧实现在「边界回合不在已加载窗口」时
                         回退到最后一回合 ⇒ 线被钉在最新消息上方（用户：「每次发新消息他都在上面」）。 */
                      /* ⛔ 10-18 二次修（用户：「我刚刚压缩的，压缩完成就不见了」）：手动压缩跑成**空回合**，
                         时间线把空推进回合整组过滤掉 ⇒ 记录里的 turnId 在回合列表里根本不存在。
                         ⇒ 用**记录时间**定位：落在最后一个「先于压缩」的回合之后（压缩发生处；
                         再来新消息也不会把线拽下去）。 */
                      const compactionAt = Number(hostCompaction?.at ?? 0);
                      insertBefore = resolveCompactionAnchor(visible, boundaryTurnId, { compactionAt });
                      /* ⛔ 运行中的压缩线（优先于"已完成"线）：锚在压缩所在回合的用户消息之上；
                         找不到用户消息回合就锚在最后一回合之上。⛔ 不与底部兜底线同屏 ——
                         底部那条的条件已排除"存在 in-progress 压缩项"的情况。 */
                      if (runningCompactionTurnId) {
                        insertBefore = resolveCompactionAnchor(visible, runningCompactionTurnId);
                        if (insertBefore < 0) insertBefore = Math.max(0, visible.length - 1);
                        compactionLine = (
                          <div className="compact-divider compact-divider--running" role="status" aria-label="上下文压缩状态" key={`compact-running-${thread.id}`}>
                            <i className="compact-divider-line" aria-hidden />
                            <span className="compact-divider-text">
                              <LoaderCircle size={13} className="spin" />
                              {compactToast?.state === "running" && compactToast.threadId === thread.id ? compactToast.message : "正在自动压缩上下文…（完成后自动继续，无需操作）"}
                            </span>
                            <button type="button" className="compact-divider-cancel" title="停止压缩" onClick={() => app.cancelCompaction()}>
                              <CircleStop size={12} />停止
                            </button>
                            <i className="compact-divider-line" aria-hidden />
                          </div>
                        );
                      } else if (lastCompaction && insertBefore >= 0) {
                        compactionLine = <ItemView item={lastCompaction} onCopy={messageHandlers.onCopy} onQuote={messageHandlers.onQuote} key={`compact-${lastCompaction.id}`} />;
                      } else if (hostCompaction && insertBefore >= 0) {
                        compactionLine = (
                          <div className="compact-divider compact-divider--success compact-divider--settled" role="status" aria-label="上下文压缩状态" key={`compact-host-${hostCompaction.turnId}`}>
                            <i className="compact-divider-line" aria-hidden />
                            <span className="compact-divider-text"><CircleCheck size={13} />上下文已自动压缩</span>
                            <i className="compact-divider-line" aria-hidden />
                          </div>
                        );
                      } else if (compactToast && compactToast.state !== "running" && compactToast.threadId === thread.id) {
                        // ⛔ 时间线里没有压缩 item 时才用 toast 兜底 —— 而且**渲染在同一个归位位置**，
                        //    不再单独挂在时间线尾部（09-26 两条线就是「归位的一条 + 尾部兜底一条」）。
                        compactionLine = (
                          <div className={`compact-divider compact-divider--${compactToast.state} compact-divider--settled`} role="status" aria-label="上下文压缩状态" key={`compact-toast-${compactToast.threadId}`}>
                            <i className="compact-divider-line" aria-hidden />
                            <span className="compact-divider-text">
                              {compactToast.state === "error" ? <CircleX size={13} /> : compactToast.state === "cancelled" ? <CircleStop size={13} /> : <CircleCheck size={13} />}
                              {compactToast.message}
                            </span>
                            <button type="button" className="compact-divider-close" title="关闭此条记录" aria-label="关闭" onClick={() => setCompactToast(null)}><X size={12} /></button>
                            <i className="compact-divider-line" aria-hidden />
                          </div>
                        );
                      }
                    }
                    return [
                      ...visible.map((turn, i) => (
                      <Fragment key={turn.id}>
                        {compactionLine && i === insertBefore && compactionLine}
                        <MemoTurnView turn={turn} threadId={thread?.id ?? ""} isLastTurn={String(turn.id) === lastId} usage={turn.usage ?? (turn.id === latestCompletedTurn?.id ? lastUsage : null)} tokenUsage={turn.id === latestCompletedTurn?.id || turn.id === activeTurnId ? tokenUsage : null} fallbackWindow={customModel?.contextWindow} waitingForApproval={waitingForApproval && turn.id === activeTurnId} interruptedAt={interruptedTurns[turn.id]} elapsedSeconds={stoppedElapsed[turn.id]} handlers={messageHandlers} hooks={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? hookPulse.hooks : null} />
                      </Fragment>
                    )),
                      /* ⛔ 末尾插槽：手动压缩的锚点 = 压缩发生处（最后一回合之后） */
                      compactionLine && insertBefore === visible.length ? <Fragment key="compact-tail">{compactionLine}</Fragment> : null,
                    ];
                  })()}
                  {/* 滑动窗口后面的已加载回合（最新方向）折成占位区：只参与滚动几何，
                     不挂 React 回合。这样即便整段历史都加载过，切会话也只挂 5 个回合。 */}
                  {thread && historyPlan.hiddenBelow > 0 && (
                    <div className="timeline-history-bottom-spacer" style={{ height: historyBottomSpacerHeight }} data-hidden-turns={historyPlan.hiddenBelow} aria-hidden="true">
                      <div className="timeline-history-bottom-skeleton"><i /><i /><i /></div>
                    </div>
                  )}
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
                  {pastedText && <PastedTextEditor path={pastedText.path} name={pastedText.name} onClose={() => setPastedText(null)} transport={pastedText.kind === "file" ? fileEditTransport : undefined} />}
                  {/* ⛔ 首启「环境体检」弹窗 + 后台安装角标已删（10-07 用户令：有新手引导入口了）。
                     缺工具去「设置 → 开发工具」按需下载；别在这里复活 EnvCheckDialog。 */}
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
                  <BootIntroGate
                    stage={!serverStatus || serverStatus === "starting" ? "starting" : serverStatus !== "ready" ? "engine" : threadsLoading ? "threads" : "ready"}
                    done={bootReady || Boolean(showLogin)}
                  />
                  {systemEvents.map((event) => <div className={`system-event ${event.tone ?? "info"}`} key={event.id}><strong>{event.tone === "success" ? <CircleCheck size={13} className="system-event-icon" /> : null}{event.title}</strong><Markdown>{event.text}</Markdown></div>)}
                  {/* ⛔ 成功/失败的压缩线**只在上面的归位处渲染一处**（09-26 用户截图「两条压缩线」：
                      归位一条 + 这里尾部兜底一条）。这条尾部兜底已删除——任何时序下同屏只可能有一条
                      「已完成」压缩线。进行中的转圈（running）仍留在底部贴输入框，见下方。 */}
                  {compactToast && compactToast.state === "running" && compactToast.threadId === thread?.id && !(thread?.turns ?? []).some((t) => (t.items ?? []).some((i) => isCompactionItem(i) && (i.status === "inProgress" || i.status === "running"))) && (
                    <div className={`compact-divider compact-divider--running`} role="status" aria-label="上下文压缩状态">
                      <i className="compact-divider-line" aria-hidden />
                      <span className="compact-divider-text">
                        <LoaderCircle size={13} className="spin" />
                        {compactToast.message}
                      </span>
                      {/* 压缩与运行状态一样可手动停止（09-26 用户要求）：本地立即落成「已取消」再中断引擎
                          ——中断后完成事件可能永远不来，靠事件熄灯会永久转圈。 */}
                      <button type="button" className="compact-divider-cancel" title="停止压缩" onClick={() => app.cancelCompaction()}>
                        <CircleStop size={12} />停止
                      </button>
                      <i className="compact-divider-line" aria-hidden />
                    </div>
                  )}
                  {/* ⛔ 审批卡已迁到 composer-wrap（贴输入框上方，09-13 用户定稿：原消息流内的大卡
                      太占屏、弹窗窗口里也看不到——贴输入框的卡片与 agent-ask 同款布局，主窗/弹窗一致） */}
                  {/* ⛔ thread 在场才渲染（10-10 用户截图「欢迎界面串别的会话的状态」同型）：
                      activityLabel 是**全局**状态（等待确认/子智能体执行中来自任意会话），
                      欢迎页（还没有会话）显示它就是把别的会话的状态串进来。 */}
                  {thread && activityLabel && <div className={`working-indicator ${waitingForApproval || waitingForInput ? "paused" : ""}`}>
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
                      onClick={() => {
                        if (thread) setTurnWindowTail(thread.id, 0);
                        releaseToUserRef.current("button");
                        stickToBottomRef.current = true;
                        const el = scrollRef.current;
                        if (el) scrollToOffsetInstant(el, contentTailTarget(el));
                      }}
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
                      /* ⛔ 办公室预览**接口保留位**（09-30 用户：「太丑了，直接删了这个功能；接口可以保留，
                         按键保留」）。实现（team-office 域）已整体删除；重做时在这里接回预览浮层。 */
                      onOpenOffice={() => setCompanyPreviewTeamId(railTeam.teamId)}
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
                  {/* 调度头像轨 + **办公室入口**（09-16 / 10-05）：运行中亮头像，跑完停留 20 秒。
                      ⭐ 10-05 用户要求：普通会话的办公室入口从"左下角浮动胶囊"改到**这条右侧轨道**上，
                         图标与位置跟专家团成员轨末位那个办公室节点**完全一致**（共用 OfficeRailNode）。
                      ⛔ 门槛是 `!railTeam` 而**不是** runs.length：
                         · 专家团会话走上面的 TeamMemberRail（它自带办公室节点）⇒ 这里必须让开，否则两个办公室入口；
                         · `!runs.length` 时轨道也会渲染（只有一个办公室节点），
                           否则"没调度过"的普通会话根本没有右侧轨道、入口无处安放。 */}
                  {!railTeam && (
                    <DelegatedRail
                      containerRef={timelineWrapRef}
                      runs={delegatedRailRuns}
                      activeId={delegatedPopupId}
                      onOpen={(tid) => setDelegatedPopupId(tid)}
                      onOpenOffice={() => setCompanyPreviewTeamId(OFFICE_SESSION_TEAM_ID)}
                    />
                  )}
                  {delegatedPopupRun && delegatedPopupRun.originThreadId === thread?.id && (
                    <DelegatedRunPopup run={delegatedPopupRun} onClose={() => setDelegatedPopupId("")} />
                  )}
                  {/* 选中文字浮出的「复制 / 添加到对话」（10-05）：动作复用 messageHandlers 那两条现成通道
                      （onCopy = copyMessage、onQuote = quoteMessage 引用条），不另造实现。 */}
                  <SelectionActionBar containerRef={timelineWrapRef} onCopy={messageHandlers.onCopy} onAppend={messageHandlers.onQuote} />
                </div>
  );
}
