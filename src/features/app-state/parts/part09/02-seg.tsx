/**
 * usePart09b（09-22：part09 按序切分出来的第 2 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isCompactionItem } from "../../../../lib/compaction-item.mjs";
import "@xterm/xterm/css/xterm.css";
import { FieldHelp, LoginScreen } from "../../../../features/auth";
import { DispatchMenu, DispatchBadge } from "../../../../features/dispatch";
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
  
  Type,
  Sun,
  User,
  Wrench,
  Wifi,
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
} from "lucide-react";
import { locateMatchEl } from "../../../app-view/helpers";
import { useAnchoredPopover } from "../../../app-view/hooks/useAnchoredPopover";
import type { Bag } from "../bag-types";

export function usePart09b(bag: Bag) {
  // 团队会话里正在被调度的成员（主理人通过 team_member_invoke 分发子任务时点亮其头像）
  const activeThreadMemberRunning = bag.expertTeamMemberRunning && bag.thread && bag.expertTeamMemberRunning.teamId === (bag.teamThreadMapRef.current.get(bag.thread.id) || bag.teamThreadConfigRef.current.get(bag.thread.id)?.teamId) ? bag.expertTeamMemberRunning : null;
bag.activeThreadMemberRunning = activeThreadMemberRunning as typeof bag.activeThreadMemberRunning;


  const activeMemberTeam = bag.activeThreadMemberRunning ? bag.expertTeams.find((team) => team.teamId === bag.activeThreadMemberRunning!.teamId) ?? null : null;
bag.activeMemberTeam = activeMemberTeam as typeof bag.activeMemberTeam;


  const activeMember = bag.activeMemberTeam && bag.activeThreadMemberRunning ? [bag.activeMemberTeam.lead, ...bag.activeMemberTeam.members].find((member) => member.id === bag.activeThreadMemberRunning!.memberName) ?? null : null;
bag.activeMember = activeMember as typeof bag.activeMember;


  // 09-12 用户要求：去掉「已工作 X 秒」耗时指示（上方回合头部已有处理时间，重复且
  // 在流式期间跟着内容上下跳）；只保留真正有信息量的状态（停止中/等确认/等输入/专家/子智能体）
  const activityLabel = bag.interrupting ? "正在停止" : bag.waitingForApproval ? "等待你的确认" : bag.waitingForInput ? "等待你的输入" : bag.activeMember ? `专家「${bag.activeMember.profession.zh || bag.activeMember.name}」执行中` : bag.subAgentRunning ? `子智能体「${bag.subAgentRunning}」执行中` : "";
bag.activityLabel = activityLabel as typeof bag.activityLabel;


  // ── 成员头像轨 / 成员工作弹窗 / 历史记录（09-14 用户要求） ────────────────────
  /** 当前会话所属团队。优先主进程映射 —— popout 独立窗口没有本地 teamThreadMapRef。 */
  const railTeamId = bag.threadTeamId || (bag.thread ? bag.teamThreadMapRef.current.get(bag.thread.id) ?? "" : "");
bag.railTeamId = railTeamId as typeof bag.railTeamId;


  const railTeam = bag.railTeamId ? bag.expertTeams.find((team) => team.teamId === bag.railTeamId) ?? null : null;
bag.railTeam = railTeam as typeof bag.railTeam;


  /** 本会话的委托记录，最新在前 */
  const railRuns = Object.values(bag.teamRuns).filter((run) => run.leadThreadId === bag.thread?.id).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
bag.railRuns = railRuns as typeof bag.railRuns;


  /** 每个成员「正在跑」的那次委托 —— 并行阶段可能多个成员同时亮 */
  const railRunningByMember: Record<string, TeamMemberRunRecord> = {};
bag.railRunningByMember = railRunningByMember as typeof bag.railRunningByMember;


  for (const run of bag.railRuns) if (run.status === "running" && !bag.railRunningByMember[run.memberId]) bag.railRunningByMember[run.memberId] = run;


  /** 每个成员最近一次委托（头像的亮 / 灰 / 完成态据此判定） */
  const railLastByMember: Record<string, TeamMemberRunRecord> = {};
