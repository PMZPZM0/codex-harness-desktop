/**
 * MainStageGoalsBar —— AppViewMainStage 的 JSX 第 2 段（09-22 从 02-main-stage.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
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
import { FlowDiagram } from "../../../../components/FlowDiagram";
import type { HarnessAppApi } from "../../../app-state/useHarnessApp";

export function MainStageGoalsBar({ app }: { app: HarnessAppApi }) {
  const {
    doneExpanded,
    goalText,
    goalsAutoGone,
    goalsDocked,
    goalsExpanded,
    goalsOpen,
    openAppPrompt,
    planSteps,
    setDoneExpanded,
    setGoalText,
    setGoalsDocked,
    setGoalsExpanded,
    setGoalsOpen,
    setTaskList,
    taskList,
    thread,
  } = app;
  return (
    goalsOpen && !goalsAutoGone && thread && (goalText || planSteps.length > 0 || taskList.length > 0) && (
                  <>
                    <div className={`goals-pop ${goalsDocked ? "docked" : ""}`}>
                      <div className="goals-header-row">
                        <button className="goals-summary" onClick={() => setGoalsExpanded((current) => !current)}>
                          <Target size={14} />
                          <strong>目标与进程</strong>
                          {goalText && <span className="goals-goal-text">{goalText}</span>}
                          <span className="goals-count">{planSteps.filter((s) => s.status === "completed").length}/{planSteps.length}</span>
                          <ChevronDown size={13} className={goalsExpanded ? "open" : ""} />
                        </button>
                        <div className="goals-actions">
                          <button className="secondary-setting goals-set-btn" onClick={() => { void openAppPrompt("设置长期目标", goalText || "", true).then((text) => { if (text != null) { setGoalText(text); if (thread) void window.codex.request("thread/goal/set", { threadId: thread.id, objective: text }); } }); }}><PenLine size={12} />{goalText ? "编辑目标" : "设置目标"}</button>
                          <button className="icon-button" title={goalsDocked ? "展开面板" : "收纳面板"} onClick={() => setGoalsDocked((current) => !current)}>{goalsDocked ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}</button>
                          <button className="icon-button" title="隐藏" onClick={() => setGoalsOpen(false)}><X size={13} /></button>
                        </div>
                      </div>
                      {goalsExpanded && <div className="goals-body">
                        {/* ── 分区一：执行计划（引擎 plan 模式 / 目标模式）── */}
                        <div className="goals-section">
                          <div className="goals-section-title"><Target size={12} />执行计划</div>
                          <div className="goal-line">{goalText || "尚未设置目标"}</div>
                          {planSteps.length > 0 && <FlowDiagram steps={planSteps} />}
                          {planSteps.length > 0 && <div className="plan-steps-body">
                            {planSteps.filter((s) => s.status !== "completed").map((step, index) => <div key={index} className={`plan-step ${step.status === "inProgress" ? "doing" : ""}`}><span className="plan-dot" />{step.step}</div>)}
                            {planSteps.some((s) => s.status === "completed") && (
                              <details className="plan-done" open={doneExpanded} onToggle={(event) => setDoneExpanded(event.currentTarget.open)}>
                                <summary>已完成 {planSteps.filter((s) => s.status === "completed").length} 项<ChevronDown size={12} /></summary>
                                {planSteps.filter((s) => s.status === "completed").map((step, index) => <div key={index} className="plan-step done"><Check size={12} className="plan-check" />{step.step}</div>)}
                              </details>
                            )}
                          </div>}
                          {planSteps.length === 0 && !goalText && <div className="goals-empty">用 /plan 或设置目标后，这里会显示执行计划</div>}
                        </div>
                        {/* ── 分区二：待办事项（agent 通过 task_add / task_update 维护）──
                            ⛔ 与「执行计划」是**两份独立数据**（planSteps 来自引擎 plan 事件，
                            taskList 来自 task_add 工具），语义与状态数都不同，故分区渲染、各自计数，
                            不混在一个列表里（09-15 用户选定 C2）。 */}
                        <div className="goals-section">
                          <div className="goals-section-title">
                            <ListChecks size={12} />待办事项
                            <span className="goals-count">{taskList.filter((t: any) => t.status === "done").length}/{taskList.length}</span>
                          </div>
                          {taskList.length > 0 ? (
                            <ul className="rpa-task-list goals-task-list">
                              {taskList.map((task: any) => (
                                <li key={task.id} className={task.status === "done" ? "done" : ""}>
                                  <label className="auto-switch" title={task.status === "done" ? "标记待办" : "标记完成"}>
                                    <input type="checkbox" checked={task.status === "done"} onChange={() => { const next = task.status === "done" ? "todo" : "done"; void window.codex.updateTask({ id: task.id, patch: { status: next } }).then(() => setTaskList((current: any[]) => current.map((t: any) => (t.id === task.id ? { ...t, status: next } : t)))); }} />
                                  </label>
                                  <span className="rpa-task-text">{task.text}</span>
                                  <button className="icon-button" title="删除" onClick={() => { void window.codex.deleteTask(task.id).then(() => setTaskList((current: any[]) => current.filter((t: any) => t.id !== task.id))); }}><X size={12} /></button>
                                </li>
                              ))}
                            </ul>
                          ) : <div className="goals-empty">让 Codex 安排待办时（task_add），会自动出现在这里</div>}
                        </div>
                      </div>}
                    </div>
                    {/* 收纳后露出的窄标签：点击展开面板 */}
                    <button className={`goals-handle ${goalsDocked ? "visible" : ""}`} title="展开目标面板" onClick={() => setGoalsDocked(false)}>
                      <Target size={14} />
                      <span>目标</span>
                      <span className="goals-handle-count">{planSteps.filter((s) => s.status === "completed").length}/{planSteps.length}</span>
                    </button>
                  </>
                )
  );
}
