/**
 * usePart02b12 —— usePart02b1 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：目标状态/复核/文件树 — 会话关注与集群行渲染
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DispatchMenu, DispatchBadge } from "../../../../../../features/dispatch";
import { getBossThreads } from "../../../../../../features/boss-group-view";
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
  Palette,
  Telescope,
  CircleHelp,
  Video,
  Bell,
  CheckCheck,
} from "lucide-react";
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../../../../components/CardShell";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../../lib/user-refs";
import { getEntityTagState, openTagEditor } from "../../../../../../lib/entity-tags.mjs";
import { aliasLabelOf, getAliasState, subscribeAliases } from "../../../../../../lib/alias-store.mjs";
import { badgeCycleIndexOf, cycleThreadBadge, getBadgeCycleState, subscribeBadgeCycle } from "../../../../../../lib/thread-badge-cycle.mjs";
import { ROW_COLORS, getThreadRowColors, setThreadRowColor } from "../../../../../../lib/thread-row-colors.mjs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../../app-view/types";
import type { Bag } from "../../../bag-types";

export function usePart02b12(bag: Bag) {
  /* ⛔⛔ 笔名快照**必须在这里订阅一次**（10-31 白屏实证：`Minified React error #310`）——
     `renderThreadRow` 只是本 hook 里的一个**普通函数**（由侧栏组件 `map` 调用，不是组件），
     在里面调 `useSyncExternalStore` 等于“每渲染一行就往调用方组件的 hook 链上插一个”
     ⇒ 行数一变（展开/收起/新会话）hook 数量就变 ⇒ `Rendered more hooks than during the previous render`
     ⇒ 整个界面被 ErrorBoundary 兜成「界面发生错误」。
     ⇒ 订阅在 hook 顶层做一次，`renderThreadRow` 只读闭包里的快照（快照变 ⇒ 本 hook 重渲染 ⇒ 闭包更新）。 */
  const aliasState = useSyncExternalStore(subscribeAliases, getAliasState);
  /* ⛔ 11-01 用户令：「标签最多只能显示一个，多了在标签上加一个切换功能」——
     下标走独立 store，订阅**只能在这里做一次**（renderThreadRow 是普通函数，不是组件）。 */
  const badgeCycle = useSyncExternalStore(subscribeBadgeCycle, getBadgeCycleState);
  // 会话行「等待用户操作」动态徽标：侧栏对应会话上亮起需审批/需选择/需确认字样
  // 优先级：需审批 > 需选择 > 需确认；审批请求缺 threadId 时归当前会话
  const threadAttention = useMemo(() => {
    const map = new Map<string, string>();
    const priority: Record<string, number> = { "需审批": 3, "需选择": 2, "需确认": 1 };
    const setLabel = (threadId: string, label: string) => {
      if (!threadId) return;
      const existing = map.get(threadId);
      if (!existing || priority[label] > priority[existing]) map.set(threadId, label);
    };
    for (const request of bag.pending) {
      const tid = String(request.params?.threadId ?? bag.threadRef.current?.id ?? "");
      if (request.method === "item/tool/requestUserInput") setLabel(tid, "需选择");
      else if (request.method === "mcpServer/elicitation/request") setLabel(tid, "需确认");
      else setLabel(tid, "需审批"); // 审批类与其余默认渲染「批准」卡的 serverRequest
    }
    if (bag.agentAsk) setLabel(bag.agentAsk.threadId, "需选择");
    return map;
  }, [bag.pending, bag.agentAsk]);
