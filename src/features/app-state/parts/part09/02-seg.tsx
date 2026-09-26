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
import { basename } from "../../../../lib/basename";
import { locateMatchEl } from "../../../app-view/helpers";
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

  // 顶栏操作簇（📁 工作区 / ⋯ 任务菜单 / 新建终端 / 右栏开关）：右栏关闭时嵌在
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
                <div className="ctx-picker">
          <button className="icon-button tb-workspace" title="工作区上下文（当前会话使用的项目目录）" onClick={() => bag.setCtxMenuOpen((current) => !current)}><FolderOpen size={16} /></button>
          {bag.ctxMenuOpen && <>
            <div className="menu-backdrop" onClick={() => bag.setCtxMenuOpen(false)} />
            <div className="task-menu ctx-menu">
              <button onClick={() => { bag.setCtxMenuOpen(false); void bag.chooseWorkspace(); }}><FolderOpen size={14} />{bag.workspace ? "选择其他目录…" : "选择工作区目录"}</button>
              {bag.workspace && <button onClick={() => bag.setCtxMenuOpen(false)}><FolderOpen size={14} /><span className="ctx-current-name">资源管理器 · {basename(bag.workspace)}</span><Check size={14} className="ctx-check" /></button>}
            </div>
          </>}
        </div>
        <div className="task-menu-wrap">
          {/* ★ 常驻入口（09-15 用户要求 D）：面板被自动隐藏或手动关掉后，仍能从这里叫回。
              只在「确实有内容」时出现（有执行计划 / 有目标 / 有待办），避免无意义占位。
              点击 = 复位 goalsAutoGone（跑完自动隐藏的标记）+ 打开面板 + 展开内容。 */}
          {(bag.planSteps.length > 0 || bag.goalText || bag.taskList.length > 0) && (
            <button
              className="icon-button tb-goals-entry"
              title="目标与进程（执行计划 / 待办事项）"
              onClick={() => { bag.setGoalsAutoGone(false); bag.setGoalsOpen(true); bag.setGoalsExpanded(true); bag.setGoalsDocked(false); }}
            >
              <Target size={17} />
              <span className="tb-goals-badge">{bag.planSteps.filter((s) => s.status === "completed").length}/{bag.planSteps.length}</span>
            </button>
          )}
          <button className="icon-button tb-task-menu" title="当前任务操作" onClick={() => bag.setTaskMenuOpen((current) => !current)}><MoreHorizontal size={18} /></button>
          {bag.taskMenuOpen && <>
            <div className="menu-backdrop" onClick={bag.closeTaskMenu} />
            <div className="task-menu" role="menu">
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
            </div>
          </>}
        </div>
        <button className="icon-button tb-terminal" title="新建终端标签页" onClick={() => { bag.setRightOpen(true); bag.setRightTab("terminal"); }}><TerminalSquare size={16} /></button>
        <button className="icon-button tb-right-panel" title={bag.rightOpen ? "收起右侧面板" : "展开右侧面板"} onClick={() => bag.setRightOpen(!bag.rightOpen)}>{bag.rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    </>
  );
bag.topbarActionsNode = topbarActionsNode as typeof bag.topbarActionsNode;
  return { activeThreadMemberRunning, activeMemberTeam, activeMember, activityLabel, railTeamId, railTeam, railRuns, railRunningByMember, railLastByMember, popupRun, historyMemberRuns, delegatedRailRuns, delegatedPopupRun, recentCompaction, saveInlineRename, earlyView, topbarActionsNode };
}
