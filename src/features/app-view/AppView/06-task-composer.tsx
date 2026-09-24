/**
 * AppViewTaskComposer —— AppView 的 JSX 第 6 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../lib/effort";
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
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../lib/user-refs";
import { effortLabels } from "../../../lib/effort-labels";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../helpers";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewTaskComposer({ app }: { app: HarnessAppApi }) {
  const {
    allModels,
    autoFormVisible,
    saveSchedule,
    scheduleDraft,
    scheduleStatus,
    setAutoFormVisible,
    setScheduleDraft,
    threads,
    workspace,
  } = app;
  return (
    autoFormVisible && <div className="modal-backdrop schedule-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAutoFormVisible(false); }}><div className="schedule-modal" role="dialog" aria-modal="true" aria-label="定时任务">
                    <div className="se-head">
                      <strong><Clock3 size={14} />新建定时任务</strong>
                      <button type="button" className="icon-button" title="收起" onClick={() => setAutoFormVisible(false)}><X size={14} /></button>
                    </div>
                    <div className="se-body">
                      <div className="se-row">
                        <label className="se-field"><span>任务名称<i>*</i></span><input value={scheduleDraft.name} onChange={(event) => setScheduleDraft({ ...scheduleDraft, name: event.target.value })} placeholder="例如：每周五生成项目周报" /></label>
                        <label className="se-field"><span>工作区<i>*</i></span>
                          <span className="se-input-btn">
                            <input value={scheduleDraft.workspace} onChange={(event) => setScheduleDraft({ ...scheduleDraft, workspace: event.target.value })} placeholder="任务执行时使用的工作目录" />
                            <button type="button" onClick={() => void window.codex.chooseDirectoryAt(scheduleDraft.workspace || workspace || "").then((dir: string | null) => { if (dir) setScheduleDraft((current) => ({ ...current, workspace: dir })); })}>浏览…</button>
                          </span>
                        </label>
                      </div>
                      <label className="se-field"><span>执行提示词<i>*</i></span><textarea rows={3} value={scheduleDraft.prompt} onChange={(event) => setScheduleDraft({ ...scheduleDraft, prompt: event.target.value })} placeholder="描述这个任务每次运行时要做的事，例如：汇总本周 Git 提交与 CI 状态，生成周会话摘要并列出重要变更" /></label>
                      <div className="se-row">
                        <label className="se-field"><span>执行会话</span>
                          <select value={scheduleDraft.threadId} onChange={(event) => setScheduleDraft({ ...scheduleDraft, threadId: event.target.value })}>
                            <option value="">新建会话</option>
                            {threads.filter((entry) => entry.cwd === scheduleDraft.workspace).map((entry) => <option key={entry.id} value={entry.id}>{cleanThreadDisplayTitle(entry.name, { preview: entry.preview })}</option>)}
                          </select>
                        </label>
                        <label className="se-field"><span>执行模型</span>
                          <select value={scheduleDraft.model} onChange={(event) => setScheduleDraft({ ...scheduleDraft, model: event.target.value })}>
                            <option value="">跟随全局设置</option>
                            {allModels.map((m) => <option key={m.id} value={m.model}>{m.displayName}</option>)}
                          </select>
                        </label>
                        <label className="se-field"><span>推理强度</span>
                          <select value={scheduleDraft.effort} onChange={(event) => setScheduleDraft({ ...scheduleDraft, effort: event.target.value })}>
                            {ALL_EFFORTS.map((level) => <option key={level} value={level}>{effortLabels[level] ?? level}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="se-field"><span>调度方式</span>
                        <div className="schedule-kind" role="group" aria-label="调度方式">
                          <button type="button" className={scheduleDraft.kind === "interval" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "interval" })}>间隔</button>
                          <button type="button" className={scheduleDraft.kind === "daily" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "daily" })}>每天</button>
                          <button type="button" className={scheduleDraft.kind === "weekly" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "weekly" })}>每周</button>
                          <button type="button" className={scheduleDraft.kind === "monthly" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "monthly" })}>每月</button>
                          <button type="button" className={scheduleDraft.kind === "yearly" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "yearly" })}>每年</button>
                          <button type="button" className={scheduleDraft.kind === "once" ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, kind: "once" })}>一次性</button>
                        </div>
                      </div>
                      <div className="se-schedule-detail">
                        {scheduleDraft.kind === "interval" && <label className="se-field se-cond"><span>重复间隔</span><span className="se-input-unit"><input type="number" min="1" value={scheduleDraft.intervalMinutes} onChange={(event) => setScheduleDraft({ ...scheduleDraft, intervalMinutes: event.target.value })} /><em>小时</em></span></label>}
                        {(scheduleDraft.kind === "daily" || scheduleDraft.kind === "weekly" || scheduleDraft.kind === "monthly" || scheduleDraft.kind === "yearly") && <label className="se-field se-cond"><span>执行时间</span><input type="time" value={scheduleDraft.timeOfDay} onChange={(event) => setScheduleDraft({ ...scheduleDraft, timeOfDay: event.target.value })} /></label>}
                        {scheduleDraft.kind === "once" && <label className="se-field se-cond"><span>运行时间</span><input type="datetime-local" value={scheduleDraft.scheduledAt} onChange={(event) => setScheduleDraft({ ...scheduleDraft, scheduledAt: event.target.value })} /></label>}
                        {scheduleDraft.kind === "weekly" && <div className="se-field se-cond"><span>重复星期</span>
                          <span className="se-weekrow">
                            <span className="schedule-weekdays" role="group" aria-label="重复星期">
                              {["日", "一", "二", "三", "四", "五", "六"].map((label, day) => (
                                <button type="button" key={day} className={scheduleDraft.weekdays.includes(day) ? "active" : ""} onClick={() => setScheduleDraft({ ...scheduleDraft, weekdays: scheduleDraft.weekdays.includes(day) ? scheduleDraft.weekdays.filter((entry) => entry !== day) : [...scheduleDraft.weekdays, day].sort() })}>{label}</button>
                              ))}
                            </span>
                            <label className="se-check"><input type="checkbox" checked={scheduleDraft.biweekly} onChange={(event) => setScheduleDraft({ ...scheduleDraft, biweekly: event.target.checked })} />每两周</label>
                          </span>
                        </div>}
                        {scheduleDraft.kind === "monthly" && <label className="se-field se-cond"><span>每月第几天</span><span className="se-input-unit"><input type="number" min="1" max="31" value={scheduleDraft.monthDay} onChange={(event) => setScheduleDraft({ ...scheduleDraft, monthDay: event.target.value })} /><em>日</em></span></label>}
                        {scheduleDraft.kind === "yearly" && <label className="se-field se-cond"><span>每年</span><span className="se-input-unit"><input type="number" min="1" max="12" value={scheduleDraft.month} onChange={(event) => setScheduleDraft({ ...scheduleDraft, month: event.target.value })} /><em>月</em><input type="number" min="1" max="31" value={scheduleDraft.monthDay} onChange={(event) => setScheduleDraft({ ...scheduleDraft, monthDay: event.target.value })} /><em>日</em></span></label>}
                        <label className="se-field se-cond"><span>有效期至（可选）</span><input type="datetime-local" value={scheduleDraft.validUntil} onChange={(event) => setScheduleDraft({ ...scheduleDraft, validUntil: event.target.value })} /></label>
                      </div>
                      {scheduleDraft.name.trim() !== "" && <div className="se-preview"><Clock3 size={13} /><span>计划：{describeSchedule({ kind: scheduleDraft.kind, timeOfDay: scheduleDraft.timeOfDay, weekdays: scheduleDraft.weekdays, intervalMinutes: Number(scheduleDraft.intervalMinutes) || 60, scheduleType: scheduleDraft.kind === "once" ? "once" : "recurring", scheduledAt: scheduleDraft.scheduledAt, monthDay: Number(scheduleDraft.monthDay) || 1, month: Number(scheduleDraft.month) || 1 })}{scheduleDraft.kind === "weekly" && scheduleDraft.biweekly ? "（每两周）" : ""}{scheduleDraft.validUntil ? ` · 至 ${scheduleDraft.validUntil.replace("T", " ").slice(5, 16)}` : ""}</span></div>}
                    </div>
                    <footer className="se-foot">
                      <span className="se-status">{scheduleStatus}</span>
                      <div>
                        <button type="button" className="secondary-setting" onClick={() => setAutoFormVisible(false)}>取消</button>
                        <button type="button" className="primary-setting" disabled={!scheduleDraft.name.trim() || !scheduleDraft.prompt.trim() || !scheduleDraft.workspace.trim()} onClick={() => void saveSchedule().then((ok) => { if (ok) setAutoFormVisible(false); })}><Check size={14} />添加任务</button>
                      </div>
                    </footer>
                  </div></div>
  );
}