bag.threadAttention = threadAttention as typeof bag.threadAttention;

  // 侧栏「长按拖出为独立窗口」已删（09-13 用户定稿：入口只留顶栏的独立/返回按钮）。
  /** variant="member"：专家团成员会话行（次要层级）。09-14 用户反馈「会话主次明显不对，
   *  主会话右边才亮图标」——成员会话是程序管理的子会话，不给归档/置顶/更多按钮，
   *  宽度留给标题（否则标题被挤成「交易分析专家团…」分不清谁是谁）。样式差异全在 CSS。 */
  const renderThreadRow = (entry: Thread, variant?: "member" | "lead", extras?: { actions?: ReactNode; badge?: ReactNode }) => {
    const running = bag.runningThreadIds.has(entry.id) || entry.status === "inProgress" || entry.status === "running";
    const attentionLabel = bag.threadAttention.get(entry.id);
    const attentionTone = attentionLabel === "需审批" ? "approval" : attentionLabel === "需选择" ? "choice" : "confirm";
    // 被弹窗锁定的会话：侧栏置灰不可点（会话已在独立窗口里渲染，点击会造成双窗口重复渲染），
    // 行仍保留在原位置（用户 09-13 定稿：隐藏改为置灰）。弹窗关闭后自动恢复可点。
    const poppedOut = bag.poppedOutThreadIds.has(entry.id);
    /** 成员会话标题：剥掉重复的「团队名 · 」前缀，只留职能名（用户反馈「为啥都要重复前缀」）。
     *  仅成员行生效；重命名弹窗仍用完整名（那里需要全名）。 */
    const rawTitle = cleanThreadDisplayTitle(entry.name, { preview: entry.preview });
    const parsedMember = variant === "member" ? parseTeamMemberTitle(rawTitle) : null;
    const displayTitle = variant === "member"
      ? (parsedMember?.profession || rawTitle.match(/^.*?·\s*(.+)$/)?.[1]?.trim() || rawTitle)
      : rawTitle;
    /* 会话来源标签（09-29 用户：「专家团在主代理会话加上专家团标签字样…专家就专家标签，
       普通会话无标签，代理加上代理标签」）。
       判定优先级：显式 variant（簇头=lead、成员=member，由调用方权威传入）> 调度记录 kind。
       ⛔ 用户语义映射：专家团主会话与专家团调度 =「专家团」；成员与专家调度 =「专家」；
       子智能体调度 =「代理」；普通会话（main）**无标签**。 */
    const delegateKind = bag.delegateRecords[entry.id]?.kind;
    /* ★ 10-31 用户令：每个会话都有两字笔名（主会话 = 「XX主管」，用户 = 总经理）。
       展示在标题前（小徽标），可在会话菜单里改；改名经主进程校验后广播，
       被调度会话里的「上级主管」当场跟着变。
       ⛔ 这里的 `aliasState` 是**闭包**读的（订阅在 `usePart02b12` 顶层做一次）——
          不要在这一行调 hook：本函数是普通函数，不是组件（React #310）。 */
    const aliasLabel = aliasLabelOf(aliasState, entry.id);
    const aliasMeaning = String(aliasState.aliases?.[entry.id]?.meaning ?? "");
    /**
     * **改名字**（唯一入口，11-01 用户令：「重新命名和改笔名不是一样的逻辑吗，为啥要两个选项」）。
     *
     * ⛔ 不做第二套写入逻辑：整条链收敛在 `bag.renameThread` ——
     *   本地覆盖表 → threads 内存表 → 引擎会话名 → 别名记录（+ 广播）。
     *   侧栏菜单、侧栏双击标题、顶栏双击、斜杠命令走的是**同一个函数**，所以四处的名字永远一致。
     */
    const renameSession = async (threadId: string, current: string) => {
      const next = await bag.openAppPrompt("改名字", String(current ?? "").trim()).catch(() => null);
      if (!next?.trim()) return;
      await bag.renameThread(threadId, next.trim());
    };
    // 团队成员数（10-01 用户反馈）：专家市场包装出来的是**只有主理人的团队**（members 空），
    // 它的会话应该挂「专家」徽标，不该跟多成员专家团混用「专家团」。
    // ⛔ teamId 三路取证（10-01 二改，用户：「新建专家又没有标签了」——新建会话进不了启动时
    // 加载的 teamThreadsIndex，必须用**创建会话当刻就写入**的两张表兜底）：
    //   ① teamThreadMapRef（发起会话时立即 set）② teamThreadsIndex（IPC 回读，可能滞后）
    const entryTeamId = bag.teamThreadMapRef?.current?.get(entry.id) ?? bag.teamThreadsIndex[entry.id];
    const entryTeamMemberCount = entryTeamId
      ? (bag.expertTeams.find((team) => team.teamId === entryTeamId)?.members?.length ?? 0)
      : -1;
    const leadBadge = entryTeamMemberCount === 0 ? { tone: "expert", label: "专家" } : { tone: "team", label: "专家团" };
    /* 角色登记（10-01）：startTeamSession / startMemberDirectSession 建会话当刻就 rememberExpertRole，
       是「新建会话」唯一**同步可得**的身份来源（上面两张表都可能还没跟上）。 */
    const expertRole = bag.readStoredExpertRole?.(entry.id);
    /* ⛔⛔ 2026-10-04 用户拍板（需求1）：被调度的会话统一挂「调度」徽标（专家团风格），
       不再按来源分成「专家团 / 专家 / 代理」三种 —— 用户原话：
       「标签（已调度）主会话 / 调度会话--专家名字或者专家团名字或者子智能体随机名字」。
       角色信息在会话名里已经有了（调度时按对象命名），徽标只标"它是被调度的"。
       层级（挂主会话下面）由 buildDispatchChildren 的 childrenOf/childIds 负责（09-25 已有）。 */
    /* ⛔ 11-01 用户（截图：「被调度的会话，就显示调度两个字就行了，不要加中枢两个字」）：
       中枢群的成员会话原来打「中枢调度」⇒ 改成统一的「调度」。
       ⛔ 它被谁派的在**层级**里已经说了（缩进挂在那个中枢会话下面），徽标只标"它是被调度的"。
       ⛔ 成员会话是派活时 thread/start 新建的，不走 delegate 登记 ⇒ 只能由群账本回传的
          memberThreadIds 认（store 由侧栏订阅，这里读快照即可，渲染期不发起请求）。 */
    const bossSnap = getBossThreads();
    const isBossMemberThread = bossSnap.memberIds.includes(entry.id);
    /* 10-25 用户令：自动新建的指挥中枢要**打标签**，跟普通会话一眼区分开。 */
    /* ⛔ 统一口径：群 boss 线程 **或** 已登记的指挥中枢（sessionIds）⇒ 徽标/图标/注入三处一致，
       不会出现"被当成指挥中枢却没有中枢徽标"这种串台。 */
    const isBossOwnThread = bossSnap.bossIds.includes(entry.id) || (bossSnap.sessionIds ?? []).includes(entry.id);
    const sourceBadge = isBossOwnThread
      ? { tone: "boss", label: "中枢" }
      : isBossMemberThread
      ? { tone: "dispatch", label: "调度" }
      : delegateKind
      ? { tone: "dispatch", label: "调度" }
      : variant === "lead" || expertRole?.kind === "team"
        ? leadBadge
        : variant === "member" || expertRole?.kind === "member"
          ? { tone: "expert", label: "专家" }
          : null;
    /* ⛔ 10-31 用户令（截图）：「这个已调度标签可以不要」——
       原先主会话派出未归档的调度会话时，会在名字前挂一个「已调度」徽标。
       主会话下方本来就有缩进的调度子行（`buildDispatchChildren` 的 childrenOf/childIds），
       徽标属于同一件事的第二次表达 ⇒ 整条撤掉，连带它参与「最多一个标签」的判定一起去掉
       （否则会变成"看不见的徽标照样占用标签位"，用户加了自定义标签却不显示）。 */
    /* 兜底（10-01）：分类视图里主理人会话是**普通行**渲染（variant/调度记录都没有），
       但 teamThreadsIndex / 角色登记知道它属于哪个团队 ⇒ 同样按成员数给「专家/专家团」徽标，
       不然专家团主理人会在分类视图里光溜溜地混进普通会话。成员行（variant=member）不适用。 */
    const fallbackTeamBadge = !sourceBadge && variant !== "member" && (entryTeamId || expertRole)
      ? (expertRole?.kind === "member" ? { tone: "expert", label: "专家" } : leadBadge)
      : null;
    /* ⛔⛔ 11-01 用户（截图：「会话的新增标签功能没了」）：
       上一版把「已有身份徽标 / 已有笔名就不给加自定义标签」做成了硬门 —— 而**每个会话都有名字**，
       于是所有人都没有入口、存量自定义标签也不再渲染（等于功能被静默删掉）。
       ⇒ 标签位就是**槽位**：谁都能加，多个标签靠点击循环（同一时刻只显示一个）。
       ⛔ 存量标签一律保留、照常参与循环，不删数据。 */
    const customTag = getEntityTagState().threads[entry.id];
    /* ⛔ 10-31 用户令（对照截图）：「这个标签子会话为啥会重复，保留最左边一个就行」——
       **子会话行**（variant=member）只保留一个标签：有笔名就显示笔名（最左），没笔名才退回首身份徽标；
       调度进度徽标 / 额外徽标不再叠加 —— "它被谁派出、跑到哪一步"在缩进的父行与展开块里已经说过。
       顶层行（普通会话 / 簇头）维持原样：笔名 + 身份徽标是两件不同的事，用户没让删。 */
    const oneBadge = variant === "member";
    const secondaryBadge = oneBadge ? null : (sourceBadge || fallbackTeamBadge);
    /* ⛔ 11-01 用户令：「直接改会话名字，而不是在前面加一个什么主管标签」——
       笔名不再做成徽标（它已经是标题本身），徽标位只留给身份 / 状态。 */
    /* 标签集合：**最多只渲染一个**，其余靠点击标签循环（顺序 = 先提醒、再身份、再附加）。 */
    const rowBadges: ReactNode[] = [];
    if (attentionLabel) rowBadges.push(<span className={`thread-attention-badge tone-${attentionTone}`}>{attentionLabel}</span>);
    if (entry.rolloutMissing) rowBadges.push(<span className="thread-attention-badge tone-confirm" title="会话的历史记录文件已丢失，点开只能看到提示">记录丢失</span>);
    if (secondaryBadge) rowBadges.push(<span className={`thread-source-badge tone-${secondaryBadge.tone}`} title={`来源：${secondaryBadge.label}`}>{secondaryBadge.label}</span>);
    if (customTag) rowBadges.push(<span className="entity-tag thread-custom-tag" style={{ "--tag-color": customTag.color } as any} title={`标签：${customTag.text}`}>{customTag.text}</span>);
    if (!oneBadge && bag.delegateRecords[entry.id]) rowBadges.push(<DispatchBadge record={bag.delegateRecords[entry.id]} />);
    if (!oneBadge && extras?.badge) rowBadges.push(extras.badge);
    const badgeIndex = badgeCycleIndexOf(badgeCycle, entry.id, rowBadges.length);
    const shownBadge = rowBadges[badgeIndex] ?? null;
    /* 10-31 用户令：会话行可自选底色 —— 未选中浅色常驻、选中后稍深一档。 */
    const rowColor = getThreadRowColors().colors[entry.id] ?? "";
    /* ⛔ 11-01 用户令：「会话选项名字…不要跟着用户首个消息内容去会话名字」——
       有笔名就**用笔名当标题**（笔名即名），没有笔名才回落"会话名 / 首条消息预览"。 */
    const titleText = aliasLabel || displayTitle;
    /* 10-25 用户令：时间常驻行尾，但**运行中不展示**（尾部位置让给转圈/加载指示）。 */
    const showRowTime = !running && bag.openingThread !== entry.id;
    return (
    <div
      className={`thread-row ${bag.thread?.id === entry.id ? "active" : ""} ${running ? "running" : "ready"} ${bag.threadRowMenu?.id === entry.id ? "menu-open" : ""} ${poppedOut ? "popped-out" : ""}${variant === "member" ? " is-member-row" : ""}${bag.delegateRecords[entry.id] ? " is-delegated-row" : ""}${rowColor ? " has-row-color" : ""}`}
      key={entry.id}
      data-thread-id={entry.id}
      style={rowColor ? ({ "--row-color": rowColor } as any) : undefined}
    >
      <button title={entry.rolloutMissing ? "该会话的历史记录文件已丢失，无法打开" : poppedOut ? "该会话已在独立窗口中打开（关闭独立窗口后恢复）" : bag.runningThreadIds.has(entry.id) || entry.status === "inProgress" || entry.status === "running" ? "任务运行中" : bag.unreadDoneIds.has(entry.id) ? "任务已完成，点击查看" : "双击改名字"} onClick={() => { bag.clearThreadDoneUnread(entry.id); if (poppedOut) { bag.showToast("会话在独立窗口中", "已打开为独立窗口，关闭该窗口后会话自动回到主应用"); return; } if (entry.rolloutMissing) { bag.showToast("会话记录已丢失", "该会话的历史记录文件（rollout）已不在磁盘上，引擎无法恢复内容。可归档该会话，或新建会话继续。"); return; } void bag.openThread(entry.id); }}>
        <span className="thread-row-title-line" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); void renameSession(entry.id, titleText); }}><span className={`thread-row-tags${rowBadges.length > 1 ? " is-cyclable" : ""}`} onClick={rowBadges.length > 1 ? (event) => { event.preventDefault(); event.stopPropagation(); cycleThreadBadge(entry.id, rowBadges.length); } : undefined} title={rowBadges.length > 1 ? `点击切换标签（${badgeIndex + 1}/${rowBadges.length}）` : undefined}>{shownBadge}{rowBadges.length > 1 && <span className="thread-tag-cycle" title={`点击切换标签（${badgeIndex + 1}/${rowBadges.length}）`} aria-hidden>+{rowBadges.length - 1}</span>}</span><span className="thread-row-name" title={aliasMeaning && aliasLabel ? `${titleText} —— ${aliasMeaning}` : titleText}>{titleText}</span></span>{showRowTime && <small>{timeAgo(entry.updatedAt)}</small>}
      </button>
      <div className="thread-actions">
        <button className={`thread-pin-button ${bag.pinnedThreads.includes(entry.id) ? "pinned" : ""}`} title={bag.pinnedThreads.includes(entry.id) ? "取消置顶" : "置顶会话"} onClick={(event) => { event.stopPropagation(); bag.togglePinThread(entry.id); }}><Pin size={13} /></button>
        {/* ⛔ 10-25 用户令：「指挥中枢不要归档功能，有删除会话功能就行了」⇒ 指挥中枢不挂归档按钮
            （删除在「⋯」菜单里）。普通会话不受影响。 */}
        {isBossOwnThread ? null : (
        <button className="thread-archive-button" title="归档会话" onClick={(event) => { event.stopPropagation(); void bag.archiveThread(entry.id); }}><Archive size={13} /></button>
        )}
        <button className="thread-more-button" title="会话操作" aria-expanded={bag.threadRowMenu?.id === entry.id} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const menuHeight = 250; bag.setThreadRowMenu((current) => current?.id === entry.id ? null : { id: entry.id, top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8)), right: Math.max(8, window.innerWidth - rect.right) }); }}><MoreHorizontal size={14} /></button>
        {extras?.actions}
        {/* ⛔⛔ 2026-10-04 用户指定换成 Uiverse「serious-mule-65」8 点旋转 spinner。
            **这里必须只有 1 个 `<i />`** —— 8 个点由 CSS 的 7 层 box-shadow 画出。
            原来这里是 `<i /><i /><i />`（三点弹跳），⛔ 留着三个会让 box-shadow 的点
            叠在三个元素上、糊成一团。CSS 侧改动见 02-sidebar-threads.css（两边必须同步）。 */}
        {bag.openingThread === entry.id ? <Spinner /> : running ? <span className="thread-running-indicator" title="任务运行中"><i /></span> : bag.unreadDoneIds.has(entry.id) ? <span className="thread-done-dot" title="任务已完成，点击进入查看" /> : null}
        {bag.threadRowMenu?.id === entry.id && createPortal(<>
          <button className="thread-row-menu-backdrop" aria-label="关闭会话菜单" onClick={() => bag.setThreadRowMenu(null)} />
          <div className="thread-row-menu" role="menu" style={{ top: bag.threadRowMenu.top, right: bag.threadRowMenu.right }}>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.exportThreadsMarkdown([entry.id]); }}><FileText size={13} /><span>导出会话</span><small>.md</small></button>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.exportThreadsBackup([entry.id]); }}><Download size={13} /><span>完整备份</span><small>.json</small></button>
            {/* ⛔ 11-01 用户令：**只留一个改名入口**。
                「重命名」和「改笔名」本来是同一个操作（笔名就是会话名），两个选项让人以为分工不同。
                现在统一叫「改名字」：写别名记录 + 写引擎会话名 + 广播（子会话里的「上级：X」跟着变）。 */}
            <button onClick={() => { bag.setThreadRowMenu(null); void renameSession(entry.id, titleText); }}><PenLine size={13} /><span>改名字</span></button>
            <button onClick={() => { bag.setThreadRowMenu(null); openTagEditor({ kind: "thread", id: entry.id, title: rawTitle, value: customTag ?? null }); }}><Tag size={13} /><span>{customTag ? "编辑标签" : "添加标签"}</span></button>
            {/* 10-31 用户令：会话行底色自选 —— 未选中浅色常驻、选中后颜色稍深一档。 */}
            <div className="thread-row-color-field" role="group" aria-label="会话颜色">
              {/* 10-31 用户令：「恢复默认」放标签行（色板上方），做**淡字按钮**——圆圈 × 太难看。 */}
              <span className="thread-row-color-label">
                <Palette size={13} />会话颜色
                <button
                  type="button"
                  className="thread-row-color-clear"
                  title="恢复默认底色"
                  onClick={(event) => { event.stopPropagation(); setThreadRowColor(entry.id, ""); bag.setThreadRowMenu(null); }}
                >恢复默认</button>
              </span>
              <span className="thread-row-color-dots">
                {ROW_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    className={`thread-row-color-dot${rowColor === color.value ? " on" : ""}`}
                    style={{ "--dot": color.value } as any}
                    title={`设为${color.label}色`}
                    aria-label={`会话颜色：${color.label}`}
                    onClick={(event) => { event.stopPropagation(); setThreadRowColor(entry.id, color.value); bag.setThreadRowMenu(null); }}
                  />
                ))}
              </span>
            </div>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.forkThreadFromSidebar(entry); }}><GitBranch size={13} /><span>分支</span></button>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.copyThreadReferenceId(entry); }}><Copy size={13} /><span>复制会话 ID</span></button>
            <button className="danger" onClick={() => { bag.setThreadRowMenu(null); void bag.deleteThread(entry.id); }}><Trash2 size={13} /><span>删除</span></button>
          </div>
        </>, document.body)}
      </div>
    </div>
  );
  };
