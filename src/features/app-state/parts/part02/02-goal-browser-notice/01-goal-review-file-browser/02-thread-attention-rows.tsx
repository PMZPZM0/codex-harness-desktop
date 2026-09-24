/**
 * usePart02b12 —— usePart02b1 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：目标状态/复核/文件树 — 会话关注与集群行渲染
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@xterm/xterm/css/xterm.css";
import { DispatchMenu, DispatchBadge } from "../../../../../../features/dispatch";
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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../../../../components/CardShell";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../../lib/user-refs";
import { basename } from "../../../../../../lib/basename";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../../app-view/types";
import type { Bag } from "../../../bag-types";

export function usePart02b12(bag: Bag) {
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
  const renderThreadRow = (entry: Thread, variant?: "member" | "lead", extras?: { actions?: any; badge?: any }) => {
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
    return (
    <div
      className={`thread-row ${bag.thread?.id === entry.id ? "active" : ""} ${running ? "running" : "ready"} ${bag.threadRowMenu?.id === entry.id ? "menu-open" : ""} ${poppedOut ? "popped-out" : ""}${variant === "member" ? " is-member-row" : ""}${bag.delegateRecords[entry.id] ? " is-delegated-row" : ""}`}
      key={entry.id}
      data-thread-id={entry.id}
    >
      <button title={entry.rolloutMissing ? "该会话的历史记录文件已丢失，无法打开" : poppedOut ? "该会话已在独立窗口中打开（关闭独立窗口后恢复）" : bag.runningThreadIds.has(entry.id) || entry.status === "inProgress" || entry.status === "running" ? "任务运行中" : bag.unreadDoneIds.has(entry.id) ? "任务已完成，点击查看" : "双击修改任务名称"} onClick={() => { bag.clearThreadDoneUnread(entry.id); if (poppedOut) { bag.showToast("会话在独立窗口中", "已打开为独立窗口，关闭该窗口后会话自动回到主应用"); return; } if (entry.rolloutMissing) { bag.showToast("会话记录已丢失", "该会话的历史记录文件（rollout）已不在磁盘上，引擎无法恢复内容。可归档该会话，或新建会话继续。"); return; } void bag.openThread(entry.id); }}>
        <span className="thread-row-title-line" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); void bag.openAppPrompt("修改任务名称", cleanThreadDisplayTitle(entry.name, { preview: entry.preview })).then((next) => { if (next?.trim()) void bag.renameThread(entry.id, next); }); }}><span title={rawTitle}>{displayTitle}</span>{bag.delegateRecords[entry.id] ? <DispatchBadge record={bag.delegateRecords[entry.id]} /> : null}{extras?.badge}{entry.rolloutMissing && <span className="thread-attention-badge tone-confirm" title="会话的历史记录文件已丢失，点开只能看到提示">记录丢失</span>}{attentionLabel && <span className={`thread-attention-badge tone-${attentionTone}`}>{attentionLabel}</span>}</span><small>{basename(entry.cwd)} · {timeAgo(entry.updatedAt)}</small>
      </button>
      <div className="thread-actions">
        <button className={`thread-pin-button ${bag.pinnedThreads.includes(entry.id) ? "pinned" : ""}`} title={bag.pinnedThreads.includes(entry.id) ? "取消置顶" : "置顶会话"} onClick={(event) => { event.stopPropagation(); bag.togglePinThread(entry.id); }}><Pin size={13} /></button>
        <button className="thread-archive-button" title="归档会话" onClick={(event) => { event.stopPropagation(); void bag.archiveThread(entry.id); }}><Archive size={13} /></button>
        <button className="thread-more-button" title="会话操作" aria-expanded={bag.threadRowMenu?.id === entry.id} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const menuHeight = 250; bag.setThreadRowMenu((current) => current?.id === entry.id ? null : { id: entry.id, top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8)), right: Math.max(8, window.innerWidth - rect.right) }); }}><MoreHorizontal size={14} /></button>
        {extras?.actions}
        {bag.openingThread === entry.id ? <Spinner /> : running ? <span className="thread-running-indicator" title="任务运行中"><i /><i /><i /></span> : bag.unreadDoneIds.has(entry.id) ? <span className="thread-done-dot" title="任务已完成，点击进入查看" /> : null}
        {bag.threadRowMenu?.id === entry.id && createPortal(<>
          <button className="thread-row-menu-backdrop" aria-label="关闭会话菜单" onClick={() => bag.setThreadRowMenu(null)} />
          <div className="thread-row-menu" role="menu" style={{ top: bag.threadRowMenu.top, right: bag.threadRowMenu.right }}>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.exportThreadsMarkdown([entry.id]); }}><FileText size={13} /><span>导出会话</span><small>.md</small></button>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.exportThreadsBackup([entry.id]); }}><Download size={13} /><span>完整备份</span><small>.json</small></button>
            <button onClick={() => { bag.setThreadRowMenu(null); void bag.openAppPrompt("重命名任务", cleanThreadDisplayTitle(entry.name, { preview: entry.preview })).then((next) => { if (next?.trim()) void bag.renameThread(entry.id, next); }); }}><PenLine size={13} /><span>重命名</span></button>
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
            展开体只补成员会话，不重复主会话。 */}
        {cluster.lead ? bag.renderThreadRow(cluster.lead, "lead", {
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
              <small>{basename(rep.cwd)} · {timeAgo(rep.updatedAt)}</small>
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
