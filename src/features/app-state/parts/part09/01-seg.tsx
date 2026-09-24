/**
 * usePart09a（09-22：part09 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
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
import { pickEnhanceHint, shouldShowHintAfterSends, isLongPrompt, HINT_COOLDOWN_MS, HINT_AUTO_HIDE_MS } from "../../../../lib/enhance-hints.mjs";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../lib/turn-fold";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { basename } from "../../../../lib/basename";
import type { Bag } from "../bag-types";

export function usePart09a(bag: Bag) {
  /** 输入框回车语义（09-23 按 WorkBuddy 口径对齐）：
   *   · `Enter` → 发送；
   *   · `Shift` / `Ctrl` / `Cmd` + `Enter` → **换行**。
   *     ⛔ 原判据是 `!event.shiftKey` ⇒ **Ctrl+Enter 也被当成发送**，与「快捷键一览」里
   *        `keys: ["Ctrl+Enter", "Enter"] → 发送消息` 自相矛盾：Ctrl+Enter 换行才是通用习惯
   *        （WorkBuddy 5.5.2 专门「恢复 Ctrl/Cmd+Enter 换行」）。
   *   ⛔ 必须先挡**输入法组字**：中文/日文选候选词同样是 Enter，Chromium 组字期间照样派发 keydown
   *      （`isComposing=true`，老引擎给 `keyCode 229`）—— 早期判据只有 `!shiftKey`，
   *      打中文时按回车确认候选词会**把半截消息直接发出去**。
   *   ⛔ Ctrl/Cmd+Enter 自己插换行：不要指望 contentEditable 对带修饰键的 Enter 一定有默认行为
   *      （无默认行为时用户会看到"按了没反应"，比原来的"误发送"更难查）。 */
  function onComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      // ⛔ 不能用 `document.execCommand("insertLineBreak")`：对 `contenteditable="plaintext-only"`
      //   是**空操作** —— 真机实测 Ctrl+Enter 后输入框里什么都没变（"按了没反应"比原来的"误发送"
      //   更难查）。走项目既有约定（见 src/features/composer/Composer.tsx 的粘贴分支）。
      document.execCommand("insertText", false, "\n");
      return;
    }
    if (event.shiftKey || event.altKey) return;   // 交给浏览器默认（插入换行）
    event.preventDefault();
    void bag.send();
  }
bag.onComposerKeyDown = onComposerKeyDown as typeof bag.onComposerKeyDown;

  function closePanelTab(key: string) {
    bag.setOpenTabs((current) => {
      const closed = current.find((tab) => tab.key === key);
      if (closed) bag.setRecentlyClosed((list) => [{ key: closed.key, name: closed.name, at: Date.now() }, ...list.filter((entry) => entry.name !== closed.name)].slice(0, 6));
      const next = current.filter((tab) => tab.key !== key);
      if (bag.rightTab === key) bag.setRightTab(next[0] ? next[0].key : "");
      return next;
    });
  }
bag.closePanelTab = closePanelTab as typeof bag.closePanelTab;

  function openPanelTab(key: string, name: string) {
    bag.setOpenTabs((current) => current.some((tab) => tab.key === key) ? current : [...current, { key, name }]);
    bag.setRightTab(key);
    bag.setRecentlyClosed((list) => list.filter((entry) => entry.name !== name));
    bag.setSwitcherOpen(false);
  }
bag.openPanelTab = openPanelTab as typeof bag.openPanelTab;

  // 长会话窗口化：默认只渲染最近 TURN_WINDOW 个回合，更早的由「显示更早/滚动到顶」
  // 增量加载（loadEarlierTurns）。这台机器是软件渲染（无 GPU），把几千个回合一次性挂进
  // React 是「切会话要等很久」的主因——content-visibility 只省绘制，省不掉建元素与
  // Markdown 解析的成本。窗口按会话记数（turnWindow[id]），openThread 切回时重置，
  // 保证切换成本恒定；ref 镜像供 loadEarlierTurns/刻度尺跳转免重渲染读取。
  const [turnWindow, setTurnWindow] = useState<Record<string, number>>({});
bag.turnWindow = turnWindow as typeof bag.turnWindow; bag.setTurnWindow = setTurnWindow as typeof bag.setTurnWindow;

  const turnWindowRef = useRef<Record<string, number>>({});
bag.turnWindowRef = turnWindowRef as typeof bag.turnWindowRef;

  const loadingEarlierRef = useRef<Set<string>>(new Set());
