/**
 * ComposerComposerCardStack —— MainStageComposer 的 JSX 第 1 段（09-22 从 03-composer.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { createPortal } from "react-dom";
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
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../helpers";
import type { HarnessAppApi } from "../../../../app-state/useHarnessApp";

export function ComposerComposerCardStack({ app }: { app: HarnessAppApi }) {
  const {
    dismissNotice,
    notices,
    openThread,
    runEnvironmentCheck,
  } = app;
  return (
    (() => {
                        if (!notices.length) return null;
                        // 按「来源」分两组各贴各的锚（09-20 用户：设置页产生的弹窗在设置弹窗内居中，
                        // 对话产生的在对话区居中）。settings 组找不到锚（弹窗已关）就落回对话区。
                        const groups: Array<{ scope: "settings" | "chat"; items: typeof notices; selector: string }> = [
                          { scope: "settings", items: notices.filter((n) => n.scope === "settings"), selector: ".settings-modal" },
                          { scope: "chat", items: notices.filter((n) => n.scope !== "settings"), selector: "main.workspace" },
                        ];
                        return groups.map((group) => {
                          if (!group.items.length) return null;
                          const anchor = document.querySelector(group.selector)
                            ?? (group.scope === "settings" ? document.querySelector("main.workspace") : null);
                          if (!anchor) return null;
                          const r = anchor.getBoundingClientRect();
                          return createPortal(
                            <div
                              className="notice-stack"
                              role="status"
                              aria-live="polite"
                              style={{ top: r.top + 12, left: r.left + r.width / 2, maxWidth: Math.min(480, r.width - 24) }}
                            >
                              {group.items.map((entry) => {
                                const tone = noticeTone(entry.text);
                                const NoticeIcon = tone === "success" ? <CircleCheck size={16} /> : tone === "error" ? <X size={16} /> : tone === "warning" ? <AlertTriangle size={16} /> : <Info size={16} />;
                                return (
                                  <div key={entry.id} className={`notice notice-toast notice--${tone}`}>
                                    <span className="notice-icon">{NoticeIcon}</span>
                                    <span className="notice-text">{entry.text}</span>
                                    {/* 多会话并发时「这条是谁的」是刚需：点一下直接跳过去看（跳完即关） */}
                                    {entry.threadId && (
                                      <button
                                        className="notice-jump"
                                        title="跳到该会话"
                                        onClick={() => {
                                          const target = entry.threadId;
                                          dismissNotice(entry.id);
                                          if (target) void openThread(target);
                                        }}
                                      >跳转</button>
                                    )}
                                    {/* 出错时的**一键自查**（09-23）：能力早就在主进程（app:doctor），
                                        但渲染层从来没接 —— 用户侧的表现是"出错了只能复述给我听"。
                                        只在 error 语气上给入口，避免平时噪音。 */}
                                    {tone === "error" && (
                                      <button
                                        className="notice-jump"
                                        title="环境自查（引擎二进制 / 版本 / 工作区 / 依赖）"
                                        onClick={() => { dismissNotice(entry.id); void runEnvironmentCheck(); }}
                                      >自查</button>
                                    )}
                                    <button title="关闭" onClick={() => dismissNotice(entry.id)}><X size={13} /></button>
                                  </div>
                                );
                              })}
                            </div>,
                            document.body,
                            group.scope,
                          );
                        });
                      })()
  );
}
