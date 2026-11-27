/**
 * AppViewReviewPanel —— AppView 的 JSX 第 3 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
  Activity as ActivityIcon,
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
  SquareTerminal,
} from "lucide-react";
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../components/CardShell";
import BrowserPane from "../../../components/BrowserPane";
import { TaskMonitorPanel } from "../../task-monitor/TaskMonitorPanel";
import { TurnReviewPanel } from "../../status";
import { WorkspaceFilePreview } from "./03-workspace-files";
import { getRightFile, subscribeRightFile } from "../../../lib/right-file.mjs";
import { isImagePath } from "../../../lib/is-image-path";
import { refreshWithReceipt } from "../../../lib/refresh-receipt.mjs";
import { canvasLightMs, subscribeCanvasActivity } from "../../../lib/canvas-activity.mjs";
import { defaultPanelWidth, getPanelMaximized, setPanelMaximized, subscribePanelMaximized } from "../../../lib/panel-zoom.mjs";
import { CommandExecutionCard, TerminalPanel } from "../../terminal";
import { StorageSection, ReviewPanel } from "../../storage-settings";
import { DramaCanvas } from "../../drama-canvas";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

/** 右侧面板的可开关标签（11-26 用户令：右栏改成浏览器式标签条）。数组顺序 = 标签顺序。 */
const PANEL_TABS: Array<{ key: string; name: string; Icon: typeof Globe2; ic: string; title: string }> = [
  { key: "monitor", name: "监控", Icon: ActivityIcon, ic: "ic-violet", title: "监控：本会话的技能 / MCP / 插件、每轮产物，以及由本会话 Codex 产出的自我改进建议" },
  { key: "review", name: "变更", Icon: GitBranch, ic: "ic-green", title: "变更：按范围查看 Git 改动（未暂存 / 已暂存 / 分支起点 / 上一轮）" },
  { key: "turn-review", name: "审阅", Icon: FileText, ic: "ic-pink", title: "审阅：本轮对话改过的文件与完整对比" },
  { key: "browser", name: "浏览器", Icon: Globe2, ic: "ic-blue", title: "浏览器：在内置浏览器打开网页" },
  { key: "tree", name: "文件", Icon: FolderTree, ic: "ic-amber", title: "文件：浏览工作区并预览" },
  /* ⛔ 11-26 用户令：「加一个标签页打开图片功能，不是在画布 —— 画布是编辑图的」。
     ⇒ 图片页 = **只读查看**（打开本地图 / 看尺寸与路径 / 放大缩小），改图仍去「画布」页。 */
  { key: "image", name: "图片", Icon: Image, ic: "ic-pink", title: "图片：打开并查看图片（只读预览；改图请用「画布」）" },
  { key: "canvas", name: "画布", Icon: LayoutGrid, ic: "ic-cyan", title: "无限画布：卡片连线的工作流（电商出图 / 生图 / 短剧 / 3D 建模）" },
  { key: "terminal", name: "终端", Icon: SquareTerminal, ic: "ic-accent", title: "终端：在当前工作目录里跑命令" },
];