bag.railLastByMember = railLastByMember as typeof bag.railLastByMember;


  for (const run of bag.railRuns) if (!bag.railLastByMember[run.memberId]) bag.railLastByMember[run.memberId] = run;


  const popupRun = bag.teamPopupRunId ? bag.teamRuns[bag.teamPopupRunId] ?? null : null;
bag.popupRun = popupRun as typeof bag.popupRun;


  const historyMemberRuns = bag.teamHistoryMember ? bag.teamHistoryRuns.filter((run) => run.memberId === bag.teamHistoryMember) : [];
bag.historyMemberRuns = historyMemberRuns as typeof bag.historyMemberRuns;


  /** 调度头像轨（09-16）：本会话派出去的委派会话。**跑完停留 20 秒**（用户要求「方便查看内容」），
   *  完成态头像回正、呼吸环停；20 秒后自动从轨上摘掉。 */
  const delegatedRailRuns = Object.values(bag.delegateLiveRuns)
    .filter((run) => run.originThreadId === bag.thread?.id)
    .sort((a, b) => a.startedAt - b.startedAt);
bag.delegatedRailRuns = delegatedRailRuns as typeof bag.delegatedRailRuns;


  /* ⛔⛔ 10-04：「子智能体执行中」指示器的**原唯一写入点**是渲染层的 `subagent_invoke` 分支
      —— 那条通道随「合并成单一调度工具」删除 ⇒ `bag.subAgentRunning` 恒为 null，
      顶栏 badge（AppView 的 .subagent-badge）与时间线活动指示器**静默失效**（不是坏了，是永远不显示）。
      ⇒ 改为从统一的**委托记录**回灌（与调度头像轨 `delegatedRailRuns` 同一份主进程真相）：
      语义等价（= 本会话正在跑的子智能体），且对新通道 `agent_invoke(kind=subagent)` 同样生效。
      ⚠️ 必须走 **setter**、不能直接写 `bag.subAgentRunning = …`：后者会被【92】判成「本 part 的
         镜像」，要求它也出现在本段 return 里；而该名字已由 part02 发布 ⇒ 同名双 return 会被
         【92】判为「组合根展开静默覆盖」。setter 不在镜像口径内（守卫只认 `bag.X =`）。 */
  useEffect(() => {
    // ⛔ 派生写在 effect 体内、**不新增段顶层声明** —— 【93】会把段顶层的每个 const 当成 Bag 名，
    //    没有对应声明就报「推断有、Bag 没有」。
    const live = Object.values(bag.delegateLiveRuns);
    const run = live.find((entry) => entry.originThreadId === bag.thread?.id && entry.status === "running" && entry.kind === "subagent") ?? null;
    bag.setSubAgentRunning(run ? run.name : null);
  }, [bag.delegateLiveRuns, bag.thread?.id, bag.setSubAgentRunning]);


  const delegatedPopupRun = bag.delegatedPopupId ? bag.delegateLiveRuns[bag.delegatedPopupId] ?? null : null;
bag.delegatedPopupRun = delegatedPopupRun as typeof bag.delegatedPopupRun;


  // 上下文压缩后的缓存重建窗口：压缩重写了提示词前缀，上游缓存命中需要 1~3 轮才恢复
  // （rollout 实测：压缩后 last.cached=0 连续 2 轮，第 3 轮回到 98%）。窗口内 0% 不是 bug。
  const recentCompaction = useMemo(() => {
    if (!bag.thread) return false;
    const turns = bag.thread.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].items?.some((item) => isCompactionItem(item))) return turns.length - 1 - i < 3;
    }
    return false;
  }, [bag.threadMemoKey]);
bag.recentCompaction = recentCompaction as typeof bag.recentCompaction;


  const saveInlineRename = () => {
    const next = bag.renameDraft.trim();
    if (next && bag.thread) void bag.renameThread(bag.thread.id, next);
    bag.setInlineRename(false);
  };
bag.saveInlineRename = saveInlineRename as typeof bag.saveInlineRename;



  const earlyView = bag.showLogin ? (
      <LoginScreen onSkip={() => void bag.handleSkip()} onLogin={(info) => bag.handleLogin(info)} />
    ) : null;