bag.renderThreadRow = renderThreadRow as typeof bag.renderThreadRow;

  /** 一批会话的聚簇切分（分组视图/项目视图共用）。
   *  09-14 用户实测：聚簇只在「分组」视图生效，「项目」视图下成员会话仍各自占一行 —— 抽成共用逻辑。 */
  const clusterSplit = (entries: Thread[]) => {
    const teamIds = new Set<string>();
    for (const entry of entries) { const teamId = bag.teamThreadsIndex[entry.id]; if (teamId) teamIds.add(teamId); }
    const clusters = bag.clusteredSidebar.clusters.filter((c) => teamIds.has(c.teamId));
    // ⛔ singles 必须同时排除「成员」和「各簇的主会话」——memberIds 只含成员，
    // 主会话若不一并排除会既作聚簇行渲染、又落进 singles 再渲染一次（用户实测「展示两次」）。
    const leadIds = new Set<string>();
    for (const c of clusters) if (c.lead) leadIds.add(c.lead.id);
    const singles = entries.filter((entry) => !bag.clusteredSidebar.memberIds.has(entry.id) && !leadIds.has(entry.id));
    return { clusters, singles };
  };
bag.clusterSplit = clusterSplit as typeof bag.clusterSplit;

  /** 聚簇行：主会话名 + 「N 会话」徽标 + 展开箭头（展开出主会话/成员会话分节）。 */
  /** 专家团聚簇行 = **团队条**（用户 09-14 草稿定稿）：
   *  折叠时只显示「团名 + N 会话 + 展开箭头」——它是一个分组头，不是某个会话，点它只展开/收起；
   *  展开后组内第一条是**主会话行**（标注「主会话」），其余是成员行（只写职能名、不带团队前缀）。
   *  这样团队名只作为分组出现一次，不会像早先那样把主会话渲染两遍。 */
  const renderClusterRow = (cluster: { teamId: string; lead: Thread | null; members: Thread[] }) => {
    const rep = cluster.lead ?? cluster.members[0];
    if (!rep) return null;
    const expanded = bag.expandedTeamClusters.has(cluster.teamId);
    const anyRunning = cluster.members.some((m) => bag.runningThreadIds.has(m.id)) || Boolean(cluster.lead && bag.runningThreadIds.has(cluster.lead.id));
    const attention = cluster.members.map((m) => bag.threadAttention.get(m.id)).find(Boolean);
    const clusterTotal = cluster.members.length + (cluster.lead ? 1 : 0);
    // 团队名优先取专家团配置；取不到则从主会话标题里剥掉「· 职能」后缀
    const rawLeadTitle = cleanThreadDisplayTitle((cluster.lead ?? rep).name, { preview: (cluster.lead ?? rep).preview });
    const teamName = bag.expertTeams.find((t) => t.teamId === cluster.teamId)?.displayName?.zh || rawLeadTitle.replace(/\s*[·・].*$/, "");
    return (
      <div key={`cluster-${cluster.teamId}`} className={`team-cluster ${expanded ? "expanded" : ""}`}>
        {/* 折叠态显示的就是**主会话行**（用户 09-14：「默认折叠状态，只展示一个专家团的主会话就行」
            +「归档和三个点是在主会话上，子会话不用」）。
            直接复用 renderThreadRow，主会话自带归档/更多/菜单；额外挂一个展开箭头；
            展开体只补成员会话，不重复主会话。
            ⛔ 10-01 用户反馈「专家团怎么还有展开按键」：专家市场包装出来的是**只有主理人的团队**
            （members 空）——展开体里什么都没有，展开键是死的 ⇒ 零成员团队退化为普通主会话行，
            不挂展开键、不做聚簇（徽标由 renderThreadRow 按成员数判成「专家」）。 */}
        {cluster.lead && cluster.members.length === 0 ? bag.renderThreadRow(cluster.lead, "lead") : cluster.lead ? bag.renderThreadRow(cluster.lead, "lead", {
          actions: (
            <button className="thread-cluster-toggle" title={expanded ? "收起成员会话" : `展开 ${clusterTotal} 个会话`} onClick={(event) => { event.stopPropagation(); bag.toggleTeamCluster(cluster.teamId); }}>
              <ChevronDown size={14} className={expanded ? "open" : ""} />
            </button>
          ),
        }) : (
          // 主会话缺失（映射不全/被删）：退化为一枚可展开的分组条
          <div className={`thread-row team-cluster-head ${anyRunning ? "running" : "ready"}`}>
            <button title={`展开 ${clusterTotal} 个会话`} onClick={() => bag.toggleTeamCluster(cluster.teamId)}>
              <span className="thread-row-title-line"><span>{teamName}</span></span>
              <small>{timeAgo(rep.updatedAt)}</small>
            </button>
            <div className="thread-actions">
              <button className="thread-cluster-toggle" title={expanded ? "收起成员会话" : "展开成员会话"} onClick={(event) => { event.stopPropagation(); bag.toggleTeamCluster(cluster.teamId); }}>
                <ChevronDown size={14} className={expanded ? "open" : ""} />
              </button>
            </div>
          </div>
        )}
        {expanded && (
          <div className="team-cluster-body">
            {/* 主会话不在这里重复渲染 —— 折叠态的团队条本身就是主会话行（可点进）。
                展开体只补成员会话（职能名，无团队前缀）。 */}
            {cluster.members.length > 0 && <div className="team-cluster-label">成员会话 · {cluster.members.length}</div>}
            {cluster.members.map((entry) => bag.renderThreadRow(entry, "member"))}
          </div>
        )}
      </div>
    );
  };
bag.renderClusterRow = renderClusterRow as typeof bag.renderClusterRow;

  /** 一批会话的列表渲染：聚簇行在前，其余行按原顺序。 */
  const renderClusterList = (entries: Thread[]) => {
    const { clusters, singles } = bag.clusterSplit(entries);
    return <>{clusters.map(bag.renderClusterRow)}{singles.map((entry) => bag.renderThreadRow(entry))}</>;
  };
bag.renderClusterList = renderClusterList as typeof bag.renderClusterList;

  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
bag.narrow = narrow as typeof bag.narrow; bag.setNarrow = setNarrow as typeof bag.setNarrow;

  useEffect(() => {
    const onResize = () => bag.setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { threadAttention, renderThreadRow, clusterSplit, renderClusterRow, renderClusterList, narrow, setNarrow };
}