/** 右侧审阅面板：内置浏览器、差异视图、文件树与高亮联动。 */
export function AppViewReviewPanel({ app }: { app: HarnessAppApi }) {
  const {
    browserOpenReq,
    diff,
    highlightedFilePath,
    loadTree,
    setHighlightedFilePath,
    setNotice,
    openFile,
    openPanelTab,
    reviewBusy,
    reviewReport,
    rightOpen,
    rightTab,
    setRightTab,
    startReview,
    thread,
    threads,
    toggleTreeDir,
    treeChildren,
    treeExpanded,
    treeLoading,
    treePath,
    workspace,
  } = app;
  /* 10-22 文件卡 → 右栏预览：订阅事件箱里的目标路径；树里点文件也走同一个选中态。 */
  const [workspaceFile, setWorkspaceFile] = useState<string>(() => getRightFile()?.path || "");
  useEffect(() => subscribeRightFile(({ path }) => setWorkspaceFile(path)), []);

  /* 11-26 用户令：「标签页默认一个都不要打开」——
     ⇒ 右栏启动时是**空标签条 + 新标签页**，功能页要用户点了才长出来（浏览器同款）。
     ⛔ 不用「关闭清单」而用「打开清单」：默认空更贴近真实模型，也不会出现
        「六个标签全关掉之后没有任何入口能恢复」的死路。 */
  const [openedTabs, setOpenedTabs] = useState<string[]>([]);
  const bootedRef = useRef(false);
  useEffect(() => {
    /* 首次挂载：右栏一律回到**新标签页**（rightTab 是上次残留的 monitor/review/tree 之类）。
       ⛔ 判据依据：这个面板是**常驻挂载**的（AppView 里无条件渲染，只靠 data-state 开合），
       所以「文件卡 / 命令面板 / 审阅桥点名某页」都发生在挂载**之后** ⇒ 走下面的第二个分支补标签，
       这里不需要"猜"谁刚被点名。11-26 用户令：「默认这个（新标签页）界面就行，不要默认打开监控」。
       ⛔ 别为了"保住刚点名的页"把这里改成保留 rightTab —— 那会让每次启动都直接开上次那一页。 */
    if (!bootedRef.current) {
      bootedRef.current = true;
      if (rightTab && rightTab !== "newtab") setRightTab("newtab");
      return;
    }
    /* 之后：别处（命令面板/文件卡/快捷键）把 rightTab 切到某个功能页时，自动补上它的标签，
       否则会出现「内容变了但标签条上没有这一条」的错位 */
    if (PANEL_TABS.some((tab) => tab.key === rightTab) && !openedTabs.includes(rightTab)) {
      setOpenedTabs((prev) => (prev.includes(rightTab) ? prev : [...prev, rightTab]));
    }
  }, [rightTab]);

  /* 图片页（11-26）：只读查看 —— 记住当前那张图；⛔ 不落盘、不进 bag，重开面板即清空。 */
  const [imagePath, setImagePath] = useState("");
  const pickImage = async () => {
    const picked = await window.codex.chooseImages().catch(() => [] as string[]);
    const first = Array.isArray(picked) ? picked.find((item) => typeof item === "string" && item) : "";
    if (first) setImagePath(first);
  };

  const stripRef = useRef<HTMLDivElement | null>(null);

  /* 画布绿灯（11-26 用户令）：「codex 调用画布工作流就绿灯自动展开」——
     模型调 workflow_read / workflow_writeback 时，画布标签亮一颗绿点，
     让用户一眼知道「Codex 正在按这条工作流跑」以及「看到的卡片是真的在同步」。
     ⛔ 只亮一段时间（canvasLightMs，与事件箱同一口径），不是常驻状态。 */
  const [canvasLiveAt, setCanvasLiveAt] = useState(0);
  useEffect(() => {
    let timer = 0;
    const off = subscribeCanvasActivity(() => {
      setCanvasLiveAt(Date.now());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCanvasLiveAt(0), canvasLightMs());
    });
    return () => { off(); window.clearTimeout(timer); };
  }, []);

  /** 右栏「放大 / 缩小」（11-27 用户两次纠正后定稿）：
   *  放大 = **整个侧边栏覆盖主对话区**（主区那一列压成 0、右栏吃掉整行剩余宽度）；
   *  缩小 = 恢复原来的侧边栏宽度（默认 308，与拖拽同一个 localStorage key）。
   *  ⛔ 不是把面板宽度调大几档 —— 那叫原地打转，用户明确否掉了。
   *  ⛔ 放大态放**共享 store**（`panel-zoom`）：壳的 `--right-w` 由 AppView 读同一个 store 写内联样式，
   *     不再从这里手动给 `.app-shell` 加类 —— className 是 AppView 每帧算的，手加的类会打架。 */
  const panelMax = useSyncExternalStore(subscribePanelMaximized, getPanelMaximized, getPanelMaximized);


  /* 关右栏时退出放大态：否则下次打开直接顶格，用户会以为界面坏了。 */
  useEffect(() => {
    if (!app.rightOpen) setPanelMaximized(false);
  }, [app.rightOpen]);

  const shrinkPanel = () => {
    setPanelMaximized(false);
    const width = defaultPanelWidth();
    app.setPanelWidth(width);
    try { localStorage.setItem("panel-width", String(width)); } catch { /* 隐私模式：宽度仍生效，只是不记 */ }
  };

  /** 从新标签页（或别处）打开一个功能页 */
  const openPanelPage = (key: string) => {
    setOpenedTabs((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setRightTab(key);
  };

  const shutPanelTab = (key: string) => {
    setOpenedTabs((prev) => prev.filter((item) => item !== key));
    if (rightTab !== key) return;
    const rest = openedTabs.filter((item) => item !== key);
    /* 全关光就落回新标签页 —— 右栏不能变成一片空白 */
    setRightTab(rest.length ? rest[rest.length - 1] : "newtab");
  };

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>(".panel-tab.active");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rightTab, openedTabs.length]);
  /* 10-26 用户：「右边加一下，上下可以…展示，下面也可以往上展示」。文件树与预览之间可拖动分栏；
     预览头部「展开/恢复」把预览拉满（文件树收起），Alt+↑ / Alt+↓ 同效。分栏高度按会话记住。 */
  const TREE_H_KEY = "workspace-files-tree-h";
  const [treeHeight, setTreeHeight] = useState<number | null>(() => {
    try { const n = Number(localStorage.getItem(TREE_H_KEY)); return Number.isFinite(n) && n >= 120 ? n : null; } catch { return null; }
  });
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const filesWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (treeHeight == null) return;
    try { localStorage.setItem(TREE_H_KEY, String(Math.round(treeHeight))); } catch { /* 隐私模式 */ }
  }, [treeHeight]);
  useEffect(() => {
    if (rightTab !== "tree") return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "ArrowUp") { event.preventDefault(); setPreviewExpanded(true); }
      else if (event.key === "ArrowDown") { event.preventDefault(); setPreviewExpanded(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rightTab]);
  const startTreeResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const wrap = filesWrapRef.current;
    const tree = wrap?.querySelector<HTMLElement>(".workspace-files-tree");
    if (!wrap || !tree) return;
    const startY = event.clientY;
    const startH = tree.getBoundingClientRect().height;
    const max = Math.max(160, wrap.getBoundingClientRect().height - 180);
    const onMove = (move: PointerEvent) => {
      setTreeHeight(Math.max(120, Math.min(max, startH + (move.clientY - startY))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const resolvedWorkspaceFile = useMemo(() => {
    if (!workspaceFile) return "";
    const looksRelative = !/^[A-Za-z]:[\\/]/.test(workspaceFile) && !workspaceFile.startsWith("/") && !workspaceFile.startsWith("~/");
    if (!looksRelative || !workspace) return workspaceFile;
    const sep = workspace.includes("\\") ? "\\" : "/";
    return `${workspace.replace(/[\\/]+$/, "")}${sep}${workspaceFile.replace(/^[\\/]+/, "")}`;
  }, [workspaceFile, workspace]);
  /* 10-31 右侧抽屉：关闭时**延迟卸载** 220ms（= --dur-panel），让 [data-state="closed"]
     的 translate 退场真的播出来。⛔ 立刻卸载 = 元素没了，CSS 过渡无从触发 ⇒ 关闭仍是闪现。 */
  const [mounted, setMounted] = useState(rightOpen);
  /* 进场要「先以关闭态挂上、下一帧再切 open」：元素插入那一拍若已是最终态，
     CSS 过渡不会触发（实测打开时 translate 恒为 none、只有列宽在动）。
     ⛔ 两次 rAF：单次可能仍在同一个布局批次里，切了也播不动。 */
  const [entered, setEntered] = useState(rightOpen);
  useEffect(() => {
    if (!rightOpen) { setEntered(false); return; }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [rightOpen]);
  useEffect(() => {
    if (rightOpen) { setMounted(true); return; }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timer);
  }, [rightOpen, mounted]);
  if (!mounted) return null;
  return (
    <aside className="context-panel" data-state={rightOpen && entered ? "open" : "closed"}
      /* 放大态（11-27 用户令「放大要覆盖主对话框」）：**不改网格列宽**，而是让面板自己跨到主区那一列 ——
         ⛔ 压列宽会把主区内容挤成一条竖排文字（用户连拍两次），
         ⛔ display:none 主区会让自动排布把面板挤成 21px，
         ⛔ 藏 .workspace 又是 10-25 明令禁止的老坑（父级 hidden 会全白）。
         跨列 + 面板自身不透明背景 = 真的「盖住」，主区在下面原样待着、缩回来立刻恢复。 */
      style={panelMax ? { gridColumn: "2 / -1", gridRow: 2, width: "auto", minWidth: 0, zIndex: 30 } : undefined}>
            <div className="panel-tabstrip">
              <div className="tabstrip-tabs" role="tablist" aria-label="右侧面板" ref={stripRef}>
                {/* 11-26 用户令：右栏做成浏览器式标签条 —— 每个标签带 ×，右侧「+」开新标签页，
                    新标签页正文是四个入口（打开浏览器 / 查看工作空间 / 查看变更 / 打开终端）。
                    ⛔ 关标签只从这条上摘掉，不改 rightTab 之外的任何状态、不销毁页面数据。 */}
                {openedTabs.map((key) => {
                  const tab = PANEL_TABS.find((item) => item.key === key);
                  if (!tab) return null;
                  return (
                    <div
                      key={tab.key}
                      role="tab"
                      aria-selected={rightTab === tab.key}
                      tabIndex={0}
                      className={`panel-tab ${rightTab === tab.key ? "active" : ""} ${tab.key === "canvas" && canvasLiveAt ? "is-live" : ""}`}
                      title={tab.title}
                      onClick={() => setRightTab(tab.key)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setRightTab(tab.key); } }}
                      onAuxClick={(event) => { if (event.button === 1) shutPanelTab(tab.key); }}
                    >
                      <tab.Icon size={12} className={tab.ic} />
                      <span>{tab.name}</span>
                      {/* 绿灯（11-26）：Codex 正在调画布工作流 —— 读取与回填都会点亮，几秒后自己灭。 */}
                      {tab.key === "canvas" && canvasLiveAt ? (
                        <span className="panel-tab-live" title="Codex 正在按画布工作流执行，卡片会实时同步" />
                      ) : null}
                      <button className="tab-close" title={`关闭「${tab.name}」标签（不影响数据）`} onClick={(event) => { event.stopPropagation(); shutPanelTab(tab.key); }}>
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                {rightTab === "newtab" || !openedTabs.length ? (
                  <div className="panel-tab active" role="tab" aria-selected>
                    <LayoutGrid size={12} className="ic-cyan" /><span>新标签页</span>
                  </div>
                ) : null}
              </div>
              {/* 11-26 用户令 + 11-27 两次纠正：
                  · 放大 = 整个侧边栏**覆盖主对话区**（不是把宽度调大几档，那是原地打转）；
                  · 缩小 = 恢复原来的侧边栏宽度；
                  · 形态 = **一颗图标、两段热区**（用户：「不能做成一个图标，两段展示吗」）。
                    ⛔ 不是并排两颗各自成型的按钮 —— 那样看着像两个不相干的功能。
                    一颗「面板 + 中缝 + 左右箭头」的图标，左半＝放大、右半＝缩回，中缝就是分界。 */}
              <div className={`panel-tab-zoom ${panelMax ? "is-max" : ""}`} role="group" aria-label="缩放右侧面板">
                <svg className="panel-tab-zoom-glyph" width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
                  <rect x="2.5" y="1.5" width="25" height="13" rx="3" />
                  <line x1="15" y1="4" x2="15" y2="12" />
                  <path d="M9.5 4.5 L6.5 8 L9.5 11.5" />
                  <path d="M20.5 4.5 L23.5 8 L20.5 11.5" />
                </svg>
                <button type="button" className="panel-tab-zoom-half is-left" title="放大：整个侧边栏覆盖主对话区" aria-label="放大侧边栏（覆盖主对话区）" aria-pressed={panelMax} onClick={() => setPanelMaximized(true)} />
                <button type="button" className="panel-tab-zoom-half is-right" title="缩小：恢复原来的侧边栏宽度" aria-label="缩小侧边栏（恢复原宽）" onClick={shrinkPanel} />
              </div>
              <button className="panel-tab-add" title="新标签页" onClick={() => setRightTab("newtab")}><Plus size={14} /></button>
            </div>
            {/* 新标签页（11-26 用户令）：⛔ 列的是**右栏自己的页**（监控/变更/审阅/浏览器/文件/画布/终端），
                ⛔ 不是照抄参考截图里那四条 —— 那四条是别的应用的入口，照搬过来等于凭空多长一坨。 */}
            {/* ⛔ 11-26 审查：这里只认 `rightTab === "newtab"`。原来还带 `|| !openedTabs.length`
                —— 外部（文件卡 / 命令面板）刚把 rightTab 切到功能页、补标签的 effect 还没跑那一帧，
                新标签页与功能页会**同时显示**，挤成上下各半。标签条那处保留该条件（只是多一颗芯片）。 */}
            <div className={`panel-page ${rightTab === "newtab" ? "" : "hidden"}`}>
              {/* ⛔ 11-26 用户：「按键居中来，做好看一点，靠左不好看」。
                  ⇒ 整块居中 + 两列入口卡（图标带淡色底），⛔ 不是把左对齐的行拉宽 ——
                  原来那种「一行一条细线」在宽栏里左边一坨、右边空一片，最难看。 */}
              <div className="panel-newtab">
                <div className="panel-newtab-inner">
                  <p className="panel-newtab-head">在右侧打开一页</p>
                  <div className="panel-newtab-grid">
                    {PANEL_TABS.map((entry) => (
                      <button key={entry.key} className="panel-newtab-card" title={entry.title} onClick={() => openPanelPage(entry.key)}>
                        <span className={`panel-newtab-ic ${entry.ic}`}><entry.Icon size={15} /></span>
                        <span className="panel-newtab-name">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className={`panel-page ${rightTab === "review" ? "" : "hidden"}`}>
              <ReviewPanel workspace={workspace} lastDiff={diff} disabled={!thread} busy={reviewBusy} report={reviewReport} onReview={startReview} onNotice={setNotice} />
            </div>
            <div className={`panel-page ${rightTab === "turn-review" ? "" : "hidden"}`}>
              <TurnReviewPanel workspace={workspace} active={rightTab === "turn-review"} onOpenFile={(path) => void openFile(path)} />
            </div>
            {/* 10-30 任务监控：本会话每轮的技能/MCP/插件、产物与自我改进建议（⛔ 数据按 threadId 取，换会话即换） */}
            <div className={`panel-page ${rightTab === "monitor" ? "" : "hidden"}`}>
              <TaskMonitorPanel app={app} active={rightTab === "monitor"} />
            </div>
            {/* 无限画布（11-26）：⛔ 只在激活时挂载 —— display:none 下 React Flow 量到 0×0，
                fitView 会把整张画布缩成一个点，切回来只剩一团。 */}
            <div className={`panel-page ${rightTab === "canvas" ? "" : "hidden"}`}>
              {rightTab === "canvas" ? (
                <DramaCanvas
                  variant="inline"
                  onClose={() => setRightTab("monitor")}
                  workspace={workspace}
                  threads={threads}
                />
              ) : null}
            </div>
            {/* 图片页（11-26 用户令）：「加一个标签页打开图片功能，不是在画布 —— 画布是编辑图的」。
                ⛔ 这里只做**只读查看**（打开本地图 / 看尺寸与路径 / 放大），改图去「画布」页；
                ⛔ 不复用画布那份状态 —— 两边各管各的，免得查看一张图就把画布切了。 */}
            <div className={`panel-page ${rightTab === "image" ? "" : "hidden"}`}>
              <div className="panel-image-viewer">
                <div className="panel-image-bar">
                  <button type="button" className="panel-image-pick" onClick={() => void pickImage()}>
                    <Image size={13} />{imagePath ? "换一张图片" : "打开图片"}
                  </button>
                  {imagePath ? <span className="panel-image-name" title={imagePath}>{imagePath.split(/[\/]/).pop()}</span> : null}
                </div>
                {imagePath ? (
                  <WorkspaceFilePreview path={imagePath} onOpenEditor={() => undefined} expanded />
                ) : (
                  <div className="panel-image-empty">
                    <Image size={26} className="ic-pink" />
                    <p>打开一张图片查看（PNG / JPG / WEBP / GIF）</p>
                    <p className="panel-image-hint">要看层叠与编辑，用「画布」页</p>
                  </div>
                )}
              </div>
            </div>
            <div className={`panel-page ${rightTab === "tree" ? "" : "hidden"}`}>
            <div ref={filesWrapRef} className={`workspace-files${previewExpanded ? " is-preview-expanded" : ""}`}>
            <section className="tree-section workspace-files-tree" style={!previewExpanded && treeHeight != null ? { flexBasis: treeHeight, maxHeight: treeHeight } : undefined}>
              <div className="panel-section-heading"><h2>工作区文件</h2><div className="panel-section-actions"><button className="icon-button" title="查看项目变更" onClick={() => openPanelTab("review", "变更")}><GitBranch size={14} /></button><button className="icon-button" title="刷新工作区文件" onClick={() => void refreshWithReceipt(setNotice, "刷新工作区文件", () => loadTree(treePath || workspace))}>{treeLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
              <div className="tree-location" title={treePath || workspace}>{treePath || workspace || "未选择工作区"}</div>
              {treeLoading ? <div className="panel-loading"><Spinner />读取中</div> : (() => {
                const normSep = (s: string) => s.replace(/\\/g, "/").toLowerCase();
                const target = highlightedFilePath ? normSep(highlightedFilePath) : null;
                // ZCode 式递归树：文件夹 ▶ 原地展开/收起子级（惰性加载），文件点击直接打开
                const renderRows = (dir: string, depth: number): ReactNode[] => {
                  const sep = dir.includes("\\") ? "\\" : "/";
                  const base = dir.replace(/[\\/]+$/, "");
                  const entries = treeChildren[dir] ?? [];
                  return entries.flatMap((entry) => {
                    const full = `${base}${sep}${entry.fileName}`;
                    const selected = target != null && (target === normSep(full) || target.endsWith(`/${entry.fileName.toLowerCase()}`));
                    const expanded = treeExpanded.has(full);
                    const row = (
                      <button
                        key={full}
                        data-tree-path={full}
                        className={`tree-entry ${selected ? "tree-entry--selected" : ""}`}
                        style={{ paddingLeft: 6 + depth * 14 }}
                        onClick={() => {
                          if (entry.isDirectory) { toggleTreeDir(full); return; }
                          /* 10-22 Qoder 式联动：单击在**右侧栏**预览，双击才开居中编辑器。 */
                          setHighlightedFilePath(full);
                          setWorkspaceFile(full);
                        }}
                        onDoubleClick={() => { if (!entry.isDirectory) void openFile(full); }}
                        title={entry.isDirectory ? `${expanded ? "收起" : "展开"} ${entry.fileName}` : "点击在右侧预览；双击在编辑器打开"}
                      >
                        {entry.isDirectory
                          ? <ChevronRight size={12} className={`tree-chevron ${expanded ? "open" : ""}`} />
                          : <span className="tree-chevron-spacer" />}
                        <span>{entry.isDirectory ? <FolderOpen size={14} /> : isImagePath(full) ? <Image size={14} /> : <FileCode2 size={14} />}</span>
                        <span>{entry.fileName}</span>
                      </button>
                    );
                    return entry.isDirectory && expanded ? [row, ...renderRows(full, depth + 1)] : [row];
                  });
                };
                const root = treePath || workspace;
                return <div className="tree-list">{renderRows(root, 0)}</div>;
              })()}
            </section>
            {!previewExpanded && (
              <div
                className="workspace-files-splitter"
                role="separator"
                aria-orientation="horizontal"
                title="上下拖动：调整文件树与预览高度；Alt+↑ 预览拉满 / Alt+↓ 恢复"
                onPointerDown={startTreeResize}
              ><span /></div>
            )}
            <WorkspaceFilePreview path={resolvedWorkspaceFile} onOpenEditor={(path) => void openFile(path)} expanded={previewExpanded} onToggleExpanded={() => setPreviewExpanded((value) => !value)} />
            </div>
            </div>
            <div className={`panel-page ${rightTab === "browser" ? "" : "hidden"}`}>
              <BrowserPane variant="panel" onOpenExternal={(url) => void window.codex.openExternal(url)} pendingOpen={browserOpenReq} />
            </div>
            <div className={`panel-page ${rightTab === "terminal" ? "" : "hidden"}`}>
              {rightTab === "terminal" && <TerminalPanel id="panel-terminal" workspace={workspace} active />}
            </div>
          </aside>
  );
}