bag.earlyView = earlyView as typeof bag.earlyView;




  // ── 当前会话搜索（09-24 二次修订）── 顶栏 🔍：**只搜当前会话**的消息，点结果跳到那条消息。
  // 用户要求（09-24 下午）：「这个搜索只展示当前会话的历史记录，不要展示其他的」。
  // 复用既有会话内搜索能力（原本只有状态与逻辑、没有 UI）：
  //   · bag.chatSearchQuery / bag.chatSearchResults —— 渲染层内存匹配，每条带 turnId+itemId
  //     ⇒ 能精确定位到 DOM（`locateMatchEl`，**仅限已渲染的回合**：消息区懒加载，
  //       落在更早未渲染页里的命中没有 DOM，点了跳不过去 —— 详见下面 jumpToHit 的注释）；
  //   · bag.chatSearchGo（上/下一条）、bag.setChatSearchIndex（当前项）；
  //   · part04/03-seg 的 useLayoutEffect 负责给命中打 .msg-search-hit / -current 高亮。
  // ⛔ 跨会话搜索（history:search IPC + history-search-ipc.ts）实现保留但**不再有 UI 入口** ——
  //   用户明确不要看到其他会话；能力留着以备将来需要（见该文件头注释）。
  // ⛔ 面板开关**复用 bag.chatSearchOpen 单一真相源**（不另立局部 state）：
  //    Ctrl+Shift+F 走的是 bag.setChatSearchOpen(true)，若这里用另一个 state，
  //    快捷键会把结果算出来、把高亮打上，却**不显示面板**（状态分叉）。
  const historySearchBtnRef = useRef<HTMLButtonElement | null>(null);
  /* ⛔⛔ 2026-10-04：`.topbar` 带 `overflow: hidden`（守卫【250】为修「图标压原生钮」加的）
     ⇒ 顶栏里的 `position: absolute` 弹层被**整棵子树裁掉**，点了没反应，z-index 救不了。
     工作区菜单（ctx-menu）与任务菜单（task-menu）同病，与 dispatch-pop 一起改成
     **portal 到 body + fixed**；定位共用 useAnchoredPopover。
     ⚠️ 只改 position 不够 —— 不 portal 仍在被裁的子树里。
     ⚠️ 宽度要与 CSS 实际宽度一致：`.task-menu` 是 226px（见 02-sidebar-threads.css）。 */
  const ctxBtnRef = useRef<HTMLButtonElement | null>(null);
  const ctxMenuStyle = useAnchoredPopover(bag.ctxMenuOpen, ctxBtnRef, 226);
  /* 工作区浮层「关得掉」+ **非阻塞**（10-06 夜八轮，用户实测「点图标都不会自动消失、其他地方
     点不了、关都关不掉」）：
       根因＝原来靠 `.menu-backdrop`（fixed inset:0）当遮罩 —— 它挂在顶栏 drag 子树里，
       真实鼠标点击被 OS 拿去拖窗口、页面收不到 onClick；遮罩还把整个视口圈进拖拽区 ⇒ 全屏点不动。
       修法＝**撤掉遮罩**，改用 DispatchMenu 同款「window mousedown 判外部」（守卫 11e ⑧ 钉过
       那条范式）：点图标/别处 → 菜单关闭**且这次点击照常命中目标**（非阻塞，一步到位）。
       ⛔ 判外部要问两处：📁 按钮（DOM 子树）+ 弹层自己 —— 弹层 portal 到 body 后不在按钮
       子树里（DispatchMenu 的 10-04 事故：只判按钮 ⇒ 弹层内点一下就被当外部关掉）。
       Esc 并列监听：键盘用户与遮罩失效环境的最后退路。 */
  useEffect(() => {
    if (!bag.ctxMenuOpen) return;
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".ctx-menu")) return;          // 弹层内（portal 到 body，不在按钮子树）
      if (ctxBtnRef.current?.contains(target as Node)) return; // 📁 按钮：交给自身 onClick 开关切
      bag.setCtxMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") bag.setCtxMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [bag.ctxMenuOpen]);
  const taskBtnRef = useRef<HTMLButtonElement | null>(null);
  const taskMenuStyle = useAnchoredPopover(bag.taskMenuOpen, taskBtnRef, 226);
  const closeHistoryPanel = useCallback(() => {
    bag.setChatSearchOpen(false);
    bag.setChatSearchQuery(""); // 关面板即清词：下次打开不留旧高亮 / 旧结果
  }, [bag]);
  const jumpToHit = useCallback((hit: { turnId: string; itemId: string; text: string }) => {
    const index = bag.chatSearchResults.findIndex((m) => m.itemId === hit.itemId);
    if (index >= 0) bag.setChatSearchIndex(index);
    // ⛔⛔ 会话消息区是**懒加载**的（窗口化渲染）：默认只挂最近 TURN_WINDOW 个回合，更早的要靠
    //   「显示更早的 N 条」按钮 / 向上滚到近顶才增量加载（见 AppView/02-main-stage/01-timeline.tsx）。
    //   而搜索结果读的是**内存里的 thread.turns（已加载的全部回合）** ⇒ 必然出现下面这个组合：
    //     · **能搜到** —— 命中项在内存里，所以会出现在结果列表里；
    //     · **跳不过去** —— 它在更早、**还没渲染**的那几页里 ⇒ DOM 里没有对应节点，
    //       locateMatchEl 返回 null，这句 `?.scrollIntoView(...)` 就是**静默无操作**（点了像没反应）。
    //   ⇒ 这是懒加载的既定行为，**不是 bug**：把那几页加载出来（点按钮 / 向上滚）之后再点这条结果就能跳。
    //   ⛔ 不要为了「点一下就跳到尚未加载的更早页」去动懒加载本身。
    //   双 rAF：等 chatSearchIndex 落地（高亮重打）再滚，否则滚到的是高亮前的 DOM。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const scroller = bag.scrollRef.current;
      if (scroller) locateMatchEl(scroller, hit)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
  }, [bag]);
  // 面板开着时 Esc 关闭（输入框自身的 Esc 也会冒泡到这里，行为一致）
  useEffect(() => {
    if (!bag.chatSearchOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") closeHistoryPanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bag.chatSearchOpen, closeHistoryPanel]);

  // 顶栏操作簇（🔍 搜索 / 调度 / 独立弹窗 / ⋯ 任务菜单 / 右栏开关；📁 工作区 10-06 夜七轮
  // 已挪去标题最前）：右栏关闭时嵌在
  // topbar 右端、开启时嵌在右栏顶条右端——两处都紧贴右上角原生窗口钮，且都是
  // 拖拽容器的【子元素】（no-drag 豁免），fixed 悬浮层会被拖拽区吞掉点击（实测）。
  const topbarActionsNode = (
    <>
      {bag.popoutThreadId ? (
        <button className="icon-button popout-return-btn" title="返回主应用（关闭本独立窗口）" onClick={() => void window.codex.popoutClose(bag.thread?.id ?? null)}><Minimize2 size={16} /></button>
      ) : (
        <>
          {/* 当前会话搜索（09-24）：顶栏 🔍 打开搜索条。只搜当前会话的消息，点结果跳到那条消息。 */}
          <div className="history-search-wrap">
            <button
              ref={historySearchBtnRef}
              type="button"
              className="icon-button"
              title="搜索当前会话（Ctrl+Shift+F）"
              aria-expanded={bag.chatSearchOpen}
              onClick={() => { if (bag.chatSearchOpen) closeHistoryPanel(); else bag.setChatSearchOpen(true); }}
            >
              <Search size={16} />
            </button>
            {bag.chatSearchOpen && createPortal((() => {
              // ⛔ 面板必须 portal 到 body + fixed：顶栏 .topbar 自带 z-index:30 的层叠上下文，
              //    面板 z 再高也只在其内部生效（与原通知面板同坑：DOM 查询全绿、画面上没有）。
              const r = historySearchBtnRef.current?.getBoundingClientRect();
              const posStyle = r
                ? { top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }
                : { top: 60, right: 12 };
              const query = bag.chatSearchQuery.trim();
              const hits = bag.chatSearchResults;
              const MAX_ITEMS = 50;
              // 片段：命中位置前后各取一段，命中词用 <mark>（与会话内搜索的高亮同源语义）
              const renderSnippet = (text: string) => {
                const lower = text.toLowerCase();
                const at = lower.indexOf(query.toLowerCase());
                if (at < 0) return text.slice(0, 120);
                const start = Math.max(0, at - 40);
                const end = Math.min(text.length, at + query.length + 80);
                const frag = text.slice(start, end);
                const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                return (
                  <>
                    {start > 0 ? "…" : ""}
                    {frag.split(new RegExp(`(${escaped})`, "gi")).map((part, partIndex) => (
                      part.toLowerCase() === query.toLowerCase() ? <mark key={partIndex}>{part}</mark> : <span key={partIndex}>{part}</span>
                    ))}
                    {end < text.length ? "…" : ""}
                  </>
                );
              };
              return (
                <>
                  <div className="menu-backdrop" onClick={closeHistoryPanel} />
                  <div className="history-search-panel" role="dialog" aria-label="搜索当前会话" style={posStyle}>
                    <div className="history-search-head">
                      <strong>搜索当前会话</strong>
                      {query ? <span className="history-search-meta">{hits.length ? `${hits.length} 处命中` : "无结果"}</span> : null}
                    </div>
                    <div className="history-search-input-row">
                      <Search size={14} />
                      <input
                        autoFocus
                        value={bag.chatSearchQuery}
                        placeholder="搜当前会话的消息（回车跳到下一条）"
                        onChange={(event) => { bag.setChatSearchQuery(event.target.value); bag.setChatSearchIndex(0); }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") { event.preventDefault(); bag.chatSearchGo(event.shiftKey ? -1 : 1); }
                        }}
                      />
                      <button onClick={() => bag.chatSearchGo(-1)} disabled={!hits.length} title="上一条">↑</button>
                      <button onClick={() => bag.chatSearchGo(1)} disabled={!hits.length} title="下一条">↓</button>
                    </div>
                    {!query && <div className="history-search-empty">只搜当前会话；输入关键词后回车跳到第一条命中，再回车继续往下</div>}
                    {query && !hits.length && <div className="history-search-empty">当前会话里没有匹配的消息</div>}
                    {query && hits.slice(0, MAX_ITEMS).map((hit, index) => (
                      <div key={hit.itemId} className={`history-search-item${index === bag.chatSearchIndex ? " is-current" : ""}`} onClick={() => jumpToHit(hit)}>
                        <div className="history-search-item-head">
                          <span className="history-search-title">{hit.type === "userMessage" ? "用户" : hit.type === "agentMessage" ? "助手" : "工具"}</span>
                          {index === bag.chatSearchIndex && <i className="history-search-tag">当前</i>}
                        </div>
                        <div className="history-search-snippet"><span>{renderSnippet(hit.text)}</span></div>
                      </div>
                    ))}
                    {query && hits.length > MAX_ITEMS && <div className="history-search-more">还有 {hits.length - MAX_ITEMS} 处命中（用 ↑ ↓ 继续跳）</div>}
                  </div>
                </>
              );
            })(), document.body)}
          </div>
          {/* 调度开关放独立窗口图标左边（09-16 用户要求） */}
          <DispatchMenu
            topbar
            dispatch={bag.activeDispatch}
            targets={bag.dispatchInfo.targets}
            disabled={!bag.thread?.id}
            busy={bag.dispatchBusy}
            lockedBy={bag.dispatchHolderName}
            onReleaseHolder={() => { void bag.releaseDispatchHolder(); }}
            restrictedLabel={bag.threadRole.restricted ? (bag.threadRole.label ?? "专家 / 专家团") : null}
            onChange={(next, opts) => { void bag.applyDispatch(next, opts); }}
          />
          <button className="icon-button popout-open-btn" title="独立会话弹窗：把当前会话开到新窗口（可拖出应用外，支持多个同时存在）" disabled={!bag.thread} onClick={() => { if (bag.thread) void bag.popoutCurrentThread(bag.thread.id); }}><Maximize2 size={16} /></button>
        </>
      )}
        {/* ⛔ 工作区 📁（.ctx-picker）10-06 夜七轮已挪去**标题最前**（AppView.tsx 的 .task-title）——
            用户令「把文件图标放到最前面」。挪走后：窄屏隐藏规则与守卫【250】覆盖率清单都跟着改到
            .task-title 前缀；不许再加回这个操作簇（会与标题前的那个重复）。 */}
        <div className="task-menu-wrap">
          {/* 10-06 夜三轮：原「目标与进程」常驻入口（Target 图标 + goals-pop 面板）已按用户令撤掉 ——
              任务清单改由输入框上方的回合状态胶囊承载（「步骤 N/M · X 个文件已修改」，悬停展开），
              ⛔ 别再往这里加回目标/清单类入口。 */}
          <button ref={taskBtnRef} className="icon-button tb-task-menu" title="当前任务操作" onClick={() => bag.setTaskMenuOpen((current) => !current)}><MoreHorizontal size={18} /></button>
          {bag.taskMenuOpen && <>
            <div className="menu-backdrop" onClick={bag.closeTaskMenu} />
            {createPortal(
              <div className="task-menu task-menu-fixed" role="menu" style={taskMenuStyle}>
              <div className="task-menu-sections">
                <div className="task-menu-section">
                  <span className="task-menu-label">当前任务</span>
                  <button disabled={!bag.thread} onClick={() => { bag.closeTaskMenu(); void bag.runSlashCommand("/compact"); }}><Minimize2 size={14} /><span>压缩上下文</span></button>
                  <button disabled={!bag.thread} onClick={() => { bag.closeTaskMenu(); void bag.runSlashCommand("/review"); }}><Search size={14} /><span>审查代码改动</span></button>
                  <button disabled={!bag.thread} onClick={() => { bag.closeTaskMenu(); void bag.runSlashCommand("/undo"); }}><RotateCcw size={14} /><span>撤销上一轮</span></button>
                </div>
                <div className="task-menu-section">
                  <span className="task-menu-label">工作区</span>
                  <button onClick={() => { bag.closeTaskMenu(); bag.setRightOpen(true); bag.setRightTab("tree"); }}><FolderTree size={14} /><span>浏览项目文件</span></button>
                  <button disabled={!bag.thread} onClick={() => { bag.closeTaskMenu(); void bag.runSlashCommand("/queue"); }}><ListChecks size={14} /><span>消息队列</span></button>
                </div>
              </div>
              </div>,
              document.body,
            )}
          </>}
        </div>
        {/* 10-04 用户拍板：**顶栏的终端按钮已删** —— 右侧栏里已经有「终端」标签页
            （part09/01-seg.tsx 的面板分组），顶栏那个是重复入口。
            ⛔ 同步清掉了 09-settings-workspace-memory.css 里的 `.tb-terminal` 规则 ——
               留着就是一条无主的死样式（守卫【160】那种"引用了但类没了"的方向相反：
               类没了规则还在）。*/}
        <button className="icon-button tb-right-panel" title={bag.rightOpen ? "收起右侧面板" : "展开右侧面板"} onClick={() => bag.setRightOpen(!bag.rightOpen)}>{bag.rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    </>
  );
bag.topbarActionsNode = topbarActionsNode as typeof bag.topbarActionsNode;
  /* Laya 自动档（10-01）：状态在 part06 挂 bag（⛔ part06 先跑），这里镜像出本地名进 return 面
     ——【92】要求 return 的每个名字要么本地声明要么 bag 镜像，直接写 bag.x 会打红。 */
  const effortAuto = bag.effortAuto;
  const changeEffortAuto = bag.changeEffortAuto;
  const resolveAutoEffort = bag.resolveAutoEffort;
  const layaInstalled = bag.layaInstalled;
  const layaReady = bag.layaReady;
  const autoEffortApplied = bag.autoEffortApplied;
  return { activeThreadMemberRunning, activeMemberTeam, activeMember, activityLabel, railTeamId, railTeam, railRuns, railRunningByMember, railLastByMember, popupRun, historyMemberRuns, delegatedRailRuns, delegatedPopupRun, recentCompaction, saveInlineRename, earlyView, topbarActionsNode, effortAuto, changeEffortAuto, resolveAutoEffort, layaInstalled, layaReady, autoEffortApplied, ctxBtnRef, ctxMenuStyle, taskBtnRef, taskMenuStyle };
}
