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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../components/CardShell";
import BrowserPane from "../../../components/BrowserPane";
import { TaskMonitorPanel } from "../../task-monitor/TaskMonitorPanel";
import { TurnReviewPanel } from "../../status";
import { WorkspaceFilePreview } from "./03-workspace-files";
import { getRightFile, subscribeRightFile } from "../../../lib/right-file.mjs";
import { isImagePath } from "../../../lib/is-image-path";
import { refreshWithReceipt } from "../../../lib/refresh-receipt.mjs";
import { CommandExecutionCard, TerminalPanel } from "../../terminal";
import { StorageSection, ReviewPanel } from "../../storage-settings";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

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
  return (
    rightOpen && <aside className="context-panel">
            <div className="panel-tabstrip">
              <div className="tabstrip-tabs">
                {/* 10-07 用户截图后补：与侧栏「项目/分类」同一口径 —— tab 的**前缀图标**按色相上色、文字中性。 */}
                {/* 10-22 用户：「侧边栏终端按键可以删了，替换成审阅图标」——终端标签撤掉（右栏默认 308px 时排不下五个，
                    审阅被挤到横向滚动外），审阅顶到第二位（10-30 起「监控」排第一，审阅变第三）；终端页保留，Ctrl+J / 命令面板仍可打开。 */}
                <button className={`panel-tab ${rightTab === "monitor" ? "active" : ""}`} title="监控：本会话的技能 / MCP / 插件、每轮产物，以及由本会话 Codex 产出的自我改进建议" onClick={() => setRightTab("monitor")}><ActivityIcon size={12} className="ic-violet" /><span>监控</span></button>
                <button className={`panel-tab ${rightTab === "review" ? "active" : ""}`} title="变更：按范围查看 Git 改动（未暂存 / 已暂存 / 分支起点 / 上一轮）" onClick={() => setRightTab("review")}><GitBranch size={12} className="ic-green" /><span>变更</span></button>
                <button className={`panel-tab ${rightTab === "turn-review" ? "active" : ""}`} title="审阅：本轮对话改过的文件与完整对比" onClick={() => setRightTab("turn-review")}><FileText size={12} className="ic-pink" /><span>审阅</span></button>
                <button className={`panel-tab ${rightTab === "browser" ? "active" : ""}`} title="浏览器：在内置浏览器打开网页" onClick={() => setRightTab("browser")}><Globe2 size={12} className="ic-blue" /><span>浏览器</span></button>
                <button className={`panel-tab ${rightTab === "tree" ? "active" : ""}`} title="文件：浏览工作区并预览" onClick={() => setRightTab("tree")}><FolderTree size={12} className="ic-amber" /><span>文件</span></button>
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
              <TaskMonitorPanel app={app} />
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
