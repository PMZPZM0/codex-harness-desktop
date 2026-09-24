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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../components/CardShell";
import BrowserPane from "../../../components/BrowserPane";
import { isImagePath } from "../../../lib/is-image-path";
import { CommandExecutionCard, TerminalPanel } from "../../terminal";
import { StorageSection, ReviewPanel } from "../../storage-settings";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewReviewPanel({ app }: { app: HarnessAppApi }) {
  const {
    browserOpenReq,
    diff,
    highlightedFilePath,
    loadTree,
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
  return (
    rightOpen && <aside className="context-panel">
            <div className="panel-tabstrip">
              <div className="tabstrip-tabs">
                <button className={`panel-tab ${rightTab === "review" ? "active" : ""}`} title="变更" onClick={() => setRightTab("review")}><GitBranch size={12} /><span>变更</span></button>
                <button className={`panel-tab ${rightTab === "terminal" ? "active" : ""}`} title="终端" onClick={() => setRightTab("terminal")}><TerminalSquare size={12} /><span>终端</span></button>
                <button className={`panel-tab ${rightTab === "browser" ? "active" : ""}`} title="浏览器" onClick={() => setRightTab("browser")}><Globe2 size={12} /><span>浏览器</span></button>
                <button className={`panel-tab ${rightTab === "tree" ? "active" : ""}`} title="项目树" onClick={() => setRightTab("tree")}><FolderTree size={12} /><span>项目树</span></button>
              </div>
            </div>
            <div className={`panel-page ${rightTab === "review" ? "" : "hidden"}`}>
              <ReviewPanel workspace={workspace} lastDiff={diff} disabled={!thread} busy={reviewBusy} report={reviewReport} onReview={startReview} />
            </div>
            <div className={`panel-page ${rightTab === "tree" ? "" : "hidden"}`}>
            <section className="tree-section">
              <div className="panel-section-heading"><h2>项目树</h2><div className="panel-section-actions"><button className="icon-button" title="查看项目变更" onClick={() => openPanelTab("review", "变更")}><GitBranch size={14} /></button><button className="icon-button" title="刷新项目树" onClick={() => void loadTree(treePath || workspace)}>{treeLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
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
                        onClick={() => entry.isDirectory ? toggleTreeDir(full) : void openFile(full)}
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
