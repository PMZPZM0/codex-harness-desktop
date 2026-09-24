/**
 * AppViewFilePreviewEditor —— AppView 的 JSX 第 9 段（09-22 从 AppView.tsx 分出，纯搬迁）。
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
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "../../../components/CardShell";
import { basename } from "../../../lib/basename";
import { imageUrl } from "../../../lib/image-url";
import { Markdown, MdCode, MdBlock, FilePreviewCode } from "../../markdown";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../helpers";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewFilePreviewEditor({ app }: { app: HarnessAppApi }) {
  const {
    closeTab,
    fileDraft,
    fileEditing,
    filePreview,
    fileTabs,
    fileTruncated,
    openInBrowserPane,
    rawOpenFile,
    saveFilePreview,
    savingFile,
    setFileDraft,
    setFileEditing,
    setFilePreview,
    setNotice,
    workspace,
  } = app;
  return (
    filePreview && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilePreview(null); }}>
            <div className={`file-preview ${filePreview.kind === "image" ? "image-preview" : "text-preview"}`} role="dialog" aria-label="文件预览">
              {fileTabs.length > 0 && (
                <div className="file-preview-tabs">
                  {fileTabs.map((tabPath) => (
                    <div key={tabPath} className={`file-preview-tab ${tabPath === filePreview.path ? "active" : ""}`}>
                      <button className="file-preview-tab-name" title={tabPath} onClick={() => void rawOpenFile(tabPath)}>{basename(tabPath)}</button>
                      <button className="file-preview-tab-close" title="关闭标签" onClick={(event) => { event.stopPropagation(); closeTab(tabPath); }}><X size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
              <header>
                <div>{filePreview.kind === "image" ? <Image size={17} /> : filePreview.kind === "binary" ? <FileWarning size={17} /> : filePreview.kind === "pdf" ? <FileText size={17} /> : <FileCode2 size={17} />}<strong>{basename(filePreview.path)}</strong></div>
                <div className="file-preview-actions">
                  {filePreview.kind === "text" && /\.(html?|htm)$/i.test(filePreview.path) && <>
                    <button className="secondary-setting" title="在内置浏览器中打开这个网页" onClick={() => openInBrowserPane(toFileUrl(filePreview.path))}><Globe2 size={14} />浏览器打开</button>
                    <button className="secondary-setting" title="在独立大窗口预览（可自由调整大小）" onClick={() => void window.codex.browserPopout(toFileUrl(filePreview.path)).catch((error: any) => setNotice(`放大预览失败：${error?.message ?? ""}`))}><Maximize2 size={14} />放大预览</button>
                  </>}
                  {!fileEditing && filePreview.kind === "text" && !fileTruncated && workspace && <button className="secondary-setting" onClick={() => { setFileDraft(filePreview.content); setFileEditing(true); }}><PenLine size={14} />编辑</button>}
                  {fileEditing && <><button className="secondary-setting" onClick={() => setFileEditing(false)}>取消</button><button className="primary-setting" disabled={savingFile || fileDraft === filePreview.content} onClick={() => void saveFilePreview()}>{savingFile ? <Spinner /> : <Check size={14} />}保存</button></>}
                  <button className="icon-button relay-modal-close" title="关闭" onClick={() => setFilePreview(null)}><X size={17} /></button>
                </div>
              </header>
              <div className="file-preview-meta">{filePreview.path} · {filePreview.kind === "image" ? `${filePreview.language.toUpperCase()} 图片` : filePreview.kind === "binary" ? "二进制文件" : filePreview.kind === "pdf" ? "PDF 文档" : filePreview.language}{fileTruncated ? " · 文件过大，仅只读预览" : ""}</div>
              {filePreview.kind === "image"
                ? <div className="file-preview-image" title="点击图片外空白处关闭" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilePreview(null); }}><img src={imageUrl(filePreview.path)} alt={basename(filePreview.path)} /></div>
                : filePreview.kind === "pdf"
                  ? <iframe className="file-preview-pdf" src={imageUrl(filePreview.path)} title={basename(filePreview.path)} />
                  : filePreview.kind === "binary"
                    ? <div className="file-preview-binary">
                        <FileWarning size={34} />
                        <strong>二进制文件（.{filePreview.language}），不支持文本预览</strong>
                        <p>文本方式打开只会显示乱码。请用对应的本机程序（如 Excel / Word / 压缩软件）打开，或在对话中让引擎解析文件内容。</p>
                      </div>
                    : fileEditing
                      ? <textarea className="file-preview-editor" value={fileDraft} spellCheck={false} onChange={(event) => setFileDraft(event.target.value)} />
                      : <FilePreviewCode language={filePreview.language} content={filePreview.content} truncated={fileTruncated} />}
            </div>
          </div>
  );
}