bag.loadingEarlierRef = loadingEarlierRef as typeof bag.loadingEarlierRef;

  /** 正在续载更早历史的会话 id：ref 只用于防重入（不触发渲染），这个 state 驱动顶部提示
   *  ——此前自动加载是「静默」的，用户不知道正在加载。 */
  const [earlierLoadingId, setEarlierLoadingId] = useState<string | null>(null);
bag.earlierLoadingId = earlierLoadingId as typeof bag.earlierLoadingId; bag.setEarlierLoadingId = setEarlierLoadingId as typeof bag.setEarlierLoadingId;

  /** 真实用户滚动信号：只有用户自己滚（滚轮 / 触摸 / 翻页键 / 拖滚动条）才允许「滚动近顶自动续载」。
   *  ⛔ 不能用 scrollTop 位置反推用户意图（项目既有铁律）：打开会话时 jumpToBottom 的程序化滚动、
   *  上方插入内容后的位置补偿，都会把 scrollTop 扫过「近顶」区间——据此续载会「用户没滚也跟着加载」
   *  （实测首屏白加载一页：3 → 6 回合）。 */
  const userScrolledRef = useRef(false);
bag.userScrolledRef = userScrolledRef as typeof bag.userScrolledRef;

  useEffect(() => {
    const mark = () => { bag.userScrolledRef.current = true; };
    // 形参用 Event + 断言：直接标 KeyboardEvent 会让 addEventListener("keydown") 的重载匹配失败
    const onKey = (event: Event) => {
      const tag = (event.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return; // 输入框里打字不算滚动
      const key = String((event as unknown as { key?: string }).key ?? "");
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(key)) mark();
    };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function expandTurnWindow(id: string, count: number) {
    const next = { ...bag.turnWindowRef.current, [id]: (bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW) + count };
    bag.turnWindowRef.current = next;
    bag.setTurnWindow(next);
  }
bag.expandTurnWindow = expandTurnWindow as typeof bag.expandTurnWindow;

  /** 回到最新（贴底）后把渲染窗口**收回基线**：往上滚看过的历史不必一直渲染——用户实测
   *  「滚上去看了历史消息、再滚下来，切换会话回来它还在渲染，不方便」。
   *  ⛔ 只收「渲染窗口」，不动 thread.turns（数据仍在内存：再往上滚先本地展开、不重新请求），
   *  引擎侧上下文更不受影响；窗口记忆也回到基线，所以切走再切回同样是初始态。 */
  function collapseTurnWindow(id: string) {
    if ((bag.turnWindowRef.current[id] ?? bag.TURN_WINDOW) === bag.TURN_WINDOW) return;
    const next = bag.touchTurnWindow(id, { ...bag.turnWindowRef.current, [id]: bag.TURN_WINDOW });
    bag.turnWindowRef.current = next;
    bag.setTurnWindow(next);
  }
bag.collapseTurnWindow = collapseTurnWindow as typeof bag.collapseTurnWindow;

  const allItems = bag.thread?.turns.flatMap((turn) => turn.items) ?? [];
bag.allItems = allItems as typeof bag.allItems;

  const isEmpty = !bag.thread && !bag.allItems.length;
bag.isEmpty = isEmpty as typeof bag.isEmpty;

  // 欢迎页（空会话）自动聚焦输入框：docked-center 的 absolute 定位 + 过渡动画期间命中区域会
  // 短暂偏移，用户点好几次才聚焦。进入欢迎页直接聚焦，从根上绕开「点不进去」。
  useEffect(() => {
    if (!bag.showLogin && bag.isEmpty) {
      const raf = requestAnimationFrame(() => bag.composerInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [bag.isEmpty, bag.showLogin]);

  // 无缓存切换会话期间（thread 尚未恢复），顶部标题先用列表里的名称，避免闪「新任务」
  const switchingMeta = bag.switchingThreadId ? bag.threads.find((entry) => entry.id === bag.switchingThreadId) : null;
bag.switchingMeta = switchingMeta as typeof bag.switchingMeta;

  // 命令面板条目（09-12 多会话性能）：原来是未 memo 的 IIFE，**每次 App 渲染**都要
  // 过滤 threads + 整棵项目树、构造十几个带闭包的对象——而 onEvent 里的 setState
  // 会让 App 高频重渲染（多会话时更密）。这里只对「数据」做记忆化：函数们不是
  // useCallback（不在依赖里，否则每次渲染都变、memo 形同虚设），统一走 ref 取最新值。
  const paletteHandlersRef = useRef({ startNewThread: bag.startNewThread, chooseWorkspace: bag.chooseWorkspace, setSettingsPage: bag.setSettingsPage, setSettingsOpen: bag.setSettingsOpen, setRightOpen: bag.setRightOpen, openPanelTab: bag.openPanelTab, openThread: bag.openThread, openFile: bag.openFile });
bag.paletteHandlersRef = paletteHandlersRef as typeof bag.paletteHandlersRef;

  bag.paletteHandlersRef.current = { startNewThread: bag.startNewThread, chooseWorkspace: bag.chooseWorkspace, setSettingsPage: bag.setSettingsPage, setSettingsOpen: bag.setSettingsOpen, setRightOpen: bag.setRightOpen, openPanelTab: bag.openPanelTab, openThread: bag.openThread, openFile: bag.openFile };

  const paletteSections = useMemo(() => {
    const H = bag.paletteHandlersRef.current;
    const q = bag.paletteQuery.toLowerCase();
    const match = (label: string) => label.toLowerCase().includes(q);
    const ops = [
      { group: "建议", label: "新任务", shortcut: "Ctrl+N", icon: MessageSquarePlus, run: () => H.startNewThread() },
      { group: "建议", label: "打开工作区", shortcut: "Ctrl+O", icon: FolderOpen, run: () => void H.chooseWorkspace() },
      { group: "建议", label: "设置", icon: Settings2, run: () => { H.setSettingsPage("general"); H.setSettingsOpen(true); } },
      { group: "面板", label: "切换侧边栏", shortcut: "Ctrl+B", icon: PanelRightOpen, run: () => H.setRightOpen((current) => !current) },
      { group: "面板", label: "切换终端", shortcut: "Ctrl+J", icon: TerminalSquare, run: () => H.openPanelTab("terminal", bag.workspace ? basename(bag.workspace) : "终端") },
      { group: "面板", label: "切换预览", icon: Globe2, run: () => H.openPanelTab("browser", "浏览器") },
      { group: "面板", label: "打开变更视图", icon: GitBranch, run: () => H.openPanelTab("review", "变更") },
      { group: "面板", label: "添加项目树标签", icon: FolderTree, run: () => H.openPanelTab("tree", "项目树") },
      { group: "配置", label: "自动化", icon: Clock3, run: () => { H.setSettingsPage("schedule"); H.setSettingsOpen(true); } },
      { group: "配置", label: "模型设置", icon: Bot, run: () => { H.setSettingsPage("model"); H.setSettingsOpen(true); } },
      { group: "配置", label: "插件", icon: Store, run: () => { H.setSettingsPage("plugins"); H.setSettingsOpen(true); } },
      { group: "配置", label: "记忆", icon: Archive, run: () => { H.setSettingsPage("memory"); H.setSettingsOpen(true); } },
    ].filter((row) => match(row.label));
    const tasks = bag.threads.filter((entry) => (entry.name ?? "").toLowerCase().includes(q) || (entry.preview ?? "").toLowerCase().includes(q)).map((entry) => ({ group: "任务", label: cleanThreadDisplayTitle(entry.name, { preview: entry.preview }), icon: MessageSquare, run: () => void H.openThread(entry.id) }));
    const files = bag.treeEntries.filter((entry) => !entry.isDirectory && entry.fileName.toLowerCase().includes(q)).map((entry) => ({ group: "文件", label: entry.fileName, icon: FileCode2, run: () => void H.openFile(`${bag.treePath || bag.workspace}${bag.treePath || bag.workspace ? (bag.treePath.includes("\\") ? "\\" : "/") : ""}${entry.fileName}`) }));
    const sections: { group: string; rows: any[] }[] = [];
    if (bag.paletteTab === "all" || bag.paletteTab === "ops") for (const group of ["建议", "面板", "配置"]) {
      const rows = ops.filter((row) => row.group === group);
      if (rows.length) sections.push({ group, rows });
    }
    if ((bag.paletteTab === "all" || bag.paletteTab === "tasks") && tasks.length) sections.push({ group: "任务", rows: tasks });
    if ((bag.paletteTab === "all" || bag.paletteTab === "files") && bag.attachedFiles.length) sections.push({ group: "文件", rows: bag.attachedFiles });
    return sections;
  }, [bag.paletteQuery, bag.paletteTab, bag.threads, bag.treeEntries, bag.treePath, bag.workspace]);
bag.paletteSections = paletteSections as typeof bag.paletteSections;

  const fileTruncated = bag.filePreview?.kind === "text" && bag.filePreview.content.length >= 200_000;
bag.fileTruncated = fileTruncated as typeof bag.fileTruncated;

  const usage = bag.tokenUsage?.total ?? bag.tokenUsage?.last ?? bag.tokenUsage;
bag.usage = usage as typeof bag.usage;

  const lastUsage = bag.tokenUsage?.last ?? bag.usage;
bag.lastUsage = lastUsage as typeof bag.lastUsage;

  // 记忆化理由同 paletteSections：原来每次 App 渲染都新建数组（O(回合数)），
  // 而 onEvent 高频 setState 会让它每帧都跑一遍。
  const completedTurns = useMemo(() => bag.thread?.turns.filter((turn) => turn.status !== "inProgress") ?? [], [bag.threadMemoKey]);
bag.completedTurns = completedTurns as typeof bag.completedTurns;

  const latestCompletedTurn = bag.completedTurns.at(-1);
bag.latestCompletedTurn = latestCompletedTurn as typeof bag.latestCompletedTurn;

  const stats = bag.usageStats;
bag.stats = stats as typeof bag.stats;

  const activeFlags: string[] = bag.thread?.status?.activeFlags ?? [];
bag.activeFlags = activeFlags as typeof bag.activeFlags;

  const waitingForApproval = bag.activeFlags.includes("waitingOnApproval") || bag.pending.some((request) => request.method.toLowerCase().includes("approval"));
bag.waitingForApproval = waitingForApproval as typeof bag.waitingForApproval;

  const waitingForInput = bag.activeFlags.includes("waitingOnUserInput");
bag.waitingForInput = waitingForInput as typeof bag.waitingForInput;

  // 当前会话只读取自己的运行状态；其他后台任务继续在侧栏独立显示，不影响本会话按钮。
  const activeThreadRunning = Boolean(bag.thread && (bag.runningThreadIds.has(bag.thread.id) || bag.thread.turns.some((turn) => isTurnRunning(turn))));
bag.activeThreadRunning = activeThreadRunning as typeof bag.activeThreadRunning;

  // 输入被清空 → 重置"长输入已触发"标记（所以下一条长需求还能提醒一次）
  useEffect(() => { if (!bag.prompt.trim()) bag.enhanceLongFiredRef.current = false; }, [bag.prompt]);

    // 提示气泡的展示前提：按钮真的渲染出来了（条件必须与 enhance-button 的 JSX 条件一致，
    // 否则会出现"按钮没画出来却去弹气泡" ⇒ 用户永远看不到）。
    // ⛔ 09-23 起**不再含**「回合是否在跑」：运行中输入框里写的是**下一条消息的草稿**，
    //   与在跑的回合互不相干；按 running 隐藏会让长任务里打草稿的用户看不到按钮（用户实测报回）。
    const enhanceAnchorVisible = Boolean(bag.prompt.trim() || bag.hasEnhanceBackup);
bag.enhanceAnchorVisible = enhanceAnchorVisible as typeof bag.enhanceAnchorVisible;

    useEffect(() => {
      if (bag.enhanceHint) return;
      if (!bag.enhanceAnchorVisible) return;   // 条件不满足时**不清任何 pending**，等按钮真的渲染出来
      const longPromptDue = isLongPrompt(bag.prompt) && !bag.enhanceLongFiredRef.current;
      // ⛔ 09-20 用户：「增强弹出来频率太高了，一输入文字就出来了」⇒ `due` 里**不再有**
      //   「本次启动首次」那一项 —— 打字期间**一次都不弹**。提醒只发生在两种时机：
      //     ① 发送之后（第 1 次发送 + 之后每 10 次，见发送处的 shouldShowHintAfterSends）；
      //     ② 输入很长（≥120 字符，按"编辑会话"节流）。
      const due = bag.enhanceHintAfterSendRef.current || longPromptDue;
      if (!due) return;
      if (Date.now() - bag.enhanceHintFiredAtRef.current < HINT_COOLDOWN_MS) return;   // 防连弹（3 分钟）
      bag.enhanceHintAfterSendRef.current = false;
      if (longPromptDue) bag.enhanceLongFiredRef.current = true;
      bag.showEnhanceHint();
    }, [bag.enhanceAnchorVisible, bag.enhanceHint, bag.prompt]);
  return { onComposerKeyDown, closePanelTab, openPanelTab, turnWindow, setTurnWindow, turnWindowRef, loadingEarlierRef, earlierLoadingId, setEarlierLoadingId, userScrolledRef, expandTurnWindow, collapseTurnWindow, allItems, isEmpty, switchingMeta, paletteHandlersRef, paletteSections, fileTruncated, usage, lastUsage, completedTurns, latestCompletedTurn, stats, activeFlags, waitingForApproval, waitingForInput, activeThreadRunning, enhanceAnchorVisible };
}
