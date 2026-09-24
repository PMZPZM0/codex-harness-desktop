/**
 * usePart02b11 —— usePart02b1 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：目标状态/复核/文件树 — 会话关注与集群行渲染
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { QueueItem } from "../../../../../../lib/queue-item";
import { DELEGATE_RAIL_LINGER_MS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, MEMBER_LABELS, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES } from "../../../../../app-view/constants";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../../app-view/types";
import type { Bag } from "../../../bag-types";

export function usePart02b11(bag: Bag) {
 // 方案审阅卡的提意见输入框
  // ── /goal 目标模式（引擎原生 thread goal：自动 continuation，模型用 update_goal 判定达成）──
  // goalStatus: active/paused/blocked/usageLimited/budgetLimited/complete（引擎 ThreadGoalStatus）
  const [goalStatus, setGoalStatus] = useState<string | null>(null);
bag.goalStatus = goalStatus as typeof bag.goalStatus; bag.setGoalStatus = setGoalStatus as typeof bag.setGoalStatus;

  // 目标卡生命周期（09-15 用户定稿）：任务跑完 → **立即隐藏**；新任务开始立即恢复显示。
  // ⛔ 旧实现是「收纳后 20s 才消失」—— 用户反馈「任务完成了就该隐藏掉，没必要还保留」，
  //    且 20s 这个时机既打扰（还想看时它没了）又拖沓（不想看时它还占着）。
  //    现在改为下降沿立刻隐藏（完成即走），并由工具栏的常驻入口随时叫回（见 goalsHandle）。
  const [goalsAutoGone, setGoalsAutoGone] = useState(false);
bag.goalsAutoGone = goalsAutoGone as typeof bag.goalsAutoGone; bag.setGoalsAutoGone = setGoalsAutoGone as typeof bag.setGoalsAutoGone;

  const goalsPrevRunningRef = useRef(false);
bag.goalsPrevRunningRef = goalsPrevRunningRef as typeof bag.goalsPrevRunningRef;

  const goalsTaskRunning = Boolean(bag.sending || bag.activeTurnId);
bag.goalsTaskRunning = goalsTaskRunning as typeof bag.goalsTaskRunning;

  useEffect(() => {
    const wasRunning = bag.goalsPrevRunningRef.current;
    bag.goalsPrevRunningRef.current = bag.goalsTaskRunning;
    if (bag.goalsTaskRunning) {
      // 新任务开始：恢复显示（并把「用户手动关掉」的状态也一并复位，任务来了就该看见）
      bag.setGoalsAutoGone(false);
      bag.setGoalsOpen(true);
      return;
    }
    // 只在运行 → 空闲的下降沿触发（挂载时本就空闲不动作）
    if (!wasRunning) return;
    bag.setGoalsExpanded(false);
    bag.setGoalsAutoGone(true);
  }, [bag.goalsTaskRunning]);

  const [reviewBusy, setReviewBusy] = useState(false);
bag.reviewBusy = reviewBusy as typeof bag.reviewBusy; bag.setReviewBusy = setReviewBusy as typeof bag.setReviewBusy;

  const [reviewReport, setReviewReport] = useState("");
bag.reviewReport = reviewReport as typeof bag.reviewReport; bag.setReviewReport = setReviewReport as typeof bag.setReviewReport;

  const reviewTurnRef = useRef<string | null>(null);
bag.reviewTurnRef = reviewTurnRef as typeof bag.reviewTurnRef;

  const [treePath, setTreePath] = useState("");
bag.treePath = treePath as typeof bag.treePath; bag.setTreePath = setTreePath as typeof bag.setTreePath;

  const [treeEntries, setTreeEntries] = useState<TreeEntry[]>([]);
bag.treeEntries = treeEntries as typeof bag.treeEntries; bag.setTreeEntries = setTreeEntries as typeof bag.setTreeEntries;

  // ZCode 式树形：每个目录的子项缓存 + 已展开目录集合（原地下级展开，不再整树切换目录）
  const [treeChildren, setTreeChildren] = useState<Record<string, TreeEntry[]>>({});
bag.treeChildren = treeChildren as typeof bag.treeChildren; bag.setTreeChildren = setTreeChildren as typeof bag.setTreeChildren;

  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
bag.treeExpanded = treeExpanded as typeof bag.treeExpanded; bag.setTreeExpanded = setTreeExpanded as typeof bag.setTreeExpanded;

  const [treeLoading, setTreeLoading] = useState(false);
bag.treeLoading = treeLoading as typeof bag.treeLoading; bag.setTreeLoading = setTreeLoading as typeof bag.setTreeLoading;

  const [browserHome, setBrowserHome] = useState(() => localStorage.getItem("browser-home") ?? "https://github.com/openai/codex");
bag.browserHome = browserHome as typeof bag.browserHome; bag.setBrowserHome = setBrowserHome as typeof bag.setBrowserHome;

  const [browserUrl, setBrowserUrl] = useState("");
bag.browserUrl = browserUrl as typeof bag.browserUrl; bag.setBrowserUrl = setBrowserUrl as typeof bag.setBrowserUrl;

  const [browserDraft, setBrowserDraft] = useState("");
bag.browserDraft = browserDraft as typeof bag.browserDraft; bag.setBrowserDraft = setBrowserDraft as typeof bag.setBrowserDraft;

  // 09-16：默认用**内置浏览器视图**（右栏 BrowserPane = 内置 Chromium webview）；CloakBrowser 改为
  // 按需下载的可选增强（需要过反爬站点时才用）。这里的 mode 是旧版 App 级浏览器面板的遗留字段
  // （面板已由 components/BrowserPane 取代），仅用于兼容既有渲染分支，默认值也必须跟「默认内置」一致。
  const [browserMode] = useState<"cloak" | "internal">("internal");
bag.browserMode = browserMode as typeof bag.browserMode;

  const [cloakPage, setCloakPage] = useState("");
bag.cloakPage = cloakPage as typeof bag.cloakPage; bag.setCloakPage = setCloakPage as typeof bag.setCloakPage;

  const [cloakStatus, setCloakStatus] = useState("");
bag.cloakStatus = cloakStatus as typeof bag.cloakStatus; bag.setCloakStatus = setCloakStatus as typeof bag.setCloakStatus;

  // 浏览器收藏夹 + 历史（localStorage 持久化）
  const [browserBookmarks, setBrowserBookmarks] = useState<{ url: string; title: string }[]>(() => { try { return JSON.parse(localStorage.getItem("browser-bookmarks") ?? "[]"); } catch { return []; } });
bag.browserBookmarks = browserBookmarks as typeof bag.browserBookmarks; bag.setBrowserBookmarks = setBrowserBookmarks as typeof bag.setBrowserBookmarks;

  const [browserHistory, setBrowserHistory] = useState<{ url: string; title: string; at: number }[]>(() => { try { return JSON.parse(localStorage.getItem("browser-history") ?? "[]"); } catch { return []; } });
bag.browserHistory = browserHistory as typeof bag.browserHistory; bag.setBrowserHistory = setBrowserHistory as typeof bag.setBrowserHistory;

  const [browserDrawer, setBrowserDrawer] = useState<"" | "bookmarks" | "history">("");
bag.browserDrawer = browserDrawer as typeof bag.browserDrawer; bag.setBrowserDrawer = setBrowserDrawer as typeof bag.setBrowserDrawer;

  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
bag.browserMenuOpen = browserMenuOpen as typeof bag.browserMenuOpen; bag.setBrowserMenuOpen = setBrowserMenuOpen as typeof bag.setBrowserMenuOpen;

  const [backupBusy, setBackupBusy] = useState<"" | "export" | "import" | "export-md" | "import-md">("");
bag.backupBusy = backupBusy as typeof bag.backupBusy; bag.setBackupBusy = setBackupBusy as typeof bag.setBackupBusy;

  // cloak 首页快捷站点：收藏夹优先（≤6），不足补内置常用站点
  const homeSites = useMemo(() => {
    const list: { name: string; url: string; color?: string }[] = bag.browserBookmarks.slice(0, 6).map((b) => ({ name: b.title || b.url, url: b.url }));
    for (const s of QUICK_SITES) {
      if (list.length >= 6) break;
      if (!list.some((x) => x.url === s.url)) list.push({ name: s.name, url: s.url, color: s.color });
    }
    return list;
  }, [bag.browserBookmarks]);
bag.homeSites = homeSites as typeof bag.homeSites;

  const iframeRef = useRef<HTMLIFrameElement>(null);
bag.iframeRef = iframeRef as typeof bag.iframeRef;

  const [queue, setQueue] = useState<QueueItem[]>([]);
bag.queue = queue as typeof bag.queue; bag.setQueue = setQueue as typeof bag.setQueue;

  const [queueDragIndex, setQueueDragIndex] = useState<number | null>(null);
bag.queueDragIndex = queueDragIndex as typeof bag.queueDragIndex; bag.setQueueDragIndex = setQueueDragIndex as typeof bag.setQueueDragIndex;

  const [mobileNav, setMobileNav] = useState(false);
bag.mobileNav = mobileNav as typeof bag.mobileNav; bag.setMobileNav = setMobileNav as typeof bag.setMobileNav;

  const [sidebarFlyout, setSidebarFlyout] = useState(false);
bag.sidebarFlyout = sidebarFlyout as typeof bag.sidebarFlyout; bag.setSidebarFlyout = setSidebarFlyout as typeof bag.setSidebarFlyout;

  const [threadRowMenu, setThreadRowMenu] = useState<{ id: string; top: number; right: number } | null>(null);
bag.threadRowMenu = threadRowMenu as typeof bag.threadRowMenu; bag.setThreadRowMenu = setThreadRowMenu as typeof bag.setThreadRowMenu;

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar-sections-collapsed") || "[]") as string[]); } catch { return new Set<string>(); }
  });
bag.collapsedSections = collapsedSections as typeof bag.collapsedSections; bag.setCollapsedSections = setCollapsedSections as typeof bag.setCollapsedSections;

  const toggleSection = useCallback((key: string) => {
    bag.setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("sidebar-sections-collapsed", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
bag.toggleSection = toggleSection as typeof bag.toggleSection;
  return { goalStatus, setGoalStatus, goalsAutoGone, setGoalsAutoGone, goalsPrevRunningRef, goalsTaskRunning, reviewBusy, setReviewBusy, reviewReport, setReviewReport, reviewTurnRef, treePath, setTreePath, treeEntries, setTreeEntries, treeChildren, setTreeChildren, treeExpanded, setTreeExpanded, treeLoading, setTreeLoading, browserHome, setBrowserHome, browserUrl, setBrowserUrl, browserDraft, setBrowserDraft, browserMode, cloakPage, setCloakPage, cloakStatus, setCloakStatus, browserBookmarks, setBrowserBookmarks, browserHistory, setBrowserHistory, browserDrawer, setBrowserDrawer, browserMenuOpen, setBrowserMenuOpen, backupBusy, setBackupBusy, homeSites, iframeRef, queue, setQueue, queueDragIndex, setQueueDragIndex, mobileNav, setMobileNav, sidebarFlyout, setSidebarFlyout, threadRowMenu, setThreadRowMenu, collapsedSections, setCollapsedSections, toggleSection };
}
