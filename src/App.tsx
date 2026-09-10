import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@xterm/xterm/css/xterm.css";
import ReactMarkdown, { type Components } from "react-markdown";
import { markdownUrlTransform } from "./lib/markdown-url";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { codeFontStack, codeFonts, codePreviewSnippet, codeThemeStyle, codeThemes } from "./lib/code-themes";
import { codeFontSize, useCodeSettings } from "./lib/code-settings";
import { DEFAULT_EFFORT, pickDefaultEffort, CUSTOM_MODEL_EFFORTS, normalizeEffort, ALL_EFFORTS } from "./lib/effort";
import { matchModelSpec, loadExternalSpecs } from "./lib/model-specs";
import { isRateLimitError, rateLimitBackoffMs, RATE_LIMIT_MAX_ATTEMPTS } from "./lib/rate-limit-retry";
import { resolveSkillVisual, type SkillVisual } from "./lib/skill-icon";
import { translateEngineNotice } from "./lib/engine-notices-zh";
import { resolveRelayAutoTarget, resolveRelayTarget, resolveRelayKeyTarget, writeRelayActive, readRelayActive, type RelayActive } from "./lib/relay";
import { avatarToneOf, AVATAR_GRADIENTS, registerThreadTeam, unregisterThreadTeam, resolveTeamMember } from "./lib/entity-avatar";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "./lib/prompt-images";
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
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Quote,
  Paperclip,
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
} from "lucide-react";
import { useMemory, type MemoryGatewayState, type MemoryGroup, type MemoryPriority, type MemoryRecord, groupMemoriesByThread } from "./hooks/useMemory";
import UsagePanel from "./components/UsagePanel";
import { BatchActions, CheckCard, SearchField, SegmentedTabs, SelectAllToggle, ToggleSwitch } from "./components/SettingsWidgets";
import { CardStatusIcon, Spinner, useCardOpen, type ActionStatus } from "./components/CardShell";

const PPTokenEndpoints = [
  { id: "pptoken", name: "PPtoken", label: "API 端点默认", url: "https://api.pptoken.cc/v1" },
  { id: "pptoken-cn", name: "PPtoken 大陆线路", label: "OpenAI 模型 · 大陆优化线路", url: "https://cn.pptoken.cc/v1" },
  { id: "pptoken-us", name: "PPtoken 北美线路", label: "北美线路 · 需要代理", url: "https://us.pptoken.cc/v1" },
  { id: "pptoken-claude", name: "PPtoken Claude", label: "Claude 模型 · 专用地址", url: "https://api.pptoken.cc" },
];

function LoginScreen({ onSkip, onLogin }: { onSkip: () => void; onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean> }) {
  const [mode, setMode] = useState<"custom" | "pptoken" | "relay" | "openai">("pptoken");
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [apiBase, setApiBase] = useState("https://api.pptoken.cc/v1");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(0);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const endpointRef = useRef<HTMLDivElement>(null);
  const apiBaseRef = useRef<HTMLInputElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // 中转站账户登录（sub2api 兼容）
  const [relayDraft, setRelayDraft] = useState({ baseUrl: "https://api.pptoken.cc", email: "", password: "" });
  // OpenAI 官方订阅登录（设备码流程）
  const [openaiDevice, setOpenaiDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [openaiProxy, setOpenaiProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const openaiTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current); }, []);

  useEffect(() => {
    if (!endpointOpen) return;
    const onDown = (event: MouseEvent) => { if (!endpointRef.current?.contains(event.target as Node)) setEndpointOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setEndpointOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [endpointOpen]);

  const doLogin = async (provider: string, name: string, baseUrl: string, key: string) => {
    setBusy(true); setStatus("");
    try {
      const ok = await onLogin({ provider, name, baseUrl, apiKey: key, model: "", username: username.trim() || undefined });
      if (ok) return;
      setStatus("探测未返回可用模型，请检查密钥与地址");
    } catch (error: any) { setStatus("登录失败：" + error.message); }
    finally { setBusy(false); }
  };

  // 中转站账户登录：登录 → 自动选计费方式（有套餐用套餐，否则余额）→ 生成供应商进主界面
  const relayLogin = async () => {
    setBusy(true); setStatus("");
    try {
      await window.codex.relayLogin({ baseUrl: relayDraft.baseUrl.trim(), email: relayDraft.email.trim(), password: relayDraft.password });
      let target = await resolveRelayAutoTarget();
      let ok = await onLogin({ provider: target.resolved.provider, name: target.resolved.displayName, baseUrl: target.resolved.gateway, apiKey: target.resolved.apiKey, model: "", username: username.trim() || undefined });
      // 部分站点强制 key 必须绑分组（无分组 key 网关 403）：改绑第一个订阅分组重试
      if (!ok && target.mode === "balance") {
        const ov = await window.codex.relayOverview().catch(() => null);
        const subs: any[] = ov?.subscriptions ?? [];
        if (subs.length) {
          const s0 = subs[0];
          const group = { group_id: Number(s0.group_id), group_name: String(s0.group_name ?? "套餐") };
          target = { mode: "plan", group, resolved: await resolveRelayTarget("plan", group) };
          ok = await onLogin({ provider: target.resolved.provider, name: target.resolved.displayName, baseUrl: target.resolved.gateway, apiKey: target.resolved.apiKey, model: "", username: username.trim() || undefined });
        }
      }
      // 只有供应商真正生成并生效后才落「已生效」标记，避免失败残留锁死按钮/徽标
      if (ok) writeRelayActive(target.resolved.active);
      else setStatus("供应商生成失败：网关探测不到可用模型，请稍后在 设置 → 中转站 重试");
    } catch (error: any) { setStatus("中转站登录失败：" + (error.message ?? error)); }
    finally { setBusy(false); }
  };

  // OpenAI 官方订阅：设备码登录 → 收进账号库 → 写 auth.json + 重启引擎 → 自动配置进主界面
  const openaiLogin = async () => {
    setBusy(true); setStatus("");
    try {
      const proxyValue = openaiProxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      void window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      let opened = false;
      const openAuth = (url: string) => {
        if (opened || !url) return;
        opened = true;
        void window.codex.openExternal(url).catch((e: any) => setStatus("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
      };
      const first = await window.codex.openaiLoginStatus();
      setOpenaiDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setStatus("登录失败：" + first.error + "。OpenAI 有区域限制——请确认代理已开启，或填好代理地址后重试。");
      openAuth(first.url);
      const startedAt = Date.now();
      if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
      openaiTimerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setOpenaiDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuth(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          setStatus("登录失败：" + s.error + "。OpenAI 有区域限制——请确认代理已开启，或填好代理地址后重试。");
          setBusy(false);
        }
        if (s.loggedIn) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          setOpenaiDevice(null);
          const saved = await window.codex.openaiCaptureLogin();
          await window.codex.openaiAccountSwitch(saved.id);
          const ok = await onLogin({ provider: "openai-official", name: "OpenAI 官方订阅", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "", model: "", username: username.trim() || undefined });
          if (!ok) setStatus("订阅启用失败，请稍后在 设置 → 模型 重试");
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (openaiTimerRef.current) window.clearInterval(openaiTimerRef.current);
          openaiTimerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (error: any) { setStatus("OpenAI 登录失败：" + (error.message ?? error)); }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand"><div className="brand-mark login-logo"><b className="brand-ch">CH</b></div><div><strong>Codex Harness</strong><span>Desktop</span></div></div>
        <h1>欢迎使用 Codex Harness</h1>
        <p className="login-sub">配置 API 即可开始；暂不登录可直接体验主界面</p>

        <div className="login-options">
          <button type="button" className={`login-option ${mode === "pptoken" ? "active" : ""}`} onClick={() => { setMode("pptoken"); setEndpointOpen(false); queueMicrotask(() => apiKeyRef.current?.focus()); }}>
            <Rocket size={16} /><span className="login-option-title">PPtoken 推荐</span><small>中转线路 · 粘贴 Key 即用</small>
          </button>
          <button type="button" className={`login-option ${mode === "openai" ? "active" : ""}`} onClick={() => { setMode("openai"); setEndpointOpen(false); }}>
            <CircleGauge size={16} /><span className="login-option-title">OpenAI 官方订阅</span><small>ChatGPT 账号设备码登录</small>
          </button>
          <button type="button" className={`login-option ${mode === "relay" ? "active" : ""}`} onClick={() => { setMode("relay"); setEndpointOpen(false); }}>
            <Wallet size={16} /><span className="login-option-title">中转站账户</span><small>sub2api 网关 · 余额/套餐</small>
          </button>
          <button type="button" className={`login-option ${mode === "custom" ? "active" : ""}`} onClick={() => { setMode("custom"); setEndpointOpen(false); queueMicrotask(() => { apiBaseRef.current?.focus(); apiBaseRef.current?.select(); }); }}>
            <Settings2 size={16} /><span className="login-option-title">自定义 API</span><small>任意 OpenAI 兼容端点</small>
          </button>
        </div>

        {mode === "openai" ? (
          <div className="login-fields">
            <p className="relay-login-hint">点击下方按钮后浏览器会打开 OpenAI 授权页，输入验证码即可；登录成功自动启用 Codex 订阅并进入主界面。OpenAI 有区域限制，需要可访问 OpenAI 的网络（代理）。</p>
            <label className="se-field"><span>用户名（选填）</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="怎么称呼你？登录后显示在界面左上角" />
            </label>
            <label className="se-field"><span>代理地址（可选）</span>
              <input value={openaiProxy} onChange={(e) => setOpenaiProxy(e.target.value)} placeholder="http://127.0.0.1:7890" />
            </label>
        {openaiDevice && (
              <div className="official-device openai-device-panel">
                {openaiDevice.url && <>浏览器已打开授权页，输入验证码：<b>{openaiDevice.code || "见下方引擎输出"}</b></>}
                {!openaiDevice.url && "正在向 OpenAI 申请设备验证码…"}
                {openaiDevice.raw && <pre className="official-usage">{openaiDevice.raw}</pre>}
              </div>
            )}
          </div>
        ) : mode === "relay" ? (
          <div className="login-fields relay-login-fields">
            <label className="se-field"><span>中转站地址（sub2api 网关）</span>
              <input value={relayDraft.baseUrl} onChange={(e) => setRelayDraft({ ...relayDraft, baseUrl: e.target.value })} placeholder="https://api.pptoken.cc" />
            </label>
            <label className="se-field"><span>邮箱</span>
              <input value={relayDraft.email} onChange={(e) => setRelayDraft({ ...relayDraft, email: e.target.value })} placeholder="你在中转站的账号邮箱" />
            </label>
            <label className="se-field"><span>密码</span>
              <input type="password" value={relayDraft.password} onChange={(e) => setRelayDraft({ ...relayDraft, password: e.target.value })} placeholder="中转站账号密码" onKeyDown={(e) => { if (e.key === "Enter" && relayDraft.email && relayDraft.password && !busy) void relayLogin(); }} />
            </label>
            <p className="relay-login-hint">登录后自动同步余额与订阅套餐，优先使用生效中的套餐（无套餐走余额），并生成好供应商直接开聊；后续可在 设置 → 中转站 切换计费方式。</p>
          </div>
        ) : (
        <div className="login-fields">
          <label className="se-field"><span>用户名（选填）</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="怎么称呼你？登录后显示在界面左上角" />
          </label>

          {mode === "pptoken" ? (
            <label className="se-field"><span>API 端点</span>
              <div className={`login-endpoint-select ${endpointOpen ? "open" : ""}`} ref={endpointRef}>
                <button type="button" className="login-endpoint-trigger" onClick={() => setEndpointOpen((open) => !open)} aria-expanded={endpointOpen}>
                  <span><b>{PPTokenEndpoints[endpoint].label}</b><small>{PPTokenEndpoints[endpoint].url}</small></span><ChevronDown size={15} />
                </button>
                {endpointOpen && <div className="login-endpoint-menu" role="listbox">{PPTokenEndpoints.map((option, index) => <button type="button" role="option" aria-selected={index === endpoint} className={index === endpoint ? "active" : ""} key={option.id} onClick={() => { setEndpoint(index); setApiBase(option.url); setEndpointOpen(false); }}><span><b>{option.label}</b><small>{option.url}</small></span>{index === endpoint && <Check size={14} />}</button>)}</div>}
              </div>
            </label>
          ) : (
            <label className="se-field"><span>API 地址</span>
              <input ref={apiBaseRef} autoFocus value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" />
            </label>
          )}

          <label className="se-field"><span>API 密钥</span>
            <div className="pw-wrap"><input ref={apiKeyRef} type={showPw ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." /><button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>{showPw ? "隐藏" : "显示"}</button></div>
          </label>
        </div>
        )}

        {status && <div className="login-status">{status}</div>}

        {mode === "openai" ? (
          <button className="primary-setting login-btn" disabled={busy} onClick={() => void openaiLogin()}>
            {busy ? <><Spinner />等待浏览器登录…</> : <><CircleGauge size={15} />登录并启用订阅</>}
          </button>
        ) : mode === "relay" ? (
          <button className="primary-setting login-btn" disabled={!relayDraft.baseUrl.trim() || !relayDraft.email.trim() || !relayDraft.password.trim() || busy} onClick={() => void relayLogin()}>
            {busy ? <><Spinner />正在登录中转站…</> : <><Wallet size={15} />登录并自动配置</>}
          </button>
        ) : (
        <button className="primary-setting login-btn" disabled={!apiBase.trim() || !apiKey.trim() || busy} onClick={() => { const selected = PPTokenEndpoints[endpoint]; void doLogin(mode === "pptoken" ? selected.id : `custom-login-${Date.now()}`, mode === "pptoken" ? selected.name : "自定义 API", apiBase.trim().replace(/\/$/, ""), apiKey.trim()); }}>
          {busy ? <><Spinner />正在探测模型…</> : <><KeyRound size={15} />探测并登录</>}
        </button>
        )}
        <button className="ghost login-skip" onClick={onSkip}><WifiOff size={14} />暂时不登录，直接进入</button>
        <a className="login-sponsor-link" href="https://api.pptoken.cc/register?aff=X82JSNVC3W3S" onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>
          <Rocket size={12} />没有 API Key？注册 PPtoken 领取体验额度<ExternalLink size={11} />
        </a>
        <div className="login-foot">探测成功后会自动导入模型并完成配置</div>
      </div>
    </div>
  );
}
import { CodeAppearanceSection } from "./components/CodeAppearance";
import { UserCenterSection } from "./components/UserCenter";
import { BuiltinPluginsSection } from "./components/BuiltinPlugins";
import { CODEX_MARKET_ZH, zhCategory } from "./lib/codex-market-zh";
import { SKILLHUB_MCP_CATALOG, SKILLHUB_MCP_CATEGORIES, skillhubMcpDetailUrl, type SkillHubMcpEntry } from "./lib/skillhub-mcp";
import { PersonalizationPage } from "./components/PersonalizationPage";
import { GlobalSearchView } from "./components/IndexLibrary";
import BrowserPane from "./components/BrowserPane";
import type { SearchPreviewTarget } from "./components/IndexLibrary";
import ArchivePage from "./components/ArchivePage";
import { jumpToBottom } from "./components/scroll-utils";
import { FlowDiagram } from "./components/FlowDiagram";
import { MermaidDiagram } from "./components/MermaidDiagram";
import { currentStreak, dayKey, formatTokens, lastDays, readUsageStats, recordTurnUsage, resetUsageStats, totalTokens } from "./lib/usage-stats";
import { useScheduler, emptyScheduleDraft } from "./hooks/useScheduler";
import { useChannelBot, type ChannelDraft } from "./hooks/useChannelBot";
import { useModelProviders } from "./hooks/useModelProviders";
import { useFilePreview } from "./hooks/useFilePreview";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "./lib/turn-fold";
import { WidgetCard } from "./components/GenerativeWidget";
import { hasWidgetFence, extractStreamingWidget, type ShowWidgetData } from "./lib/generative-widget";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "./lib/user-refs";
import { installFocusReturn } from "./lib/focus-return";
import {
  ponytailSubSkills, planAction, applyAction, isEmptyAction, describePartial, guardOffOwner,
  findCapabilitySkill, syncedSnapshot, samePluginId,
  PONYTAIL_PLUGIN_ID, NUPHUS_MCP_ID, DESKTOP_SKILL_ID, BROWSER_SKILL_ID, GROUP_LABELS,
  type CapabilityGroupId, type SubToggleSnapshot, type GroupIpc, type MemberKey,
} from "./lib/capability-groups";


type Model = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
  supportsPersonality: boolean;
  isDefault: boolean;
  /** 多供应商支持：该模型所属供应商 id / 名称 / 是否当前生效 */
  provider?: string;
  providerName?: string;
  isActive?: boolean;
  /** 模型输入模态（含 image/video 时下拉显示「视觉」） */
  inputTypes?: ("text" | "image" | "video")[];
};
type ThreadItem = { id: string; type: string; [key: string]: any };
type Turn = { id: string; status: string; items: ThreadItem[]; error?: { message?: string } | null; durationMs?: number | null; startedAt?: number | null; completedAt?: number | null; usage?: any };
type Thread = { id: string; preview: string; name?: string | null; cwd: string; updatedAt: number; status: any; turns: Turn[] };
type PendingRequest = { id: string | number; method: string; params: any };
type SystemEvent = { id: string; title: string; text: string; tone?: "info" | "warning" | "error" | "success"; hookKey?: string; at?: number };
// —— 导入会话记录的待发送存储：threadId -> 外部 .md 对话记录 ——
// 与 expert-pending-roles 同一思路：导入后立刻新建命名空会话并跳转到对话框，记录不立即发送，
// 等用户发出该会话第一条消息时才随消息附上（界面折叠成「导入的会话记录」可展开卡）。
// localStorage 持久化保证空会话闲置到应用重启后仍能识别。
const PENDING_IMPORT_STORE_KEY = "import-pending-conversations";
function readPendingImportStore(): Record<string, PendingImportPayload> {
  try { return JSON.parse(localStorage.getItem(PENDING_IMPORT_STORE_KEY) || "{}") as Record<string, PendingImportPayload>; }
  catch { return {}; }
}
function fmtImportTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}
/** 导入记录卡上的备注行（发送包装与未发送预览共用同一文案，保证前后一致） */
function fmtImportNote(p: PendingImportPayload): string {
  return `来源文件：${p.fileName} ｜ 原会话：${p.title || "未命名"} ｜ ${p.turns ? `${p.turns} 条消息` : "消息轮次未知"} ｜ 导入于 ${fmtImportTime(p.at)}`;
}
type QueueItem = { id: string; input: any[]; clientUserMessageId: string };
type useRefObject = { current: HTMLElement | null };
type TreeEntry = { fileName: string; isDirectory: boolean; isFile: boolean };
type SkillInstallState = { skill: MarketSkillEntry; current: number; failed?: string; engineRegistered?: boolean; engineCheckMessage?: string };
/** 卸载技能进度（与安装对称）：folder=目录名、name=展示名；engineRemoved=引擎是否已确认移除。 */
type SkillRemoveState = { folder: string; name: string; description: string; current: number; failed?: string; engineRemoved?: boolean; engineCheckMessage?: string };
type PluginInstallState = { plugin: PluginMarketEntry; current: number; failed?: string; engineRegistered?: boolean; engineCheckMessage?: string };
/** 本地绝对路径 → file:// URL（webview 内置浏览器可直接渲染本地 HTML） */
function toFileUrl(p: string): string {
  const norm = p.replace(/\\/g, "/");
  return norm.startsWith("/") ? `file://${norm}` : `file:///${norm}`;
}

type MarketPreviewState = {
  kind: "skill" | "plugin" | "mcp";
  title: string;
  subtitle?: string;
  icon?: string;
  iconChar?: string;
  description: string;
  meta: string[];
  installed: boolean;
  installLabel: string;
  onInstall?: () => void;
  externalLabel?: string;
  externalUrl?: string;
  note?: string;
  note2?: string;
};

/** 通知分级：按文案判定语气——失败/错误红、成功/已完成绿、其余中性。
 * 覆盖全部 setNotice 调用点，无需逐个改调用方 */
/** 机器人渠道绑定卡：
 * 微信 → 腾讯官方 iLink bot 协议（真微信机器人：get_bot_qrcode 出微信可扫的码 → confirmed 拿 token → 微信里直接聊）
 * 其他渠道 → 控制端绑定码（手机扫码确认后作为该机器人的控制端） */
function BotBindCard({ bot, onBound }: { bot: { id: string; name: string; channel: string }; onBound: (deviceName: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "bound" | "expired">("idle");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [wxStatus, setWxStatus] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [credA, setCredA] = useState(""); // feishu/dingtalk/qq: ID；telegram: token
  const [credB, setCredB] = useState(""); // feishu/dingtalk/qq: Secret
  const [wecomUrl, setWecomUrl] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  const [qqQrMode, setQqQrMode] = useState(false); // QQ 扫码连接模式：出码等扫，成功即连
  const [qqQr, setQqQr] = useState<{ state: string; qr?: string; name?: string; error?: string } | null>(null);
  const [feishuQrMode, setFeishuQrMode] = useState(false); // 飞书扫码连接模式（Device Flow：扫码=自动建应用并授权）
  const [feishuQr, setFeishuQr] = useState<{ state: string; qr?: string; userCode?: string; name?: string; error?: string } | null>(null);
  const isWeixin = bot.channel === "wechat";
  const isTelegram = bot.channel === "telegram";
  const isFeishu = bot.channel === "feishu";
  const isDingtalk = bot.channel === "dingtalk";
  const isQq = bot.channel === "qq";
  const isWecomWebhook = bot.channel === "wecom-webhook";
  const timerRef = useRef(0);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  // Telegram Bot Token 连接：@BotFather 创建机器人拿 token，填入即连（长轮询自动恢复）
  async function startTelegramConnect() {
    const token = tgToken.trim();
    if (!token) { setWxStatus("请先粘贴 Bot Token（从 Telegram 里的 @BotFather 获取）"); return; }
    setTgBusy(true);
    setWxStatus("正在校验 Token 并连接…");
    try {
      const result = await window.codex.telegramConnect(token);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查 Token"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(`Telegram @${result.username ?? "bot"}`);
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 飞书 / 钉钉 / QQ：双凭据连接（官方长连接，免公网 IP）
  async function startCredConnect() {
    const a = credA.trim();
    const b = credB.trim();
    setTgBusy(true);
    setWxStatus("正在校验凭据并建立连接…");
    try {
      const result = isFeishu ? await window.codex.feishuConnect(a, b)
        : isDingtalk ? await window.codex.dingtalkConnect(a, b)
        : await window.codex.qqConnect(a, b);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查凭据"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(String(result.name ?? (isFeishu ? "飞书" : isDingtalk ? "钉钉" : "QQ")));
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 企微群机器人 Webhook：粘贴即连（校验 = 发一条接入通知）
  async function startWecomConnect() {
    const url = wecomUrl.trim();
    if (!url) { setWxStatus("请先粘贴群机器人 Webhook URL（企微群里「添加机器人」获取）"); return; }
    setTgBusy(true);
    setWxStatus("正在校验 Webhook 并发送接入通知…");
    try {
      const result = await window.codex.wecomWebhookConnect(url);
      if (!result?.ok) { setWxStatus(result?.error || "连接失败，请检查 Webhook URL"); return; }
      setPhase("bound");
      setWxStatus("");
      onBound(String(result.name ?? "企业微信群"));
    } catch (error: any) {
      setWxStatus("连接失败：" + (error?.message ?? "请检查网络后重试"));
    } finally {
      setTgBusy(false);
    }
  }

  // 微信 iLink 登录轮询
  async function startWeixinLogin() {
    try {
      const result = await window.codex.weixinStartLogin();
      if (!result?.qrcodeImg) { setWxStatus("获取微信二维码失败，请重试"); return; }
      // 主进程已把 iLink 的二维码内容归一化成 data URL 图片或 SVG，直接注入
      setQr(result.qrcodeImg);
      setPhase("waiting");
      setWxStatus("等待扫码… 请用手机微信扫一扫");
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        try {
          // 双保险：pollLogin 带超时防长轮询挂死；每跳同时查渠道真实连接状态——
          // 即使 poll 漏报 connected，只要网关已连上界面就会及时更新（用户实测踩过）
          const status = await Promise.race([
            window.codex.weixinPollLogin(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
          ]);
          const cs = await window.codex.channelsStatus().catch(() => null);
          if (cs?.weixin) { window.clearInterval(timerRef.current); setPhase("bound"); setWxStatus(""); onBound("微信"); return; }
          if (status?.status === "scaned") setWxStatus("已扫码，正在验证…（如微信提示验证码，输入后继续）");
          else if (status?.verifyCodeRequired) setWxStatus("请在手机微信输入提示的数字验证码");
          else if (status?.status === "expired") { window.clearInterval(timerRef.current); setPhase("expired"); setWxStatus("二维码已过期"); }
          else if (status?.connected) { window.clearInterval(timerRef.current); setPhase("bound"); setWxStatus(""); onBound("微信"); }
        } catch { /* 单次轮询失败不中断循环 */ }
      }, 1500);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
    }
  }

  // QQ 官方扫码连接：桌面出二维码 → 手机 QQ（开放平台管理者账号）扫码确认 →
  // 官方回传凭据 → 主进程自动走 qqGateway.connect。注意会重置该机器人旧 AppSecret（腾讯规则）。
  async function startQqQrConnect() {
    setWxStatus("");
    try {
      const snapshot = await window.codex.qqQrStart();
      if (snapshot.state === "failed") { setWxStatus(snapshot.error || "获取二维码失败，请重试"); setQqQrMode(false); return; }
      setQqQr(snapshot);
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.qqQrStatus();
        setQqQr(status);
        if (status.state === "connected") {
          window.clearInterval(timerRef.current);
          setQqQrMode(false);
          setPhase("bound");
          setWxStatus("");
          onBound(status.name ?? "QQ 机器人");
        } else if (status.state === "failed") {
          window.clearInterval(timerRef.current);
          setWxStatus(status.error || "扫码连接失败，请重试或改用手动输入");
          setQqQrMode(false);
        }
      }, 1200);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
      setQqQrMode(false);
    }
  }

  function exitQqQrMode() {
    window.clearInterval(timerRef.current);
    void window.codex.qqQrCancel();
    setQqQrMode(false);
    setQqQr(null);
    setWxStatus("");
  }

  // 飞书官方扫码连接（Device Flow）：扫码 → 飞书自动创建应用并授权 → 凭据回传 → 自动连接。
  // 用户零手工配置（无需去开放平台手动建应用）。
  async function startFeishuQrConnect() {
    setWxStatus("");
    try {
      const snapshot = await window.codex.feishuQrStart();
      if (snapshot.state === "failed") { setWxStatus(snapshot.error || "获取二维码失败，请重试"); setFeishuQrMode(false); return; }
      setFeishuQr(snapshot);
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.feishuQrStatus();
        setFeishuQr(status);
        if (status.state === "connected") {
          window.clearInterval(timerRef.current);
          setFeishuQrMode(false);
          setPhase("bound");
          setWxStatus("");
          onBound(status.name ?? "飞书机器人");
        } else if (status.state === "failed") {
          window.clearInterval(timerRef.current);
          setWxStatus(status.error || "扫码连接失败，请重试或改用手动输入");
          setFeishuQrMode(false);
        }
      }, 1500);
    } catch (error: any) {
      setWxStatus("获取二维码失败：" + (error?.message ?? "请检查网络后重试"));
      setFeishuQrMode(false);
    }
  }

  function exitFeishuQrMode() {
    window.clearInterval(timerRef.current);
    void window.codex.feishuQrCancel();
    setFeishuQrMode(false);
    setFeishuQr(null);
    setWxStatus("");
  }

  // 控制端绑定码轮询（非微信渠道）
  async function startBind() {
    try {
      const result = await window.codex.botBindQrcode(bot.id, bot.name);
      if (!result?.qr) { setWxStatus("获取绑定码失败，请重试"); return; }
      setQr(result.qr);
      setCode(result.code);
      setPhase("waiting");
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const status = await window.codex.botBindStatus(result.code);
        if (status === "confirmed") {
          const consumed = await window.codex.botBindConsume(result.code);
          window.clearInterval(timerRef.current);
          setPhase("bound");
          onBound(consumed?.deviceName ?? "手机");
        } else if (status === "expired") {
          window.clearInterval(timerRef.current);
          setPhase((current) => current === "waiting" ? "expired" : current);
        }
      }, 1200);
    } catch (error: any) {
      setWxStatus("获取绑定码失败：" + (error?.message ?? "请检查网络后重试"));
    }
  }

  const start = isWeixin ? startWeixinLogin : startBind;

  // 凭据型渠道（Telegram/飞书/钉钉/QQ/企微Webhook）：各自表单，无扫码
  if (isTelegram || isFeishu || isDingtalk || isQq || isWecomWebhook) {
    const head = isTelegram
      ? { title: "连接 Telegram", desc: "在 Telegram 里找 @BotFather 发送 /newbot 创建机器人，把得到的 Bot Token（形如 123456:ABC-xxx）粘贴到下面。连接后在 Telegram 里给机器人发消息即可对话，回复实时回推。" }
      : isFeishu
        ? { title: "连接飞书机器人", desc: "在 open.feishu.cn 创建「企业自建应用」：①添加「机器人」能力；②开通 im:message 相关权限并发布应用版本；③把「凭证与基础信息」页的 App ID / App Secret 填到下面。连接后群里 @机器人 或私聊发消息即可对话。" }
        : isDingtalk
          ? { title: "连接钉钉机器人", desc: "在 open-dev.dingtalk.com 创建企业内部应用：①「添加应用能力」里开通「机器人」，消息接收模式选「Stream 模式」；②发布应用；③把「应用信息」页的 Client ID / Client Secret 填到下面。连接后在群里 @机器人 发消息即可对话。" }
          : isQq
            ? { title: "连接 QQ 机器人", desc: "推荐「扫码连接」：点下方按钮出二维码，用手机 QQ 扫一下并确认即可，凭据自动回传（注意会重置该机器人旧 AppSecret）。也可在 q.qq.com 实名创建机器人后，把「开发设置」页的 AppID / AppSecret 手动填入。群聊 @机器人 需在开放平台申请「群聊消息」场景与发送权限并上线机器人；审核通过前可先用单聊测试。" }
            : { title: "企微群机器人推送", desc: "在企微群右键 →「添加群机器人」创建后，把 Webhook URL 粘贴到下面。连接即发一条接入通知。此通道为推送型：自动化任务结果、通知会实时推送到群（企微群机器人不支持收消息对话，腾讯限制）。" };
    const busy = tgBusy;
    const connect = isTelegram ? startTelegramConnect : isWecomWebhook ? startWecomConnect : startCredConnect;
    const connectLabel = isTelegram ? "连接" : isWecomWebhook ? "连接并测试" : "连接";
    return (
      <div className="bot-bind-wrap">
        <div className="bot-detail-row bot-bind-card">
          <div><strong>{head.title}</strong><small>{head.desc}</small></div>
        </div>
        {phase !== "bound" ? (
          <div className="bot-bind-panel tg-token-panel">
            {isQq && qqQrMode ? (
              <>
                {isImageSource(qqQr?.qr ?? "")
                  ? <div className="remote-qr-box"><img src={qqQr!.qr} alt="QQ 扫码二维码" style={{ display: "block", width: "100%" }} /></div>
                  : <div className="remote-qr-box">{qqQr?.qr ? <div dangerouslySetInnerHTML={{ __html: qqQr.qr }} /> : <span className="bind-spinner" />}</div>}
                <div className="bot-bind-state">
                  <span className="bot-bind-state-title"><span className="bind-spinner" />等待手机 QQ 扫码</span>
                  <span>用手机 QQ「扫一扫」扫描二维码并确认（需为开放平台上该机器人的管理者账号）</span>
                  <span>扫码确认后凭据自动回传并连接，无需手动输入；注意：会重置该机器人已保存的 AppSecret</span>
                  <button className="remote-mini-btn" onClick={exitQqQrMode}>取消扫码</button>
                </div>
              </>
            ) : isFeishu && feishuQrMode ? (
              <>
                {isImageSource(feishuQr?.qr ?? "")
                  ? <div className="remote-qr-box"><img src={feishuQr!.qr} alt="飞书扫码二维码" style={{ display: "block", width: "100%" }} /></div>
                  : <div className="remote-qr-box">{feishuQr?.qr ? <div dangerouslySetInnerHTML={{ __html: feishuQr.qr }} /> : <span className="bind-spinner" />}</div>}
                <div className="bot-bind-state">
                  <span className="bot-bind-state-title"><span className="bind-spinner" />等待飞书扫码授权</span>
                  <span>用手机飞书「扫一扫」扫描二维码并确认授权（飞书会自动创建机器人应用，无需手动去开放平台配置）</span>
                  {feishuQr?.userCode && <span>展示码：{feishuQr.userCode}</span>}
                  <span>授权成功后凭据自动回传并连接；二维码过期会自动刷新</span>
                  <button className="remote-mini-btn" onClick={exitFeishuQrMode}>取消扫码</button>
                </div>
              </>
            ) : (
              <>
                {isTelegram && (
                  <input className="tg-token-input" type="password" placeholder="粘贴 Bot Token：123456:ABC-DEF..." value={tgToken} onChange={(event) => setTgToken(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                )}
                {(isFeishu || isDingtalk || isQq) && (
                  <>
                    <input className="tg-token-input" placeholder={isDingtalk ? "Client ID (AppKey)" : "App ID / AppID"} value={credA} onChange={(event) => setCredA(event.target.value)} />
                    <input className="tg-token-input" type="password" placeholder={isDingtalk ? "Client Secret (AppSecret)" : "App Secret"} value={credB} onChange={(event) => setCredB(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                  </>
                )}
                {isWecomWebhook && (
                  <input className="tg-token-input" type="password" placeholder="粘贴 Webhook URL：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." value={wecomUrl} onChange={(event) => setWecomUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void connect(); }} />
                )}
                {isQq && (
                  <button className="bot-scan-btn" disabled={busy} onClick={() => { setQqQrMode(true); void startQqQrConnect(); }}><QrCode size={14} />扫码连接（手机 QQ 扫码，免输入）</button>
                )}
                {isFeishu && (
                  <button className="bot-scan-btn" disabled={busy} onClick={() => { setFeishuQrMode(true); void startFeishuQrConnect(); }}><QrCode size={14} />扫码连接（手机飞书扫码，自动建应用，免输入）</button>
                )}
                <button className="bot-scan-btn" disabled={busy} onClick={() => void connect()}>{busy ? <><span className="bind-spinner" />连接中…</> : <><QrCode size={14} />{connectLabel}</>}</button>
                {wxStatus && <span className="tg-token-status">{wxStatus}</span>}
              </>
            )}
          </div>
        ) : (
          <div className="bot-bind-panel">
            <div className="bot-bind-state">
              <span className="bot-bind-state-title"><span className="bind-ok">✓</span>{head.title.replace("连接", "")}已连接</span>
              <span>{isWecomWebhook ? "现在自动化任务结果与通知会推送到这个企微群。" : "现在直接在该渠道给机器人发消息即可对话，回复会实时回推。"}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bot-bind-wrap">
      <div className="bot-detail-row bot-bind-card">
        <div><strong>{isWeixin ? "连接微信" : "关联机器人"}</strong><small>{isWeixin ? "用手机微信扫码登录，登录后直接在微信里和机器人聊天，回复实时回推。" : "扫码后自动保存凭据。手机扫一扫，打开链接并确认登录，这台手机即成为该机器人的控制端。"}</small></div>
        {phase !== "bound" && <button className="bot-scan-btn" onClick={() => void start()}><QrCode size={14} />扫码</button>}
      </div>
      {phase !== "idle" && phase !== "bound" && (
        <div className="bot-bind-panel">
          {isImageSource(qr)
            ? <div className="remote-qr-box"><img src={qr} alt="微信登录二维码" style={{ display: "block", width: "100%" }} /></div>
            : <div className="remote-qr-box" dangerouslySetInnerHTML={{ __html: qr }} />}
          <div className="bot-bind-state">
            {phase === "waiting" && <>
              <span className="bot-bind-state-title"><span className="bind-spinner" />{isWeixin ? "等待微信扫码" : "等待扫码"}</span>
              {isWeixin
                ? <>
                  <span>打开手机微信「扫一扫」扫描左侧二维码</span>
                  {wxStatus && <span>{wxStatus}</span>}
                  <button className="remote-mini-btn" onClick={() => { window.clearInterval(timerRef.current); void window.codex.weixinCancelLogin().catch(() => undefined); setPhase("idle"); setQr(""); setWxStatus(""); }}>取消扫码</button>
                </>
                : <>
                  <span>用手机相机或其他 App「扫一扫」扫描左侧二维码</span>
                  <span>打开链接后点「确认登录」，该手机即成为此机器人的控制端</span>
                </>}
            </>}
            {phase === "expired" && <>
              <span className="bot-bind-state-title">二维码已过期</span>
              <button className="remote-mini-btn" onClick={() => void start()}><RefreshCw size={12} />重新扫码</button>
            </>}
          </div>
        </div>
      )}
      {phase === "bound" && (
        <div className="bot-bind-panel">
          <div className="bot-bind-state">
            <span className="bot-bind-state-title"><span className="bind-ok">✓</span>{isWeixin ? "微信已连接" : "绑定成功"}</span>
            <span>{isWeixin ? "现在直接在微信里给这个账号发消息即可对话，回复会实时回推到微信。" : "手机已确认登录，可远程控制该机器人。"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 二维码是否为图片源（data URL / http URL / 裸 base64 图片），否则视为 SVG 字符串 */
function isImageSource(value: string): boolean {
  if (value.startsWith("data:") || value.startsWith("http")) return true;
  return value.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 64));
}

/** 插件展示名：优先用市场声明的 displayName，其次回落到 id/name */
function pluginDisplayName(plugin: any): string {
  return String(plugin?.interface?.displayName || plugin?.name || plugin?.id || "未命名插件");
}
function pluginDescription(plugin: any): string {
  return String(plugin?.interface?.shortDescription || plugin?.interface?.longDescription || plugin?.description || "这个插件没有提供描述。");
}

/** Hook 注入徽标：footer 末尾的小钩子图标，hover 展开本次注入的 hook 列表 */
function HookBadge({ hooks }: { hooks: { name: string; done: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="hook-badge-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className={`hook-badge ${hooks.every((h) => h.done) ? "done" : "running"}`} title="本回合注入的 Hook"><Wrench size={12} />{hooks.length}</span>
      {open && (
        <span className="hook-badge-pop">
          {hooks.map((hook) => <span className="hook-badge-row" key={hook.name}><span className={`hook-dot ${hook.done ? "ok" : ""}`} />{hook.name}</span>)}
        </span>
      )}
    </span>
  );
}

function noticeTone(text: string): "success" | "error" | "warning" | "info" {
  if (/失败|错误|无效|无法|不存在|请先|剪贴板中没有|不能为空/i.test(text)) return "error";
  if (/已复制|已保存|已安装|已卸载|已切换|已生效|成功|已发送|已提供|已开启|已关闭|已更新|已重命名|已创建|已启动/i.test(text)) return "success";
  if (/警告|注意|即将|可能|建议|重试|部分/.test(text)) return "warning";
  return "info";
}

/** 内置命令目录（复刻 WorkBuddy/CodeBuddy 命令体系）：name / 描述 / 参数提示 / 分类。
 * 仅收录本项目引擎已具备真实能力的命令，全部有 runSlashCommand 实现。 */
type BuiltinCommandDef = { name: string; description: string; hint?: string; category: string };
const builtinCommandCatalog: BuiltinCommandDef[] = [
  // 会话管理
  { name: "new", description: "开启全新对话", category: "会话管理" },
  { name: "resume", description: "打开历史任务", category: "会话管理" },
  { name: "rename", description: "重命名当前任务", hint: "<新名称>", category: "会话管理" },
  { name: "fork", description: "从当前任务分叉出新分支", hint: "[分支名]", category: "会话管理" },
  { name: "archive", description: "归档当前任务，列表不再展示", category: "会话管理" },
  { name: "delete", description: "永久删除当前任务（不可恢复）", category: "会话管理" },
  { name: "undo", description: "撤销上一轮对话", category: "会话管理" },
  // 上下文与状态
  { name: "compact", description: "压缩当前上下文，总结较早对话释放空间", category: "上下文与状态" },
  { name: "clear", description: "清空上下文，开启新对话（旧会话保留在历史里）", category: "上下文与状态" },
  { name: "status", description: "显示任务状态、模型、思考强度与上下文用量", category: "上下文与状态" },
  { name: "context", description: "计算并展示当前上下文占用", category: "上下文与状态" },
  { name: "pwd", description: "显示当前工作目录", category: "上下文与状态" },
  { name: "cd", description: "更换当前工作目录", hint: "[目录]", category: "上下文与状态" },
  { name: "queue", description: "查看待处理的消息队列", category: "上下文与状态" },
  { name: "memory", description: "打开记忆管理，查看或新增记忆", category: "上下文与状态" },
  { name: "plan", description: "计划模式：先调研输出方案，确认后执行", hint: "<任务描述>", category: "运行控制" },
  { name: "goal", description: "目标模式：朝目标自动持续推进直至达成", hint: "<目标 | clear>", category: "运行控制" },
  // 模型与权限
  { name: "model", description: "模型与思考设置", category: "模型与权限" },
  { name: "effort", description: "切换真实思考强度", hint: "[极少|低|中|高|max|最高]", category: "模型与权限" },
  { name: "personality", description: "切换回复风格", hint: "[务实|友好|默认]", category: "模型与权限" },
  { name: "permissions", description: "运行权限设置", category: "模型与权限" },
  { name: "sandbox", description: "切换沙箱执行范围", hint: "[只读|工作区可写|完全访问]", category: "模型与权限" },
  { name: "approval", description: "切换命令审批策略", hint: "[按需|从不]", category: "模型与权限" },
  // 审查与代码
  { name: "review", description: "审查当前代码改动", hint: "[自定义指令]", category: "审查与代码" },
  { name: "diff", description: "打开本轮文件改动", category: "审查与代码" },
  { name: "copy", description: "复制上一条回复到剪贴板", category: "审查与代码" },
  // 信息查询
  { name: "help", description: "查看全部可用命令及用法", category: "信息查询" },
  { name: "skills", description: "列出可用 Skills", category: "信息查询" },
  { name: "mcp", description: "列出 MCP 服务及运行状态", category: "信息查询" },
  { name: "plugins", description: "列出已安装插件", category: "信息查询" },
  { name: "apps", description: "列出已安装 Apps", category: "信息查询" },
  // 运行控制
  { name: "stop", description: "停止当前生成", category: "运行控制" },
];
/** 兼容旧引用的二元组（name, description） */
const slashCommands = builtinCommandCatalog.map(({ name, description }) => [name, description] as const);

/** 技能名规范化：剥掉插件限定前缀并转小写。引擎对插件技能返回 `ponytail:ponytail-audit`，
 *  本地目录技能是 `ponytail-audit`——不归一化同一个技能会显示成两条。 */
function normSkillName(raw: string): string {
  const name = String(raw ?? "").toLowerCase().trim();
  const index = name.lastIndexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}
/** 技能短名：去掉 `插件:` 前缀，保留原始大小写，用于界面展示。 */
function shortSkillName(raw: string): string {
  const name = String(raw ?? "");
  const index = name.lastIndexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}
const CJK_TEXT_RE = /[\u3400-\u9fff]/;
/** 已安装技能的中文注释表：市场技能与引擎内置技能的描述多为英文，这里补齐中文说明，
 *  让「/」命令面板同款的中文注释列在技能面板里也有内容可读（key 为规范化技能名）。 */
const SKILL_ZH_NOTES: Record<string, string> = {
  "browser-automation": "浏览器自动化：网页打开抓取、自动填表、反检测指纹浏览器",
  "desktop-automation": "桌面自动化：截屏、窗口切换、鼠标点击与键盘输入",
  "find-skills": "技能发现：按需求在技能市场检索并安装合适的技能",
  ponytail: "极简编码：只写够用的最少代码，少依赖、少抽象、反对过度设计",
  "ponytail-audit": "极简审计：全仓库扫描过度设计，列出可删可简化的代码",
  "ponytail-review": "极简评审：只针对过度设计审查代码改动",
  "ponytail-debt": "极简技术债：收集代码里因简化而留下的待办",
  "ponytail-gain": "极简收益：统计极简改造节省的代码量与依赖数",
  "ponytail-help": "极简模式说明：Ponytail 全部模式与用法速查",
  "ponytail-evaluate-skill": "评估技能：检查本地技能设计是否合理",
  "self-improvement": "自我进化：记录报错、用户纠正与更好做法，持续沉淀为可复用经验",
  "smart-prompt": "提示词强化：把普通描述改写成结构化高质量提示词再执行",
  "smart-charts": "智能图表：读取数据自动生成可视化图表",
  "dev-expert": "编程专家：项目总控、接口设计、Bug 诊断、代码审查与重构",
  "evaluate-plugin": "插件评估：按工程视角评估本地 Codex 插件的质量",
  "improve-skill": "技能改进：把评估结论转成具体的重写清单",
  "metric-pack-designer": "指标包设计：为插件评估设计自定义度量指标",
  "plugin-eval": "技能/插件评估入口：解释评估结论与改进方向",
  imagegen: "生成图像：需要位图/插画时生成或编辑图片",
  "openai-docs": "官方文档：查询 Codex 模型、定价、定时任务与技能说明",
  "plugin-creator": "插件创建：脚手架式新建 Codex 插件目录",
  "review-agent": "审查代理：对目标代码做只读、缺陷优先的审查",
  "skill-creator": "技能创建：新建或更新符合规范的 Codex 技能",
  "skill-installer": "技能安装：把技能安装到 Codex 技能目录",
};
/** 技能的中文注释：高优先级中文注释表 → 安装时存下的市场中文简介 → 技能自带的中文描述 → 技能类别 → 通用兜底。
 *  使命是「每个技能都有一句中文说明」——市场技能装到本地后 frontmatter 描述多为英文，
 *  靠安装时写入来源清单的 descriptionZh 兜住「后续新装的技能」。英文描述不会再原样铺给用户。 */
function skillZhNote(entry: { name: string; description?: string; descriptionZh?: string; category?: string }): string {
  const key = normSkillName(entry.name);
  const note = SKILL_ZH_NOTES[key];
  if (note) return note;
  const marketZh = String(entry.descriptionZh ?? "").replace(/\s+/g, " ").trim();
  if (marketZh && CJK_TEXT_RE.test(marketZh)) return marketZh.length > 72 ? `${marketZh.slice(0, 72)}…` : marketZh;
  const description = String(entry.description ?? "").replace(/^\s*>\s*/, "").replace(/\s+/g, " ").trim();
  if (description && CJK_TEXT_RE.test(description)) return description.length > 64 ? `${description.slice(0, 64)}…` : description;
  const byCategory: Record<string, string> = {
    "ai-agent": "AI 智能体技能",
    "数据可视化": "数据可视化技能",
    "数据处理": "数据处理与清洗技能",
    "开发工具": "开发工具技能",
    "效率工具": "效率提升技能",
  };
  if (entry.category && byCategory[entry.category]) return byCategory[entry.category];
  return "已安装技能";
}
/** 按查询词匹配技能（前缀命中优先，最多 limit 条）：输入框「#」面板与发送拦截共用，
 *  保证「面板里看到的」与「回车/点发送时选中的」是同一套结果。 */
function matchSkillCatalog<T extends { name: string; description: string; note: string }>(catalog: T[], query: string, limit = 12): T[] {
  const q = (query ?? "").toLowerCase();
  return catalog
    .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.note.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

const effortLabels: Record<string, string> = {
  none: "关闭思考",
  minimal: "极简思考",
  low: "轻量思考",
  medium: "均衡思考",
  high: "标准思考",
  xhigh: "深度思考",
  ultra: "极限思考",
};

/** 行业分类 ID → 中文名（与专家团编辑器一致） */
const EXPERT_CATEGORY_LABELS: Record<string, string> = {
  "01-ProductDesign": "产品设计", "02-Engineering": "技术工程", "03-GameSpatial": "游戏空间",
  "04-DataAI": "数据智能", "05-MarketingGrowth": "营销增长", "06-ContentCreative": "内容创作",
  "07-SalesCommerce": "销售商务", "08-FinanceInvestment": "金融投资", "09-OperationsHR": "运营人力",
  "10-ProjectQuality": "项目质量", "11-SecurityCompliance": "法务安全", "12-IndustryConsultant": "行业顾问",
};
function categoryLabel(id: string) { return EXPERT_CATEGORY_LABELS[id] ?? (id || "未分类"); }

function expertRoleLabel(member: ExpertTeamMember, isLead = false) {
  return member.profession.zh?.trim() || (isLead ? "主理人" : "团队成员");
}

const MEMORY_CATEGORIES = [
  { name: "用户偏好", icon: User, hint: "用户风格、口味、习惯、长期偏好" },
  { name: "项目背景", icon: BookOpen, hint: "项目定位、模块、关键约束" },
  { name: "工作流/SOP", icon: ListFilter, hint: "固定的流程、约定、复盘准则" },
  { name: "任务经验", icon: Brain, hint: "踩过的坑、有效解法、可复用经验" },
  { name: "临时上下文", icon: Clock3, hint: "临时记录,任务结束后清理" },
] as const;

/** 把启用的子智能体登记成 Codex 可直接调用的 dynamicTool。 */
function subAgentTools(agents: SubAgentEntry[]) {
  const enabled = agents.filter((agent) => agent.enabled);
  if (!enabled.length) return [];
  return [{
    type: "function",
    name: "subagent_invoke",
    description: `调用用户配置的子智能体完成一个独立子任务并返回结构化结果。可用子智能体：${enabled.map((agent) => `${agent.name}（${agent.description || "无描述"}）`).join("；")}。子智能体在独立会话中运行，会继承主对话的模型与权限设置。`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "要调用的子智能体名称，必须是上面列出的名称之一", enum: enabled.map((agent) => agent.name) },
        query: { type: "string", description: "交给子智能体的完整任务描述，信息要足够独立执行" },
      },
      required: ["name", "query"],
    },
  }];
}

const idleTemplates = [
  { name: "Git 周会摘要", desc: "汇总本周 Git 活动，生成周五会话摘要：列出重要提交、已合并 PR 及主要变更，并保持简洁。", prompt: "汇总本周 Git 活动，生成周五会话摘要：列出重要提交、已合并 PR 及主要变更，并保持简洁。" },
  { name: "CI 失败与不稳定测试报告", desc: "扫描最近的 CI 运行，列出失败和不稳定测试及其可能原因，并按影响范围给出修复建议。", prompt: "扫描最近的 CI 运行，列出失败和不稳定测试及其可能原因，并按影响范围给出修复建议。" },
  { name: "文档同步检查", desc: "基于当前代码实现和最近提交，检查仓库中的 README、docs、配置说明与使用示例是否过时或与实现不一致。仅修改文档。", prompt: "基于当前代码实现和最近提交，检查仓库中的 README、docs、配置说明与使用示例是否过时或与实现不一致。仅修改文档。" },
];
const cronTemplates = [
  { name: "晨会动态", desc: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，最终生成不超过 6 条的晨会口述摘要。只读分析。", time: "每工作日 09:00", intervalMinutes: 1440, icon: "◎" },
  { name: "风险扫描", desc: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄露及跨端兼容等高置信风险，并附代码和修复建议。", time: "每天 10:00", intervalMinutes: 1440, icon: "⚠" },
  { name: "发布简报", desc: "整理本周合并的 PR 和 commit，按功能、修复、体验及工程改进分类，同时生成团队版和面向用户的精简发布说明。", time: "每周五 16:00", intervalMinutes: 10080, icon: "📝" },
  { name: "文档同步检查", desc: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高置信差异，并附文件路径和修复建议。", time: "每周三 15:00", intervalMinutes: 10080, icon: "📄" },
];
type SettingsPage = "user" | "general" | "devtools" | "appearance" | "personalization" | "model" | "relay" | "openai" | "browser" | "computer" | "memory" | "agents" | "teams" | "plugins" | "mcp" | "ssh" | "skills" | "commands" | "hooks" | "usage" | "channel" | "schedule" | "rpa" | "archive" | "backup" | "storage" | "automation" | "agentteam";
// 导航分组：常用项置顶（技能/插件紧挨），自动化三合一、智能体+专家团合并为二级页。
// "browser"/"computer"/"rpa"/"agents"/"teams" 保留在类型里（历史跳转兼容），但不再出现在导航。
const settingsNav: { group: string; items: [SettingsPage, string, any][] }[] = [
  { group: "账户", items: [["user", "用户中心", UserRound], ["model", "模型", Bot], ["relay", "中转站", Wallet], ["openai", "OpenAI 订阅", CircleGauge]] },
  { group: "常用", items: [["general", "控制台", Settings2], ["appearance", "外观", Sun], ["personalization", "个性化", Sparkles], ["skills", "技能", Zap], ["plugins", "插件", Store], ["memory", "记忆", Archive], ["commands", "命令", TerminalSquare]] },
  { group: "自动化与能力", items: [["automation", "自动化", Workflow], ["mcp", "MCP", Wifi], ["schedule", "定时任务", Clock3], ["hooks", "钩子", Wrench], ["ssh", "SSH 服务器", Server]] },
  { group: "智能体", items: [["agentteam", "智能体团队", Users]] },
  { group: "数据与统计", items: [["usage", "使用统计", CircleGauge], ["storage", "数据管理", Database], ["backup", "会话备份", Download], ["archive", "归档管理", Archive]] },
  { group: "开发工具", items: [["devtools", "开发工具", TerminalSquare]] },
];

/** 能力总闸各子项在提示文案里的展示名（describePartial / 部分启用提示用）。 */
const MEMBER_LABELS: Partial<Record<MemberKey, string>> = {
  ponytail: "ponytail 注入开关",
  ponytailPlugin: "ponytail 插件",
  ponytailSkills: "ponytail 子技能",
  desktop: "桌面自动化总闸",
  nuphusMcp: "nuphus MCP",
  desktopSkill: `${DESKTOP_SKILL_ID} 技能`,
  browser: "浏览器自动化总闸",
  browserSkill: `${BROWSER_SKILL_ID} 技能`,
};

/** 快捷键一览：settings 快捷键弹窗用。keys 是展示用组合，实际绑定在全局 keydown 处理器。 */
const SHORTCUT_GROUPS: { group: string; shortcuts: { keys: string[]; desc: string }[] }[] = [
  {
    group: "对话",
    shortcuts: [
      { keys: ["Ctrl+Enter", "Enter"], desc: "发送消息" },
      { keys: ["Shift+Enter"], desc: "插入换行" },
      { keys: ["Ctrl+Shift+F"], desc: "搜索当前对话内容" },
      { keys: ["Ctrl+L"], desc: "聚焦输入框" },
      { keys: ["Ctrl+Shift+/"], desc: "聚焦输入框（输入命令）" },
    ],
  },
  {
    group: "新建与会话",
    shortcuts: [
      { keys: ["Ctrl+N", "Ctrl+Shift+N"], desc: "新建对话" },
      { keys: ["Ctrl+K", "Ctrl+P", "Ctrl+Shift+P"], desc: "打开命令面板" },
      { keys: ["Ctrl+O"], desc: "更换工作区目录" },
    ],
  },
  {
    group: "界面",
    shortcuts: [
      { keys: ["Ctrl+B"], desc: "打开 / 关闭右侧上下文面板" },
      { keys: ["Ctrl+J"], desc: "打开终端面板" },
      { keys: [","], desc: "打开设置（Ctrl + 逗号）" },
      { keys: ["Ctrl+Shift+S"], desc: "打开设置 · 控制台" },
      { keys: ["Esc"], desc: "关闭当前弹窗 / 面板" },
    ],
  },
  {
    group: "其它",
    shortcuts: [
      { keys: ["Ctrl+Shift+/"], desc: "输入斜杠命令" },
      { keys: ["Ctrl+Z / Ctrl+Y"], desc: "撤销 / 重做（编辑框内）" },
    ],
  },
];

function imageUrl(path: string) {
  // 双重编码：Chromium 对自定义协议 URL 会自行解一层 percent 编码，路径里的 %5C（反斜杠）
  // 被还原成 \ 后在协议层丢失（实测 decoded 变成 C:UsersAdministrator... → existsSync false
  // → 主进程返回 1x1 透明占位 → 用户看到「透明的图」）。双编码保证 handler 至少还剩一层可解。
  return `harness-image://local?path=${encodeURIComponent(encodeURIComponent(path))}`;
}

/** 把图片显示源的 path 还原成本地文件路径；非本地（http/data/相对）返回 null。
 *  支持三种形态：本地绝对路径、harness-image://（双编码）、http(s) URL（返回 null 走外部打开）。 */
function resolveImagePath(input: string): string | null {
  if (!input) return null;
  if (input.startsWith("harness-image://")) {
    try {
      let p = new URL(input).searchParams.get("path") ?? "";
      // URLSearchParams 已解一层；双编码的 path 还剩一层（%5C 等）
      if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith("/")) { try { p = decodeURIComponent(p); } catch { return null; } }
      return p || null;
    } catch { return null; }
  }
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("/")) return input;
  return null;
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** 会话列表按本地日历日分组（WorkBuddy conversation-section 风格） */
/** 按「具体日期」对对话分组（今天 / 昨天用口语，其余用具体月日），每组一个可折叠 section */
function groupThreadsByTime(threads: Thread[]): { key: string; label: string; items: Thread[] }[] {
  const groups = new Map<string, { key: string; label: string; items: Thread[] }>();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const dayMs = 86400;
  const pad = (value: number) => String(value).padStart(2, "0");
  for (const t of threads) {
    const ts = t.updatedAt;
    // 分组键必须用「本地日历日零点」时间戳，不能用 floor(ts/86400)（按 UTC 日切分）——
    // UTC+8 下今天 0~8 点的会话会落进上一个 UTC 日，被拆成另一组但标签同为「今天」→ 重复分组。
    const d = new Date(ts * 1000);
    const key = String(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
    let label: string;
    if (ts >= startOfToday) label = "今天";
    else if (ts >= startOfToday - dayMs) label = "昨天";
    else {
      const d = new Date(ts * 1000);
      const nowD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((nowD.getTime() / 1000 - ts) / dayMs);
      if (diffDays < 7) {
        const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        label = weekdays[d.getDay()];
      } else {
        label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    let group = groups.get(key);
    if (!group) { group = { key: `day-${key}`, label, items: [] }; groups.set(key, group); }
    group.items.push(t);
  }
  return [...groups.values()].sort((a, b) => Number(b.key.replace("day-", "")) - Number(a.key.replace("day-", "")));
}

/** 首页内置快捷站点（无收藏时兜底展示，品牌色字母块） */
const QUICK_SITES: { name: string; url: string; color: string }[] = [
  { name: "GitHub", url: "https://github.com", color: "#181717" },
  { name: "OpenAI", url: "https://openai.com", color: "#10a37f" },
  { name: "Google", url: "https://www.google.com", color: "#4285f4" },
  { name: "哔哩哔哩", url: "https://www.bilibili.com", color: "#fb7299" },
  { name: "知乎", url: "https://www.zhihu.com", color: "#0084ff" },
  { name: "百度", url: "https://www.baidu.com", color: "#2932e1" },
];

/** 按时段返回问候语 */
function greetingForHour(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚上好";
  return "夜深了";
}

/** 收集对话消息文本供内容搜索（user/agent 正文、推理、工具 content/title） */
function collectMessageTexts(thread: Thread | null): { turnId: string; itemId: string; type: string; text: string }[] {
  if (!thread) return [];
  const out: { turnId: string; itemId: string; type: string; text: string }[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      let text = "";
      if (item.type === "userMessage" || item.type === "agentMessage") text = typeof item.text === "string" ? item.text : "";
      else if (item.type === "reasoning") text = typeof item.text === "string" ? item.text : "";
      else if (typeof item.content === "string") text = item.content;
      else if (typeof item.title === "string") text = item.title;
      else if (typeof item.summary === "string") text = item.summary;
      if (text.trim()) out.push({ turnId: turn.id, itemId: item.id, type: item.type, text });
    }
  }
  return out;
}

/** 在滚动容器里定位匹配消息元素（优先精确 item，退化同 turn 首条） */
function locateMatchEl(scroller: HTMLElement, m: { turnId: string; itemId: string }): HTMLElement | null {
  const all = Array.from(scroller.querySelectorAll<HTMLElement>("[data-turn-id]"));
  const exact = all.find((n) => n.dataset.turnId === m.turnId && n.dataset.itemId === m.itemId);
  if (exact) return exact;
  return all.find((n) => n.dataset.turnId === m.turnId) ?? null;
}

function uniqueModelCount(models: { id: string }[] | undefined) {
  if (!models?.length) return 0;
  const seen = new Set<string>();
  for (const m of models) if (m?.id) seen.add(m.id);
  return seen.size;
}

function ago(ts: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

const RRULE_DAY_NAMES: Record<string, string> = { MO: "一", TU: "二", WE: "三", TH: "四", FR: "五", SA: "六", SU: "日" };

function clampRruleNum(value: string | undefined, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// 对齐 WorkBuddy 的 rrule 描述：每N小时 / 每天HH:MM / 每周X、Y / 每两周 / 每月X日 / 每年M月D日
function describeRrule(rrule: string) {
  const map = new Map<string, string>();
  for (const pair of (rrule || "").split(";")) {
    const [key, value] = pair.split("=");
    if (key && value) map.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  const freq = map.get("FREQ") || "DAILY";
  const interval = clampRruleNum(map.get("INTERVAL"), 1, 999, 1);
  const hour = String(clampRruleNum(map.get("BYHOUR"), 0, 23, 9)).padStart(2, "0");
  const minute = String(clampRruleNum(map.get("BYMINUTE"), 0, 59, 0)).padStart(2, "0");
  const time = `${hour}:${minute}`;
  if (freq === "HOURLY") return interval <= 1 ? "每小时" : `每 ${interval} 小时`;
  if (freq === "DAILY") return `每天 ${time}`;
  if (freq === "WEEKLY") {
    const days = (map.get("BYDAY") ?? "").split(",").map((day) => RRULE_DAY_NAMES[day.trim().toUpperCase()] ?? day.trim()).filter(Boolean);
    if (days.length === 7) return interval > 1 ? `每 ${interval} 周 · 每天 ${time}` : `每天 ${time}`;
    const head = interval > 1 ? `每 ${interval} 周` : "每周";
    return days.length ? `${head} ${days.join("、")} ${time}` : `${head} ${time}`;
  }
  if (freq === "MONTHLY") return `每月 ${clampRruleNum(map.get("BYMONTHDAY"), 1, 31, 1)} 日 ${time}`;
  if (freq === "YEARLY") return `每年 ${clampRruleNum(map.get("BYMONTH"), 1, 12, 1)} 月 ${clampRruleNum(map.get("BYMONTHDAY"), 1, 31, 1)} 日 ${time}`;
  return freq.toLowerCase();
}

function describeSchedule(task: { kind?: string; timeOfDay?: string; weekdays?: number[]; intervalMinutes: number; rrule?: string; scheduleType?: string; scheduledAt?: string; monthDay?: number; month?: number }) {
  if (task.rrule) return describeRrule(task.rrule);
  if (task.scheduleType === "once" || task.kind === "once") {
    const at = task.scheduledAt;
    return at ? `一次性 ${at.replace("T", " ").slice(5, 16)}` : "一次性";
  }
  const time = task.timeOfDay ?? "09:00";
  if (task.kind === "daily") return "每天 " + time;
  if (task.kind === "weekly") return "每周" + (task.weekdays ?? [1]).map((day) => "日一二三四五六"[day]).join("、") + " " + time;
  if (task.kind === "monthly") return `每月 ${task.monthDay ?? 1} 日 ${time}`;
  if (task.kind === "yearly") return `每年 ${task.month ?? 1} 月 ${task.monthDay ?? 1} 日 ${time}`;
  if (task.intervalMinutes % 60 === 0) return task.intervalMinutes === 60 ? "每小时" : `每 ${task.intervalMinutes / 60} 小时`;
  return `每 ${task.intervalMinutes} 分钟`;
}

type ToolStatusEntry = { id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string };

// 自动化工具状态卡：nuphus-mcp / playwright-cli / cloakbrowser。
function ToolCard({ tool }: { tool: ToolStatusEntry }) {
  const Icon = tool.id === "nuphus-mcp" ? Monitor : tool.id === "cloakbrowser" ? ShieldCheck : Globe2;
  const state = !tool.installed ? "missing" : !tool.binaryReady ? "partial" : "ready";
  const stateLabel = state === "ready" ? "就绪" : state === "partial" ? "待下载内核" : "未安装";
  return (
    <div className={`tool-card ${state}`}>
      <span className="tool-card-icon"><Icon size={16} /></span>
      <div className="tool-card-main">
        <div className="tool-card-head">
          <strong>{tool.name}</strong>
          {tool.version && <code className="tool-card-version">v{tool.version}</code>}
          <span className={`tool-card-state ${state}`}>{stateLabel}</span>
        </div>
        <p>{tool.detail}</p>
        <code className="tool-card-command">{tool.command}</code>
      </div>
    </div>
  );
}

function basename(value: string) {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}

function modelName(value: string) {
  return value.startsWith("custom:") ? value.split(":").slice(2).join(":") : value;
}

/** 机器人渠道中文名（bot-detail 已连接卡等处展示用） */
function botChannelName(channel: string) {
  return channel === "wechat" ? "微信" : channel === "feishu" ? "飞书" : channel === "telegram" ? "Telegram" : channel === "dingtalk" ? "钉钉" : channel === "wecom-webhook" ? "企微推送" : channel === "qq" ? "QQ 机器人" : "";
}

/** 机器人是否在线：所有渠道都看网关真实连接状态 */
function botOnlineOf(bot: { channel: string; enabled: boolean }, channelOnline: Record<string, boolean | undefined>) {
  if (!bot.channel) return false;
  return Boolean(channelOnline[bot.channel]);
}

function formatDuration(value: unknown) {
  // 与 usage-stats 版本并存：接受 unknown 并返回空串语义，避免历史调用点行为变化
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  return localFormatDurationMs(milliseconds);
}

function localFormatDurationMs(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))} 毫秒`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 0 : 1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

function itemStatusLabel(status: unknown) {
  if (status === "inProgress" || status === "running") return "处理中";
  if (status === "failed" || status === "error") return "失败";
  if (status === "declined") return "已拒绝";
  if (status === "interrupted") return "已中断";
  return "已处理";
}

function durationLabel(status: unknown, durationMs: unknown) {
  const duration = formatDuration(durationMs);
  return duration ? `${itemStatusLabel(status)} · ${duration}` : itemStatusLabel(status);
}

const workItemTypes = new Set(["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "subAgentActivity", "imageGeneration"]);

function isTaskTurn(turn: Turn) {
  return turn.items.some((item) => workItemTypes.has(item.type));
}

function diffStats(diff: string) {
  return diff.split("\n").reduce((stats, line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) stats.added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) stats.deleted += 1;
    return stats;
  }, { added: 0, deleted: 0 });
}

function isActivityItem(item: ThreadItem) {
  return item.type !== "userMessage" && item.type !== "agentMessage" && item.type !== "reasoning";
}

function formatTimestamp(value: unknown) {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
}

function itemText(item: ThreadItem) {
  if (item.type === "agentMessage") return item.text ?? "";
  if (item.type === "userMessage") return (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  return "";
}

function inputText(input: any[]) {
  return input.filter((part) => part.type === "text").map((part) => part.text).join("\n") || `${input.filter(isImagePart).length} 个图片附件`;
}

const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
function isImagePath(path: string) {
  const lower = path.toLowerCase();
  return imageExts.has(lower.slice(lower.lastIndexOf(".")));
}

/** 看着像文件路径：要么含盘符/分隔符，要么以 .<1-5 字符后缀 结尾 */
function looksLikeFilePath(candidate: string): boolean {
  const trimmed = candidate.replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  if (!trimmed || trimmed.length > 4096) return false;
  // Windows 盘符单独走规则；非盘符路径禁掉明显非法字符
  const hasDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  if (!hasDrive && /[<>:"|?*\u0000-\u001f]/.test(trimmed)) return false;
  // 版本号 / 纯数字 token（2.55.0、v24.19.0、11.17.0、384.4）不是文件
  if (/^[vV]?\d[\d.,]*\d$/.test(trimmed)) return false;
  // 中文描述末尾的小数（累计升值超0.4、增长3.5）不是“.4/.5 文件”。
  if (/\.\d{1,5}$/.test(trimmed)) return false;
  if (hasDrive) return /\.[A-Za-z0-9]{1,5}$/.test(trimmed);
  if (trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  if (/[\\/]/.test(trimmed) && /\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  // 裸路径：单词或连续中文，不带空格、不带引号
  if (/\s/.test(trimmed)) return false;
  if (/^[A-Za-z0-9_.\u4e00-\u9fa5-]+\.[A-Za-z0-9]{1,5}$/.test(trimmed)) return true;
  return false;
}

/** 从 assistant markdown 中抽出可疑文件路径（围栏代码块外；同路径去重） */
function extractFilePathsFromMarkdown(text: string): { path: string; prefix: string }[] {
  const seen = new Set<string>();
  const out: { path: string; prefix: string }[] = [];
  const push = (raw: string, prefix: string) => {
    const trimmed = raw.replace(/^[`"'\s]+|[`"'\s]+$/g, "").replace(/[\\/]+$/, "");
    if (!looksLikeFilePath(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ path: trimmed, prefix });
  };
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    if (part == null) break;
    for (const line of part.split(/\r?\n/)) {
      // 1) 路径 / Path / 文件 / 位置 关键字前缀（行级，整行就是「keyword: path」）
      const kw = line.match(/^[ \t]*(?:路径|Path|路径名|文件|位置|File|path)[:：][ \t]*(.+?)[ \t]*$/i);
      if (kw) {
        push(kw[1], kw[1].replace(/\s+/g, " ").trim());
        continue;
      }
      // 2) 反引号包裹：本行所有反引号块都收；整行就是单个反引号路径时才把整行也算上
      const bt = line.match(/`([^`\n]+)`/g);
      if (bt) {
        for (const piece of bt) push(piece.slice(1, -1), piece);
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("`") && trimmedLine.endsWith("`") && bt.length === 1) {
          push(trimmedLine.slice(1, -1), trimmedLine);
        }
        continue;
      }
      // 3) 全行就是 Windows 绝对路径（含盘符）；Chinese 字符非 word-boundary，直接定位
      const abs = line.match(/([A-Za-z]:[\\/][^\s<>:"|?*\n]+\.[A-Za-z0-9]{1,5})/);
      if (abs) {
        push(abs[1], abs[1]);
        continue;
      }
      // 4) 任意裸文件路径（含扩展名的 token），可在一行里出现多次
      const bareMatches = line.match(/([^\s<>:"|?*()<>\[\]{}]+\.[A-Za-z0-9]{1,5})/g);
      if (bareMatches) {
        for (const m of bareMatches) push(m, m);
      }
    }
  }
  return out;
}

function InlineFileCards({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const matches = useMemo(() => extractFilePathsFromMarkdown(text), [text]);
  const [resolvedPaths, setResolvedPaths] = useState<Record<string, string>>({});
  // 探测两步走（全程只 stat，不扫磁盘）：① 按解析路径直查；② 裸文件名查会话路径台账
  // （工具调用等消息项里出现过的真实路径）。都找不到才灰显，点击只弹提示、不再炸读取错误。
  useEffect(() => {
    let cancelled = false;
    setResolvedPaths({});
    for (const m of matches) {
      const abs = resolveFilePath?.(m.path) ?? m.path;
      window.codex.fileExists(abs)
        .then(async (r) => {
          if (cancelled) return;
          if (r?.exists) {
            setResolvedPaths((prev) => ({ ...prev, [m.path]: abs }));
            return;
          }
          const known = lookupKnownFile?.(m.path) ?? null;
          if (cancelled) return;
          if (!known) return;
          try {
            const check = await window.codex.fileExists(known);
            if (cancelled) return;
            if (check?.exists) setResolvedPaths((prev) => ({ ...prev, [m.path]: known }));
          } catch { /* 无真实文件就不渲染卡片 */ }
        })
        .catch(() => { /* 探测失败不渲染，避免制造点不开的假卡片 */ });
    }
    return () => { cancelled = true; };
  }, [matches]);
  const confirmed = matches.filter((match) => Boolean(resolvedPaths[match.path]));
  if (confirmed.length === 0) return null;
  return (
    <div className="inline-file-cards" aria-label="涉及到的文件">
      {confirmed.map((m, index) => {
        const name = basename(m.path) || m.path;
        const openPath = resolvedPaths[m.path];
        return (
          <button
            type="button"
            className="inline-file-card"
            key={`${m.path}-${index}`}
            title={isImagePath(openPath) ? `点击预览：${openPath}` : `点击打开：${openPath}`}
            onClick={() => {
              if (isImagePath(openPath)) openImageLightbox?.(openPath, name);
              else onOpenFile?.(openPath);
            }}
          >
            {isImagePath(m.path) ? (
              <span className="inline-file-thumb">
                <img src={imageUrl(resolveFilePath?.(openPath) ?? openPath)} alt="" loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} />
              </span>
            ) : <FileText size={14} />}
            <span className="inline-file-name">{name}</span>
            {openPath !== name && <span className="inline-file-path">{openPath}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 用户消息引用行：文件卡片 / 技能胶囊 / 上下文引用卡 */
function UserRefsRow({ refs, onOpenFile, onQuote, extraThumbs, hideFiles }: { refs: ParsedUserRefs; onOpenFile?: (path: string) => void; onQuote?: (text: string) => void; extraThumbs?: ReactNode; hideFiles?: boolean }) {
  const { files, skills, contexts } = refs;
  const visibleFiles = hideFiles ? [] : files;
  if (!visibleFiles.length && !skills.length && !contexts.length && !extraThumbs) return null;
  return (
    <div className="msg-refs">
      {visibleFiles.map((path, index) => {
        const name = basename(path) || path;
        if (isImagePath(path)) {
          const src = path.startsWith("http") ? path : imageUrl(path);
          return (
            <button type="button" className="ref-file-card ref-image-card" title={name} onClick={() => openImageLightbox?.(path, name)} key={index}>
              <span className="ref-image-thumb">
                <img src={src} alt={name} loading="lazy" />
                <span className="ref-image-preview"><img src={src} alt={name} /></span>
              </span>
            </button>
          );
        }
        return (
          <button type="button" className="ref-file-card" title={name} onClick={() => onOpenFile?.(path)} key={index}>
            <FileText size={14} />
            <span className="ref-file-name">{name}</span>
          </button>
        );
      })}
      {skills.map((skill, index) => (
        <span className="ref-skill-chip" title={skill.description || skill.name} key={index}><Zap size={12} /><span>{skill.name}</span></span>
      ))}
      {contexts.map((ctx, index) => (
        <button type="button" className="ref-context-card" title="点击引用" onClick={() => onQuote?.(`${ctx.role}：${ctx.text}`)} key={index}>
          <Quote size={13} />
          <span className="ref-context-role">{ctx.role}</span>
          <span className="ref-context-text">{ctx.text}</span>
        </button>
      ))}
      {extraThumbs}
    </div>
  );
}

/** 排队消息列表：位于输入框上方，长条布局，新消息往上叠加（最新的在最顶部、紧贴输入框）。
 *  含 2 条及以上时提供折叠/展开开关（默认展开，由用户手动折叠）；拖动排序由每条左侧手柄支持。 */
function QueuedMessageList({ entries, onOpenFile, onQuote, onDelete, onStart, onSave, onReorder, dragIndex, setDragIndex }: {
  entries: QueueItem[];
  onOpenFile: (path: string) => void;
  onQuote: (text: string) => void;
  onDelete: (id: string) => void;
  onStart: (id?: string) => void;
  onSave: (entry: QueueItem, text: string) => void;
  onReorder: (from: number, to: number) => void;
  dragIndex: number | null;
  setDragIndex: (index: number | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!entries.length) return null;
  // 新消息往上叠加：渲染倒序（数组末尾的最新消息显示在最顶部）。拖拽 index 是显示序，需镜像回原数组序。
  const reversed = [...entries].reverse();
  const n = entries.length;
  const mapIndex = (displayIndex: number) => n - 1 - displayIndex;
  return (
    <div className={`queued-messages ${collapsed ? "is-collapsed" : ""}`}>
      {n >= 2 && (
        <button type="button" className="queued-collapse-toggle" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "展开排队消息" : "折叠排队消息"}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span className="queued-collapse-label">排队消息</span>
          <span className="queued-collapse-count">{n}</span>
          <span className="queued-collapse-hint">{collapsed ? "展开" : "折叠"}</span>
        </button>
      )}
      {!collapsed && reversed.map((entry, displayIndex) => <QueuedMessageItem key={entry.id} entry={entry} index={displayIndex} total={entries.length} onOpenFile={onOpenFile} onQuote={onQuote} onDelete={onDelete} onStart={onStart} onSave={onSave} onReorder={(from, to) => onReorder(mapIndex(from), mapIndex(to))} dragIndex={dragIndex} setDragIndex={setDragIndex} />)}
    </div>
  );
}

function QueuedMessageItem({ entry, index, total, onOpenFile, onQuote, onDelete, onStart, onSave, onReorder, dragIndex, setDragIndex }: {
  entry: QueueItem; index: number; total: number;
  onOpenFile: (path: string) => void; onQuote: (text: string) => void;
  onDelete: (id: string) => void; onStart: (id?: string) => void; onSave: (entry: QueueItem, text: string) => void;
  onReorder: (from: number, to: number) => void; dragIndex: number | null; setDragIndex: (index: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => inputText(entry.input));
  const rawText = inputText(entry.input);
  const refs = useMemo<ParsedUserRefs>(() => parseUserRefs(rawText), [rawText]);
  const images = (entry.input ?? []).filter(isImagePart);
  const saving = () => { setEditing(false); onSave(entry, draft); };
  if (editing) {
    return (
      <div className="queued-message queued-message-editing" data-queued-id={entry.id}>
        <textarea value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saving(); }} placeholder="编辑排队消息内容" />
        <div className="queued-edit-actions">
          <button className="ghost" onClick={() => setEditing(false)}>取消</button>
          <button disabled={!draft.trim() && !images.length} onClick={saving}>保存</button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`queued-message ${dragIndex === index ? "dragging" : ""}`}
      data-queued-id={entry.id}
      draggable
      onDragStart={() => setDragIndex(index)}
      onDragOver={(event) => { event.preventDefault(); if (dragIndex != null && dragIndex !== index) { onReorder(dragIndex, index); setDragIndex(index); } }}
      onDragEnd={() => setDragIndex(null)}
      title={total > 1 ? "拖动可调整排队顺序" : undefined}
    >
      <span className="queued-grip" aria-hidden="true"><GripVertical size={14} /></span>
      <div className="queued-main">
        <span className="queued-badge"><Clock3 size={11} />排队中{total > 1 ? ` ${index + 1}/${total}` : ""}</span>
        <UserRefsRow refs={refs} onOpenFile={onOpenFile} onQuote={onQuote} />
        {refs.threadReferences.map((reference) => <ImportedRecordCard key={reference.id} note={reference.note} content={reference.content} kind="thread" />)}
        {refs.cleanText && <span className="queued-text">{refs.cleanText}</span>}
        {images.map((part: any, idx: number) => <span className="queued-image-chip" key={idx}><Image size={13} />{part.path}</span>)}
      </div>
      <div className="queued-actions">
        <button className="queued-action" title="立即注入思路（不打断当前任务）" onClick={() => onStart(entry.id)}><ArrowUp size={13} />立即</button>
        <button className="queued-action" title="编辑排队消息" onClick={() => { setDraft(inputText(entry.input)); setEditing(true); }}><PenLine size={13} />编辑</button>
        <button className="queued-action danger" title="删除排队消息" onClick={() => onDelete(entry.id)}><Trash2 size={13} />删除</button>
      </div>
    </div>
  );
}

const reasoningStart = new Map<string, number>();
const reasoningDuration = new Map<string, number>();
// 某些中转不转发 agentMessage delta，只在 completed 时一次性交付全文。
// 记录这种"从短文本突然跳到全文"的 item，渲染层用快速增量揭示兜底。
const bufferedAgentRevealStarts = new Map<string, string>();
// reasoning 同理：完成快照一次性交付思考全文时，渐进揭示避免"瞬间冒出来"
const bufferedReasoningRevealStarts = new Map<string, string>();
// 命令/动态工具/文件编辑内容在 completed 快照里整包交付时，也从旧内容继续追字。
const bufferedToolRevealStarts = new Map<string, string>();

/** reasoning 的展示文本：summary + content 数组（兼容字符串与对象两种形态）拼成一段 */
function reasoningTextOf(item: ThreadItem): string {
  const norm = (arr: unknown): string[] => (Array.isArray(arr) ? arr : []).map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (entry && typeof entry === "object") {
      const t = (entry as any).text ?? (entry as any).content;
      if (typeof t === "string") return t.trim();
    }
    return "";
  }).filter(Boolean);
  return [...norm(item.summary), ...norm(item.content)].join("\n\n");
}

// 流式 delta 事件（高频，需要合帧）；item/completed 等结构性事件走即时路径
const deltaMethods = new Set(["item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded", "item/reasoning/textDelta", "item/commandExecution/outputDelta"]);
const isDeltaMethod = (method: string) => deltaMethods.has(method);

function loadThreadPermissions(id: string): { sandbox?: string; approval?: string } {
  try { return JSON.parse(localStorage.getItem("thread-permissions-" + id) ?? "{}"); } catch { return {}; }
}
function saveThreadPermissions(id: string, sandbox: string, approval: string) {
  localStorage.setItem("thread-permissions-" + id, JSON.stringify({ sandbox, approval }));
}

function loadThreadModel(id: string): string {
  try { return localStorage.getItem("thread-model-" + id) ?? ""; } catch { return ""; }
}

function saveThreadModel(id: string, modelId: string) {
  if (!id || !modelId) return;
  try { localStorage.setItem("thread-model-" + id, modelId); } catch { /* ignore */ }
}

/** 每会话独立的思考等级：切会话互不串扰（对齐 thread-model 的按会话存储模式）。 */
function loadThreadEffort(id: string): string {
  try { return localStorage.getItem("thread-effort-" + id) ?? ""; } catch { return ""; }
}

function saveThreadEffort(id: string, effort: string) {
  if (!id || !effort) return;
  try { localStorage.setItem("thread-effort-" + id, effort); } catch { /* ignore */ }
}

function sandboxPolicy(mode: string, cwd: string) {
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  if (mode === "read-only") return { type: "readOnly", networkAccess: false };
  // 默认自主模式：仅在当前项目根目录可写，允许常规构建/测试/依赖查询联网。
  // 工作区外访问仍由 Codex 沙箱与审批策略保护。
  return { type: "workspaceWrite", writableRoots: cwd ? [cwd] : [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

function sandboxMode(policy: any): "danger-full-access" | "read-only" | "workspace-write" | null {
  if (!policy?.type) return null;
  if (policy.type === "dangerFullAccess") return "danger-full-access";
  if (policy.type === "readOnly") return "read-only";
  if (policy.type === "workspaceWrite") return "workspace-write";
  return null;
}

function mergeItem(thread: Thread | null, turnId: string, item: ThreadItem) {
  if (!thread) return thread;
  return {
    ...thread,
    turns: thread.turns.map((turn) =>
      turn.id !== turnId
        ? turn
        : { ...turn, items: turn.items.some((entry) => entry.id === item.id) ? turn.items.map((entry) => (entry.id === item.id ? stableItem(entry, item) : entry)) : [...turn.items, item] },
    ),
  };
}

// 缓存 thread 与 resume 结果是否有实质内容变化：turns 数 / 最后一条 turn / updatedAt 任一不同即变化。
// 秒开路径据此决定是否替换渲染（无变化不替换，避免闪烁）。
function threadContentChanged(a: Thread | null, b: Thread | null): boolean {
  if (!a || !b) return true;
  if (a.turns.length !== b.turns.length) return true;
  const lastA = a.turns[a.turns.length - 1]?.id;
  const lastB = b.turns[b.turns.length - 1]?.id;
  if (lastA !== lastB) return true;
  return a.updatedAt !== b.updatedAt;
}

/** 运行中会话切回时的 resume 合并：快照可能落后于本地流式积累（切走期间 delta 仍在更新内存）。
 *  逐 item 取文本更长的一方（agentMessage 正文 / reasoning 摘要与内容），避免正文回退后
 *  delta 从快照点重新追加 = 已渲染内容「重新走一遍出字动画」（09-08 反馈）。 */
function mergeLongerStreams(cached: Thread, loaded: Thread): Thread {
  return {
    ...loaded,
    turns: loaded.turns.map((turn) => {
      const oldTurn = cached.turns.find((entry) => entry.id === turn.id);
      if (!oldTurn) return turn;
      return {
        ...turn,
        items: turn.items.map((item) => {
          const prev = oldTurn.items.find((entry) => entry.id === item.id);
          if (!prev) return item;
          if (item.type === "agentMessage" && typeof item.text === "string" && typeof prev.text === "string" && prev.text.length > item.text.length) {
            return { ...item, text: prev.text };
          }
          if (item.type === "reasoning") {
            const longer = (arr: any[] | undefined, cur: any[] | undefined) => (Array.isArray(arr) && (cur?.length ?? 0) < arr.length ? arr : cur);
            const summary = longer(prev.summary as any[], item.summary as any[]);
            const content = longer(prev.content as any[], item.content as any[]);
            if (summary !== item.summary || content !== item.content) return { ...item, summary, content };
          }
          return item;
        }),
      };
    }),
  };
}

function mergeTurn(thread: Thread | null, nextTurn: Turn) {
  if (!thread) return thread;
  const current = thread.turns.find((turn) => turn.id === nextTurn.id);
  const items = current ? [...current.items] : [];
  for (const item of nextTurn.items) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) { items.push(item); continue; }
    // 引用保持：内容没变的 item 沿用旧引用，memo 才能跳过未变化消息；
    // turn/completed 整回合替换时不再引发全树重渲染（闪烁根源）
    items[index] = stableItem(items[index], item);
  }
  // 保留回合级 usage（引擎在 turn/completed 时附带，旧消息也能展示 token / 缓存）
  const turn = current ? { ...current, ...nextTurn, items, usage: nextTurn.usage ?? current.usage } : nextTurn;
  return { ...thread, turns: current ? thread.turns.map((entry) => entry.id === turn.id ? turn : entry) : [...thread.turns, turn] };
}

function markBufferedAgentReveal(thread: Thread | null, turnId: string, item: ThreadItem) {
  // reasoning 完成快照一次性交付思考全文：同样标记起点，渲染层渐进揭示
  if (item.type === "reasoning") {
    const nextText = reasoningTextOf(item);
    if (nextText.length < 40) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = reasoningTextOf(current as ThreadItem);
    const jump = nextText.length - currentText.length;
    if (jump >= 40 && nextText.startsWith(currentText)) bufferedReasoningRevealStarts.set(item.id, currentText);
    return;
  }
  if (item.type === "commandExecution") {
    const nextText = truncateTailLines(String(item.aggregatedOutput ?? "").trim(), 500).text;
    if (nextText.length < 48) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = truncateTailLines(String(current?.aggregatedOutput ?? "").trim(), 500).text;
    if (nextText.length - currentText.length >= 48) bufferedToolRevealStarts.set(String(item.id), nextText.startsWith(currentText) ? currentText : "");
    return;
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const payload = (entry: ThreadItem | undefined) => String(entry?.progress || JSON.stringify(entry?.result ?? entry?.arguments ?? entry?.contentItems, null, 2) || "");
    const nextText = payload(item);
    if (nextText.length < 48) return;
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    const currentText = payload(current);
    if (nextText.length - currentText.length >= 48) bufferedToolRevealStarts.set(`${item.id}-payload`, nextText.startsWith(currentText) ? currentText : "");
    return;
  }
  if (item.type === "fileChange") {
    const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
    for (const [index, change] of (item.changes ?? []).entries()) {
      const nextText = String(change?.diff ?? "");
      const currentText = String(current?.changes?.[index]?.diff ?? "");
      if (nextText.length >= 48 && nextText.length - currentText.length >= 48) {
        bufferedToolRevealStarts.set(`${item.id}-diff-${index}`, nextText.startsWith(currentText) ? currentText : "");
      }
    }
    return;
  }
  if (item.type !== "agentMessage") return;
  const nextText = String(item.text ?? "");
  if (nextText.length < 40) return;
  const current = thread?.turns.find((turn) => turn.id === turnId)?.items.find((entry) => entry.id === item.id);
  const currentText = String(current?.text ?? "");
  const jump = nextText.length - currentText.length;
  if (jump >= 40 && nextText.startsWith(currentText)) bufferedAgentRevealStarts.set(item.id, currentText);
}

function markBufferedTurnReveal(thread: Thread | null, turn: Turn) {
  for (const item of turn.items ?? []) markBufferedAgentReveal(thread, turn.id, item);
}

/** 服务端快照 vs 本地流式状态：所有字段深比较等值则保留旧引用（memo 命中） */
function stableItem(existing: ThreadItem, next: ThreadItem): ThreadItem {
  // 服务端快照缺 summary/content/text（reasoning/agentMessage 完成事件经常只回 id+status），
  // 直接用 next 会把本地流式积累的内容清空——思考卡“完成后消失”的根源。缺字段时本地优先。
  // 另：服务端完成快照的 summary/content 是对象数组 [{type:"summary_text",text}]，本地流式存的是
  // 字符串数组 ["..."]，结构不同不该覆盖本地（否则思考内容会变成 "[object Object]"）。
  const sparse = (next.type === "reasoning" || next.type === "agentMessage") && next.summary == null && next.content == null && next.text == null;
  const serverObjectArray = (next.type === "reasoning") && Array.isArray(next.summary) && next.summary.some((entry: any) => entry && typeof entry === "object");
  if (sparse || serverObjectArray) return { ...next, summary: existing.summary ?? next.summary, content: existing.content ?? next.content, text: existing.text ?? next.text };
  // turn/started、item/completed、turn/completed 都可能返回同 ID 但 content 为空的 userMessage。
  // 空快照只能更新状态，绝不能抹掉已经落地的用户正文。
  if (next.type === "userMessage" && itemText(existing).trim() && !itemText(next).trim()) {
    return { ...next, content: existing.content };
  }
  // agentMessage 文本回退保护：切换回运行中会话时，引擎 resume 会重放 item/started 等
  // 快照事件，其 text 为空或短于本地流式积累的内容——用快照覆盖会让已渲染的正文被清短，
  // 随后 delta 从头继续追加 = 整段正文「重新走一遍出字动画」（09-08 反馈）。
  // 快照文本是本地文本的前缀（或等长）时保留本地长文本；本地为空/快照是新内容时正常采用。
  if (next.type === "agentMessage" && typeof next.text === "string" && typeof existing.text === "string" && existing.text.length > 0) {
    if (next.text.length <= existing.text.length && existing.text.startsWith(next.text)) {
      return { ...next, text: existing.text };
    }
  }
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  for (const key of keys) {
    if (JSON.stringify((existing as any)[key]) !== JSON.stringify((next as any)[key])) return next;
  }
  return existing;
}

/** turn/start 的同步响应有时包含空 userMessage；用本次真实 input 补齐后再进入本地状态。 */
function hydrateTurnUserMessage(turn: Turn, input: any[]): Turn {
  let hydrated = false;
  const items = turn.items.map((item) => {
    if (item.type !== "userMessage" || itemText(item).trim()) return item;
    hydrated = true;
    return { ...item, content: input };
  });
  return hydrated ? { ...turn, items } : turn;
}

function appendDelta(thread: Thread | null, turnId: string, itemId: string, type: string, field: string, delta: string) {
  if (!thread) return thread;
  const turn = thread.turns.find((entry) => entry.id === turnId);
  const current = turn?.items.find((entry) => entry.id === itemId) ?? { id: itemId, type };
  return mergeItem(thread, turnId, { ...current, [field]: `${current[field] ?? ""}${delta}` });
}

function appendIndexedDelta(thread: Thread | null, turnId: string, itemId: string, field: "summary" | "content", index: number, delta: string) {
  if (!thread) return thread;
  const turn = thread.turns.find((entry) => entry.id === turnId);
  const current = turn?.items.find((entry) => entry.id === itemId) ?? { id: itemId, type: "reasoning", summary: [], content: [] };
  const parts = [...(current[field] ?? [])];
  parts[index] = `${parts[index] ?? ""}${delta}`;
  // 深度思考很长时引擎可能在思考真正结束前就推 item/completed（实测：codex_core
  // 报 "ReasoningSummaryDelta without active item" / "OutputTextDelta without active item"，
  // 即提前完结的 item 仍持续收到后续 delta）。若此刻仍收到 reasoning 增量，说明思考还没完：
  // 清掉过早落下的 duration / 恢复 running，否则 reasoningActive 判定会断 → 运行状态
  // 莫名中断但内容还在涨（用户实测连续两次：深度思考很久后运行状态断了）。
  const merged = mergeItem(thread, turnId, { ...current, [field]: parts });
  const fresh = merged?.turns.find((entry) => entry.id === turnId)?.items.find((entry) => entry.id === itemId);
  if (fresh && fresh.type === "reasoning") {
    if (fresh.status !== "inProgress" && fresh.status !== "running") {
      reasoningDuration.delete(itemId);
      if (!reasoningStart.has(itemId)) reasoningStart.set(itemId, Date.now());
      return mergeItem(merged!, turnId, { ...fresh, status: "inProgress", durationMs: undefined });
    }
    if (reasoningDuration.has(itemId)) reasoningDuration.delete(itemId);
  }
  return merged!;
}

const threadStreamMethods = new Set([
  "turn/started", "turn/completed", "item/started", "item/completed",
  "item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded", "item/reasoning/textDelta",
  "item/commandExecution/outputDelta", "item/plan/delta", "turn/plan/updated",
  "item/fileChange/patchUpdated", "item/mcpToolCall/progress", "item/commandExecution/terminalInteraction",
  "thread/name/updated", "thread/status/changed",
]);

function applyThreadEvent(thread: Thread | null, method: string, params: any): Thread | null {
  switch (method) {
    case "turn/started":
      return mergeTurn(thread, params.turn);
    case "turn/completed":
      markBufferedTurnReveal(thread, params.turn);
      return mergeTurn(thread, params.turn);
    case "item/started":
      return mergeItem(thread, params.turnId, params.item);
    case "item/completed":
      markBufferedAgentReveal(thread, params.turnId, params.item);
      return mergeItem(thread, params.turnId, params.item);
    case "item/agentMessage/delta":
      return appendDelta(thread, params.turnId, params.itemId, "agentMessage", "text", params.delta);
    case "item/reasoning/summaryTextDelta":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "summary", params.summaryIndex ?? 0, params.delta ?? params.text ?? "");
    case "item/reasoning/summaryPartAdded":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "summary", params.summaryIndex ?? params.index ?? 0, params.part?.text ?? params.text ?? params.delta ?? "");
    case "item/reasoning/textDelta":
      return appendIndexedDelta(thread, params.turnId, params.itemId, "content", params.contentIndex ?? 0, params.delta ?? params.text ?? "");
    case "item/commandExecution/outputDelta":
      return appendDelta(thread, params.turnId, params.itemId, "commandExecution", "aggregatedOutput", params.delta);
    case "item/plan/delta":
      return appendDelta(thread, params.turnId, params.itemId, "plan", "text", params.delta);
    case "turn/plan/updated": {
      const text = `${params.explanation ? `${params.explanation}\n\n` : ""}${(params.plan ?? []).map((step: any) => `- [${step.status === "completed" ? "x" : " "}] ${step.step}`).join("\n")}`;
      return mergeItem(thread, params.turnId, { id: `plan-${params.turnId}`, type: "plan", text });
    }
    case "item/fileChange/patchUpdated": {
      const turn = thread?.turns.find((entry) => entry.id === params.turnId);
      const item = turn?.items.find((entry) => entry.id === params.itemId) ?? { id: params.itemId, type: "fileChange", status: "inProgress" };
      return mergeItem(thread, params.turnId, { ...item, changes: params.changes });
    }
    case "item/mcpToolCall/progress":
      return appendDelta(thread, params.turnId, params.itemId, "mcpToolCall", "progress", `${params.message}\n`);
    case "item/commandExecution/terminalInteraction":
      return appendDelta(thread, params.turnId, params.itemId, "commandExecution", "terminalInput", params.stdin);
    case "thread/name/updated":
      return thread ? { ...thread, name: params.threadName ?? null } : thread;
    case "thread/status/changed":
      return thread && thread.id === params.threadId ? { ...thread, status: params.status } : thread;
    default:
      return thread;
  }
}

/** WorkBuddy 式内联图片 chip：解析 prompt 里的 [图片:path] 占位符，渲染成可悬停/可删除的胶囊。
 *  hover → 浮动预览（预加载完成才显示，避免闪烁）；hover 时图标位变 X（visibility 交换）；
 *  点击 → 全屏 lightbox。纯展示组件，删除/预览通过回调上抛。 */
/** 对话中的文件引用面板（WorkBuddy 式）：候选文件列表由调用方收集传入，
 *  这里负责搜索框、过滤与空态展示。点选后回调 onPick 加入 files 附件。 */
function ThreadFilePicker({ query, onQuery, candidates, onPick, onClose }: { query: string; onQuery: (value: string) => void; candidates: { path: string; source: string }[]; onPick: (path: string) => void; onClose: () => void }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    return candidates.filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return !q || entry.path.toLowerCase().includes(q) || basename(entry.path).toLowerCase().includes(q);
    }).slice(0, 30);
  }, [candidates, query]);
  return (
    <>
      <div className="submenu-search"><Search size={13} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索对话中的文件" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} /></div>
      <div className="submenu-list">
        {filtered.map((entry) => (
          <button type="button" key={entry.path} title={entry.path} onClick={() => onPick(entry.path)}>
            {isImagePath(entry.path) ? <Image size={14} /> : <FileCode2 size={14} />}
            <span className="thread-file-name">{basename(entry.path)}</span>
            <small>{entry.source}</small>
          </button>
        ))}
        {!filtered.length && <p className="submenu-empty">{query.trim() ? "没有匹配的文件" : "当前会话还没有出现过文件"}</p>}
      </div>
    </>
  );
}

/** WorkBuddy 式输入框（contentEditable）：文本与图片 chip 真正内联在文字流里，
 *  chip 粘贴/插入在光标处，退格可整体删除。prompt 仍以 [图片:路径] 占位符为数据源
 *  （prompt-images.ts 管线与发送组装零改动），DOM 只是它的可编辑视图。
 *  非受控：仅当外部 value 与 DOM 序列化结果不一致（发送清空/切会话/增强/斜杠命令）
 *  才重建 DOM；用户输入只做 DOM→prompt 序列化回流，绝不反向覆盖正在编辑的 DOM。 */
function ComposerEditor({ value, placeholder, editorRef, domValueRef, makeChip, onValueInput, onKeyDown, onBlur, onPasteImage, onPasteFiles }: {
  value: string;
  placeholder: string;
  editorRef: { current: HTMLDivElement | null };
  domValueRef: { current: string | null };
  makeChip: (path: string) => HTMLElement;
  onValueInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  onPasteImage: (text: string) => void;
  onPasteFiles: (paths: string[]) => void;
}) {
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || domValueRef.current === value) return;
    rebuildComposerDom(el, value, makeChip);
    domValueRef.current = value;
    // 重建后光标放回末尾（外部置值场景：斜杠命令追加、发送清空等）
    const selection = window.getSelection();
    if (selection && document.activeElement === el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [value, editorRef, domValueRef, makeChip]);
  return (
    <div
      ref={editorRef}
      className="composer-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={(event) => {
        const el = event.currentTarget;
        let next = serializeComposerDom(el);
        // 全删后可能残留孤立 <br>：清成真正 empty，让 :empty 占位符与发送守卫都成立
        if (!next.trim() && !promptImagePaths(next).length) { el.innerHTML = ""; next = ""; }
        domValueRef.current = next;
        onValueInput(next);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPaste={(event) => {
        const pasted = [...event.clipboardData.files];
        const imageFile = pasted.find((file) => file.type.startsWith("image/"));
        // 从系统复制的非图片文件（PDF/代码/文档等）：作为附件加入输入框。
        // Electron 渲染层 File 对象带 path（原生扩展），可直接作为附件路径。
        const filePaths = pasted
          .filter((file) => !file.type.startsWith("image/"))
          .map((file) => (file as File & { path?: string }).path)
          .filter((p): p is string => typeof p === "string" && p.length > 0);
        // Windows 上从资源管理器复制文件时 clipboardData.files 常为空（系统剪贴板是
        // CF_HDROP，浏览器不转成 File 列表）——可靠通道是 text/uri-list（file:/// 列表）。
        const uriList = event.clipboardData.getData("text/uri-list");
        const uriPaths: string[] = [];
        if (uriList) {
          for (const raw of uriList.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            try {
              const url = new URL(line);
              if (url.protocol === "file:") {
                // file:///C:/foo bar.txt → C:\foo bar.txt
                uriPaths.push(decodeURIComponent(line.slice("file://".length)).replace(/\//g, "\\").replace(/^\\/, ""));
              }
            } catch { /* 非 URL 行（如注释）跳过 */ }
          }
        }
        const allFilePaths = [...new Set([...filePaths, ...uriPaths])];
        if (allFilePaths.length) {
          event.preventDefault();
          onPasteFiles(allFilePaths);
        } else if (imageFile) {
          event.preventDefault();
          onPasteImage(event.clipboardData.getData("text/plain"));
        } else {
          // 渲染层 files/uri-list 都拿不到：剪贴板可能是文件（Windows CF_HDROP 渲染层不暴露）
          // 也可能是纯文本。先阻止原生，主进程 clipboard.read() 兜底判断文件；
          // 若确认无文件再手动插入纯文本（保持光标位置），保证纯文本粘贴不失效。
          event.preventDefault();
          const plain = event.clipboardData.getData("text/plain");
          void window.codex.readClipboardFiles().then((paths) => {
            if (paths.length) { onPasteFiles(paths); return; }
            if (plain) {
              try { document.execCommand("insertText", false, plain); } catch { /* ignore */ }
              const el = editorRef.current;
              if (el) {
                const next = serializeComposerDom(el);
                if (next !== domValueRef.current) {
                  domValueRef.current = next;
                  onValueInput(next);
                }
              }
            }
          });
        }
      }}
    />
  );
}

/** 序列化输入框 DOM 为 prompt 字符串：文本节点原样、图片 chip 还原为占位符、
 *  BR/块级边界还原为换行。与 rebuildComposerDom 近似互逆（经 splitPromptSegments）。 */
function serializeComposerDom(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ""; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const imagePath = el.getAttribute("data-image-path");
    if (imagePath != null) { out += imageToken(imagePath); return; }
    if (el.tagName === "BR") { out += "\n"; return; }
    for (const child of Array.from(el.childNodes)) walk(child);
    if (el.tagName === "DIV" || el.tagName === "P") out += "\n";
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return out.replace(/\n$/, "");
}

/** 从占位符字符串重建输入框 DOM：文本段按行拆 <br>，图片段生成内联 chip。 */
function rebuildComposerDom(root: HTMLElement, value: string, makeChip: (path: string) => HTMLElement) {
  root.textContent = "";
  for (const seg of splitPromptSegments(value)) {
    if (seg.kind === "image") { root.appendChild(makeChip(seg.path)); continue; }
    seg.text.split("\n").forEach((line, index) => {
      if (index > 0) root.appendChild(document.createElement("br"));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
}

const COMPOSER_CHIP_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

/** 生成内联图片 chip（contenteditable=false）：点主体预览，点 X 删除。
 *  全部原生 DOM：输入框 DOM 由用户编辑与重建函数共同维护，不经 React 渲染。 */
function createInlineImageChip(path: string, onRemove: (path: string) => void, onPreview: (path: string) => void, onChange: () => void): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "composer-image-chip-inline";
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-image-path", path);
  chip.innerHTML = `<span class="composer-image-chip-icon">${COMPOSER_CHIP_ICON}</span><span class="composer-image-chip-name"></span><button type="button" class="composer-image-chip-close" title="移除图片">×</button>`;
  chip.querySelector(".composer-image-chip-name")!.textContent = basename(path);
  // 阻止 mousedown 默认行为：点 chip 不丢编辑光标
  chip.addEventListener("mousedown", (event) => event.preventDefault());
  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if ((event.target as HTMLElement).closest(".composer-image-chip-close")) {
      chip.remove();
      onRemove(path);
      onChange();
      return;
    }
    onPreview(path);
  });
  return chip;
}

function ComposerMenu({ icon, label, options, value, onChange, disabled, title, width, tone, toneOf }: { icon: any; label: string; options: { value: string; title: string; desc?: string }[]; value: string; onChange: (value: string) => void; disabled?: boolean; title?: string; width?: number; tone?: "danger"; toneOf?: (option: { value: string; title: string; desc?: string }) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find((option) => option.value === value);
  const Icon = icon;
  return (
    <div className={`composer-menu ${open ? "open" : ""}`} ref={wrapRef}>
      <button type="button" className={`composer-setting ${tone === "danger" ? "danger" : ""}`} disabled={disabled} title={title ?? label} onClick={() => setOpen((currentOpen) => !currentOpen)}>
        <Icon size={14} />
        <span>{current?.title ?? label}</span>
        <ChevronDown size={12} className={`menu-caret ${open ? "up" : ""}`} />
      </button>
      {open && (
        <div className="composer-menu-pop" role="listbox" aria-label={label} style={width ? { width } : undefined}>
          {options.map((option) => {
            const itemTone = toneOf?.(option);
            return (
              <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={option.value === value ? "active" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
                <span className={`menu-item-icon${itemTone ? ` tone-dot tone-${itemTone}` : ""}`}>{option.value === value ? <CircleCheck size={15} /> : null}</span>
                <span className="menu-item-text"><strong>{option.title}</strong>{option.desc && option.desc !== option.title ? <small>{option.desc}</small> : null}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const approvalMenuOptions = (fullAccess: boolean) => fullAccess ? [
  { value: "on-request", title: "变更前确认", desc: "改文件前先问我。" },
  { value: "untrusted", title: "自动编辑", desc: "自动编辑文件。" },
  { value: "never", title: "完全访问", desc: "减少确认次数。" },
] : [
  { value: "on-request", title: "变更前确认", desc: "改文件前先问我。" },
  { value: "untrusted", title: "自动编辑", desc: "自动编辑文件。" },
  { value: "never", title: "完全访问", desc: "减少确认次数。" },
];

// SkillHub showcase 四榜单（对应 skills:market-list 的 section 映射）
const skillHubCategories = ["总排行", "近期最热", "最新上传", "官方精选"];
// SkillHub category 分类（英文 key → 中文标签），技能市场按分类过滤
const skillHubCategoryTabs: [string, string][] = [
  ["全部", ""], ["AI 智能体", "ai-agent"], ["办公效率", "office-efficiency"], ["知识管理", "knowledge-management"],
  ["数据分析", "data-analysis"], ["内容创作", "content-creation"], ["专业技能", "professional"], ["生活服务", "life-service"],
  ["设计与媒体", "design-media"], ["IT 运维与安全", "it-ops-security"], ["开发编程", "dev-programming"],
];
const skillHubCategoryName = (key: string) => skillHubCategoryTabs.find(([, value]) => value === key)?.[0] ?? key;

/** GitHub raw logo → jsDelivr CDN 镜像（raw.githubusercontent.com 在国内不可达，渲染层图片走镜像）；
 *  非 raw 地址原样返回；镜像再失败由 <img onError> 兜底首字母。 */
function toCdnLogo(url: string): string {
  if (!/^https?:\/\/raw\.githubusercontent\.com\//i.test(url)) return url;
  const rest = url.replace(/^https?:\/\/raw\.githubusercontent\.com\//i, "");
  // rest = owner/repo/ref/path...
  const parts = rest.split("/");
  if (parts.length < 4) return url;
  const [owner, repo, ref, ...path] = parts;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path.join("/")}`;
}

/** 市场卡片图标：字母兜底在底 + 图片盖上去。原地址优先（本机 raw 直连往往可达），
 *  加载失败再切 jsDelivr 镜像（部分网络下 raw 不可达），再失败隐藏图片露字母。 */
function MarketLogo({ url, label, size = 30 }: { url?: string; label: string; size?: number }) {
  const initial = (label || "?").charAt(0).toUpperCase();
  const [src, setSrc] = useState(url ?? "");
  const [failed, setFailed] = useState(false);
  const handleError = () => {
    if (url && src === url && toCdnLogo(url) !== url) { setSrc(toCdnLogo(url)); return; }
    setFailed(true);
  };
  return <span className="plugin-market-logo-box" style={{ width: size, height: size }}>
    <span className="plugin-market-logo plugin-market-logo-letter" style={{ width: size, height: size, lineHeight: `${size}px`, fontSize: Math.round(size * 0.46) }}>{initial}</span>
    {url && !failed ? <img className="plugin-market-logo plugin-market-logo-img" style={{ width: size, height: size }} src={src} alt="" loading="lazy" onError={handleError} /> : null}
  </span>;
}

/** 市场卡片点击预览（技能/插件/MCP 通用） */
function MarketPreviewModal({ state, onClose }: { state: MarketPreviewState; onClose: () => void }) {
  return <div className="modal-backdrop market-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="market-preview" role="dialog" aria-modal="true" aria-label={state.title}>
    <div className="market-preview-head">
      <MarketLogo url={state.icon} label={state.iconChar ?? state.title} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="market-preview-title">{state.title}</h3>
        {state.subtitle && <p className="market-preview-sub">{state.subtitle}</p>}
      </div>
      <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
    </div>
    <p className="market-preview-desc">{state.description}</p>
    {state.meta.length > 0 && <div className="market-preview-meta">{state.meta.map((item) => <code key={item}>{item}</code>)}</div>}
    {state.note && <p className="market-preview-desc" style={{ color: "var(--amber2, var(--muted))" }}>{state.note}</p>}
    <footer className="market-preview-foot">
      {state.note2 && <span className="market-preview-note">{state.note2}</span>}
      {state.externalUrl && <button className="secondary-setting" onClick={() => void window.codex.openExternal(state.externalUrl!)}><ArrowUpRight size={14} />{state.externalLabel ?? "查看来源"}</button>}
      {state.onInstall && <button className="primary-setting" onClick={() => { state.onInstall!(); onClose(); }}>{state.installed ? <Check size={14} /> : <Plus size={14} />}{state.installLabel}</button>}
    </footer>
  </section></div>;
}
// 插件市场（codex-marketplace.com）分类 tab：中文标签 → API 英文分类值
const pluginMarketCategoryTabs: [string, string][] = [["全部", "全部"], ["编码", "Coding"], ["效率", "Productivity"], ["实用工具", "Utilities"], ["AI 与智能体", "AI & Agents"], ["设计", "Design"], ["数据", "Data"], ["开发", "Development"]];

/** 思考档位菜单（minimal~ultra）。单一数据源 = 模型配置里的档位声明：
 *  配置勾了才显示、取消勾选就从菜单消失（currentEffortOptions 与引擎 catalog 同源）；
 *  菜单选中未声明档位（含 /effort 命令）时自动回写声明落库。 */
const effortMenuOptions = ALL_EFFORTS.map((value) => ({
  value,
  title: effortLabels[value] ?? value,
  desc: { minimal: "最快响应，几乎不思考。", low: "轻量思考。", medium: "平衡速度与质量。", high: "更严谨，适合复杂任务。", xhigh: "请求 xhigh 强度，需供应商支持。", ultra: "引擎扩展档，实际请求强度按模型映射。" }[value] ?? "",
}));

/** 高度动画折叠原语（对齐 WorkBuddy cr-collapse：0.28s 高度 + 内容 opacity/位移过渡）
 * bare=true 时只输出 content/inner 两层，由外层容器提供 wb-fold 状态类（避免嵌套叠加过渡时长） */
function Fold({ open, bare, children }: { open: boolean; bare?: boolean; children: React.ReactNode }) {
  const body = <div className="wb-fold-content"><div className="wb-fold-inner">{children}</div></div>;
  return bare ? body : <div className={`wb-fold ${open ? "open" : "collapsed"}`}>{body}</div>;
}

/** 工具/命令/编辑卡片：受控展开。展开状态走公共壳 useCardOpen：
 * autoOpen 由调用方给出「运行中 且 有内容」（编辑卡运行中展示 diff，完成自动折叠过渡）；
 * 命令/工具不自动展开（头部即全部信息），用户手动展开后尊重其选择 */
function ActionCard({ icon, verb, info, status, statusText, autoOpen, defaultExpanded, children }: {
  icon: React.ReactNode;
  verb: React.ReactNode;
  info?: React.ReactNode;
  status: ActionStatus;
  statusText?: React.ReactNode;
  autoOpen?: boolean;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}) {
  const { open, toggle } = useCardOpen(Boolean(defaultExpanded || autoOpen));
  return (
    <div className={`action-card ${status} ${open ? "open" : "closed"}`}>
      <button type="button" className="action-head" onClick={toggle}>
        <span className="action-icon">{icon}</span>
        <span className="action-verb">{verb}</span>
        {info != null && <span className="action-info">{info}</span>}
        <span className="action-status">
          <CardStatusIcon status={status} />
          {statusText != null && <span className="action-status-text">{statusText}</span>}
        </span>
        <ChevronDown size={13} className="action-chevron" />
      </button>
      {children != null && <Fold open={open}><div className="action-content">{children}</div></Fold>}
    </div>
  );
}

/** 尾部截断：超过 max 行只保留最后 max 行（对齐 WorkBuddy truncateByLines tail），返回省略行数 */
function truncateTailLines(text: string, max = 500): { text: string; omittedLines: number } {
  const lines = text.split("\n");
  if (lines.length <= max) return { text, omittedLines: 0 };
  return { text: lines.slice(lines.length - max).join("\n"), omittedLines: lines.length - max };
}

function commandCodeLanguage(command: string): { language: string; label: string } {
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(command)) return { language: "powershell", label: "PowerShell" };
  if (/^\s*(?:cmd(?:\.exe)?\s+\/c|call\s+)/i.test(command)) return { language: "batch", label: "Command Prompt" };
  return { language: "bash", label: "Shell" };
}

function payloadLanguage(text: string): string {
  const value = text.trim();
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) return "json";
  return "text";
}

const ToolCodeBlock = memo(function ToolCodeBlock({ language, text, revealing, className, maxHeight = 260 }: {
  language: string;
  text: string;
  revealing?: boolean;
  className?: string;
  maxHeight?: number;
}) {
  const settings = useCodeSettings();
  return (
    <div className={`tool-code-block ${className ?? ""} ${revealing ? "packet-revealing" : ""}`.trim()}>
      <SyntaxHighlighter
        language={language}
        style={codeThemeStyle(settings.theme)}
        PreTag="pre"
        CodeTag="code"
        className="tool-code-pre code-highlight"
        showLineNumbers={settings.lineNumbers}
        wrapLongLines={settings.wrap}
        customStyle={{
          fontSize: codeFontSize(settings.fontScale),
          fontFamily: codeFontStack(settings.font),
          lineHeight: 1.55,
          maxHeight,
          margin: 0,
        }}
      >{text || " "}</SyntaxHighlighter>
      {revealing ? <span className="packet-stream-cursor tool-code-cursor" aria-hidden /> : null}
    </div>
  );
});

/** 命令执行卡片（1:1 复刻 WorkBuddy ExecuteCommandCompactRenderer）：
 * 收起态单行 [终端图标][动词][命令文本][状态][箭头]，运行中命令文本走「流光扫过」动画；
 * 展开态 bash 卡片：bash 标题 + 命令原文 + 尾部截断输出（mono），空输出成功态显示「运行成功 ✓」。 */
function CommandExecutionCard({ item, waitingForApproval, turnActive }: { item: ThreadItem; waitingForApproval?: boolean; turnActive?: boolean }) {
  const running = item.status === "inProgress" || item.status === "running";
  const failed = !running && item.exitCode != null && item.exitCode !== 0;
  const command = String(item.command ?? "").trim();
  const output = String(item.aggregatedOutput ?? "").trim();
  const terminalInput = String(item.terminalInput ?? "").trim();
  // 命令输出默认收起。运行过程优先展示模型的文字说明和思考，代码/终端输出由用户按需展开；
  // 否则长输出会占满视口，让用户误以为运行时“只有代码、没有文字过程”。
  const { open, toggle } = useCardOpen(false);
  const { text: tailOutput, omittedLines } = useMemo(() => truncateTailLines(output, 500), [output]);
  const { displayed: displayedOutput, revealing: outputRevealing } = usePacketRevealText(String(item.id), tailOutput, Boolean(turnActive), bufferedToolRevealStarts, 48);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 流式输出时贴底滚动（对齐 ReasoningCard 的 rAF 合帧方案）
  useEffect(() => {
    if (!running && !outputRevealing) return;
    const el = contentRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [displayedOutput, running, outputRevealing]);
  const verb = waitingForApproval && running ? "等待批准" : running ? "正在运行" : failed ? "运行失败" : "已运行";
  const status: ActionStatus = running ? (waitingForApproval ? "pending" : "running") : failed ? "error" : "done";
  const emptySuccess = !running && !failed && output === "";
  const shell = commandCodeLanguage(command);
  const codeText = [
    command,
    terminalInput ? `$ ${terminalInput}` : "",
    displayedOutput || (running ? "等待输出…" : ""),
  ].filter(Boolean).join("\n\n");
  return (
    <div className={`cmd-card ${status} ${open ? "open" : "closed"}`}>
      <button type="button" className="cmd-head" onClick={toggle}>
        <span className="cmd-icon"><TerminalSquare size={14} /></span>
        <span className="cmd-verb">{verb}</span>
        <span className={`cmd-command ${running ? "loading" : ""}`}>{command || "命令"}</span>
        <span className="cmd-status">
          <CardStatusIcon status={status} />
          {!running && <span className="cmd-duration">{durationLabel(item.status, item.durationMs)}</span>}
        </span>
        <ChevronDown size={13} className="cmd-chevron" />
      </button>
      <Fold open={open}>
        <div className="cmd-content" ref={contentRef}>
          {waitingForApproval && running && <div className="cmd-approval"><ShieldCheck size={13} />需要批准才能继续</div>}
          <div className="cmd-title">{shell.label}</div>
          <div className="cmd-output">
            {emptySuccess ? (
              <span className="cmd-output-success"><CircleCheck size={14} />运行成功</span>
            ) : (
              <>
                {omittedLines > 0 && <span className="cmd-output-truncated">⋯ 已省略前 {omittedLines} 行</span>}
                <ToolCodeBlock language={shell.language} text={codeText} revealing={outputRevealing} className="cmd-code-block" maxHeight={230} />
              </>
            )}
          </div>
          {failed && <div className="cmd-exit">退出码 {item.exitCode}</div>}
        </div>
      </Fold>
    </div>
  );
}

function LinkCard({ href }: { href: string }) {
  let host = href;
  try { host = new URL(href).host || href; } catch { /* keep raw href */ }
  return (
    <span className="link-card" role="group" aria-label={`链接卡片 ${host}`}>
      <span className="link-card-icon"><Globe2 size={17} /></span>
      <span className="link-card-body"><strong>{host}</strong><small>网站</small></span>
      <button className="link-card-open" title={`在浏览器中打开 ${href}`} onClick={() => void window.codex.openExternal(href)}>打开</button>
    </span>
  );
}

// 插件表与组件表必须提在模块级：写在 JSX 内联会每次渲染产生新数组/新对象，
// ReactMarkdown 会认为组件类型变了，把整棵 Markdown 子树卸载重建 —— 这正是
// 流式出字时代码块/图片每帧闪烁的根因。提为常量后只做文本节点 diff。
const MD_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** 代码块：必须是模块级稳定组件。主题/字体由代码设置驱动，组件内部自己订阅 store，
 * 这样切换主题只重渲染代码块本身，不会让 Markdown 整棵树重建（流式出字时也在复用节点）。 */
const MdCode = memo(function MdCode({ className, children, ...props }: any) {
  const settings = useCodeSettings();
  if (!className) return <code {...props}>{children}</code>;
  const language = className.replace("language-", "");
  if (language === "mermaid") return <MermaidDiagram code={String(children)} />;
  return (
    <SyntaxHighlighter
      language={language}
      style={codeThemeStyle(settings.theme)}
      PreTag="div"
      className="code-highlight"
      showLineNumbers={settings.lineNumbers}
      wrapLongLines={settings.wrap}
      customStyle={{ fontSize: codeFontSize(settings.fontScale), fontFamily: codeFontStack(settings.font), margin: 0 }}
    >{String(children).replace(/\n$/, "")}</SyntaxHighlighter>
  );
});

/** 文件预览只读代码视图：与对话代码块同源渲染（主题/字体/字号/行号/换行全复用 code-settings），
 *  修复「文件预览里代码高亮不生效」——之前是裸 <code> 标签，无语法解析。 */
const FilePreviewCode = memo(function FilePreviewCode({ language, content, truncated }: { language: string; content: string; truncated?: boolean }) {
  const settings = useCodeSettings();
  const normalized = String(language ?? "").replace(/^\./, "").toLowerCase();
  return (
    <SyntaxHighlighter
      language={normalized}
      style={codeThemeStyle(settings.theme)}
      PreTag="pre"
      CodeTag="code"
      className="file-preview-code code-highlight"
      // WorkBuddy 式文件查看：行号常开（代码块内联展示才跟随用户设置）
      showLineNumbers
      wrapLongLines={settings.wrap}
      customStyle={{ fontSize: codeFontSize(settings.fontScale), fontFamily: codeFontStack(settings.font), margin: 0 }}
    >{content.replace(/\n$/, "")}{truncated ? "\n…（文件过大，仅展示前 200K 字符）" : ""}</SyntaxHighlighter>
  );
});

const MD_COMPONENTS: Components = {
  p: ({ children }) => {
    const list = Array.isArray(children) ? children : [children];
    // remark-breaks 对只含空白/换行的段落也会生成 <p>；它不是正文，不能给
    // 后面的命令卡或工具折叠组制造一整行空白。
    if (list.every((child) => child == null || (typeof child === "string" && child.trim() === ""))) return null;
    const only = list.length === 1 ? list[0] : null;
    const href = only?.props?.href;
    if (typeof href === "string" && /^https?:\/\//i.test(href) && String(only.props.children ?? "").replace(/\/+$/, "") === href.replace(/\/+$/, "")) {
      return <LinkCard href={href} />;
    }
    return <p>{children}</p>;
  },
  a: ({ href, children }) => (
    <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.codex.openExternal(href); }}>
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img className="message-image" src={src} alt={alt ?? ""} onClick={() => src && openImageLightbox?.(src, alt ?? "")} />
  ),
  code: MdCode,
};

/** 把 markdown 切成块：只在「围栏代码块之外」的空行处切分。
 *  流式出字时只有最后一块在增长，前面各块内容不变 —— 配合 MdBlock 的 memo（字符串按值比较），
 *  已完成的块不会重新走 remark 解析。整篇重解析的 O(全文) 降到 O(最后一块)，
 *  这是长回复越往后越卡的主因。 */
function splitMarkdown(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed);
    if (marker) {
      const ch = marker[1][0];
      // 围栏内不切分：否则 ``` 开合被拆到两个块里，代码块会渲染成乱码
      if (!fence) fence = ch;
      else if (ch === fence) fence = null;
    }
    const nextIsContent = i + 1 < lines.length && lines[i + 1].trim() !== "";
    if (!fence && trimmed === "" && nextIsContent) {
      if (buf.length) { blocks.push(buf.join("\n")); buf = []; }
      continue;
    }
    buf.push(line);
  }
  if (buf.length) blocks.push(buf.join("\n"));
  return blocks;
}

/** 单块渲染：props 是字符串，memo 按值比较 —— 内容不变就完全跳过解析与 diff */
const MdBlock = memo(function MdBlock({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS} components={MD_COMPONENTS} urlTransform={markdownUrlTransform}>{text}</ReactMarkdown>;
});

const Markdown = memo(function Markdown({ children }: { children: string }) {
  // 若正文含可视化 fence（```show_widget / ```widget 等），混合渲染普通 markdown 块 + widget 卡片。
  // 流式阶段未闭合的 fence 用 loading 占位卡（streaming），闭合后替换为真实 iframe。
  const { blocks, widgets } = useMemo<{ blocks: string[]; widgets: Array<{ key: number; data: ShowWidgetData; streaming: boolean }> }>(() => {
    if (!hasWidgetFence(children)) return { blocks: splitMarkdown(children), widgets: [] };
    const result = extractStreamingWidget(children);
    const bs: string[] = [];
    const ws: Array<{ key: number; data: ShowWidgetData; streaming: boolean }> = [];
    result.segments.forEach((seg, i) => {
      if (seg.type === "text") bs.push(seg.content);
      else ws.push({ key: i, data: seg.data, streaming: false });
    });
    if (result.streamingWidget) ws.push({ key: -1, data: result.streamingWidget, streaming: true });
    return { blocks: bs, widgets: ws };
  }, [children]);
  // 流式出字是纯追加，前面的块只会变多不会重排，用 index 作 key 稳定且足够
  const rendered = blocks.map((text, index) => <MdBlock text={text} key={`b${index}`} />);
  // widget 卡片按流序与文本块交错插入（text/widget 由 segments 顺序保证）
  const dark = isWidgetDark();
  const ordered: React.ReactNode[] = [];
  const textCount = blocks.length;
  for (let i = 0; i < Math.max(textCount, widgets.length); i++) {
    if (i < textCount) ordered.push(rendered[i]);
    if (i < widgets.length) {
      const seg = widgets[i];
      ordered.push(<WidgetCard key={`w${seg.key}`} data={seg.data} dark={dark} streaming={seg.streaming} />);
    }
  }
  return <>{ordered}</>;
});

// 模块级组件（WidgetCard / widget iframe）读取当前主题，由 App 主体随 theme 变化更新。
let widgetDark = false;
function isWidgetDark(): boolean { return widgetDark; }

let openImageLightbox: ((path: string, alt: string) => void) | null = null;
// 渲染层可注册的「相对/裸路径 → 绝对路径」解析器（由 App 主体把 workspace 拼进去），
// 供 InlineFileCards 缩略图等模块级组件使用，避免层层传 prop。
let resolveFilePath: ((path: string) => string) | null = null;
// 会话路径台账：从工具调用等消息项里收集出现过的绝对路径（basename → 绝对路径），
// 供 InlineFileCards 把裸文件名直接解析到真实目录——纯内存查找，不扫磁盘
let lookupKnownFile: ((name: string) => string | null) | null = null;
// 模块级「未找到文件」友好提示器（App 注册 showToast），灰卡点击不再走 fs:read 炸错误 toast
let notifyFileMissing: ((message: string) => void) | null = null;

/** 递归收集对象里所有字符串中的 Windows 绝对路径，登记 basename → 绝对路径（后出现的覆盖先前的） */
function collectKnownPaths(source: unknown, map: Map<string, string>, depth = 0): void {
  if (!source || depth > 8) return;
  if (Array.isArray(source)) { for (const value of source) collectKnownPaths(value, map, depth + 1); return; }
  if (typeof source === "object") { for (const value of Object.values(source as Record<string, unknown>)) collectKnownPaths(value, map, depth + 1); return; }
  if (typeof source !== "string") return;
  for (const match of source.matchAll(/([A-Za-z]:[\\/][^\s<>:"|?*]+\.[A-Za-z0-9]{1,5})/g)) {
    const abs = match[1];
    const base = abs.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    if (base) map.set(base, abs);
  }
}

function ImagePreview({ path, alt, onCopy }: { path: string; alt: string; onCopy?: () => void }) {
  return <img className="message-image" src={path.startsWith("http") ? path : imageUrl(path)} alt={alt} onClick={() => openImageLightbox?.(path, alt)} onContextMenu={(event) => { if (!onCopy) return; event.preventDefault(); onCopy(); }} />;
}

function ImageLightbox({ path, alt, onClose, onCopy }: { path: string; alt: string; onClose: () => void; onCopy?: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; baseX: number; baseY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clampZoom = (value: number) => Math.min(6, Math.max(1, value));
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={alt}>
      <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button title="缩小" onClick={() => setZoom((current) => clampZoom(current - 0.25))}><ZoomOut size={15} /></button>
        <button className="lightbox-zoom" title="点击重置" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button>
        <button title="放大" onClick={() => setZoom((current) => clampZoom(current + 0.25))}><ZoomIn size={15} /></button>
        {onCopy && <button title="复制图片" onClick={onCopy}><Copy size={15} /></button>}
        {(() => {
          const local = resolveImagePath(path);
          return local
            ? <button title="在文件夹中显示" onClick={() => void window.codex.shellReveal(local)}><FolderOpen size={15} /></button>
            : path.startsWith("http")
              ? <button title="在浏览器中打开" onClick={() => void window.codex.openExternal(path)}><ExternalLink size={15} /></button>
              : null;
        })()}
        <button title="关闭 (Esc)" onClick={onClose}><X size={15} /></button>
      </div>
      <div
        className={`lightbox-body${dragging ? " dragging" : ""}`}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); else event.stopPropagation(); }}
        onDoubleClick={() => { setZoom((current) => (current > 1 ? 1 : 2.5)); setOffset({ x: 0, y: 0 }); }}
        onMouseDown={(event) => { if (zoom <= 1) return; event.preventDefault(); dragRef.current = { x: event.clientX, y: event.clientY, baseX: offset.x, baseY: offset.y }; setDragging(true); }}
        onMouseMove={(event) => { const drag = dragRef.current; if (drag) setOffset({ x: drag.baseX + (event.clientX - drag.x), y: drag.baseY + (event.clientY - drag.y) }); }}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={(event) => setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 0.87)))}
      >
        <img src={path.startsWith("http") ? path : imageUrl(path)} alt={alt} draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} title={status === "ready" ? "Codex 已连接" : status === "error" ? "Codex 连接失败" : "Codex 正在启动"} />;
}

function CompletedChanges({ turn }: { turn: Turn }) {
  const changes = turn.items.flatMap((item) => item.type === "fileChange" ? (item.changes ?? []) : []);
  if (!changes.length) return null;
  const byPath = new Map<string, { path: string; added: number; deleted: number }>();
  for (const change of changes) {
    const path = change.path ?? change.filePath ?? "未知文件";
    const stats = diffStats(change.diff ?? "");
    const current = byPath.get(path) ?? { path, added: 0, deleted: 0 };
    byPath.set(path, { path, added: current.added + stats.added, deleted: current.deleted + stats.deleted });
  }
  const files = [...byPath.values()];
  const totals = files.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 });
  return (
    <details className="completed-changes" open>
      <summary><FileCode2 size={15} /><strong>已编辑 {files.length} 个文件</strong><span className="diff-add">+{totals.added}</span><span className="diff-delete">-{totals.deleted}</span><ChevronDown size={14} /></summary>
      <div>{files.map((file) => <div className="completed-file" key={file.path}><code>{file.path}</code><span><b>+{file.added}</b> <i>-{file.deleted}</i></span></div>)}</div>
    </details>
  );
}

type FoldHandlers = {
  onCopy: (text: string) => void;
  onQuote: (text: string) => void;
  onImageCopy: (path: string) => void;
  onFork: (turnId: string) => void;
  onEdit: (turnId: string, item: ThreadItem) => void;
  onOpenFile: (path: string) => void;
  onOpenThread?: (id: string) => void;
};

/** 过程折叠组（对齐 WorkBuddy cr-collapse summary/completed/process 三种皮肤）
 * autoFold：组内首个单元完成后由「内联渲染」切换为折叠组时，先挂载为展开再于下一帧收起，
 * 让 CSS 高度过渡真正跑起来（否则组件以 collapsed 直接挂载，没有过渡、视觉上硬切一下） */
function FoldGroup({ title, leadGroup, variant, running, defaultOpen = false, autoFold, failedCount, children }: {
  title: string;
  leadGroup?: string | null;
  variant: "summary" | "completed" | "process";
  running?: boolean;
  defaultOpen?: boolean;
  autoFold?: boolean;
  failedCount?: number;
  children: React.ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [mountOpen] = useState(() => Boolean(autoFold));
  // 挂载帧保持展开，下一帧再收起 → 浏览器能捕捉到 1fr→0fr 的高度变化，高度过渡才跑得起来。
  // 依赖数组必须用 mountOpen 而不能用「已执行过」的 ref 去挡，StrictMode 下 effect 双调用会
  // 先取消 rAF 再被 ref 挡掉第二次调度，结果永远收不起来。
  useEffect(() => {
    if (!mountOpen) return;
    const raf = requestAnimationFrame(() => setManualOpen(false));
    return () => cancelAnimationFrame(raf);
  }, [mountOpen]);
  const open = manualOpen ?? (mountOpen || defaultOpen);
  const group = leadGroup ?? "other";
  const LeadIcon = group === "command" ? TerminalSquare
    : group === "modify" ? FileCode2
    : group === "research" || group === "search" ? Search
    : group === "collab" ? Bot
    : group === "reasoning" ? Brain
    : Wrench;
  return (
    <div className={`wb-fold ${open ? "open" : "collapsed"} wb-fold--${variant} ${running ? "running" : ""}`}>
      <button type="button" className="wb-fold-header" title={open ? "点击收起" : "点击展开过程"} onClick={() => setManualOpen(!open)}>
        <ChevronDown size={12} className="wb-fold-caret" />
        {variant === "summary" && <span className="wb-fold-lead"><LeadIcon size={13} /></span>}
        {variant === "completed" && <span className={`wb-fold-dot ${failedCount ? "error" : ""}`} aria-hidden />}
        <span className={`wb-fold-title ${running ? "shimmer-text" : ""}`}>{title}</span>
        {failedCount ? <span className="wb-fold-failed">{failedCount} 项失败</span> : null}
      </button>
      <Fold open={open} bare><div className="wb-fold-body">{children}</div></Fold>
    </div>
  );
}

/** 运行中计时只使用本地秒表，不读取引擎时间戳，避免秒/毫秒单位混淆。 */
function RunningProcessTime() {
  const startedRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const totalSeconds = Math.max(0, Math.floor((now - startedRef.current) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return <div className="running-process-time">正在处理 {minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`}</div>;
}

/** 连续同类工具限流：默认只展示最新三条，旧条目留在原位置并可展开。 */
function CappedToolRun({ label, units, renderUnit, limit = 3 }: {
  label: string;
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // limit=Infinity：回合运行中不收起旧行——流式期间插入折叠行会把下方正在出字的正文顶得上跳下跳（实证）
  const hiddenCount = Math.max(0, units.length - limit);
  if (!hiddenCount) return <>{units.map(renderUnit)}</>;
  const hidden = units.slice(0, hiddenCount);
  const latest = units.slice(hiddenCount);
  return (
    <div className={`capped-tool-run ${expanded ? "expanded" : "collapsed"}`}>
      <button type="button" className="capped-tool-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? `收起较早的${label}` : `展开较早的${label}`}>
        <ChevronDown size={12} />
        <span>{expanded ? `收起较早的 ${hiddenCount} 条${label}` : `已收起 ${hiddenCount} 条${label}`}</span>
        {!expanded && <small>最新 {limit} 条</small>}
      </button>
      <Fold open={expanded}><div className="capped-tool-hidden">{hidden.map(renderUnit)}</div></Fold>
      <div className="capped-tool-latest">{latest.map(renderUnit)}</div>
    </div>
  );
}

function CappedToolSequence({ units, renderUnit }: {
  units: FoldUnit[];
  renderUnit: (unit: FoldUnit) => React.ReactNode;
}) {
  const runs = useMemo(() => buildOrderedToolRuns(units), [units]);
  return <>{runs.map((run) => run.kind === "unit"
    ? <Fragment key={run.key}>{renderUnit(run.units[0])}</Fragment>
    : <CappedToolRun key={run.key} label={run.label} units={run.units} renderUnit={renderUnit} />)}</>;
}

/** 消息折叠状态机（对齐 WorkBuddy assistant-fold/fold.ts）：
 * 流式与完成态共用 buildSegments 分段，输出【同构扁平 keyed children】（fold-首单元id / item id），
 * 完成瞬间结构对得上 → 不重挂、动画不重播。
 * 流式：连续 ≥2 个可折叠单元 → 未到正文前收「lead 组 + 最新一条内联」；到正文后整段收意图摘要组（小折叠）；
 * 完成：首段工具组换「已完成 · 用时 X」皮肤；其余工具段用意图摘要标题（收起态，可展开看过程）；
 *       正文（含中间解说）与深度思考卡、plan/图片卡按流序内联常显——思考卡全程保持同一 DOM 节点，
 *       live→done 的自动收起动画才能播出来（否则回合结束被吸进折叠组卸载重挂，表现就是「闪一下就没了」）。 */
function TurnFoldStream({ items, turn, running, fallbackWindow, waitingForApproval, handlers, finalAgentId, usage, tokenUsage }: {
  items: ThreadItem[];
  turn: Turn;
  running: boolean;
  fallbackWindow?: number;
  waitingForApproval?: boolean;
  handlers: FoldHandlers;
  finalAgentId?: string;
  usage?: any;
  tokenUsage?: any;
}) {
  const units = useMemo(() => items
    .filter((item) => !(item.type === "agentMessage" && !String(item.text ?? "").trim()))
    .map((item) => ({ item, kind: classifyUnit(item) })),
  [items]);
  const segments = useMemo(() => buildSegments(units, !running), [units, running]);

  const renderItem = (unit: FoldUnit, hideFooter?: boolean, reasoningActive?: boolean) => (
    <MemoItemView
      item={unit.item}
      turn={turn}
      turnActive={unit.item.type === "reasoning" ? Boolean(reasoningActive) : running}
      usage={unit.item.id === finalAgentId ? usage : null}
      tokenUsage={unit.item.id === finalAgentId ? tokenUsage : null}
      fallbackWindow={fallbackWindow}
      hideFooter={unit.item.type === "agentMessage" ? hideFooter || undefined : undefined}
      waitingForApproval={waitingForApproval}
      onCopy={handlers.onCopy}
      onQuote={handlers.onQuote}
      onImageCopy={handlers.onImageCopy}
      onFork={unit.item.type === "agentMessage" && unit.item.id === finalAgentId && !hideFooter ? () => handlers.onFork(turn.id) : undefined}
      onOpenFile={handlers.onOpenFile}
      onOpenThread={handlers.onOpenThread}
      key={unit.item.id}
    />
  );

  const failedCountOf = (group: FoldUnit[]) => group.filter((u) => foldItemStatus(u.item) === "failed" || (u.item.type === "commandExecution" && !running && u.item.exitCode)).length;

  if (running) {
    // 运行态严格保留引擎事件流中的每一个稳定节点。正文、工具和多段深度思考
    // 按原始顺序逐项存在；各卡片自行完成 live→done 与自动收起，不能把历史步骤
    // 合并成一个摘要，否则下一阶段到来时前一阶段会在视觉上消失。
    const lastReasoningIndex = units.reduce((last, unit, index) => unit.item.type === "reasoning" ? index : last, -1);
    const indexByUnit = new Map(units.map((unit, index) => [unit, index] as const));
    return <CappedToolSequence units={units} renderUnit={(unit) => {
      const index = indexByUnit.get(unit) ?? -1;
      // 上游有时不在 reasoning item 上回传 completed/status，只能用事件顺序兜底：
      // 后面已经出现工具或正文时，前一块思考必然已经结束；只有最后一个无完成标记
      // 的 reasoning 才是当前正在直播的思考。
      const reasoningActive = unit.item.type === "reasoning"
        && (unit.item.status === "inProgress" || unit.item.status === "running"
          || (!unit.item.status && !unit.item.durationMs && !reasoningDuration.has(String(unit.item.id)) && index === lastReasoningIndex))
        && !units.slice(index + 1).some((next) => next.item.type !== "reasoning");
      return renderItem(unit, unit.item.type === "agentMessage" ? true : undefined, reasoningActive);
    }} />;
  }

  // ── 完成态：与流式态同构的分段折叠 ──
  // 复用 segments（回合结束后所有 foldable 段 shouldFold=true），输出与流式态相同的扁平
  // 结构、相同的 key（fold-首单元id / item id）→ 完成瞬间不重挂、动画不重播。
  // 与流式态的差异仅两点：
  //   1. 首个正文之前的工具段保留「已完成 · 用时 X」皮肤作为任务回合收尾标记；其余工具段
  //      用意图摘要标题（computeFoldSummary，如「已搜索：…」）——旧消息展开后正文之间也有
  //      运行状态展示，不再是一坨无结构的正文堆（旧版把正文+工具全塞进一个巨型已完成组）；
  //   2. 不播 autoFold：历史加载保持收起；刚完成的组在流式期已收起，无需重播。
  const duration = turn.durationMs ? formatDuration(turn.durationMs) : null;
  const completedTitle = turn.error ? "处理出错" : duration ? `耗时 ${duration}` : "已处理";
  // 完成事件并不总会给 agentMessage 带稳定 id（部分上游只在流式事件里有 id，
  // 最终快照会缺失或更换）。不能因此退回旧分段展示，否则思考和中间正文会全部
  // 暴露在“耗时”折叠外。优先匹配明确 id，匹配不到就以最后一条有正文的消息为总结。
  let finalUnitIndex = -1;
  if (finalAgentId) {
    for (let index = units.length - 1; index >= 0; index--) {
      if (units[index].item.id === finalAgentId && units[index].item.type === "agentMessage") {
        finalUnitIndex = index;
        break;
      }
    }
  }
  if (finalUnitIndex < 0) {
    for (let index = units.length - 1; index >= 0; index--) {
      const item = units[index].item;
      if (item.type === "agentMessage" && Boolean(String(item.text ?? "").trim())) {
        finalUnitIndex = index;
        break;
      }
    }
  }
  const finalUnit = finalUnitIndex >= 0 ? units[finalUnitIndex] : undefined;
  const completedProcess = finalUnit ? units.filter((_, index) => index !== finalUnitIndex) : [];
  // 历史会话常只保留 reasoning + 中间 agentMessage，工具 item 可能没有进入快照。
  // 不能继续只按连续工具段折叠：最后一条正文是结果，其前面的全部内容都是过程。
  if (finalUnit && completedProcess.length > 0) {
    return <>
      <FoldGroup
        key={`fold-completed-${turn.id}`}
        variant="completed"
        title={completedTitle}
        leadGroup={topToolGroup(completedProcess)}
        failedCount={failedCountOf(completedProcess) || undefined}
      >
        <CappedToolSequence units={completedProcess} renderUnit={(unit) => renderItem(unit, unit.item.type === "agentMessage" ? true : undefined)} />
      </FoldGroup>
      {renderItem(finalUnit, true)}
    </>;
  }
  const out: React.ReactNode[] = [];
  let bodySeen = false;
  for (const seg of segments) {
    if (seg.kind === "foldable") {
      const lead = !bodySeen;
      out.push(
        <FoldGroup
          key={`fold-${seg.units[0].item.id}`}
          variant={lead ? "completed" : "summary"}
          title={lead ? completedTitle : computeFoldSummary(seg.units, false, waitingForApproval)}
          leadGroup={topToolGroup(seg.units)}
          failedCount={failedCountOf(seg.units) || undefined}
        >
          <CappedToolSequence units={seg.units} renderUnit={(unit) => renderItem(unit, unit.item.type === "agentMessage" ? true : undefined)} />
        </FoldGroup>,
      );
      continue;
    }
    for (const u of seg.units) {
      if (u.kind === "body") bodySeen = true;
      // 与流式态同构：finalAgent 的 footer 永远不在 inner 渲染，由 TurnView 外层 MessageFooter 统一渲染。
      out.push(renderItem(u, u.item.type === "agentMessage" ? true : undefined));
    }
  }
  return <>{out}</>;
}

function ContextRing({ tokenUsage, fallbackWindow }: { tokenUsage?: any; fallbackWindow?: number }) {
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  const currentUsage = usageBucket(tokenUsage, "last") ?? usageBucket(tokenUsage, "total");
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  // 有 contextWindow 但还没用量时仍显示图标占位（0%），让"上下文进度"始终可见
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const label = used != null ? `${Math.round(percent)}%` : "—";
  const title = used != null ? `上下文 ${Math.round(percent)}% · ${Number(used).toLocaleString()} / ${Number(contextWindow).toLocaleString()} Token` : `上下文窗口 ${Number(contextWindow).toLocaleString()} Token · 用量未同步`;
  // 重度长上下文：接近窗口上限时变色预警（warn 80% / danger 95%），提示该压缩了
  const tone = percent >= 95 ? "danger" : percent >= 80 ? "warn" : "";
  return <span className={`context-ring ${tone}`} role="progressbar" aria-label="上下文用量" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} title={title}><CircleGauge size={13} /><small>{label}</small></span>;
}

// ── 数据管理 / 缓存清理（设置 → 数据与统计 → 数据管理） ──
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function StorageSection({ onNotice, onClearMemoryCache, openAppConfirm }: {
  onNotice: (message: string) => void;
  onClearMemoryCache: () => void;
  openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
}) {
  const [info, setInfo] = useState<{ items: { key: string; label: string; bytes: number; deletable: boolean }[]; userData: string; engineLog: string; imagesDir: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { window.codex.storageInfo().then(setInfo).catch((error: any) => onNotice("读取数据占用失败：" + (error?.message ?? error))); };
  useEffect(() => { refresh(); }, []);
  const clear = async (target: "engine-log" | "images", label: string) => {
    const ok = await openAppConfirm("清理缓存", `确认清空「${label}」？此操作不可撤销。\n（会话历史记录不会被删除，仅清理诊断日志与图片缓存。）`, "清理");
    if (!ok) return;
    setBusy(target);
    try {
      const res = await window.codex.storageClear(target);
      if (res?.ok) { onNotice(`已清理：${label}`); refresh(); }
      else onNotice("清理失败：" + (res?.error ?? "未知错误"));
    } catch (error: any) {
      onNotice("清理失败：" + (error?.message ?? error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="settings-section stack">
      <div className="settings-copy"><h2>数据管理</h2><p>查看各数据目录占用，并清理可安全的缓存。会话历史（rollout 原档）是你的全部对话记录，<strong>不在清理范围内</strong>，请通过归档 / 备份管理。</p></div>
      <div className="storage-list">
        {info?.items.map((item) => (
          <div className="storage-row" key={item.key}>
            <div className="storage-meta"><strong>{item.label}</strong><span>{formatBytes(item.bytes)}</span></div>
            {item.deletable
              ? <button className="danger-setting" disabled={busy !== null} onClick={() => void clear(item.key as "engine-log" | "images", item.label)}>{busy === item.key ? "清理中…" : "清理"}</button>
              : <span className="storage-locked" title="会话历史不可在此删除，请用归档 / 备份管理">保留</span>}
          </div>
        ))}
        {!info && <p className="muted">正在统计占用…</p>}
      </div>
      <div className="settings-subhead"><Database size={13} />会话恢复缓存（内存）</div>
      <p className="muted">应用会在内存里缓存已打开过的会话用于秒开；长时间运行、切换过大量会话后可能占用可观内存。清理后下次打开会话会重新从磁盘加载（略慢一瞬）。</p>
      <div className="settings-actions">
        <button className="secondary-setting" disabled={busy !== null} onClick={() => { onClearMemoryCache(); onNotice("已清理会话恢复缓存"); }}>清理会话恢复缓存</button>
        <button className="secondary-setting" onClick={() => { window.codex.getUserData().then((p: string) => window.codex.shellReveal(p)).catch(() => undefined); }}>打开数据目录</button>
      </div>
    </section>
  );
}

function usageBucket(tokenUsage: any, scope: "last" | "total") {
  if (!tokenUsage) return null;
  const camel = scope === "last" ? "lastTokenUsage" : "totalTokenUsage";
  const snake = scope === "last" ? "last_token_usage" : "total_token_usage";
  return tokenUsage?.[scope] ?? tokenUsage?.[camel] ?? tokenUsage?.[snake] ?? tokenUsage?.info?.[snake] ?? null;
}

function usageNumber(usage: any, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function usageInputTokens(usage: any): number {
  return usageNumber(usage, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens");
}

function usageCachedTokens(usage: any): number {
  const direct = usageNumber(usage, "cachedInputTokens", "cached_input_tokens", "cacheReadInputTokens", "cache_read_input_tokens");
  if (direct > 0) return direct;
  return usageNumber(
    usage?.inputTokensDetails ?? usage?.input_tokens_details ?? usage?.promptTokensDetails ?? usage?.prompt_tokens_details,
    "cachedTokens",
    "cached_tokens",
  );
}

function usageCacheRate(usage: any): number | null {
  const input = usageInputTokens(usage);
  if (input <= 0) return null;
  const cached = Math.min(input, usageCachedTokens(usage));
  return Math.round((cached / input) * 1000) / 10;
}

type UsageCounterSnapshot = { input: number; cached: number; output: number; total: number };
function usageCounterSnapshot(usage: any): UsageCounterSnapshot {
  return {
    input: usageInputTokens(usage),
    cached: usageCachedTokens(usage),
    output: usageNumber(usage, "outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    total: usageNumber(usage, "totalTokens", "total_tokens"),
  };
}

/** 官方订阅额度徽标：当前供应商是 openai-official 时显示，5 分钟轮询 wham/usage 与官方同步；弹窗看原始明细。 */
function openaiWindowLabel(seconds?: number): string {
  if (seconds === 604800) return "本周窗口";
  if (seconds === 18000) return "5 小时窗口";
  if (seconds) return `${Math.round(seconds / 3600)} 小时窗口`;
  return "额度窗口";
}
/** wham/usage → 可视化面板数据：主/次窗口用量、档位、状态（官方字段变动手动适配） */
function parseOpenaiUsagePanel(data: any): { planType: string; windows: { label: string; usedPercent: number; resetAt?: number; windowSeconds?: number }[]; limitReached: boolean } {
  const rate = data?.rate_limit ?? data;
  const windows: { label: string; usedPercent: number; resetAt?: number; windowSeconds?: number }[] = [];
  for (const key of ["primary_window", "secondary_window", "tertiary_window"]) {
    const win = rate?.[key];
    if (win && typeof win.used_percent === "number") {
      windows.push({
        label: openaiWindowLabel(win.limit_window_seconds),
        usedPercent: Math.min(100, Math.max(0, win.used_percent)),
        resetAt: Number(win.reset_at) || undefined,
        windowSeconds: Number(win.limit_window_seconds) || undefined,
      });
    }
  }
  return { planType: String(data?.plan_type ?? "plus").toUpperCase(), windows, limitReached: Boolean(rate?.limit_reached) };
}
/** 重置倒计时：官方 reset_at（epoch 秒）→「X 小时 Y 分后重置（HH:mm）」 */
function openaiResetText(resetAt: number | undefined, now: number): string {
  if (!resetAt) return "";
  const diff = resetAt * 1000 - now;
  if (diff <= 0) return "已重置";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const clock = new Date(resetAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return h > 0 ? `${h} 小时 ${m} 分后重置（${clock}）` : `${m} 分后重置（${clock}）`;
}

function OpenaiBalanceBadge({ accountKey }: { accountKey?: string | null }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<ReturnType<typeof parseOpenaiUsagePanel> | null>(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    try {
      setPanel(parseOpenaiUsagePanel(await window.codex.openaiUsage()));
      setErr("");
    } catch (e: any) { setErr(e.message ?? "额度同步失败"); }
  }, []);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!accountKey) return;
    void refresh();
    const timer = window.setInterval(refresh, 60_000); // 与中转站余额徽标同节奏的实时同步
    const tick = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [accountKey, refresh]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!accountKey) return null;
  const primary = panel?.windows[0];
  const summary = err ? "额度同步失败" : panel && primary ? `订阅已用 ${Math.round(primary.usedPercent)}%` : "订阅";
  return <div className="relay-badge" ref={wrapRef}>
    <button type="button" className="context-ring relay-badge-btn" title="OpenAI 订阅额度" aria-label="OpenAI 订阅额度" onClick={() => { setOpen((v) => !v); if (!panel) void refresh(); }}>
      <CircleGauge size={13} /><small>{summary}</small>
    </button>
    {open && <div className="ctx-pop relay-pop" role="dialog" aria-label="OpenAI 订阅额度明细" onMouseLeave={() => setOpen(false)}>
      <div className="ctx-pop-head"><strong>OpenAI 官方订阅</strong>{panel?.planType && <span className="openai-plan-badge">{panel.planType}</span>}</div>
      <div className="ctx-pop-sub">{err ? err : "额度每 5 分钟与官方同步"}</div>
      {panel && panel.windows.length > 0 && (
        <div className="ctx-pop-grid openai-usage-grid">
          {panel.windows.map((win) => (
            <div className="ctx-pop-cell" key={win.label}>
              <span className="ctx-pop-cell-label">{win.label}</span>
              <div className="relay-plan-progress"><i style={{ width: win.usedPercent + "%" }} /></div>
              <b className="ctx-pop-cell-value">已用 {Math.round(win.usedPercent)}%</b>
              {win.resetAt ? <small className="openai-reset-line"><Clock3 size={10} />{openaiResetText(win.resetAt, nowTick)}</small> : null}
            </div>
          ))}
        </div>
      )}
      {panel?.limitReached && <p className="relay-account-err"><AlertTriangle size={13} />当前窗口额度已用尽，等待窗口重置或切换中转站。</p>}
      {!err && panel && panel.windows.length === 0 && <p className="openai-sub-line">官方未返回窗口用量数据（可能尚未产生用量）。</p>}
      <p className="ctx-pop-cache-note">设置 → 账户 → OpenAI 订阅 可管理账号与切换。</p>
    </div>}
  </div>;
}

/** 中转站余额徽标：当前供应商是中转站生成的（relay-active-v1）时显示套餐余量或账户余额；点击弹明细。 */
/** 分组名清洗：去掉站方加的装饰性 emoji/符号，截断超长名（完整名走 title 悬停查看）。 */
function shortGroupName(name: unknown, max: number) {
  const cleaned = String(name ?? "套餐").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim() || "套餐";
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

const OFFICIAL_MODELS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"];

/** OpenAI 官方订阅卡：ChatGPT 设备码登录（引擎原生 codex login --device-auth，无需本地回调端口）。
 *  启用后引擎配置不写 model_provider，走内置 openai + auth.json 的 ChatGPT 凭据（订阅额度）。 */
function OpenaiOfficialCard({ activeProvider, onActivate, onNotice }: { activeProvider?: string; onActivate: (models: string[]) => Promise<void> | void; onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<{ loggedIn: boolean; email: string } | null>(null);
  const [device, setDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<string>("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [proxy, setProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const timerRef = useRef<number | null>(null);
  const isActive = activeProvider === "openai-official";
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  const loadUsage = async () => {
    try { setUsage(JSON.stringify(await window.codex.openaiUsage(), null, 1).slice(0, 800)); } catch (e: any) { setUsage("额度查询失败：" + (e.message ?? e)); }
  };
  const startLogin = async () => {
    setBusy(true); setLoginError("");
    try {
      const proxyValue = proxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      void window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      let opened = false;
      const openAuth = (url: string) => {
        if (opened || !url) return;
        opened = true;
        void window.codex.openExternal(url).catch((e: any) => onNotice("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
      };
      const first = await window.codex.openaiLoginStatus();
      setDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setLoginError(first.error);
      openAuth(first.url);
      const startedAt = Date.now();
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuth(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setLoginError(s.error);
          setBusy(false);
        }
        if (s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setStatus({ loggedIn: true, email: s.email });
          setDevice(null); setLoginError("");
          void window.codex.openaiCaptureLogin().catch(() => undefined);
          onNotice(`OpenAI 官方账号已登录：${s.email}，正在启用订阅…`);
          await onActivate(OFFICIAL_MODELS);
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (e: any) { onNotice("官方登录失败：" + (e.message ?? e)); } finally { setBusy(false); }
  };
  useEffect(() => { void (async () => { try { const s = await window.codex.openaiLoginStatus(); setStatus({ loggedIn: s.loggedIn, email: s.email }); if (s.loggedIn) void loadUsage(); } catch { /* IPC 不可用 */ } })(); }, []);
  return (
    <div className={`relay-entry-banner official-banner ${isActive ? "active" : ""}`}>
      <Bot size={16} />
      <div className="relay-entry-text">
        <b>OpenAI 官方订阅（ChatGPT 登录）</b>
        <small>{status?.loggedIn ? `已登录：${status.email || "ChatGPT 账号"}` : "用 ChatGPT 账号设备码登录，直接使用 Codex 订阅额度，无需 API Key"}</small>
        {device && device.url && <small className="official-device">浏览器已打开登录页：<a href={device.url} onClick={(e) => { e.preventDefault(); void window.codex.openExternal(device.url); }}>auth.openai.com</a>，输入验证码 <b>{device.code || "见下方引擎输出"}</b></small>}
        {device && !device.code && device.raw ? <pre className="official-usage">{device.raw}</pre> : null}
        {device && !device.url && !loginError && <small className="official-device">正在向 OpenAI 申请设备验证码…</small>}
        {loginError && <small className="official-device official-error">登录失败：{loginError}。OpenAI 有区域限制——请确认代理/VPN 已开启；也可在下方填写代理地址后重试。</small>}
        {!status?.loggedIn && <small className="official-device">代理（可选）：<input className="official-proxy-input" value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:7890" /></small>}
      </div>
      <div className="relay-entry-actions">
        {status?.loggedIn && <button type="button" className="secondary-setting" onClick={() => { setUsageOpen((v) => !v); if (!usage) void loadUsage(); }}><CircleGauge size={13} />额度</button>}
        {status?.loggedIn
          ? <button type="button" className="secondary-setting" disabled={isActive} onClick={() => void onActivate(OFFICIAL_MODELS)}>{isActive ? <><Check size={13} />使用中</> : <><Play size={13} />启用</>}</button>
          : <button type="button" className="secondary-setting" disabled={busy} onClick={() => void startLogin()}>{busy ? <><Spinner />等待登录…</> : <><LogIn size={13} />设备码登录</>}</button>}
      </div>
      {usageOpen && usage && <pre className="official-usage">{usage}</pre>}
    </div>
  );
}

/** 额度 JSON → 进度条数据：宽松收集 percent 字段（官方结构变动时自动适配），最多 5 条 */
function extractQuotaBars(data: any): { label: string; value: number }[] {
  const bars: { label: string; value: number }[] = [];
  const walk = (node: any, context: string, depth: number) => {
    if (node == null || typeof node !== "object" || depth > 4 || bars.length >= 5) return;
    for (const [key, value] of Object.entries(node)) {
      if (bars.length >= 5) return;
      // 官方窗口结构：{ used_percent, limit_window_seconds } → 用友好窗口名（5 小时窗口/本周窗口）
      if (typeof value === "object" && value && typeof (value as any).used_percent === "number") {
        bars.push({ label: openaiWindowLabel((value as any).limit_window_seconds), value: (value as any).used_percent });
      } else if (typeof value === "number" && /percent/i.test(key) && value >= 0 && value <= 100) {
        bars.push({ label: (context ? context + " · " : "") + String(key).replace(/_/g, " "), value: value });
      } else if (typeof value === "object") {
        walk(value, /percent|ratio|window/i.test(key) ? context : String(key).replace(/_/g, " "), depth + 1);
      }
    }
  };
  walk(data, "", 0);
  return bars;
}

/** OpenAI 订阅页（设置 → 账户 → OpenAI 订阅）：监控面板 + 多账号批量管理。 */
function OpenaiSubscriptionPage({ activeProvider, onActivate, onNotice, onActiveChange }: { activeProvider?: string; onActivate: (models: string[]) => Promise<void> | void; onNotice: (m: string) => void; onActiveChange?: (email: string) => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [device, setDevice] = useState<{ url: string; code: string; raw?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [err, setErr] = useState("");
  const [usageMap, setUsageMap] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [manageEmail, setManageEmail] = useState("");
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [proxy, setProxy] = useState(() => localStorage.getItem("openai-proxy") ?? "");
  const timerRef = useRef<number | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNowTick(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const authOpenedRef = useRef(false);
  const reload = useCallback(async () => {
    try { const list = await window.codex.openaiAccounts(); setAccounts(list); return list as { id: string; email: string; loggedIn?: boolean }[]; } catch { setAccounts([]); return []; }
  }, []);
  const loadUsage = useCallback(async (email: string) => {
    try {
      const raw = JSON.stringify(await window.codex.openaiUsage({ email }), null, 1);
      setUsageMap((m) => ({ ...m, [email]: raw }));
    } catch (e: any) { setUsageMap((m) => ({ ...m, [email]: "ERR:" + (e.message ?? e) })); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  // 账号列表加载后自动为每个账号拉一次额度
  useEffect(() => {
    const t = window.setTimeout(() => { accounts.forEach((a) => { if (!usageMap[a.email]) void loadUsage(a.email); }); }, 800);
    return () => window.clearTimeout(t);
  }, [accounts]);
  // 实时同步：60s 轮询全部账号额度（与中转站余额徽标同节奏）
  useEffect(() => {
    if (!accounts.length) return;
    const t = window.setInterval(() => { accounts.forEach((a) => void loadUsage(a.email)); }, 60_000);
    return () => window.clearInterval(t);
  }, [accounts, loadUsage]);
  // 浏览器打开一次即可（授权 URL 首次出现时触发）
  const openAuthOnce = (url: string) => {
    if (authOpenedRef.current || !url) return;
    authOpenedRef.current = true;
    void window.codex.openExternal(url).catch((e: any) => setErr("打开浏览器失败：" + (e.message ?? e) + "，请手动访问 " + url));
  };
  const startLogin = async () => {
    setBusy(true); setErr("");
    try {
      const proxyValue = proxy.trim();
      if (proxyValue) localStorage.setItem("openai-proxy", proxyValue); else localStorage.removeItem("openai-proxy");
      await window.codex.openaiSetProxy(proxyValue).catch(() => undefined);
      await window.codex.openaiLoginStart({ proxy: proxyValue || undefined });
      const first = await window.codex.openaiLoginStatus();
      setDevice({ url: first.url, code: first.code, raw: first.lines });
      if (first.error) setErr("登录失败：" + first.error + "。OpenAI 有区域限制——请确认代理已开启（本机检测到 7897 端口代理，填 http://127.0.0.1:7897），或换正确端口后重试。");
      openAuthOnce(first.url);
      const startedAt = Date.now();
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(async () => {
        const s = await window.codex.openaiLoginStatus();
        setDevice({ url: s.url, code: s.code, raw: s.lines });
        openAuthOnce(s.url);
        if (s.error && !s.childAlive && !s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setErr("登录失败：" + s.error + "。OpenAI 有区域限制——请确认代理已开启后重试。");
          setBusy(false);
        }
        if (s.loggedIn) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setDevice(null);
          const saved = await window.codex.openaiCaptureLogin();
          await reload();
          // 登录即生效：写入 auth.json + 重启引擎 + 自动配置官方订阅模型，直接可对话
          try {
            await window.codex.openaiAccountSwitch(saved.id);
            onActiveChange?.(saved.email);
            await onActivate(OFFICIAL_MODELS);
            onNotice("OpenAI 账号已登录并启用订阅：" + saved.email + "，可以直接开始对话");
          } catch (e: any) {
            setErr("账号已保存，但自动启用失败：" + (e.message ?? e));
          }
        } else if (Date.now() - startedAt > 15 * 60_000) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          void window.codex.openaiLoginCancel();
        }
      }, 2500);
    } catch (e: any) { setErr("官方登录失败：" + (e.message ?? e)); } finally { setBusy(false); }
  };
  const switchAccount = async (id: string) => {
    setWorking("sw" + id); setErr("");
    try {
      const r = await window.codex.openaiAccountSwitch(id);
      onActiveChange?.(r.email);
      onNotice("已切换官方账号：" + r.email + "，引擎已重启");
    } catch (e: any) { setErr("切换失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  const removeAccount = async (id: string) => {
    setWorking("rm" + id); setErr("");
    try { await window.codex.openaiAccountRemove(id); await reload(); onNotice("账号已删除"); } catch (e: any) { setErr("删除失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  const enableSubscription = async (id: string) => {
    setWorking("en" + id); setErr("");
    try {
      const r = await window.codex.openaiAccountSwitch(id);
      onActiveChange?.(r.email);
      await onActivate(OFFICIAL_MODELS);
      onNotice("已启用 " + r.email + " 的 Codex 订阅");
    } catch (e: any) { setErr("启用失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 账号启用/停用：停用 = 退出切换候选（vault 数据保留）；停用使用中的账号会同步退出引擎生效。
  // 重新启用时若当前没有任何生效的官方账号（停用会清 auth.json），自动恢复该账号订阅生效——
  // 与中转站开关同语义：开关=暂停/恢复，不该让用户再手动点「启用订阅」（09-09）
  const toggleAccount = async (id: string, enabled: boolean) => {
    setWorking("tg" + id); setErr("");
    try {
      const r = await window.codex.openaiToggleAccount({ id, disabled: !enabled });
      const list = await reload();
      if ((r as any).deactivated) {
        onActiveChange?.("");
        onNotice("账号已停用，官方订阅已退出引擎（重新打开开关可恢复）");
        return;
      }
      const target = (list ?? []).find((a: any) => a.id === id);
      if (enabled) {
        // 全局互斥：启用 A 时自动停用其他已启用的账号（一次只能开一个）
        for (const other of (list ?? []) as any[]) {
          if (other.id !== id && other.disabled !== true) {
            await window.codex.openaiToggleAccount({ id: other.id, disabled: true }).catch(() => undefined);
          }
        }
      }
      if (enabled && target) {
        // 没有任何生效的官方账号：自动把刚启用的账号恢复为当前订阅（vault 内账号必有登录态）
        onNotice("账号已启用，正在自动恢复官方订阅…");
        setWorking("en" + id);
        const sw = await window.codex.openaiAccountSwitch(id);
        onActiveChange?.(sw.email);
        await onActivate(OFFICIAL_MODELS);
        onNotice("账号已启用并恢复为当前生效：" + sw.email);
      } else {
        onNotice(enabled ? "账号已启用，可启用其 Codex 订阅" : "账号已停用，不再出现在切换候选中");
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, ""));
      await reload();
    } finally { setWorking(""); }
  };
  return (
    <section className="settings-section stack relay-center openai-center">
      <div className="settings-copy channel-heading"><div><h2>OpenAI 订阅监控</h2><p>多账号统一监控：每张卡片实时显示订阅档位、有效期与额度用量；切换账号即写入引擎并重启生效。登录与额度查询需要可访问 OpenAI 的网络（代理）。</p></div></div>
      {err && <p className="relay-account-err"><AlertTriangle size={13} />{err}</p>}
      <div className="relay-plan-grid openai-account-grid">
        {accounts.map((a) => {
          const usageRaw = usageMap[a.email];
          let bars: { label: string; value: number; resetAt?: number }[] = [];
          if (usageRaw && !usageRaw.startsWith("ERR:")) {
            try {
              const parsed = JSON.parse(usageRaw);
              const panel = parseOpenaiUsagePanel(parsed);
              bars = panel.windows.map((w) => ({ label: w.label, value: w.usedPercent, resetAt: w.resetAt }));
              if (!bars.length) bars = extractQuotaBars(parsed).map((b) => ({ label: b.label, value: b.value }));
            } catch { bars = []; }
          }
          const primary = bars[0];
          return (
            <div className={`relay-plan-card openai-account-card ${a.active ? "selected" : ""}${a.disabled ? " acct-disabled" : ""}`} key={a.id} onClick={() => { setManageEmail(a.email); setManageOpen(true); if (!usageRaw) void loadUsage(a.email); }} title="点卡片进入监控面板">
              <div className="relay-plan-card-head">
                <Bot size={15} />
                <strong title={a.email}>{a.email || a.id}</strong>
                {a.planType ? <span className="openai-plan-badge">{a.planType.toUpperCase()}</span> : null}
                {a.active && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                {a.disabled && <span className="acct-disabled-badge">已停用</span>}
                <label className="bot-switch acct-switch" title={a.disabled ? (activeProvider && !a.active ? `已有供应商生效（一次只能启用一个），先停用再启用这个账号` : "已停用，点击启用") : "启用中，点击停用"} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={!a.disabled} disabled={working === "tg" + a.id || (a.disabled && Boolean(activeProvider) && !a.active)} onChange={(event) => void toggleAccount(a.id, event.target.checked)} /><span />
                </label>
              </div>
              <p className="openai-sub-line">订阅{a.subscriptionUntil ? "至 " + a.subscriptionUntil.slice(0, 10) : "生效中"} · {new Date(a.savedAt).toLocaleString()} 登录</p>
              {primary ? (
                <div className="openai-quota-bar">
                  <div className="openai-quota-bar-label"><span>{primary.label}</span><b>{Math.round(primary.value)}%</b></div>
                  <div className="relay-plan-progress"><i style={{ width: Math.min(100, primary.value) + "%" }} /></div>
                {primary.resetAt ? <div className="openai-reset-line"><Clock3 size={10} />{openaiResetText(primary.resetAt, nowTick)}</div> : null}
                </div>
              ) : <p className="openai-sub-line">点卡片查看额度监控面板</p>}
              <div className="relay-plan-card-foot">
                <span className="relay-plan-live openai-card-hint"><CircleGauge size={11} />监控面板</span>
                {!a.active && <button className="secondary-setting" disabled={working !== "" || a.disabled} title={a.disabled ? "已停用的账号不能启用订阅，请先在卡片上重新启用" : undefined} onClick={(event) => { event.stopPropagation(); void enableSubscription(a.id); }}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}启用订阅</button>}
              </div>
            </div>
          );
        })}
        {!accounts.length && <div className="relay-plan-card"><div className="relay-plan-card-head"><Bot size={15} /><strong>暂无已保存账号</strong></div><p>点下方「添加 OpenAI 账号」，ChatGPT 设备码登录，可添加多个统一监控。</p></div>}
        <button className="relay-plan-card relay-add-card" onClick={() => setLoginModalOpen(true)}>
          <Plus size={18} />
          <strong>添加 OpenAI 账号</strong>
          <small>ChatGPT 设备码登录 · 自动启用订阅</small>
        </button>
      </div>
      {manageOpen && (() => {
        const a = accounts.find((x) => x.email === manageEmail);
        if (!a) return null;
        const usageRaw = usageMap[a.email];
        let bars: { label: string; value: number; resetAt?: number }[] = [];
        if (usageRaw && !usageRaw.startsWith("ERR:")) {
          try {
            const parsed = JSON.parse(usageRaw);
            const panel = parseOpenaiUsagePanel(parsed);
            bars = panel.windows.map((w) => ({ label: w.label, value: w.usedPercent, resetAt: w.resetAt }));
            if (!bars.length) bars = extractQuotaBars(parsed).map((b) => ({ label: b.label, value: b.value }));
          } catch { bars = []; }
        }
        return (
          <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}>
            <div className="relay-manage-modal">
              <div className="relay-keys-head">
                <strong className="relay-modal-title"><Bot size={15} />{a.email || a.id}</strong>
                {a.planType ? <span className="openai-plan-badge">{a.planType.toUpperCase()}</span> : null}
                {a.active && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                <button className="icon-button relay-modal-close" title="关闭" onClick={() => setManageOpen(false)}><X size={15} /></button>
              </div>
              <p className="openai-sub-line">订阅{a.subscriptionUntil ? "至 " + a.subscriptionUntil.slice(0, 10) : "生效中"} · {new Date(a.savedAt).toLocaleString()} 登录 · 额度与官方实时同步</p>
              {usageRaw && !usageRaw.startsWith("ERR:") && bars.length > 0 && (
                <div className="openai-quota-bars">
                  {bars.map((bar) => (
                    <div className="openai-quota-bar" key={bar.label}>
                      <div className="openai-quota-bar-label"><span>{bar.label}</span><b>{Math.round(bar.value)}%</b></div>
                      <div className="relay-plan-progress"><i style={{ width: Math.min(100, bar.value) + "%" }} /></div>
                      {bar.resetAt ? <div className="openai-reset-line"><Clock3 size={10} />{openaiResetText(bar.resetAt, nowTick)}</div> : null}
                    </div>
                  ))}
                </div>
              )}
              {usageRaw && !usageRaw.startsWith("ERR:") && bars.length === 0 && <p className="openai-sub-line">官方未返回百分比额度数据（可能尚未产生用量）。</p>}
              {usageRaw && usageRaw.startsWith("ERR:") && <p className="openai-sub-line openai-quota-err">{usageRaw.slice(4)}</p>}
              <div className="relay-plan-card-foot">
                <button className="secondary-setting" disabled={working !== ""} onClick={() => void loadUsage(a.email)}><RefreshCw size={13} />刷新额度</button>
                {a.active
                  ? <button className="secondary-setting" disabled={working !== ""} onClick={() => void onActivate(OFFICIAL_MODELS)}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}重新启用</button>
                  : <button className="secondary-setting" disabled={working !== "" || Boolean(activeProvider)} title={activeProvider ? `已有供应商「${activeProvider}」生效，请先停用再启用 OpenAI 订阅` : undefined} onClick={() => void enableSubscription(a.id)}>{working === "en" + a.id ? <Spinner /> : <Play size={13} />}启用订阅</button>}
                <button className="secondary-setting relay-account-remove" title="删除账号" disabled={working !== ""} onClick={() => void removeAccount(a.id)}><LogOut size={13} /></button>
              </div>
              <p className="relay-center-foot">启用 = 写入引擎并重启生效，直接可对话；额度数据来自 chatgpt.com 后端（wham/usage）。</p>
            </div>
          </div>
        );
      })()}
      {loginModalOpen && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginModalOpen(false); }}>
          <div className="relay-manage-modal relay-login-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><LogIn size={15} />添加 OpenAI 账号</strong>
              <small>设备码登录 · 自动收进账号库并启用订阅</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setLoginModalOpen(false)}><X size={15} /></button>
            </div>
            <p className="openai-sub-line">点击登录后浏览器会打开 OpenAI 授权页，输入验证码即可；登录成功自动启用订阅并进入可用状态。OpenAI 有区域限制，需要可访问 OpenAI 的网络（代理）。</p>
            <div className="relay-key-form openai-add-row">
              <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="代理地址（可选，如 http://127.0.0.1:7897）" />
              <button className="primary-setting" disabled={busy} onClick={() => void startLogin()}>{busy ? <><Spinner />等待浏览器登录…</> : <><LogIn size={14} />设备码登录</>}</button>
            </div>
            {device && (
              <div className="official-device openai-device-panel">
                {device.url && <>浏览器已打开授权页，输入验证码：<b>{device.code || "见下方引擎输出"}</b></>}
                {!device.url && "正在向 OpenAI 申请设备验证码…"}
                {device.raw ? <pre className="official-usage">{device.raw}</pre> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
function RelayBalanceBadge({ active }: { active: RelayActive | null }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // 强信号指纹：provider / apiKey / mode / groupId / switchedAt 任一变化都代表切换了账户或计费方式。
  // 原实现只按 provider 名做 useMemo，同网关换账号时 provider 字符串不变 → 徽标永不刷新、余额/套餐卡死在旧账号。
  const fingerprint = `${active?.provider ?? ""}|${active?.apiKey ?? ""}|${active?.mode ?? ""}|${active?.groupId ?? ""}|${active?.switchedAt ?? 0}`;
  const refresh = useCallback(() => {
    if (!active) return;
    window.codex.relayOverview().then((data) => { setOverview(data); setErr(""); }).catch((e) => setErr(e.message ?? "加载失败"));
  }, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!active) return null;
  const subs: any[] = overview?.subscriptions ?? [];
  const current = subs.find((s) => s.group_id === active.groupId);
  let label = "中转站";
  if (active.mode === "balance") {
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  } else if (current) {
    const limit = current.monthly_limit_usd ?? current.daily_limit_usd ?? 0;
    const used = current.monthly_used_usd ?? current.daily_used_usd ?? 0;
    label = overview ? `${shortGroupName(current.group_name, 12)} 剩 $${Math.max(0, limit - used).toFixed(2)}` : "套餐 …";
  } else if (overview) {
    // 该分组没有生效订阅：用量按量从账户余额扣（如站方把 key 分组清掉、或选了非订阅分组的老 key）
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  }
  return <div className="relay-badge" ref={wrapRef}>
    <button type="button" className="context-ring relay-badge-btn" title="中转站余额" aria-label="中转站余额" onClick={() => { setOpen((v) => !v); if (!overview) refresh(); }}>
      <Wallet size={13} /><small>{err ? "余额同步失败" : label}</small>
    </button>
    {open && <div className="ctx-pop relay-pop" role="dialog" aria-label="中转站余额明细" onMouseLeave={() => setOpen(false)}>
      <div className="ctx-pop-head"><strong>{active.label || "中转站"}</strong></div>
      <div className="ctx-pop-sub">{overview?.email || ""}{err ? ` · ${err}` : ""}{active.apiKey ? ` · 密钥 …${active.apiKey.slice(-6)}` : ""}</div>
      <div className="ctx-pop-grid">
        <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">账户余额</span><b className="ctx-pop-cell-value">{overview ? `$${Number(overview.balance).toFixed(2)}` : "…"}</b></div>
        {subs.map((s) => {
          const values = [
            s.monthly_limit_usd != null ? `月剩 $${Math.max(0, s.monthly_limit_usd - (s.monthly_used_usd ?? 0)).toFixed(2)}` : "",
            s.weekly_limit_usd != null ? `周剩 $${Math.max(0, s.weekly_limit_usd - (s.weekly_used_usd ?? 0)).toFixed(2)}` : "",
          ].filter(Boolean).join(" · ");
          return (
            <div className="ctx-pop-cell" key={s.id}>
              <span className="ctx-pop-cell-label" title={`${s.group_name ?? ""}${s.expires_at ? `（至 ${String(s.expires_at).slice(0, 10)}）` : ""}`}>{shortGroupName(s.group_name, 18)}{s.expires_at ? ` · ${String(s.expires_at).slice(5, 10)}` : ""}</span>
              <b className="ctx-pop-cell-value">{values || "生效中"}</b>
            </div>
          );
        })}
      </div>
      <p className="ctx-pop-cache-note">设置 → 账户 → 中转站 可切换账号、套餐或密钥。</p>
    </div>}
  </div>;
}

/** 模型设置页里的中转站精简入口：显示当前绑定状态，点击进独立中转站页。 */
function RelayAccountEntryBanner({ active, onOpen }: { active: { label: string } | null; onOpen: () => void }) {
  return (
    <button type="button" className="relay-entry-banner" onClick={onOpen}>
      <Wallet size={14} />
      <span>{active ? <>中转站账户 · 当前使用 <b>{active.label}</b></> : "中转站账户 · 登录后同步余额与订阅套餐，一键接入"}</span>
      <ChevronRight size={14} />
    </button>
  );
}

/** 中转站中心页（设置 → 中转站）：余额总览 + 套餐卡片 + 登录/退出 + 一键切换计费方式。 */
function RelayCenterPage({ busy, activeProvider, onActivate, onNotice, onOpenModelSettings }: { busy: boolean; activeProvider?: string; onActivate: (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => Promise<void> | void; onNotice: (m: string) => void; onOpenModelSettings: () => void }) {
  const [account, setAccount] = useState<{ baseUrl: string; email: string } | null>(null);
  const [draft, setDraft] = useState({ baseUrl: "https://api.pptoken.cc", email: "", password: "" });
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState("");
  const [working, setWorking] = useState("");
  const active = readRelayActive();
  const isActiveProvider = Boolean(active && activeProvider === active.provider);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (silent = true) => {
    if (!silent) setRefreshing(true);
    try {
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) {
        setAccount({ baseUrl: acc.baseUrl, email: acc.email });
        try {
          setOverview(await window.codex.relayOverview());
          setErr("");
          if (!silent) onNotice("已刷新余额与套餐");
        } catch (e: any) {
          // 保留旧数据不闪空，错误显示在页面
          setErr(e.message ?? "刷新失败");
        }
      } else if (acc) setDraft((d) => ({ ...d, baseUrl: acc.baseUrl, email: acc.email }));
    } catch { /* 未登录过 */ } finally { if (!silent) setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 账户列表（多账号管理）
  const [accounts, setAccounts] = useState<any[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const reloadAccounts = useCallback(async () => {
    try { setAccounts(await window.codex.relayAccounts()); } catch { setAccounts([]); }
  }, []);
  useEffect(() => { void reloadAccounts(); }, [reloadAccounts]);
  // 登录/切换账号后自动配置模型：已选中 key 优先 → 第一个套餐 → 余额（参数同步内置规格表在 onActivate 链路内）
  const autoConfigure = async () => {
    const ov = await window.codex.relayOverview().catch(() => null);
    setOverview(ov);
    // 简单规则：有生效订阅 → 用第一个订阅套餐；没有 → 走余额计费。
    // 匹配不到可复用的 key 时激活链路会自动新建（Harness-套餐名/Harness-余额），站点强制绑分组时自动改绑重试。
    const subs: any[] = ov?.subscriptions ?? [];
    try {
      if (subs.length) {
        await onActivate("plan", { group_id: Number(subs[0].group_id), group_name: String(subs[0].group_name ?? "套餐") });
      } else {
        await onActivate("balance");
      }
      setOverview(await window.codex.relayOverview().catch(() => ov));
    } catch (e: any) {
      setErr("模型自动配置失败：" + (e.message ?? e) + "。可在下方密钥列表手动选择一把 key 重试。");
    }
  };
  const login = async () => {
    setWorking("login"); setErr("");
    try {
      await window.codex.relayLogin({ baseUrl: draft.baseUrl, email: draft.email, password: draft.password });
      setDraft((d) => ({ ...d, password: "" }));
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) {
        setAccount({ baseUrl: acc.baseUrl, email: acc.email });
        onNotice("中转站登录成功，正在自动配置模型…");
        setLoginModalOpen(false);
        void reloadAccounts();
        await autoConfigure();
      }
    } catch (e: any) { setErr(e.message ?? "登录失败"); } finally { setWorking(""); }
  };
  const switchAccount = async (id: string) => {
    setWorking(`acc${id}`); setErr("");
    try {
      const r = await window.codex.relaySwitchAccount(id);
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) setAccount({ baseUrl: acc.baseUrl, email: acc.email });
      onNotice(`已切换账号：${r.email}`);
      await reloadAccounts();
      await autoConfigure();
    } catch (e: any) { setErr("切换账号失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  const removeAccount = async (id: string) => {
    setWorking(`acc${id}`); setErr("");
    try {
      const r = await window.codex.relayRemoveAccount(id);
      onNotice("账号已删除");
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn && r.activeId) {
        setAccount({ baseUrl: acc.baseUrl, email: acc.email });
        await reloadAccounts();
        await autoConfigure();
      } else {
        setAccount(null); setOverview(null);
        writeRelayActive(null);
        await reloadAccounts();
      }
    } catch (e: any) { setErr("删除账号失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 账号启用/停用：停用 = 退出切换候选（数据保留）；停用使用中的账号会同步禁用其供应商并退出生效。
  // 重新启用时若当前没有任何生效账号（停用当前会清掉生效模型配置），自动恢复该账号为生效——
  // 否则用户「停用→启用」一圈回来还得重新走模型配置（09-09 反馈：隔夜模型配置没了又让我配置）
  const toggleAccount = async (id: string, enabled: boolean) => {
    setWorking(`tg${id}`); setErr("");
    try {
      const r = await window.codex.relayToggleAccount({ id, disabled: !enabled });
      await reloadAccounts();
      if ((r as any).deactivated) {
        writeRelayActive(null);
        setAccount(null); setOverview(null);
        onNotice("账号已停用，对应供应商已禁用并退出当前生效（重新打开开关后可重新设为当前）");
        return;
      }
      const list = enabled ? await window.codex.relayAccounts().catch(() => []) : [];
      if (enabled) {
        // 全局互斥：启用 A 时自动停用其他已启用的账号（开关即生效候选，一次只能开一个）
        for (const other of list) {
          if (other.id !== id && !other.disabled) {
            await window.codex.relayToggleAccount({ id: other.id, disabled: true }).catch(() => undefined);
          }
        }
        if (list.some((a: any) => a.active)) {
          // 已有生效账号（就是本账号）：直接完成
          onNotice("账号已启用，当前生效");
          return;
        }
        // 没有生效账号：自动把刚启用的账号设为当前（切换 + 自动重配模型 + 引擎重启）
        const target = list.find((a: any) => a.id === id);
        if (target?.loggedIn) {
          onNotice("账号已启用，正在自动设为当前生效…");
          await window.codex.relaySwitchAccount(id);
          const acc = await window.codex.relayLoadAccount();
          if (acc?.loggedIn) setAccount({ baseUrl: acc.baseUrl, email: acc.email });
          await reloadAccounts();
          await autoConfigure();
          onNotice("账号已启用并设为当前生效，模型已自动重配");
          return;
        }
      }
      onNotice(enabled ? "账号已启用，可设为当前生效" : "账号已停用，不再出现在切换候选中");
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, ""));
      await reloadAccounts();
    } finally { setWorking(""); }
  };
  // 点账号卡片：非当前账号先切换（自动重配），再打开管理弹窗
  const openManage = async (a: any) => {
    if (!a.active) await switchAccount(a.id);
    setManageOpen(true);
    await load(false);
    void loadKeyGroups();
  };
  const logout = async () => {
    await window.codex.relayLogout();
    const acc = await window.codex.relayLoadAccount();
    if (acc?.loggedIn) {
      // 还有其他账号：自动切到剩余的第一个并重新配置
      setAccount({ baseUrl: acc.baseUrl, email: acc.email });
      onNotice("已退出当前账号，已切换到剩余账号并重新配置");
      await reloadAccounts();
      await autoConfigure();
    } else {
      writeRelayActive(null);
      setAccount(null); setOverview(null);
      await reloadAccounts();
      onNotice("已退出中转站账户（生成的供应商保留，可在模型设置里删除）");
    }
  };
  const switchTarget = async (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => {
    setWorking(mode + (group?.group_id ?? "") + (explicitKey ? `key${explicitKey.id}` : "")); setErr("");
    try {
      await onActivate(mode, group, explicitKey);
    } catch (e: any) {
      setErr("切换失败：" + (e.message ?? e)); // 常驻显示在页面，不再只靠几秒的 toast
    } finally { setWorking(""); }
    setOverview(await window.codex.relayOverview().catch(() => null));
  };
  const subs: any[] = overview?.subscriptions ?? [];
  const progress = (used: number, limit: number) => Math.min(100, Math.max(2, limit > 0 ? (used / limit) * 100 : 4));
  // 密钥管理区状态
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKey, setNewKey] = useState({ name: "", groupId: "" });
  const [creatingKey, setCreatingKey] = useState(false);
  // 全部账号的密钥（按账户分组，支持折叠）
  const [keyGroups, setKeyGroups] = useState<any[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [keysCollapsed, setKeysCollapsed] = useState(false); // 弹窗内密钥区折叠
  const loadKeyGroups = useCallback(async () => {
    try {
      const groups = await window.codex.relayKeysAll();
      setKeyGroups(groups);
      setCollapsedGroups((prev) => {
        const next: Record<string, boolean> = {};
        for (const g of groups) next[g.id] = prev[g.id] ?? !g.active; // 默认只展开当前账号
        return next;
      });
    } catch { setKeyGroups([]); }
  }, []);
  useEffect(() => { void loadKeyGroups(); }, [loadKeyGroups]);
  const groupNameOf = (gid: any) => {
    if (gid == null) return "无分组";
    const sub = (overview?.subscriptions ?? []).find((s: any) => Number(s.group_id) === Number(gid));
    if (sub) return String(sub.group_name ?? `分组 ${gid}`);
    const g = (overview?.groups ?? []).find((x: any) => Number(x.group_id ?? x.id) === Number(gid));
    return String(g?.group_name ?? g?.name ?? `分组 ${gid}`);
  };
  const createKey = async () => {
    setCreatingKey(true); setErr("");
    try {
      await window.codex.relayCreateKey({ name: newKey.name.trim(), groupId: newKey.groupId ? Number(newKey.groupId) : null });
      setNewKey({ name: "", groupId: "" }); setShowKeyForm(false);
      setOverview(await window.codex.relayOverview().catch(() => null));
      void loadKeyGroups();
      onNotice("密钥已创建");
    } catch (e: any) { setErr("创建密钥失败：" + (e.message ?? e)); } finally { setCreatingKey(false); }
  };
  const useKeyFromGroup = async (group: any, k: any) => {
    // 非当前账号的 key：先切到该账号再激活（激活链路会用该账号网关+这把 key）
    try {
      if (!group.active) await window.codex.relaySwitchAccount(group.id);
      await switchTarget(k.group_id != null ? "plan" : "balance", k.group_id != null ? { group_id: Number(k.group_id), group_name: shortGroupName(k.group_name ?? k.group_id, 16) } : undefined, { id: k.id, name: k.name, key: String(k.key ?? ""), group_id: k.group_id ?? null });
      void loadKeyGroups();
    } catch { /* switchTarget 已常驻报错 */ }
  };
  // 当前生效密钥：按已选 keyId / 计费方式与分组从密钥列表匹配（与 resolveRelayTarget 同规则）
  const [keyVisible, setKeyVisible] = useState(false);
  const currentKey = useMemo(() => {
    if (!overview) return null;
    const keys: any[] = overview.keys ?? [];
    if (overview.selectedKeyId != null) {
      const byId = keys.find((k) => k.id === overview.selectedKeyId);
      if (byId) return byId;
    }
    if (overview.selectedMode === "plan" && overview.selectedGroupId != null) return keys.find((k) => k.status === "active" && k.group_id === overview.selectedGroupId) ?? null;
    if (overview.selectedMode === "balance") return keys.find((k) => k.status === "active" && k.group_id == null) ?? null;
    return null;
  }, [overview]);
  const maskKey = (key: string) => key.length > 14 ? `${key.slice(0, 10)}••••••••${key.slice(-4)}` : key;
  return (
    <section className="settings-section stack relay-center">
      <div className="settings-copy channel-heading"><div><h2>中转站</h2><p>每个中转站账号一张卡片：点卡片进入该账号的管理面板（余额总览、订阅套餐、密钥管理），所有操作即时生效；聊天输入框旁会实时显示当前余量。</p></div></div>
      {err && <p className="relay-account-err"><AlertTriangle size={13} />{err}</p>}
      <div className="relay-plan-grid relay-home-grid">
        {accounts.map((a) => {
          const group = keyGroups.find((g) => g.id === a.id);
          const keyCount = group ? (group.keys ?? []).length : null;
          return (
            <div className={`relay-plan-card relay-account-card ${a.active ? "selected" : ""}${a.disabled ? " acct-disabled" : ""}`} key={a.id} onClick={() => void openManage(a)} title="点卡片进入管理面板">
              <div className="relay-plan-card-head">
                <span className="relay-key-status" data-status={a.loggedIn && !group?.error ? "on" : "off"} />
                <strong title={a.email}>{a.email}</strong>
                {a.active && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                {a.disabled && <span className="acct-disabled-badge">已停用</span>}
                <label className="bot-switch acct-switch" title={a.disabled ? (activeProvider && !a.active ? `已有供应商生效（一次只能启用一个），先停用再启用这个账号` : "已停用，点击启用") : "启用中，点击停用"} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={!a.disabled} disabled={working === `tg${a.id}` || (a.disabled && Boolean(activeProvider) && !a.active)} onChange={(event) => void toggleAccount(a.id, event.target.checked)} /><span />
                </label>
              </div>
              <p>{String(a.baseUrl || "").replace(/^https?:\/\//, "")}</p>
              <p>{keyCount == null ? "密钥未读取" : `${keyCount} 把密钥`}{a.selectedKeyName ? ` · 当前 ${a.selectedKeyName}` : ""}</p>
              <div className="relay-plan-card-foot">
                {a.active
                  ? <span className="relay-plan-live"><Check size={11} />当前生效</span>
                  : <button className="secondary-setting" disabled={working !== "" || a.disabled || (Boolean(activeProvider) && !isActiveProvider)} title={activeProvider && !isActiveProvider ? `已有供应商生效，请先停用再设为当前` : (a.disabled ? "已停用的账号不能设为当前，请先在卡片上启用" : undefined)} onClick={(event) => { event.stopPropagation(); void switchAccount(a.id); }}>{working === `acc${a.id}` ? <Spinner /> : <Play size={13} />}设为当前</button>}
                <button className="secondary-setting" onClick={(event) => { event.stopPropagation(); void openManage(a); }}><Settings2 size={13} />管理</button>
                <button className="secondary-setting relay-account-remove" title="删除账号" disabled={working !== ""} onClick={(event) => { event.stopPropagation(); void removeAccount(a.id); }}><LogOut size={13} /></button>
              </div>
            </div>
          );
        })}
        <button className="relay-plan-card relay-add-card" onClick={() => setLoginModalOpen(true)}>
          <Plus size={18} />
          <strong>添加中转站账号</strong>
          <small>支持任意 sub2api 网关，登录后余额与套餐一键接入</small>
        </button>
      </div>
      <p className="relay-center-foot">{isActiveProvider ? <>当前生效供应商「{active!.label}」，输入框旁的余额徽标实时同步；点上方卡片进入各账号的管理面板。</> : <>尚无生效供应商：点账号卡片进入管理面板，选套餐或密钥即可自动生成并切换。</>}</p>
      {manageOpen && account && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}>
          <div className="relay-manage-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><Wallet size={15} />{account.email}</strong>
              <small>{account.baseUrl}</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setManageOpen(false)}><X size={15} /></button>
            </div>
            <div className="relay-hero">
              <div className="relay-hero-main">
                <small>账户余额（USD）</small>
                <strong>{overview ? `$${Number(overview.balance).toFixed(2)}` : "…"}</strong>
                <span>{overview?.email || account.email} · {account.baseUrl}</span>
                {currentKey && (
                  <span className="relay-hero-key">
                    <em>当前密钥{currentKey.name ? `（${currentKey.name}）` : ""}</em>
                    <code>{keyVisible ? currentKey.key : maskKey(currentKey.key)}</code>
                    <button type="button" className="icon-button" title={keyVisible ? "隐藏密钥" : "显示密钥"} onClick={() => setKeyVisible((v) => !v)}>{keyVisible ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    <button type="button" className="icon-button" title="复制密钥" onClick={async () => { try { await navigator.clipboard.writeText(currentKey.key); onNotice("当前密钥已复制"); } catch { onNotice("复制失败，请手动选择复制"); } }}><Copy size={12} /></button>
                  </span>
                )}
              </div>
              <div className="relay-hero-actions">
                <button className="icon-button" title="刷新余额与套餐" disabled={refreshing} onClick={() => void load(false)}>{refreshing ? <Spinner /> : <RefreshCw size={14} />}</button>
                <button className="secondary-setting" onClick={() => onOpenModelSettings()}><Bot size={13} />模型配置</button>
                <button className="secondary-setting" onClick={() => void logout()}><LogOut size={13} />退出登录</button>
              </div>
            </div>
            {overview?.selectedMode && !isActiveProvider && <p className="relay-account-err"><AlertTriangle size={13} />上次切换没有完成（供应商未生成）：点下方套餐卡或密钥的「使用」重新激活即可。</p>}
            <div className="relay-plan-grid">
              {subs.map((s) => {
                const limit = s.monthly_limit_usd ?? s.daily_limit_usd ?? 0;
                const used = s.monthly_used_usd ?? s.daily_used_usd ?? 0;
                const isSelected = isActiveProvider && overview?.selectedMode === "plan" && overview?.selectedGroupId === s.group_id;
                return (
                  <div className={`relay-plan-card ${isSelected ? "selected" : ""}`} key={s.id}>
                    <div className="relay-plan-card-head"><FolderTree size={15} /><strong title={s.group_name}>{shortGroupName(s.group_name, 16)}</strong>{isSelected && <span className="relay-plan-live"><Check size={11} />使用中</span>}</div>
                    <div className="relay-plan-progress"><i style={{ width: `${progress(Number(used), Number(limit))}%` }} /></div>
                    <p>已用 ${Number(used).toFixed(2)}{limit ? ` / 月上限 $${Number(limit).toFixed(2)}` : ""}{s.expires_at ? ` · 到期 ${String(s.expires_at).slice(0, 10)}` : ""}</p>
                    <div className="relay-plan-card-foot">
                      <small>{limit ? `剩余 $${Math.max(0, Number(limit) - Number(used)).toFixed(2)}` : "生效中"}</small>
                      <button className="secondary-setting" disabled={busy || working !== ""} onClick={() => void switchTarget("plan", { group_id: Number(s.group_id), group_name: String(s.group_name ?? "套餐") })}>{working === `plan${s.group_id}` ? <Spinner /> : isSelected ? <Check size={13} /> : <Play size={13} />}使用此套餐</button>
                    </div>
                  </div>
                );
              })}
              {!subs.length && <div className="relay-plan-card"><div className="relay-plan-card-head"><FolderTree size={15} /><strong>暂无生效中的套餐</strong></div><p>可在中转站官网购买订阅套餐，购买后点「刷新」同步；或直接在下方「API 密钥」里选一把 key 使用（按量从余额扣）。</p></div>}
            </div>
            <div className="relay-keys-card">
              <div className="relay-keys-head">
                <button type="button" className="relay-keys-toggle" onClick={() => setKeysCollapsed((v) => !v)}>
                  {keysCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <strong>API 密钥</strong>
                  <small>本账号的密钥 · 选一把即生成供应商并切换</small>
                </button>
                <button className="secondary-setting" onClick={() => setShowKeyForm((v) => !v)}>{showKeyForm ? "收起" : <><Plus size={13} />新建密钥</>}</button>
              </div>
              {showKeyForm && (
                <div className="relay-key-form">
                  <input value={newKey.name} onChange={(event) => setNewKey({ ...newKey, name: event.target.value })} placeholder="密钥名称（如 Harness-主力）" />
                  <select value={newKey.groupId} onChange={(event) => setNewKey({ ...newKey, groupId: event.target.value })}>
                    <option value="">无分组（部分站点不支持）</option>
                    {(overview?.groups ?? []).map((g: any) => <option key={g.group_id ?? g.id} value={String(g.group_id ?? g.id)}>{g.group_name ?? g.name ?? `分组 ${g.group_id ?? g.id}`}</option>)}
                    {(overview?.subscriptions ?? []).filter((s: any) => !(overview?.groups ?? []).some((g: any) => Number(g.group_id ?? g.id) === Number(s.group_id))).map((s: any) => <option key={s.group_id} value={String(s.group_id)}>{s.group_name}（订阅分组）</option>)}
                  </select>
                  <button className="primary-setting" disabled={creatingKey || !newKey.name.trim()} onClick={() => void createKey()}>{creatingKey ? <Spinner /> : <Plus size={13} />}创建</button>
                </div>
              )}
              {!keysCollapsed && (
                <>
              {showKeyForm && (
                <div className="relay-key-form">
                  <input value={newKey.name} onChange={(event) => setNewKey({ ...newKey, name: event.target.value })} placeholder="密钥名称（如 Harness-主力）" />
                  <select value={newKey.groupId} onChange={(event) => setNewKey({ ...newKey, groupId: event.target.value })}>
                    <option value="">无分组（部分站点不支持）</option>
                    {(overview?.groups ?? []).map((g: any) => <option key={g.group_id ?? g.id} value={String(g.group_id ?? g.id)}>{g.group_name ?? g.name ?? `分组 ${g.group_id ?? g.id}`}</option>)}
                    {(overview?.subscriptions ?? []).filter((s: any) => !(overview?.groups ?? []).some((g: any) => Number(g.group_id ?? g.id) === Number(s.group_id))).map((s: any) => <option key={s.group_id} value={String(s.group_id)}>{s.group_name}（订阅分组）</option>)}
                  </select>
                  <button className="primary-setting" disabled={creatingKey || !newKey.name.trim()} onClick={() => void createKey()}>{creatingKey ? <Spinner /> : <Plus size={13} />}创建</button>
                </div>
              )}
              {(() => {
                const group = keyGroups.find((g) => g.active) ?? keyGroups[0];
                if (!group) return <p className="relay-key-empty">暂无账号密钥。</p>;
                const rows = [...(group.keys ?? [])].reverse();
                return (
                  <div className="relay-key-list">
                    {group.error && <p className="relay-key-empty">读取失败：{group.error}</p>}
                    {rows.map((k: any) => {
                      const isCurrent = Boolean(active?.apiKey && k.key && String(k.key) === String(active.apiKey));
                      return (
                        <div className={`relay-key-row ${isCurrent ? "current" : ""}`} key={k.id}>
                          <span className="relay-key-status" data-status={k.status === "active" ? "on" : "off"} title={k.status} />
                          <span className="relay-key-name" title={k.name}>{k.name || `密钥 #${k.id}`}</span>
                          <code className="relay-key-tail">{String(k.key ?? "").slice(0, 6)}••••{String(k.key ?? "").slice(-4)}</code>
                          <small className="relay-key-group">{groupNameOf(k.group_id)}</small>
                          {isCurrent
                            ? <span className="relay-plan-live"><Check size={11} />使用中</span>
                            : <button className="secondary-setting" disabled={busy || working !== ""} onClick={() => void useKeyFromGroup(group, k)}>{working === `key${k.id}` ? <Spinner /> : <Play size={13} />}使用</button>}
                        </div>
                      );
                    })}
                    {!rows.length && !group.error && <p className="relay-key-empty">该账号暂无密钥，点上方「新建密钥」创建。</p>}
                  </div>
                );
              })()}
                </>
              )}
            </div>
            <p className="relay-center-foot">{isActiveProvider ? <>当前供应商即中转站生成的「{active!.label}」，输入框旁的余额徽标实时同步。</> : <>点套餐卡的「使用此套餐」或密钥列表的「使用」，会自动生成供应商并切换，无需手动去模型设置新增。</>}</p>
          </div>
        </div>
      )}
      {loginModalOpen && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginModalOpen(false); }}>
          <div className="relay-manage-modal relay-login-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><Wallet size={15} />登录中转站</strong>
              <small>sub2api 站点账号密码，余额与套餐一键接入</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setLoginModalOpen(false)}><X size={15} /></button>
            </div>
            <label className="se-field"><span>站点地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.pptoken.cc" /></label>
            <label className="se-field"><span>邮箱</span><input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="你在中转站的账号邮箱" /></label>
            <label className="se-field"><span>密码</span><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="账号密码" onKeyDown={(event) => { if (event.key === "Enter" && draft.email && draft.password) void login(); }} /></label>
            <button className="primary-setting relay-login-btn" disabled={working === "login" || !draft.email || !draft.password} onClick={() => void login()}>{working === "login" ? <><Spinner />正在登录…</> : <><LogIn size={15} />登录并自动配置</>}</button>
          </div>
        </div>
      )}
    </section>
  );
}
function ContextUsageBadge({ tokenUsage, fallbackWindow, recentCompaction, onCompact }: { tokenUsage?: any; fallbackWindow?: number; recentCompaction?: boolean; onCompact?: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const contextWindow = tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? fallbackWindow;
  const lastUsage = usageBucket(tokenUsage, "last");
  const totalUsage = usageBucket(tokenUsage, "total");
  const currentUsage = lastUsage ?? totalUsage;
  const cacheUsage = tokenUsage?.derivedLast ?? currentUsage;
  const used = currentUsage?.totalTokens ?? currentUsage?.total_tokens;
  if (!contextWindow) return null;
  const percent = used != null ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const input = usageInputTokens(cacheUsage);
  const cached = Math.min(input, usageCachedTokens(cacheUsage));
  const turnCacheRate = usageCacheRate(cacheUsage);
  const averageCacheRate = totalUsage ? usageCacheRate(totalUsage) : null;
  const summaryCacheRate = averageCacheRate ?? turnCacheRate;
  const ctx = (value: any) => value != null ? Math.round((Number(value) / contextWindow) * 1000) / 10 : null;
  const details = [
    { label: "消息", value: ctx(currentUsage?.messageTokens ?? currentUsage?.message_tokens) },
    { label: "MCP 工具", value: ctx(currentUsage?.mcpToolTokens ?? currentUsage?.mcp_tool_tokens) },
    { label: "系统工具", value: ctx(currentUsage?.systemToolTokens ?? currentUsage?.system_tool_tokens) },
    { label: "技能", value: ctx(currentUsage?.skillTokens ?? currentUsage?.skill_tokens) },
    { label: "系统提示词", value: ctx(currentUsage?.systemPromptTokens ?? currentUsage?.system_prompt_tokens) },
    { label: "其他", value: ctx(currentUsage?.otherTokens ?? currentUsage?.other_tokens) },
  ].filter((entry) => entry.value != null) as { label: string; value: number }[];
  const rows = details.length ? details : [{ label: "已用", value: Math.round(percent * 10) / 10 }];
  return (
    <div className="ctx-badge" ref={wrapRef}>
      <button type="button" className="ctx-badge-btn" title={used != null ? `上下文 ${Math.round(percent)}%` : `上下文窗口 ${contextWindow.toLocaleString()} Token · 用量待同步`} aria-label="上下文容量" onClick={() => setOpen((currentOpen) => !currentOpen)} onMouseEnter={() => setOpen(true)}>
        <ContextRing tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} />
      </button>
      {open && (
        <div className="ctx-pop" role="dialog" aria-label="上下文容量明细" onMouseLeave={() => setOpen(false)}>
          <div className="ctx-pop-head"><strong>上下文容量</strong></div>
          <div className="ctx-pop-sub">{used != null ? (used / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "0.0"}万/{(contextWindow / 10000).toLocaleString()}万（{used != null ? Math.round(percent * 10) / 10 : "—"}%{summaryCacheRate != null ? ` · 累计 ${summaryCacheRate}% 缓存` : ""}）</div>
          <div className="ctx-pop-bar"><i style={{ width: `${Math.max(2, percent)}%` }} /></div>
          <div className="ctx-pop-grid">
            {rows.map((entry) => (
              <div className="ctx-pop-cell" key={entry.label}>
                <span className="ctx-pop-cell-label">{entry.label}</span>
                <b className="ctx-pop-cell-value">{entry.value}%</b>
              </div>
            ))}
            {turnCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">本轮缓存命中率</span><b className="ctx-pop-cell-value">{turnCacheRate}%</b></div>}
            {averageCacheRate != null && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">会话累计命中率</span><b className="ctx-pop-cell-value">{averageCacheRate}%</b></div>}
            {input > 0 && <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">缓存输入</span><b className="ctx-pop-cell-value">{cached.toLocaleString()} / {input.toLocaleString()}</b></div>}
          </div>
          {turnCacheRate != null && turnCacheRate < 20 && input >= 8192 && <p className="ctx-pop-cache-note">{recentCompaction ? "上下文刚压缩过：提示词前缀已被重写，上游缓存需要 1~3 轮对话重建，期间命中率偏低属正常现象。" : "本轮缓存较低，通常是首次请求、恢复旧会话、上下文压缩、切换模型/供应商，或上游未复用相同提示词前缀导致。"}</p>}
          {onCompact && percent >= 70 && (
            <button type="button" className="ctx-pop-compact-btn" onClick={() => { setOpen(false); onCompact && onCompact(); }}>
              <Minimize2 size={13} />压缩上下文（已用 {Math.round(percent)}%）
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MessageFooter({ item, turn, usage, tokenUsage, fallbackWindow, onCopy, onQuote, onFork, onEdit, extraIcon }: { item: ThreadItem; turn?: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onEdit?: () => void; extraIcon?: any }) {
  const rawText = itemText(item);
  const isAgent = item.type === "agentMessage";
  // 用户消息对外文本：团队/成员会话首条的 SYSTEM TASK 段会被折叠，引用与复制只暴露用户原文
  const text = isAgent ? rawText : (rawText.trim() ? userDisplayText(rawText) : "");
  // 兼容引擎上报字段：inputTokens / input_tokens / promptTokens / prompt_tokens 等
  const num = (value: any) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  // 优先用回合级 usage；缺失时回落到 session 级 tokenUsage.last（最新一回合的用量）
  const u = usage ?? tokenUsage?.derivedLast ?? usageBucket(tokenUsage, "last") ?? usageBucket(tokenUsage, "total") ?? tokenUsage ?? null;
  const input = usageInputTokens(u);
  const output = usageNumber(u, "outputTokens", "output_tokens", "completionTokens", "completion_tokens");
  const cached = Math.min(input, usageCachedTokens(u));
  const total = num(u?.totalTokens ?? u?.total_tokens);
  const cacheRate = input > 0 ? Math.round((cached / input) * 100) : null;
  const showTokenInfo = isAgent && (input > 0 || output > 0 || total > 0);
  return (
    <div className="message-footer">
      {/* 用户消息：引用 → 编辑 → 复制（hover 项在前，常驻项在后） */}
      {!isAgent && text && <button className="message-action message-action-extra" title="引用" onClick={() => onQuote(text)}><Quote size={12} /></button>}
      {!isAgent && onEdit && <button className="message-action message-action-extra" title="编辑并重新发送" onClick={onEdit}><PenLine size={12} /></button>}
      {/* 复制：agent/用户消息都常驻，纯图标 */}
      {text && <button className="message-action message-action-default" title="复制消息" onClick={() => onCopy(text)}><Copy size={12} /></button>}
      {/* agent 常驻：分支 → 时间（上下文进度图标只在输入框下方的 ContextUsageBadge 展示） */}
      {isAgent && onFork && <button className="message-action message-action-default" title="从此处分支" onClick={onFork}><GitBranch size={12} />分支</button>}
      {isAgent && turn?.startedAt && <span><Clock3 size={12} />{formatTimestamp(turn.completedAt ?? turn.startedAt)}</span>}
      {/* agent hover：输入/输出 Token + 缓存命中率 + 引用 */}
      {isAgent && showTokenInfo && <span className="message-action-extra">{input.toLocaleString()} 入 / {output.toLocaleString()} 出{total > 0 ? ` · ${total.toLocaleString()} 总` : ""}</span>}
      {isAgent && cacheRate != null && <span className="message-action-extra">· {cacheRate}% 缓存</span>}
      {isAgent && text && <button className="message-action message-action-extra" title="引用" onClick={() => onQuote(text)}><Quote size={12} /></button>}
      {extraIcon}
    </div>
  );
}

function UserMessageEditor({ initial, onCancel, onSubmit }: { initial: string; onCancel: () => void; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="edit-message">
      <textarea value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSubmit(draft); }} placeholder="编辑消息内容" />
      <div className="edit-actions">
        <span>Ctrl+Enter 发送 · Esc 取消</span>
        <button className="ghost" onClick={onCancel}>取消</button>
        <button disabled={!draft.trim()} onClick={() => onSubmit(draft)}>保存并重新发送</button>
      </div>
    </div>
  );
}

/** 导入的会话记录卡：随首条消息附上的外部对话记录折叠成一行备注，点开看全文。
 *  pending 模式 = 尚未发送的预览（新会话第一条消息发出前展示在消息区顶部）；
 *  已发送的消息卡由 UserMessageView 按 refs.imported 渲染（pending=false）。 */
function ImportedRecordCard({ note, content, pending, onDiscard, kind = "imported", sourceId, onOpenSource }: { note: string; content: string; pending?: boolean; onDiscard?: () => void; kind?: "imported" | "thread"; sourceId?: string; onOpenSource?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const charCount = content.length;
  const threadReference = kind === "thread";
  const canOpenSource = Boolean(threadReference && sourceId && onOpenSource);
  return (
    <div className={`import-record-card${pending ? " pending" : ""}${threadReference ? " thread-reference" : ""}`}>
      <button type="button" className="import-record-head" aria-expanded={expanded} onClick={() => setExpanded((cur) => !cur)}>
        <span className="import-record-tag">{threadReference ? <Link2 size={11} /> : <FileUp size={11} />}{threadReference ? "引用的会话记录" : pending ? "导入的会话记录（待发送）" : "导入的会话记录"}</span>
        <span className="import-record-note">{note}</span>
        <span className="import-record-actions">
          {canOpenSource && (
            <span
              role="button"
              tabIndex={0}
              className="import-record-open"
              title="打开源会话"
              onClick={(event) => { event.stopPropagation(); onOpenSource?.(sourceId!); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onOpenSource?.(sourceId!); } }}
            >打开源会话</span>
          )}
          {pending && onDiscard && (
            <span
              role="button"
              tabIndex={0}
              className="import-record-discard"
              title="放弃导入（不会影响其他会话）"
              onClick={(event) => { event.stopPropagation(); onDiscard(); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onDiscard(); } }}
            >移除</span>
          )}
          <span className="import-record-toggle">{expanded ? "收起" : `展开全文 · ${charCount > 999 ? `${(charCount / 1000).toFixed(1)}k` : charCount} 字`}<ChevronUp size={12} className={expanded ? "" : "flip-down"} /></span>
        </span>
      </button>
      {expanded && <div className="import-record-body"><pre>{content}</pre></div>}
      {pending && !expanded && <div className="import-record-hint">还没发送：直接输入问题并发送，这条记录会随你的第一条消息一起交给 AI；可先展开检查内容。</div>}
    </div>
  );
}

/** 空会话（导入后、尚未发送）的消息区顶部预览：只挂载一次即读回记录全文，避免大文本参与流式渲染 */
function PendingImportSlot({ threadId, onDiscard }: { threadId: string; onDiscard: () => void }) {
  const [payload] = useState<PendingImportPayload | null>(() => readPendingImportStore()[threadId] ?? null);
  if (!payload) return null;
  return (
    <div className="import-preview-slot">
      <ImportedRecordCard note={fmtImportNote(payload)} content={payload.text} pending onDiscard={onDiscard} />
    </div>
  );
}

/** 刚发送出去的用户消息 id 集合（渲染层特效锚点）：send/编辑重发创建乐观气泡时登记，
 *  UserMessageView 挂载命中即播放「发送出去」入场特效并从集合删除——历史消息/切会话
 *  重挂载不会误播，乐观消息被服务端消息替换后（id 不同）也不会重复播放。 */
const justSentIds = new Set<string>();

function UserMessageView({ item, turn, fallbackWindow, pending, onCopy, onQuote, onImageCopy, onEditSubmit, onOpenFile, onOpenThread }: { item: ThreadItem; turn?: Turn; fallbackWindow?: number; pending?: boolean; onCopy: (text: string) => void; onQuote: (text: string) => void; onImageCopy?: (path: string) => void; onEditSubmit?: (item: ThreadItem) => void; onOpenFile?: (path: string) => void; onOpenThread?: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  // 首帧同步判定（useState 惰性初始化）：just-sent class 随首帧 DOM 一起出现，入场动画
  // 必定从挂载瞬间播放。旧版在 effect 里补 class：晚一帧、且与钉顶程序化滚动同帧，
  // 动画被滚动/重排吞掉——表现为「发消息没有过渡动画」（09-05 反馈）。
  const [justSent] = useState(() => justSentIds.has(String(item.id ?? "")));
  useEffect(() => {
    // 播过即清登记，历史消息/切会话重挂载不会误播
    if (justSent) justSentIds.delete(String(item.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // hooks 必须在 early return 之前按固定顺序调用，否则编辑时 hook 数量变化会触发 React error #300
  const rawText = itemText(item);
  const refs = useMemo<ParsedUserRefs>(() => parseUserRefs(rawText), [rawText]);
  // 引擎回读的图片 part 可能是 localImage / local_image / image(data URL) 三种形态（见 prompt-images.ts isImagePart）
  const images = (item.content ?? []).filter(isImagePart);
  if (editing) {
    const originalText = itemText(item);
    const originalRefs = parseUserRefs(originalText);
    const originalImages = (item.content ?? []).filter(isImagePart);
    return (
      <UserMessageEditor
        initial={userDisplayText(originalText)}
        onCancel={() => setEditing(false)}
        onSubmit={(text) => {
          setEditing(false);
          // 保存时把引用段按发送格式重建，避免编辑导致文件/技能/上下文引用丢失
          const filePrefix = originalRefs.files.length ? `\n\n[附件文件]\n${originalRefs.files.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
          const skillPrefix = originalRefs.skills.length ? `\n\n[本轮已引用技能]\n${originalRefs.skills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
          const contextPrefix = originalRefs.contexts.length ? `\n\n[用户指定的对话上下文]\n${originalRefs.contexts.map((ctx, index) => `(${index + 1}) ${ctx.role}：${ctx.text}`).join("\n\n")}\n[上下文结束]\n` : "";
          const threadReferencePrefix = originalRefs.threadReferences.map(formatThreadReferenceBlock).join("\n\n");
          onEditSubmit?.({ ...item, content: [{ type: "text", text: `${text}${contextPrefix}${skillPrefix}${filePrefix}${threadReferencePrefix ? `\n\n${threadReferencePrefix}` : ""}` }, ...originalImages] });
        }}
      />
    );
  }
  const refsImagePaths = new Set(refs.files.filter(isImagePath));
  // 文本占位符里出现过的图片以内联 chip 渲染在正文里，缩略图行去重避免双份
  const inlineImageSet = new Set(promptImagePaths(rawText));
  const extraImages = images.filter((part: any) => !refsImagePaths.has(part.path) && !inlineImageSet.has(part.path));
  // 图片缩略图 + 附件文件卡统一挂在气泡边框外（上方悬浮行）：附件不再撑大气泡（09-08 反馈）
  const extraThumbs = extraImages.length > 0 ? (
    <>
      {extraImages.map((part: any, index: number) => {
        const src = imagePartSrc(part) ?? "";
        return (
          <button type="button" className="user-message-thumb" onClick={() => openImageLightbox?.(src, basename(src) || src)} key={index}>
            <img src={src.startsWith("data:") || src.startsWith("http") ? src : imageUrl(src)} alt="" loading="lazy" />
          </button>
        );
      })}
    </>
  ) : null;
  const attachRow = refs.files.length || extraThumbs ? (
    <div className="msg-refs user-attach-row">
      {refs.files.map((path, index) => {
        const name = basename(path) || path;
        if (isImagePath(path)) {
          const src = path.startsWith("http") ? path : imageUrl(path);
          return (
            <button type="button" className="ref-file-card ref-image-card" title={name} onClick={() => openImageLightbox?.(path, name)} key={index}>
              <span className="ref-image-thumb">
                <img src={src} alt={name} loading="lazy" />
                <span className="ref-image-preview"><img src={src} alt={name} /></span>
              </span>
            </button>
          );
        }
        return (
          <button type="button" className="ref-file-card" title={name} onClick={() => onOpenFile?.(path)} key={index}>
            <FileText size={14} />
            <span className="ref-file-name">{name}</span>
          </button>
        );
      })}
      {extraThumbs}
    </div>
  ) : null;
  return (
    <div className={`user-message-stack${justSent ? " just-sent" : ""}`}>
      {attachRow}
      <div className={`message user-message${pending ? " pending" : ""}`} data-ruler-mark="user" data-turn-id={turn?.id} data-item-id={item.id}>
        <div className="avatar"><User size={15} /></div>
        <div className="message-body">
          <UserRefsRow refs={refs} onOpenFile={onOpenFile} onQuote={onQuote} hideFiles />
          {refs.imported ? <ImportedRecordCard note={refs.imported.note} content={refs.imported.content} /> : null}
          {refs.threadReferences.map((reference) => <ImportedRecordCard key={reference.id} note={reference.note} content={reference.content} kind="thread" sourceId={reference.id} onOpenSource={onOpenThread} />)}
          {refs.teamTask ? (
            <div className="user-message-team-task" title="已作为团队/成员会话发起需求提交">
              <div className="user-message-team-task-tag">
                <Sparkles size={11} />
                <span>{refs.teamTask.kind === "team" ? "团队会话 · 需求已发起" : "成员会话 · 需求已发起"}</span>
              </div>
              <div className="user-message-team-task-body">{refs.teamTask.requirement}</div>
            </div>
          ) : refs.cleanText ? (
            <p className="user-message-text">
              {splitPromptSegments(refs.cleanText).map((seg, index) => seg.kind === "text"
                ? <span key={index}>{seg.text}</span>
                : <button type="button" className="composer-image-chip-inline" key={index} title={`查看 ${basename(seg.path) || seg.path}`} onClick={() => openImageLightbox?.(seg.path, basename(seg.path) || seg.path)}>
                    <span className="composer-image-chip-icon" dangerouslySetInnerHTML={{ __html: COMPOSER_CHIP_ICON }} />
                    <span className="composer-image-chip-name">{basename(seg.path) || seg.path}</span>
                  </button>)}
            </p>
          ) : null}
        </div>
        <div className="user-message-footer">
          <MessageFooter item={item} turn={turn} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onEdit={() => setEditing(true)} />
        </div>
      </div>
    </div>
  );
}

type RulerMark = { id: string; turnId: string; itemId: string; type: "user" | "agent"; label: string };

/** 刻度数 = 有内容的消息数（一条消息一个刻度），窗口固定 50 条，随滚动位置滑动 */
const RULER_MAX = 50;

function MessageRuler({ turns, onJump, scrollRef, containerRef }: { turns: Turn[]; onJump: (id: string) => void; scrollRef: useRefObject; containerRef: useRefObject }) {
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [containerNarrow, setContainerNarrow] = useState(false);
  // 容器宽度不足时（如右侧面板打开后 timeline-wrap 被压窄）自动隐藏刻度尺，避免侵入消息内容
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const check = () => {
      // 720px 是消息区可接受的最小宽度：低于此值时刻度尺会让 agent 气泡可读性变差
      setContainerNarrow(container.clientWidth < 720);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  const allMarks = useMemo<RulerMark[]>(() => {
    const result: RulerMark[] = [];
    for (const turn of turns) {
      for (const item of turn.items) {
        // 刻度只对应用户消息，agent 消息不参与
        if (item.type !== "userMessage") continue;
        if (!itemText(item).trim()) continue;
        // 团队/成员会话首条 SYSTEM TASK 段不展示给用户（与气泡/复制/编辑一致）
        const label = userDisplayText(itemText(item));
        result.push({ id: `${turn.id}-${item.id}`, turnId: turn.id, itemId: item.id, type: "user", label: label || "（仅系统任务段）" });
      }
    }
    return result;
  }, [turns]);

  const currentIndex = useMemo(() => {
    if (!currentItemId) return allMarks.length - 1;
    const idx = allMarks.findIndex((m) => m.itemId === currentItemId);
    return idx < 0 ? allMarks.length - 1 : idx;
  }, [allMarks, currentItemId]);

  // 刻度尺独立滚轮：悬停刻度尺时滚轮滑动选区的窗口起点（不滚对话内容）；
  // 滚动对话内容或跳转时偏移自动归零，回到跟随模式
  const [windowOffset, setWindowOffset] = useState(0);
  useEffect(() => { setWindowOffset(0); }, [currentIndex, allMarks.length]);

  // 可视容量：轨道高度能容纳多少刻度就显示多少（动态测量）；
  // 超出的用独立滚轮滑窗口。没有"最多 N 条"的硬规则。
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    if (!scrollable) return;
    const measure = () => {
      const track = trackRef.current;
      if (!track) return;
      // 单刻度占位 = 线高 2px + 上下 padding 8px + gap 4px（与 CSS 保持一致）
      const slot = 14;
      setVisibleCount(Math.max(4, Math.floor(track.clientHeight / slot) - 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, [scrollable]);

  const windowSize = visibleCount > 0 ? visibleCount : RULER_MAX;
  const marks = useMemo(() => {
    if (allMarks.length <= windowSize) return allMarks;
    let start = Math.max(0, Math.min(currentIndex + windowOffset, allMarks.length - windowSize));
    let end = start + windowSize;
    if (end > allMarks.length) {
      end = allMarks.length;
      start = end - windowSize;
    }
    return allMarks.slice(start, end);
  }, [allMarks, currentIndex, windowOffset, windowSize]);

  const latestId = allMarks.length ? allMarks[allMarks.length - 1].id : null;

  // 滚动联动：视口上沿 30% 处落在哪条消息上，就高亮对应刻度
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      // 内容不满一屏（如单条消息）时没有滚动意义，刻度尺随之隐藏
      setScrollable(scroller.scrollHeight - scroller.clientHeight > 80);
      // 只扫描用户消息（刻度只对应用户消息），视口上沿 30% 处落在哪条用户消息上就高亮对应刻度
      const elements = Array.from(scroller.querySelectorAll<HTMLElement>('[data-ruler-mark="user"]'));
      if (!elements.length) { setCurrentItemId(null); return; }
      const probe = scroller.scrollTop + scroller.clientHeight * 0.3;
      let current: string | null = null;
      for (const el of elements) {
        if (el.offsetTop <= probe) current = el.dataset.itemId ?? current;
        else break;
      }
      setCurrentItemId(current);
    };
    update();
    // rAF 节流：scroll/resize 高频触发，直接跑 update 会读 offsetTop/scrollTop 强制同步布局
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
    // 依赖里绝不能放 turns：流式出字每帧都换引用，会重建监听器 + ResizeObserver，
    // 并每帧强制同步布局 —— 这是长回复越往后越卡的主要来源之一。
    // 元素在 update 内部实时查询 DOM，只需在刻度数量变化时重建监听。
  }, [scrollRef, allMarks.length]);
  // 没有用户消息、内容不满一屏、或容器太窄（右侧面板打开压窄 timeline）时自动隐藏刻度尺。
  // 专家/专家团会话常常只有一条任务消息 + 超长执行输出，内容早就可滚了，
  // 若仍要求 ≥2 条用户消息，这类窗口永远没有刻度线 —— 放宽为 ≥1 条即可定位回任务消息。
  if (allMarks.length < 1 || !scrollable || containerNarrow) return null;
  return (
    <div className="message-ruler" role="navigation" aria-label="消息定位">
      <div
        className="ruler-track"
        ref={(node) => {
          trackRef.current = node;
          // 独立滚轮：悬停刻度尺时滚轮只滑刻度选区（原生非 passive 监听才能 preventDefault），
          // 不滚动对话内容
          if (!node || node.dataset.wheelBound) return;
          node.dataset.wheelBound = "1";
          node.addEventListener("wheel", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (allMarks.length <= windowSize) return;
            const direction = event.deltaY > 0 ? 1 : -1;
            const maxOffset = allMarks.length - windowSize - currentIndex;
            setWindowOffset((current) => Math.max(-currentIndex, Math.min(maxOffset, current + direction * 4)));
          }, { passive: false });
        }}
        onMouseLeave={() => { setHoverIndex(null); setTip(null); }}
      >
        {marks.map((mark, index) => {
          // 波浪效果：hover 刻度最长，上下邻刻度按距离衰减（1.4x、0.9x、0.7x），
          // 且向对话框一侧（右侧）伸长；配合错峰 transition 产生丝滑波浪
          const dist = hoverIndex == null ? 99 : Math.abs(index - hoverIndex);
          const wave = dist === 0 ? " wave-0" : dist === 1 ? " wave-1" : dist === 2 ? " wave-2" : "";
          return (
            <button
              key={mark.id}
              className={`ruler-tick ${mark.type} ${mark.id === latestId ? "latest" : ""} ${mark.itemId === currentItemId ? "current" : ""}${wave}`}
              onMouseEnter={(event) => { setHoverIndex(index); setTip({ text: mark.label, top: event.currentTarget.offsetTop + event.currentTarget.offsetHeight / 2 }); }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onJump(mark.turnId)}
              aria-label={mark.label}
            />
          );
        })}
        {tip && <div className="ruler-tip" style={{ top: tip.top }}>{tip.text}</div>}
      </div>
    </div>
  );
}

/** 刻度尺跳转：与 App 状态无关，提到模块级保证引用恒定（memo 才拦得住打字时的重渲染） */
function jumpToTurn(id: string) {
  document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 刻度尺只反映用户消息：agent 出字时 turns 每帧换引用，若照单全收，
 *  刻度尺会每帧重渲染（遍历全部消息），白吃掉一帧预算。
 *  改成比较用户消息指纹——纯字符串拼接，远便宜于重渲染整棵刻度尺。 */
function userMarksKey(turns: Turn[]) {
  let key = "";
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "userMessage") continue;
      const text = String(itemText(item) ?? "").trim();
      if (text) key += `${turn.id}|${item.id}|${text.length}|${text.slice(0, 32)};`;
    }
  }
  return key;
}
const MemoMessageRuler = memo(MessageRuler, (prev, next) =>
  prev.scrollRef === next.scrollRef
  && prev.onJump === next.onJump
  && (prev.turns === next.turns || userMarksKey(prev.turns) === userMarksKey(next.turns)),
);

/**
 * 大包文本快速揭示（WorkBuddy 式连续出字）。
 *  active=true（流式运行中）：内容只要在追加就持续逐字揭示——不要求大跳才追，
 *    小增量也平滑续写，形成「文字持续流出的打字机感」。
 *  active=false（历史加载/已完成）：直接展示全文，不重播动画。
 *  markerStore 用于完成事件一次性交付正文的场景（快进到标记点再续追）。
 *  速率按剩余量自适应：尾段逐字精雕（打字感），长文自动提速不拖沓。
 */
function revealStepFor(remaining: number) {
  // 超大输出（命令日志等可能几万字符）：≤1.5s 追完，不拖沓
  if (remaining > 3600) return Math.max(32, Math.ceil(remaining / 90));
  if (remaining > 1200) return 10;   // 长文：快速追（约 625 字符/秒）
  if (remaining > 300) return 4;     // 中段：平稳流出（约 250 字符/秒）
  return 2;                          // 尾段：精细逐字（约 125 字符/秒，打字感）
}
// 深度思考正文比主出字慢一档（约一半速）：思考内容长、信息密度低，
// 同速流出根本读不清。16ms 帧下：长文 ~312 字符/秒、中段 ~125、尾段逐字 ~62。
function revealStepForReasoning(remaining: number) {
  if (remaining > 3600) return Math.max(16, Math.ceil(remaining / 180));
  if (remaining > 1200) return 5;
  if (remaining > 300) return 2;
  return 1;
}
function usePacketRevealText(
  key: string,
  text: string,
  active: boolean,
  markerStore?: Map<string, string>,
  threshold = 24,
) {
  const initial = (() => {
    const marked = markerStore?.get(key);
    if (marked != null && text.startsWith(marked)) return marked;
    if (active && text.length >= threshold) return text.slice(0, Math.min(10, text.length));
    return text;
  })();
  const [displayed, setDisplayed] = useState(initial);
  const [revealing, setRevealing] = useState(initial.length < text.length);
  const displayedRef = useRef(displayed);
  const revealingRef = useRef(revealing);
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);
  useEffect(() => { revealingRef.current = revealing; }, [revealing]);
  useEffect(() => {
    const marked = markerStore?.get(key);
    let start = displayedRef.current;
    if (marked != null && text.startsWith(marked) && start.length < marked.length) {
      start = marked;
      displayedRef.current = start;
      setDisplayed(start);
    }
    if (!text.startsWith(start)) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      markerStore?.delete(key);
      return;
    }
    const remaining = text.length - start.length;
    if (remaining <= 0) {
      setRevealing(false);
      markerStore?.delete(key);
      return;
    }
    // active（流式运行中）：内容在增长就平滑续字，不要求大跳才追——小增量也逐字流出。
    // 非 active 或一次性整包交付（marker）也追，避免整段瞬间出现；纯历史不做动画。
    const shouldReveal = revealingRef.current || active || marked != null;
    if (!shouldReveal) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      return;
    }
    setRevealing(true);
    // 速率按剩余量自适应：尾段逐字精雕（打字感），长文自动提速不拖沓。
    const step = Math.max(1, Math.min(revealStepFor(remaining), Math.ceil(remaining / 3)));
    let end = start.length;
    const timer = window.setInterval(() => {
      end = Math.min(text.length, end + step);
      const next = text.slice(0, end);
      displayedRef.current = next;
      setDisplayed(next);
      window.dispatchEvent(new Event("codex:packet-reveal"));
      if (end >= text.length) {
        window.clearInterval(timer);
        markerStore?.delete(key);
        setRevealing(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [active, key, markerStore, text, threshold]);
  return { displayed, revealing };
}

/** 深度思考卡片：live→done 保持同一 DOM 节点（换 key 会整块重建、视觉闪烁）；
 * 展开态受控：思考中默认展开，用户手动收起后尊重其选择 */
function ReasoningCard({ item, turnActive }: { item: ThreadItem; turnActive?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // 思考卡一旦「现场出现过」（本会话流式期间渲染过），完成后永不整体消失：
  // 部分模型/中转不回 reasoning 摘要 delta，text 一直为空——旧行为在回合结束时
  // `!text && !running` 直接 return null，表现就是「深度思考板块自动消失了」。
  const seenLiveRef = useRef(false);
  const text = reasoningTextOf(item);
  const durationMs = item.durationMs ?? reasoningDuration.get(String(item.id));
  // 必须看当前 reasoning item 自己的状态，不能只看整轮 turnActive：后续工具仍在
  // 执行时，前一块已 completed 的思考也会带着 turnActive=true，旧逻辑因此永远不收起。
  const itemRunning = item.status === "inProgress" || item.status === "running";
  const running = Boolean(turnActive) && (itemRunning || (!item.status && !durationMs));
  // 深度思考可能由上游整包交付。首次挂载就是大段正文时先露出短前缀，随后快速追字；
  // 历史会话（turnActive=false 且没有 buffered 标记）保持直接展示，不重播动画。
  const initialReveal = useMemo(() => {
    const marked = bufferedReasoningRevealStarts.get(String(item.id));
    if (marked != null && text.startsWith(marked)) return marked;
    if (turnActive && text.length >= 24) return text.slice(0, Math.min(10, text.length));
    return text;
  }, [item.id]);
  const [displayed, setDisplayed] = useState(initialReveal);
  const [revealing, setRevealing] = useState(() => initialReveal.length < text.length);
  const displayedRef = useRef(displayed);
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);
  useEffect(() => {
    const markedStart = bufferedReasoningRevealStarts.get(String(item.id));
    let start = displayedRef.current;
    if (markedStart != null && text.startsWith(markedStart) && start.length < markedStart.length) {
      start = markedStart;
      displayedRef.current = start;
      setDisplayed(start);
    }
    // 内容发生修订、缩短或不再是原文本的追加时不能追字，直接同步，避免错字残留。
    if (!text.startsWith(start)) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    // 思考结束（running 已 false）：剩余追字缓冲立即放完并结束揭示。
    // 用户要求「内容输出完就自动折叠，不停留」——不能让慢速追字拖到正文都出来后
    // 思考卡还挂着展开（09-05 反馈：思考还没加载完正文就出来了）。
    if (!running && revealing) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    const remaining = text.length - start.length;
    if (remaining <= 0) {
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    // active（思考运行中）：内容只要在追加就平滑续字——小增量也逐字流出，
    // 形成与正文一致的 WorkBuddy 式连续出字节奏；完成态/整包交付也追完不瞬现。
    const shouldReveal = revealing || running || markedStart != null;
    if (!shouldReveal) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      return;
    }
    setRevealing(true);
    // 思考正文专用慢速自适应（revealStepForReasoning，约为主正文一半速）。
    const step = Math.max(1, Math.min(revealStepForReasoning(remaining), Math.ceil(remaining / 3)));
    let end = start.length;
    const timer = window.setInterval(() => {
      end = Math.min(text.length, end + step);
      const next = text.slice(0, end);
      displayedRef.current = next;
      setDisplayed(next);
      window.dispatchEvent(new Event("codex:packet-reveal"));
      if (end >= text.length) {
        window.clearInterval(timer);
        bufferedReasoningRevealStarts.delete(String(item.id));
        setRevealing(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [item.id, text, revealing, running]);
  // 自动延迟可见与用户手动展开必须分开：自动行为不能写进 manualOpen，
  // 否则会被误认为“用户主动展开”，导致第一块思考永久保持打开。
  const { open, toggle, manualOpen } = useCardOpen(Boolean(running) || revealing);
  // 思考输出完即自动折叠（running/revealing 双双转 false 时 useCardOpen 自动收起），
  // 不做「完成后保持展开凑满最短可见时长」的停留——09-05 用户反馈停留体验不好。
  // 思考结束瞬间的剩余缓冲由上面揭示 effect 立即放完，不会闪断。
  // 回合运行期间只要该 reasoning item 已进入事件流，就先保留它的标题节点；
  // 某些中转会先发 completed/started，再稍后补正文 delta，不能把后续思考误当空占位丢掉。
  useEffect(() => { if (running || turnActive) seenLiveRef.current = true; }, [running, turnActive]);
  // 思考进行中：新内容到达时自动贴底滚动。
  // 用 rAF 合并：一帧内可能来好几个 delta，直接滚会读 scrollHeight 触发多次强制同步布局。
  useEffect(() => {
    if (!running || manualOpen === false) return;
    const el = bodyRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [displayed, running, manualOpen]);
  // 没现场出现过且无内容的（历史加载的空占位）才不渲染；现场出现过的保留标题行常驻
  if (!text && !running && !seenLiveRef.current && !turnActive) return null;
  const head = running
    ? <span className="reasoning-head shimmer-text"><Brain size={13} className="reasoning-pulse" />深度思考中</span>
    : <span className="reasoning-head"><Brain size={13} />已深度思考{durationMs ? `（用时 ${formatDuration(durationMs)}）` : ""}</span>;
  return (
    <div className={`reasoning-card ${running ? "live" : "done"} ${open ? "open" : "collapsed"}`}>
      <button type="button" className="reasoning-head-btn" onClick={toggle}>
        {head}<ChevronDown size={13} className="reasoning-caret" />
      </button>
      {displayed && <Fold open={open}><div className="reasoning-body-wrap"><div className="reasoning-body" ref={bodyRef}>{displayed}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}</div></div></Fold>}
    </div>
  );
}

function ProgressiveAgentBody({ itemId, text, active, footer, onOpenFile }: { itemId: string; text: string; active?: boolean; footer?: React.ReactNode; onOpenFile?: (path: string) => void }) {
  const { displayed, revealing } = usePacketRevealText(itemId, text, Boolean(active), bufferedAgentRevealStarts, 24);
  return <div className={`message-body markdown ${revealing ? "packet-revealing" : ""}`}><Markdown>{displayed}</Markdown>{revealing ? <span className="packet-stream-cursor" aria-hidden /> : null}{!revealing ? <InlineFileCards text={text} onOpenFile={onOpenFile} /> : null}{!revealing ? footer : null}</div>;
}

function ProgressiveToolPayload({ itemId, text, active, className, language }: { itemId: string; text: string; active?: boolean; className?: string; language?: string }) {
  const { displayed, revealing } = usePacketRevealText(itemId, text, Boolean(active), bufferedToolRevealStarts, 48);
  return <ToolCodeBlock language={language ?? payloadLanguage(text)} text={displayed} revealing={revealing} className={className} />;
}

function ItemView({ item, turn, turnActive, usage, tokenUsage, fallbackWindow, hideFooter, waitingForApproval, onCopy, onQuote, onFork, onImageCopy, onEditSubmit, onOpenFile, onOpenThread, pending }: { item: ThreadItem; turn?: Turn; turnActive?: boolean; usage?: any; tokenUsage?: any; fallbackWindow?: number; hideFooter?: boolean; waitingForApproval?: boolean; onCopy: (text: string) => void; onQuote: (text: string) => void; onFork?: () => void; onImageCopy?: (path: string) => void; onEditSubmit?: (item: ThreadItem) => void; onOpenFile?: (path: string) => void; onOpenThread?: (id: string) => void; pending?: boolean }) {
  if (item.type === "userMessage") {
    return <UserMessageView item={item} turn={turn} pending={pending} onCopy={onCopy} onQuote={onQuote} onImageCopy={onImageCopy} onEditSubmit={onEditSubmit} onOpenFile={onOpenFile} onOpenThread={onOpenThread} />;
  }
  if (item.type === "agentMessage") {
    // 流式过程中会产生空的 agentMessage 片段，不渲染，避免空 div 把内容撑出滚动条
    if (!String(item.text ?? "").trim()) return null;
    // 模型在转入命令/工具调用前常会留下尾部换行；remark-breaks 会把它们
    // 变成一个没有文字的段落，段落行高正是正文与下一张工具卡之间的异常空隙。
    const assistantText = String(item.text ?? "").replace(/\s+$/u, "");
    return (
      <div className="message assistant-message" data-ruler-mark="agent" data-turn-id={turn?.id} data-item-id={item.id}>
        <div className="avatar agent"><Bot size={16} /></div>
        {/* 流式与完成态同一条 Markdown 渲染路径（raf 合帧保证流畅；remark-breaks 保真单换行），
            完成瞬间不再切换渲染方式，消除“回复完闪一下变样” */}
        <ProgressiveAgentBody
          itemId={item.id}
          text={assistantText}
          active={turnActive}
          onOpenFile={onOpenFile}
          footer={!hideFooter ? <MessageFooter item={item} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={onCopy} onQuote={onQuote} onFork={onFork} /> : undefined}
        />
      </div>
    );
  }
  if (item.type === "reasoning") {
    return <ReasoningCard item={item} turnActive={turnActive} />;
  }
  if (item.type === "commandExecution") {
    return <CommandExecutionCard item={item} waitingForApproval={waitingForApproval} turnActive={turnActive} />;
  }
  if (item.type === "fileChange") {
    const changes = item.changes ?? [];
    const stats = changes.reduce((sum: { added: number; deleted: number }, change: any) => { const next = diffStats(change.diff ?? ""); return { added: sum.added + next.added, deleted: sum.deleted + next.deleted }; }, { added: 0, deleted: 0 });
    const editing = item.status === "inProgress" || item.status === "running";
    const status: ActionStatus = editing ? "running" : "done";
    const fileNames = changes.map((change: any) => basename(change.path ?? change.filePath ?? "文件")).join("、") || "文件";
    return (
      <ActionCard icon={<FileCode2 size={13} />} verb={editing ? "正在编辑" : "已编辑"} info={fileNames ? <code>{fileNames}</code> : undefined} status={status} statusText={<><b>+{stats.added}</b> <i>-{stats.deleted}</i></>}>
        {changes.length > 0 && changes.map((change: any, idx: number) => (
          <div key={idx} className="action-diff">
            <strong>{change.path ?? change.filePath ?? "文件"}</strong>
            <ProgressiveToolPayload itemId={`${item.id}-diff-${idx}`} text={String(change.diff ?? "")} active={turnActive} language="diff" />
          </div>
        ))}
      </ActionCard>
    );
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const title = item.type === "mcpToolCall" ? `${item.server} / ${item.tool}` : item.tool;
    const running = item.status === "inProgress" || item.status === "running";
    const failed = item.status === "failed" || item.status === "error";
    const status: ActionStatus = running ? "running" : failed ? "error" : "done";
    const label = itemStatusLabel(item.status);
    const verb = running ? "正在调用" : label;
    // 团队成员调度卡：点亮该成员的渐变头像替代通用扳手图标（查模块级注册表，见 entity-avatar.ts）
    const invokedMember = item.tool === "team_member_invoke"
      ? resolveTeamMember(String(turn?.id ?? ""), String((item.arguments as any)?.memberId ?? ""))
      : null;
    return (
      <ActionCard
        icon={invokedMember
          ? <span className={`tool-member-avatar ${running ? "running" : ""}`} style={{ background: AVATAR_GRADIENTS[avatarToneOf(invokedMember.id || invokedMember.name)] }} aria-hidden="true">{invokedMember.label.slice(0, 1)}</span>
          : <Wrench size={13} />}
        verb={invokedMember ? (running ? `正在咨询 ${invokedMember.label}` : `咨询 ${invokedMember.label}`) : verb}
        info={title ? <code>{title}</code> : undefined} status={status} statusText={running ? undefined : formatDuration(item.durationMs) || label}>
        <ProgressiveToolPayload itemId={`${item.id}-payload`} text={String(item.progress || JSON.stringify(item.result ?? item.arguments ?? item.contentItems, null, 2) || "")} active={turnActive} />
      </ActionCard>
    );
  }
  if (item.type === "plan") {
    return (
      <ActionCard icon={<BookOpen size={13} />} verb="计划" status="done" defaultExpanded>
        <div className="action-plan"><Markdown>{item.text ?? ""}</Markdown></div>
      </ActionCard>
    );
  }
  if (item.type === "webSearch") {
    return (
      <ActionCard icon={<Search size={13} />} verb="网页搜索" info={item.query ? <code>{item.query}</code> : undefined} status="done" statusText={item.status ?? "完成"} />
    );
  }
  if (item.type === "collabAgentToolCall" || item.type === "subAgentActivity") {
    const title = item.type === "collabAgentToolCall" ? item.tool : item.kind;
    return (
      <ActionCard icon={<Bot size={13} />} verb={item.type === "collabAgentToolCall" ? "协作代理" : "子代理"} info={title ? <code>{title}</code> : undefined} status="done" statusText={item.status ?? item.agentPath ?? ""} />
    );
  }
  if (item.type === "imageView") return <div className="message tool-image"><div className="avatar agent"><ImagePlus size={15} /></div><div className="message-body"><ImagePreview path={item.path} alt="Codex 查看图片" onCopy={() => onImageCopy?.(item.path)} /></div></div>;
  if (item.type === "imageGeneration") return <div className="message tool-image"><div className="avatar agent"><ImagePlus size={15} /></div><div className="message-body">{item.savedPath || item.result ? <ImagePreview path={item.savedPath || item.result} alt="生成图片" onCopy={() => onImageCopy?.(item.savedPath || item.result)} /> : <p>{item.failure?.message ?? item.status}</p>}</div></div>;
  if (item.type === "sleep") {
    return <ActionCard icon={<Clock3 size={13} />} verb="等待" status={item.status === "inProgress" ? "running" : "done"} statusText={item.status ?? "进行中"} />;
  }
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") {
    return <ActionCard icon={<Search size={13} />} verb={item.type === "enteredReviewMode" ? "开始代码审查" : "完成代码审查"} info={item.review ? <code>{item.review}</code> : undefined} status="done" />;
  }
  if (item.type === "hookPrompt") {
    return <ActionCard icon={<Wrench size={13} />} verb="Hook" status="done" statusText="完成" />;
  }
  if (item.type === "contextCompaction") {
    // 压缩结果常驻为「两边虚线 + 中间文字」分隔线（与压缩进行中的过渡态同一形态），
    // 不再渲染「上下文压缩 · 完成」工具卡——那张卡用户明确不要。
    // 进行中的压缩必须渲染成转圈「正在压缩上下文」：此前 inProgress 也走成功分支，
    // 时间线里先冒出一条假「上下文压缩成功」，下面又挂着「正在压缩上下文」，自相矛盾（用户实测）。
    const failed = item.status === "error" || Boolean(item.failure?.message);
    const running = !failed && (item.status === "inProgress" || item.status === "running");
    if (running) return (
      <div className="compact-divider compact-divider--running" role="status" aria-label="上下文压缩状态">
        <i className="compact-divider-line" aria-hidden />
        <span className="compact-divider-text"><LoaderCircle size={13} className="spin" />正在压缩上下文</span>
        <i className="compact-divider-line" aria-hidden />
      </div>
    );
    return (
      <div className={`compact-divider ${failed ? "compact-divider--error" : "compact-divider--success"}`} role="status" aria-label="上下文压缩状态">
        <i className="compact-divider-line" aria-hidden />
        <span className="compact-divider-text">
          {failed ? <CircleX size={13} /> : <CircleCheck size={13} />}
          {failed ? `上下文压缩失败：${item.failure?.message ?? "请稍后重试"}` : "上下文压缩成功"}
        </span>
        <i className="compact-divider-line" aria-hidden />
      </div>
    );
  }
  return (
    <ActionCard icon={<Wrench size={13} />} verb={item.type} status="done">
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </ActionCard>
  );
}

/** memo 版消息项：流式期间父级每帧重渲染，已完成的消息项（item 引用不变）直接跳过，
 * 只有正在出字的那条（text 变化）会重渲染，滚动和已渲染内容保持静止不闪 */
const MemoItemView = memo(ItemView, (prev, next) =>
  prev.item === next.item
  && prev.turnActive === next.turnActive
  && prev.usage === next.usage
  && prev.tokenUsage === next.tokenUsage
  && prev.waitingForApproval === next.waitingForApproval
  && prev.hideFooter === next.hideFooter
  && prev.fallbackWindow === next.fallbackWindow,
);

function TurnView({ turn, usage, tokenUsage, fallbackWindow, waitingForApproval, interruptedAt, elapsedSeconds, handlers, hooks, isLastTurn }: { turn: Turn; usage?: any; tokenUsage?: any; fallbackWindow?: number; waitingForApproval?: boolean; interruptedAt?: number; elapsedSeconds?: number; handlers: FoldHandlers; hooks?: any[] | null; isLastTurn?: boolean }) {
  const completedTask = turn.status === "completed" && isTaskTurn(turn);
  // 回合已结束（含 completed/interrupted/failed）——普通聊天回合没有文件改动（不满足 isTaskTurn），
  // 但只要回合已收尾就该展示自己的操作栏（复制/分支/统计），避免被 task 限定卡掉。
  // 复用 isTurnRunning 覆盖 status === "running" 别名（部分引擎/历史数据会出现）。
  const turnFinished = !isTurnRunning(turn);
  const running = isTurnRunning(turn);
  const userItems = turn.items.filter((item) => item.type === "userMessage");
  // 回合已结束但个别工具/命令的 item/completed 事件丢失（状态仍 inProgress）→
  // 渲染层兜底落成完成态，避免「任务都完成了还卡在正在运行」。仅回合结束时兜底，
  // 正常流式期间（running）保持引擎原始状态不动。
  const responseItems = useMemo(() => {
    const items = turn.items.filter((item) => item.type !== "userMessage");
    if (running) return items;
    let stale = false;
    const fixed = items.map((item) => {
      if (item.status === "inProgress" || item.status === "running") { stale = true; return { ...item, status: "completed" }; }
      return item;
    });
    return stale ? fixed : items;
  }, [turn.items, running]);
  // 最终答复 = 最后一条有正文的 agentMessage
  const finalAgent = [...responseItems].reverse().find((item) => item.type === "agentMessage" && String(item.text ?? "").trim()) ?? null;
  const hasContent = responseItems.some((item) => item.type !== "agentMessage" || Boolean(String(item.text ?? "").trim()));
  // 可见内容：空的 agentMessage / 空 reasoning 占位不算。引擎建好 item 到首 token 之间有几十~几百毫秒，
  // 这段空窗必须有「思考中/生成中」占位顶着，否则就是白屏一下再突然整段冒出来（观感=卡+闪）。
  const hasVisible = responseItems.some((item) =>
    item.type === "agentMessage" ? Boolean(String(item.text ?? "").trim())
      : item.type === "reasoning" ? Boolean([...(item.summary ?? []), ...(item.content ?? [])].join("").trim())
        : true,
  );
  const stoppedWithoutReply = Boolean(interruptedAt && userItems.length > 0 && !hasContent);
  const statusLabel = running
    ? (turn.items.some((item) => item.type === "reasoning" && (item.status === "inProgress" || item.status === "running" || (!item.status && !item.durationMs))) ? "思考中" : "生成中")
    : turn.error ? "出错"
    : turn.durationMs ? `已用 ${formatDuration(turn.durationMs)}` : "已完成";
  const hookBadge = hooks && hooks.length > 0 ? <HookBadge hooks={hooks} /> : undefined;
  return (
    <div className={`turn-group ${running ? "running" : turn.error ? "error" : "completed"}`} id={`turn-${turn.id}`}>
      {userItems.map((item) => <MemoUserMessageView item={item} turn={turn} fallbackWindow={fallbackWindow} onCopy={handlers.onCopy} onQuote={handlers.onQuote} onImageCopy={handlers.onImageCopy} onEditSubmit={(entry) => handlers.onEdit(turn.id, entry)} onOpenFile={handlers.onOpenFile} key={item.id} />)}
      <div className="turn-card">
        {/* 占位头必须等回合内已有 userMessage：turn/started 先建回合、userMessage item 晚到，
            若不等就会渲染在乐观用户气泡上方（切会话后首条消息时肉眼可见错位，09-04 反馈）。
            空窗期反馈由乐观气泡 + 底部 working-indicator 覆盖。 */}
        {running && !hasVisible && userItems.length > 0 && <header className="turn-card-header">
          <span className="turn-card-dot" aria-hidden />
          <span className="turn-card-status shimmer-text">{statusLabel}</span>
        </header>}
        <div className="turn-card-body">
          <div className="codex-turn">
          {stoppedWithoutReply && <div className="interrupted-turn"><CircleStop size={15} /><div><strong>你在 {elapsedSeconds ?? 0} 秒后停止了</strong><span>Codex 尚未开始回复，因此没有生成内容。</span></div></div>}
          {running && isTaskTurn(turn) && <RunningProcessTime />}
          {/* inner 永远不渲染 finalAgent 的 footer（避免 running 时每个新 body 短暂成为 finalAgent 挂按钮 + 避免与外层 2129 行双排）。外层 turnFinished 决定最终是否独占渲染一份。CompletedChanges 仍需 completedTask（聊天回合没文件改动可显）。 */}
          <TurnFoldStream items={responseItems} turn={turn} running={running} fallbackWindow={fallbackWindow} waitingForApproval={waitingForApproval} handlers={handlers} finalAgentId={finalAgent?.id} usage={usage} tokenUsage={tokenUsage} />
          {completedTask && <CompletedChanges turn={turn} />}
          {turnFinished && finalAgent && <MessageFooter item={finalAgent} turn={turn} usage={usage} tokenUsage={tokenUsage} fallbackWindow={fallbackWindow} onCopy={handlers.onCopy} onQuote={handlers.onQuote} onFork={() => handlers.onFork(turn.id)} extraIcon={hookBadge} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** memo 回合视图：输入框打字等 App 级状态变化不再穿透到消息列表（闪烁根源之一）；
 * turn 对象引用在 stableItem/mergeTurn 下只有真正变化的回合会更新 */
const MemoTurnView = memo(TurnView, (prev, next) =>
  prev.turn === next.turn
  && prev.usage === next.usage
  && prev.tokenUsage === next.tokenUsage
  && prev.fallbackWindow === next.fallbackWindow
  && prev.isLastTurn === next.isLastTurn
  && prev.waitingForApproval === next.waitingForApproval
  && prev.interruptedAt === next.interruptedAt
  && prev.elapsedSeconds === next.elapsedSeconds
  && prev.handlers === next.handlers
  && prev.hooks === next.hooks,
);

/** memo 用户消息：只有消息内容/回合变化才重渲染 */
const MemoUserMessageView = memo(UserMessageView, (prev, next) =>
  prev.item === next.item
  && prev.turn === next.turn
  && prev.fallbackWindow === next.fallbackWindow,
);

function TerminalPanel({ id, workspace, active }: { id: string; workspace: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let disposed = false;
    let disposeTerm: (() => void) | null = null;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !hostRef.current) return;
        const term = new Terminal({ fontSize: 12, cursorBlink: true, theme: { background: "#161615", foreground: "#e8e8e5", selectionBackground: "#45454188" } });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        try { fit.fit(); } catch { /* host not laid out yet */ }
        fitRef.current = fit;
        const offData = window.codex.onTerminalData((terminalId, data) => { if (terminalId === id) term.write(data); });
        term.onData((data) => void window.codex.terminalInput(id, data));
        term.onResize(({ cols, rows }) => void window.codex.terminalResize(id, cols, rows));
        const onWindowResize = () => { try { fit.fit(); } catch { /* hidden */ } };
        window.addEventListener("resize", onWindowResize);
        disposeTerm = () => { offData(); window.removeEventListener("resize", onWindowResize); term.dispose(); };
        setStarted(true);
      } catch {
        setFailed(true);
      }
    })();
    return () => { disposed = true; disposeTerm?.(); };
  }, [id]);
  useEffect(() => {
    if (!started) return;
    void window.codex.restartTerminal(id, workspace || undefined);
  }, [started, id, workspace]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* hidden */ } }, 60);
    return () => clearTimeout(timer);
  }, [active]);
  return (
    <section className="terminal-section">
      <div className="terminal-host" ref={hostRef} />
      {failed && <div className="panel-loading">终端组件加载失败</div>}
    </section>
  );
}


/**
 * SSH 内置终端：xterm + ssh2 shell 会话。
 * 会话 id 由主进程分配，数据通过 ssh:data 推送、退出通过 ssh:exit；卸载时必须关闭会话，
 * 否则主进程会残留 ssh2 连接（要等应用退出才被统一清理）。
 */
function SshTerminalModal({ server, onClose }: { server: SshServer; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  const fitRef = useRef<any>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "closed" | "error">("connecting");
  const [message, setMessage] = useState("");

  // Esc 关闭：xterm 会吞掉按键，所以在 window 上监听
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !hostRef.current) return;
        const term = new Terminal({
          fontSize: 12.5,
          cursorBlink: true,
          convertEol: true,
          scrollback: 5000,
          theme: { background: "#141414", foreground: "#e8e8e5", cursor: "#7cabf8", selectionBackground: "#3a3a3888" },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        try { fit.fit(); } catch { /* 容器还没布局完 */ }
        fitRef.current = fit;

        const offData = window.codex.onSshData((payload) => term.write(payload.data ?? ""));
        const offExit = window.codex.onSshExit(() => {
          if (disposed) return;
          setStatus("closed");
          term.write("\r\n\x1b[90m[会话已断开，按 Esc 或点关闭退出]\x1b[0m\r\n");
        });
        const dataSubscription = term.onData((data) => { if (sessionRef.current) void window.codex.sshSessionWrite(sessionRef.current, data); });
        const resizeSubscription = term.onResize(({ cols, rows }) => { if (sessionRef.current) void window.codex.sshSessionResize(sessionRef.current, cols, rows); });
        const onWindowResize = () => { try { fitRef.current?.fit(); } catch { /* ignore */ } };
        window.addEventListener("resize", onWindowResize);
        cleanup = () => {
          offData();
          offExit();
          dataSubscription.dispose();
          resizeSubscription.dispose();
          window.removeEventListener("resize", onWindowResize);
          if (sessionRef.current) void window.codex.sshSessionClose(sessionRef.current);
          term.dispose();
        };

        const opened = await window.codex.sshSessionOpen(server, term.cols || 100, term.rows || 30);
        if (disposed) return;
        if ("error" in opened) {
          setStatus("error");
          setMessage(opened.error);
          term.write(`\x1b[31m连接失败：${opened.error}\x1b[0m\r\n`);
          return;
        }
        sessionRef.current = opened.sessionId;
        setStatus("online");
        term.focus();
        try { fit.fit(); } catch { /* ignore */ }
      } catch {
        if (!disposed) { setStatus("error"); setMessage("终端组件加载失败"); }
      }
    })();
    return () => { disposed = true; cleanup?.(); };
  }, [server.id]);

  useEffect(() => {
    const timer = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="modal-backdrop ssh-terminal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ssh-terminal-modal" role="dialog" aria-modal="true" aria-label={`${server.name} 终端`}>
        <header>
          <div className="ssh-terminal-title">
            <span className={`ssh-status-dot ${status === "online" ? "ok" : status === "error" ? "fail" : "testing"}`} />
            <strong>{server.name}</strong>
            <code>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""}</code>
            {server.jumpHost?.host ? <span className="ssh-tag">跳板：{server.jumpHost.host}</span> : null}
          </div>
          <div className="ssh-terminal-state">
            {status === "connecting" && <><Spinner /><span>正在建立 SSH 会话…</span></>}
            {status === "online" && <span className="ssh-terminal-online">已连接</span>}
            {status === "closed" && <span>会话已断开</span>}
            {status === "error" && <span className="ssh-terminal-error">{message || "连接失败"}</span>}
            <button className="icon-button" title="关闭终端（Esc）" onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        <div className="ssh-terminal-host" ref={hostRef} />
        <footer>
          <span>会话仅限本机使用；关闭终端即断开 SSH 连接。</span>
          <button className="secondary-setting" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}

/** 远程命令执行：一次性 exec，展示 stdout/stderr/退出码/耗时 */
function SshExecModal({ server, onClose }: { server: SshServer; onClose: () => void }) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SshExecResult | null>(null);
  const run = async () => {
    if (!command.trim() || running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await window.codex.execSshCommand(server, command));
    } catch (error: any) {
      setResult({ ok: false, error: error.message });
    } finally { setRunning(false); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal ssh-exec-modal" role="dialog" aria-modal="true" aria-label={`在 ${server.name} 上运行命令`}>
        <header>
          <div className="connector-setup-title">
            <span><TerminalSquare size={17} /></span>
            <div><strong>在「{server.name}」上运行命令</strong><p>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""} · 一次性执行，超时 30 秒</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>命令 <small>Ctrl+Enter 运行</small></span>
            <textarea rows={3} value={command} spellCheck={false} placeholder="例如：uname -a && df -h" onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void run(); } }} />
          </label>
          {result && <div className={`ssh-exec-result ${result.ok ? "ok" : "fail"}`}>
            <div className="ssh-exec-meta">
              <span>退出码 {result.code ?? "-"}</span><span>耗时 {result.latencyMs ?? "-"}ms</span>
              {result.error ? <span className="ssh-exec-error">{result.error}</span> : null}
            </div>
            {result.stdout ? <pre>{result.stdout}</pre> : null}
            {result.stderr ? <pre className="ssh-exec-stderr">{result.stderr}</pre> : null}
          </div>}
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>关闭</button>
          <button className="primary-setting" disabled={!command.trim() || running} onClick={() => void run()}>{running ? <Spinner /> : <Play size={14} />}运行</button>
        </footer>
      </section>
    </div>
  );
}

const reviewScopes: [ReviewScope, string][] = [["unstaged", "未暂存"], ["staged", "已暂存"], ["head", "全部分支更改"], ["last", "上一轮更改"]];
type ReviewScope = "unstaged" | "staged" | "head" | "last";

function ReviewPanel({ workspace, lastDiff, disabled, busy, report, onReview }: { workspace: string; lastDiff: string; disabled: boolean; busy: boolean; report: string; onReview: (instructions: string) => void }) {
  const [scope, setScope] = useState<ReviewScope>("unstaged");
  const [menuOpen, setMenuOpen] = useState(false);
  const [output, setOutput] = useState("");
  const [gitMissing, setGitMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const refresh = async () => {
    if (scope === "last") { setOutput(lastDiff); setGitMissing(false); return; }
    if (!workspace) { setGitMissing(true); setOutput(""); return; }
    setLoading(true);
    try {
      const result = await window.codex.gitDiff(workspace, scope);
      setGitMissing(false);
      setOutput(result.output ?? "");
    } catch {
      setGitMissing(true);
      setOutput("");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, [scope, workspace]);
  const files = useMemo(() => {
    if (!output) return [] as { path: string; added: number; deleted: number }[];
    const list: { path: string; added: number; deleted: number }[] = [];
    let current: { path: string; added: number; deleted: number } | null = null;
    for (const line of output.split("\n")) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      if (match) { current = { path: match[1], added: 0, deleted: 0 }; list.push(current); continue; }
      if (!current) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
    }
    return list;
  }, [output]);
  const scopeLabel = reviewScopes.find(([value]) => value === scope)?.[1] ?? "未暂存";
  return (
    <section className="review-panel git-review">
      <div className="review-bar">
        <div className="scope-wrap">
          <button className="scope-btn" onClick={() => setMenuOpen((current) => !current)}>{scopeLabel}<ChevronDown size={13} /></button>
          {menuOpen && <div className="scope-menu">
            {reviewScopes.map(([value, label]) => <button key={value} onClick={() => { setScope(value); setMenuOpen(false); }}>{label}{scope === value && <Check size={13} />}</button>)}
          </div>}
        </div>
        <button className="review-refresh" title="刷新" onClick={() => void refresh()}>{loading ? <Spinner /> : <RefreshCw size={14} />}<span>刷新</span></button>
      </div>
      {gitMissing ? <div className="git-missing"><FileCode2 size={36} /><strong>当前环境没有可用的 Git</strong><p>请先安装 Git，或确认当前运行环境里可以执行 git 命令。</p></div>
        : files.length ? <div className="diff-file-list">{files.map((file) => <div key={file.path}><code title={file.path}>{basename(file.path)}</code><span><b>+{file.added}</b> <i>-{file.deleted}</i></span></div>)}</div>
        : <div className="git-empty"><p className="muted">当前范围没有文件改动</p></div>}
      <details className="ai-review">
        <summary><Search size={13} />AI 审查（review/start）<ChevronDown size={13} /></summary>
        <div className="ai-review-body">
          <button className="primary-setting" disabled={disabled || busy} onClick={() => onReview("")}><Search size={14} />{busy ? "审查中…" : "审查未提交改动"}</button>
          <div className="review-custom">
            <textarea value={custom} rows={2} placeholder="或输入自定义审查说明，例如：重点检查鉴权逻辑" onChange={(event) => setCustom(event.target.value)} />
            <button className="secondary-setting" disabled={disabled || busy || !custom.trim()} onClick={() => { const value = custom.trim(); setCustom(""); onReview(value); }}>按说明审查</button>
          </div>
          {report && <div className="review-report"><Markdown>{report}</Markdown></div>}
        </div>
      </details>
    </section>
  );
}

function RequestCard({ request, onDone }: { request: PendingRequest; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");
  const params = request.params ?? {};
  const questions = params.questions ?? [];
  const legacyApproval = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
  const commandLike = legacyApproval || request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval";
  const available = params.availableDecisions ?? [];
  const allowOnce = legacyApproval ? "approved" : "accept";
  const allowSession = legacyApproval ? "approved_for_session" : "acceptForSession";
  const decline = legacyApproval ? { denied: { rejection: "User denied request" } } : "decline";

  async function reply(result: unknown) {
    setSubmitting(true);
    setReplyError("");
    try {
      await window.codex.respond(request.id, result);
      onDone();
    } catch (error: any) {
      setReplyError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (request.method === "item/tool/requestUserInput") {
    return (
      <section className="approval-card">
        <header><MessageSquarePlus size={16} /><strong>Codex 需要你的输入</strong></header>
        {questions.map((question: any) => (
          <label className="question" key={question.id}>
            <span>{question.header || question.question}</span>
            {question.header && <small>{question.question}</small>}
            {question.options ? (
              <select value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}>
                <option value="">请选择</option>
                {question.options.map((option: any) => <option key={option.label} value={option.label}>{option.label} - {option.description}</option>)}
              </select>
            ) : (
              <input type={question.isSecret ? "password" : "text"} value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />
            )}
          </label>
        ))}
        <footer><button className="primary" disabled={submitting} onClick={() => void reply({ answers: Object.fromEntries(questions.map((q: any) => [q.id, { answers: [answers[q.id] ?? ""] }])) })}><Check size={15} />提交</button></footer>
      </section>
    );
  }

  if (request.method === "mcpServer/elicitation/request") {
    const properties = params.requestedSchema?.properties ?? {};
    const content = Object.fromEntries(Object.keys(properties).map((key) => [key, answers[key] ?? ""]));
    return (
      <section className="approval-card">
        <header><Wrench size={16} /><strong>{params.serverName} 请求确认</strong></header>
        <p>{params.message}</p>
        {params.mode === "url" && <button onClick={() => void window.codex.openExternal(params.url)}>在浏览器中打开</button>}
        {params.mode !== "url" && Object.entries(properties).map(([key, schema]: [string, any]) => <label className="question" key={key}><span>{schema.title ?? key}</span>{schema.description && <small>{schema.description}</small>}{schema.enum ? <select value={answers[key] ?? ""} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })}><option value="">请选择</option>{schema.enum.map((value: string) => <option value={value} key={value}>{value}</option>)}</select> : <input type={schema.type === "number" || schema.type === "integer" ? "number" : "text"} value={answers[key] ?? ""} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })} />}</label>)}
        {replyError && <p className="request-error">{replyError}</p>}
        <footer><button disabled={submitting} onClick={() => void reply({ action: "decline", content: null, _meta: params._meta ?? null })}>拒绝</button><button className="primary" disabled={submitting} onClick={() => void reply({ action: "accept", content: params.mode === "url" ? null : content, _meta: params._meta ?? null })}><Check size={14} />确认</button></footer>
      </section>
    );
  }

  return (
    <section className="approval-card">
      <header><ShieldCheck size={16} /><strong>{request.method.includes("fileChange") ? "批准文件改动" : request.method.includes("permissions") ? "批准额外权限" : "批准命令执行"}</strong></header>
      {params.reason && <p>{params.reason}</p>}
      {params.command && <pre>{params.command}</pre>}
      {params.cwd && <div className="tool-meta">{params.cwd}</div>}
      {replyError && <p className="request-error">{replyError}</p>}
      <footer>
        <button disabled={submitting} onClick={() => void reply(commandLike ? { decision: decline } : { permissions: {}, scope: "turn" })}>拒绝</button>
        <button className="primary" disabled={submitting} onClick={() => void reply(commandLike ? { decision: allowOnce } : { permissions: Object.fromEntries(Object.entries(params.permissions ?? {}).filter(([, value]) => value != null)), scope: "turn" })}><Play size={14} />本次允许</button>
        {commandLike && (!available.length || available.includes(allowSession)) && <button disabled={submitting} onClick={() => void reply({ decision: allowSession })}>本会话允许</button>}
      </footer>
    </section>
  );
}

function ConnectorSetupModal({ draft, secret, saving, onDraftChange, onSecretChange, onClose, onSave }: { draft: ConnectorDraft; secret: string; saving: boolean; onDraftChange: (draft: ConnectorDraft) => void; onSecretChange: (value: string) => void; onClose: () => void; onSave: (draft: ConnectorDraft) => void }) {
  const valid = Boolean(draft.name.trim() && (draft.transport === "stdio" ? draft.command?.trim() : draft.url?.trim()));
  const changeTransport = (transport: ConnectorDraft["transport"]) => onDraftChange({ ...draft, transport });
  const save = () => onSave({ ...draft, secrets: secret.trim() ? { MCP_TOKEN: secret.trim() } : {} });
  return <div className="modal-backdrop connector-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="connector-setup-modal" role="dialog" aria-modal="true" aria-label="添加 MCP 连接器">
    <header><div className="connector-setup-title"><span><Link2 size={17} /></span><div><strong>添加 MCP 连接器</strong><p>填写服务提供方给出的连接信息，保存后会自动重启引擎并校验状态。</p></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button></header>
    <div className="connector-setup-steps"><span className="active">1 选择方式</span><i /><span>2 填写连接</span><i /><span>3 保存并验证</span></div>
    <div className="connector-transport-cards"><button type="button" className={draft.transport === "stdio" ? "active" : ""} onClick={() => changeTransport("stdio")}><TerminalSquare size={18} /><b>本地命令</b><small>适用于 npm、uvx、Docker 或已安装的 MCP 服务。</small></button><button type="button" className={draft.transport === "streamable_http" ? "active" : ""} onClick={() => changeTransport("streamable_http")}><Globe2 size={18} /><b>远程 HTTP</b><small>适用于服务商提供的 HTTPS MCP 地址和令牌。</small></button></div>
    <div className="connector-form"><label><span>连接器名称 <em>必填</em></span><input autoFocus value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} placeholder="例如：GitHub MCP" /></label>{draft.transport === "stdio" ? <><label><span>启动命令 <em>必填</em></span><input value={draft.command ?? ""} onChange={(event) => onDraftChange({ ...draft, command: event.target.value })} placeholder="例如：npx" /></label><label><span>命令参数 <small>可选，按空格分隔</small></span><input value={(draft.args ?? []).join(" ")} onChange={(event) => onDraftChange({ ...draft, args: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [] })} placeholder="例如：-y @modelcontextprotocol/server-github" /></label><div className="connector-example"><Info size={14} /><span>示例：<code>npx -y @modelcontextprotocol/server-github</code></span></div></> : <><label><span>MCP 服务地址 <em>必填</em></span><input value={draft.url ?? ""} onChange={(event) => onDraftChange({ ...draft, url: event.target.value })} placeholder="https://service.example.com/mcp" /></label><div className="connector-example"><Info size={14} /><span>请粘贴服务方提供的完整 HTTPS MCP 地址，不是官网主页。</span></div></>}<label><span>访问令牌 <small>可选，系统会加密保存</small></span><input value={secret} type="password" onChange={(event) => onSecretChange(event.target.value)} placeholder="没有令牌可先留空" /></label></div>
    <footer><button className="secondary-setting" onClick={onClose}>取消</button><button className="primary-setting" disabled={!valid || saving} onClick={save}>{saving ? <Spinner /> : <Check size={15} />}保存并验证</button></footer>
  </section></div>;
}

function ConnectorTemplateModal({ template, values, saving, oauth, onChange, onClose, onSave, onOAuth }: { template: ConnectorTemplate; values: Record<string, string>; saving: boolean; oauth: ConnectorOAuthEvent | null; onChange: (values: Record<string, string>) => void; onClose: () => void; onSave: () => void; onOAuth: () => void }) {
  const invalid = template.fields.filter((field) => !field.optional && !values[field.key]?.trim());
  const oauthBusy = oauth?.phase === "waiting";
  return <div className="modal-backdrop connector-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !oauthBusy) onClose(); }}><section className="connector-setup-modal" role="dialog" aria-modal="true" aria-label={`配置 ${template.name}`}>
    <header><div className="connector-setup-title"><span><Link2 size={17} /></span><div><strong>配置 {template.name}</strong><p>{template.summary}</p></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button></header>
    <div className="connector-template-vendor"><Zap size={13} /><span>{template.vendor}</span><small>{template.transport === "stdio" ? "本地命令 · stdio" : "远程服务 · HTTP MCP"}</small></div>
    <div className="connector-form">{template.fields.map((field, index) => <label key={field.key}><span>{field.label}{field.optional ? <small> 可选</small> : <em> 必填</em>}</span><input autoFocus={index === 0} value={values[field.key] ?? ""} type={field.secret ? "password" : "text"} onChange={(event) => onChange({ ...values, [field.key]: event.target.value })} placeholder={field.placeholder} />{field.hint && <small className="field-hint">{field.hint}</small>}</label>)}
      {template.oauth && <div className="connector-oauth-zone"><div className="connector-oauth-head"><KeyRound size={14} /><strong>OAuth 授权</strong><small>跳转官方授权页，授权完成即连接</small></div>{template.oauthNote && <p className="field-hint">{template.oauthNote}</p>}
        {oauth?.phase === "waiting" && <div className="oauth-status waiting"><Spinner /><span>{oauth.message}</span>{oauth.authorizeUrl && <a className="oauth-open-link" href={oauth.authorizeUrl} target="_blank" rel="noreferrer">没自动打开？点此打开授权页</a>}</div>}
        {oauth?.phase === "authorized" && <div className="oauth-status ok"><CircleCheck size={15} /><span>{oauth.message}</span></div>}
        {oauth?.phase === "failed" && <div className="oauth-status fail"><AlertTriangle size={15} /><span>{oauth.message}</span></div>}
      </div>}
      <div className="connector-example"><Info size={14} /><span>{template.transport === "stdio" ? "填写后写入本机 Codex 配置（命令行参数或环境变量），密钥仅保存在本机。" : "密钥走系统加密存储，经 Authorization 头注入远程 MCP。"} <a href={template.helpUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>如何获取凭据 ↗</a></span></div></div>
    <footer><button className="secondary-setting" onClick={onClose}>取消</button><button className="secondary-setting" disabled={invalid.length > 0 || saving || oauthBusy} onClick={onSave}>{saving ? <Spinner /> : <Check size={15} />}保存并验证</button>{template.oauth && <button className="primary-setting" disabled={invalid.length > 0 || saving || oauthBusy} onClick={onOAuth}>{oauthBusy ? <Spinner /> : <KeyRound size={15} />}{oauth?.phase === "authorized" ? "重新授权" : "授权连接"}</button>}</footer>
  </section></div>;
}

/** 技能头像：市场 emoji 优先，空缺时按关键词/分类映射 lucide 图标，配色随分类。 */
function SkillAvatar({ skill, size = 15 }: { skill: { name: string; description?: string; category?: string; icon?: string }; size?: number }) {
  // 市场数据带真实图标 URL（SkillHub iconUrl / 插件 logo）时优先显示图片，其余走 emoji/图标映射
  if (skill.icon?.startsWith("http")) {
    // 原地址直连（cloudcache/SkillHub CDN 直连可达），失败切 jsDelivr 镜像兜底，再失败隐藏露 emoji
    return <SkillAvatarImg name={skill.name} url={skill.icon} />;
  }
  const visual: SkillVisual = resolveSkillVisual(skill);
  return <span className={`skill-avatar ${visual.iconClass}`}>{visual.emoji || (visual.Icon ? <visual.Icon size={size} /> : null)}</span>;
}

function SkillAvatarImg({ name, url }: { name: string; url: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const handleError = () => {
    if (src === url && toCdnLogo(url) !== url) { setSrc(toCdnLogo(url)); return; }
    setFailed(true);
  };
  if (failed) {
    const visual: SkillVisual = resolveSkillVisual({ name });
    return <span className={`skill-avatar ${visual.iconClass}`}>{visual.emoji || (visual.Icon ? <visual.Icon size={15} /> : null)}</span>;
  }
  return <span className="skill-avatar skill-avatar-img" title={name}><img src={src} alt="" loading="lazy" onError={handleError} /></span>;
}

function SkillInstallModal({ state, onClose, onUse }: { state: SkillInstallState; onClose: () => void; onUse: () => void }) {
  const steps = ["下载技能包", "检查文件结构", "安全检查", "写入技能目录", "登记市场来源", "重启 Codex 引擎", "确认引擎发现"];
  const done = state.current >= steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="安装技能">
    <header><div><SkillAvatar skill={state.skill} size={17} /><div><strong>正在安装 {state.skill.name}</strong><p>{state.failed ? "安装没有完成，文件不会作为可用技能显示。" : done ? "安装流程已结束。请查看引擎发现状态。" : "请保持此窗口打开，安装会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRegistered ? "ok" : "pending"}`}><CircleCheck size={17} /><div><strong>{state.engineRegistered ? "Codex 已发现此技能" : "技能已安装，等待引擎下一轮扫描"}</strong><p>{state.engineCheckMessage ?? "已写入技能目录。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>安装失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="secondary-setting" onClick={onClose}>关闭</button>{done && <button className="primary-setting" onClick={onUse}><Quote size={14} />在对话中使用</button>}</footer>}
  </section></div>;
}

/** 卸载技能弹窗：与安装同款分步进度（校验 → 删除文件 → 清理登记 → 重启引擎 → 确认移除），
 *  解决「点一下只弹个小提示、感觉没卸掉」的问题——结束时明确给出引擎是否已移除的结论。 */
function SkillRemoveModal({ state, onClose }: { state: SkillRemoveState; onClose: () => void }) {
  const steps = ["校验技能目录", "删除技能文件", "清理来源登记", "重启 Codex 引擎", "确认引擎已移除"];
  // 进度口径：事件把 current 推到 steps.length 时最后一步仍是「处理中」，收到 complete/pending
  // （推一位）才判定整体完成——与安装弹窗「verify 后还有 complete」的节奏一致。
  const done = state.current > steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="卸载技能">
    <header><div><span className="skill-remove-badge"><Trash2 size={16} /></span><div><strong>正在卸载 {state.name}</strong><p>{state.failed ? "卸载没有完成，技能目录可能仍存在。" : done ? "卸载流程已结束。请查看引擎移除状态。" : "请保持此窗口打开，卸载会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRemoved ? "ok" : "pending"}`}>{state.engineRemoved ? <CircleCheck size={17} /> : <AlertTriangle size={17} />}<div><strong>{state.engineRemoved ? "已卸载：Codex 不再发现此技能" : "已删除文件，等待引擎下一轮扫描确认"}</strong><p>{state.engineCheckMessage ?? "技能目录已删除。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>卸载失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="primary-setting" onClick={onClose}>完成</button></footer>}
  </section></div>;
}

/** 插件市场安装弹窗：与技能安装同款进度，阶段为插件专属（GitHub 下载 → 写入 marketplace 目录） */
function PluginInstallModal({ state, onClose }: { state: PluginInstallState; onClose: () => void }) {
  const steps = ["解析插件仓库", "下载插件文件", "写入插件目录", "登记市场来源", "重启 Codex 引擎", "确认引擎发现"];
  const done = state.current >= steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="安装插件">
    <header><div><span className="plugin-market-logo plugin-market-logo-letter modal">{state.plugin.displayName.charAt(0).toUpperCase()}</span><div><strong>正在安装 {state.plugin.displayName}</strong><p>{state.failed ? "安装没有完成，插件不会生效。" : done ? "安装流程已结束。请查看引擎发现状态。" : "请保持此窗口打开，安装会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRegistered ? "ok" : "pending"}`}><CircleCheck size={17} /><div><strong>{state.engineRegistered ? "Codex 已发现此插件" : "插件已安装，等待引擎下一轮扫描"}</strong><p>{state.engineCheckMessage ?? "已写入本地插件目录。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>安装失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="secondary-setting" onClick={onClose}>关闭</button></footer>}
  </section></div>;
}

const PRIORITY_LABELS: Record<MemoryPriority, { label: string; hint: string; accent: string }> = {
  P0: { label: "P0 · 核心", hint: "置顶 + 长期保留，召回时永远优先", accent: "var(--green)" },
  P1: { label: "P1 · 重要", hint: "项目背景 / 工作流 SOP，长期可复用", accent: "var(--blue, #4a90e2)" },
  P2: { label: "P2 · 一般", hint: "任务经验与事实，按工作区可复用", accent: "var(--amber, #d99000)" },
  P3: { label: "P3 · 临时", hint: "临时上下文，自动衰减 / 可清理", accent: "var(--muted)" },
};

/** 相对时间显示：2 分钟内=刚刚；24 小时内=N 小时前；30 天内=N 天前；更早=短日期 */
function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 2 * 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 24 * 60 * 60_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function MemoryFunnel({ groups, onPreview, onTogglePin, onDeleteOne, onDeleteGroup, onOpenThread }: {
  groups: MemoryGroup[];
  onPreview: (entry: MemoryRecord) => void;
  onTogglePin: (id: string) => void;
  onDeleteOne: (id: string) => void;
  onDeleteGroup: (group: MemoryGroup) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 层级别折叠：P0 默认展开（核心一眼可见），P1/P2/P3 默认整层收起
  const [collapsedLayers, setCollapsedLayers] = useState<Record<string, boolean>>({ P1: true, P2: true, P3: true });
  const buckets = useMemo(() => {
    const map: Record<MemoryPriority, MemoryGroup[]> = { P0: [], P1: [], P2: [], P3: [] };
    for (const g of groups) map[g.priority].push(g);
    return map;
  }, [groups]);
  const totalItems = useMemo(() => groups.reduce((sum, g) => sum + g.items.length, 0), [groups]);
  const totalPinned = useMemo(() => groups.reduce((sum, g) => sum + g.items.filter((it) => (it as any).pinned).length, 0), [groups]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleLayer = (p: MemoryPriority) => setCollapsedLayers((prev) => ({ ...prev, [p]: !prev[p] }));

  if (!groups.length) {
    return <div className="memory-funnel-empty"><p>暂无记忆。开启自动捕获后，新会话的关键内容会按 P 级沉淀到这里；或者上方手动保存一条。</p></div>;
  }

  const order: MemoryPriority[] = ["P0", "P1", "P2", "P3"];
  return (
    <div className="memory-funnel">
      <div className="memory-funnel-summary">
        <strong>{totalItems}</strong> 条记忆 · <strong>{groups.length}</strong> 个会话 · <strong>{totalPinned}</strong> 个置顶
      </div>
      {order.map((p) => {
        const list = buckets[p];
        if (!list.length) return null;
        const meta = PRIORITY_LABELS[p];
        const count = list.reduce((sum, g) => sum + g.items.length, 0);
        const layerCollapsed = !!collapsedLayers[p];
        return (
          <section key={p} className={`memory-funnel-layer memory-funnel-${p} ${layerCollapsed ? "collapsed" : ""}`}>
            <header className="memory-funnel-layer-head" style={{ borderLeftColor: meta.accent }} onClick={() => toggleLayer(p)} role="button" aria-expanded={!layerCollapsed} title={layerCollapsed ? "展开该层级" : "折叠该层级"}>
              <div className="memory-funnel-layer-title"><span className="memory-funnel-layer-tag" style={{ background: meta.accent }}>{meta.label}</span><span className="memory-funnel-layer-hint">{meta.hint}</span></div>
              <div className="memory-funnel-layer-count">{list.length} 个会话 · {count} 条
                <button className={`memory-group-chevron ${layerCollapsed ? "" : "open"}`} title={layerCollapsed ? "展开" : "收起"}>{layerCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
              </div>
            </header>
            {!layerCollapsed && (
            <div className="memory-funnel-groups">
              {list.map((group) => {
                const isOpen = !!expanded[group.key];
                return (
                  <article key={group.key} className={`memory-group ${isOpen ? "open" : ""}`}>
                    <header className="memory-group-head" onClick={() => toggle(group.key)}>
                      <div className="memory-group-title">
                        {group.threadId
                          ? <button className="memory-group-open-thread" title="打开会话" onClick={(event) => { event.stopPropagation(); onOpenThread(group.threadId!); }}><MessageSquare size={12} /></button>
                          : <span className="memory-group-manual" title="手动保存"><Edit3 size={12} /></span>}
                        <span className="memory-group-name">{group.threadTitle}</span>
                      </div>
                      <div className="memory-group-meta">
                        {group.categories.map((cat) => <span key={cat} className="memory-category-pill">{cat}</span>)}
                        <span className="memory-group-time" title={new Date(group.latestAt).toLocaleString()}>{formatRelativeTime(group.latestAt)}</span>
                        <span className="memory-group-count">{group.items.length} 条</span>
                        <button className="icon-button" title="删除整个会话记忆" onClick={(event) => { event.stopPropagation(); onDeleteGroup(group); }}><Trash2 size={12} /></button>
                        <button className={`memory-group-chevron ${isOpen ? "open" : ""}`} title={isOpen ? "收起" : "展开"}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                      </div>
                    </header>
                    {isOpen && (
                      <div className="memory-group-items">
                        {group.items.map((entry) => (
                          <article className={`memory-card ${(entry as any).pinned ? "pinned" : ""}`} key={entry.id} onClick={() => onPreview(entry)} title="点击查看全文">
                            <div className="memory-card-head">
                              <span className="memory-category-pill">{entry.category}</span>
                              {(entry as any).pinned && <span className="memory-pin-badge" title="核心记忆，不被自动清理">★ 核心</span>}
                              {(entry as any).workspace && <span className="memory-ws-badge" title="项目记忆">{(entry as any).workspace.split(/[\\/]/).pop()}</span>}
                              <span className="memory-card-time" title={new Date(entry.updatedAt).toLocaleString()}>{formatRelativeTime(entry.updatedAt)}</span>
                              {entry.sourceThreadId && <button className="icon-button" title="打开源会话" onClick={(event) => { event.stopPropagation(); onOpenThread(entry.sourceThreadId!); }}><MessageSquare size={12} /></button>}
                              <button className={`icon-button ${(entry as any).pinned ? "pin-on" : ""}`} title={(entry as any).pinned ? "取消置顶" : "置顶为核心记忆"} onClick={(event) => { event.stopPropagation(); onTogglePin(entry.id); }}><Star size={12} /></button>
                              <button className="icon-button" title="删除" onClick={(event) => { event.stopPropagation(); onDeleteOne(entry.id); }}><Trash2 size={12} /></button>
                            </div>
                            <p className="memory-card-preview">{entry.content}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MemoryLayersEditor({ snapshot, scope, draft, dirty, distilling, hasWorkspace, savedAt, onScope, onDraft, onSave, onDistill }: {
  snapshot: MemoryLayersSnapshot | null;
  scope: "user" | "background" | "project";
  draft: string;
  dirty: boolean;
  distilling: boolean;
  hasWorkspace: boolean;
  savedAt: number | null;
  onScope: (scope: "user" | "background" | "project") => void;
  onDraft: (value: string) => void;
  onSave: () => void;
  onDistill: () => void;
}) {
  if (!snapshot) return <div className="memory-layers"><p className="memory-layers-loading">正在读取记忆分层…</p></div>;
  const over = snapshot.budget.over;
  const pending = snapshot.pendingDistill.dates.length;
  return (
    <div className="memory-layers">
      <div className="memory-layers-head">
        <div className="memory-layers-title">
          <span className="memory-layers-icon"><BookOpen size={15} /></span>
          <div>
            <strong>常驻记忆</strong>
          <span>每轮对话自动前置。用户档案跨项目生效，项目背景与项目记忆只跟随当前工作区。</span>
          </div>
        </div>
        <div className={`memory-budget ${over ? "over" : ""}`} title="超过预算会在注入时截断并提示蒸馏">
          <span>用户 {snapshot.budget.user}/1500</span>
          <span>背景 {snapshot.budget.background}/2000</span>
          <span>项目 {snapshot.budget.project}/3000</span>
          <span>日志 {snapshot.budget.logs}</span>
          {over && <span className="memory-budget-warn">超预算</span>}
        </div>
      </div>

      <div className="memory-layer-tabs" role="tablist" aria-label="记忆分层">
        <button role="tab" aria-selected={scope === "user"} className={`memory-layer-tab ${scope === "user" ? "active" : ""}`} onClick={() => onScope("user")}>用户档案</button>
        <button role="tab" aria-selected={scope === "background"} className={`memory-layer-tab ${scope === "background" ? "active" : ""}`} disabled={!hasWorkspace} title={hasWorkspace ? "所有该项目会话都会读取" : "先选择一个工作区"} onClick={() => onScope("background")}>项目背景</button>
        <button role="tab" aria-selected={scope === "project"} className={`memory-layer-tab ${scope === "project" ? "active" : ""}`} disabled={!hasWorkspace} title={hasWorkspace ? "跟随当前工作区" : "先选择一个工作区"} onClick={() => onScope("project")}>项目记忆</button>
        <span className="memory-layer-path" title={scope === "user" ? snapshot.paths.user : scope === "background" ? snapshot.paths.background : snapshot.paths.project}>{scope === "user" ? snapshot.paths.user : (scope === "background" ? (snapshot.paths.background || "未选择工作区") : (snapshot.paths.project || "未选择工作区"))}</span>
      </div>

      <textarea
        className="memory-layer-editor"
        rows={9}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder={scope === "user"
          ? "跨所有项目生效的规则与偏好。一行一条，只写不看会再踩的：\n- 回答用中文，先给结论再给依据\n- 不要主动提交 git，未经确认不 push"
          : scope === "background"
            ? "这个项目是做什么的、目录怎么分、运行前必须知道什么。新会话会优先读取这里：\n- 项目目标：\n- 关键目录：\n- 启动/构建方式：\n- 不能做的事："
            : "这个项目的长期约束与踩过的坑。一行一条：\n- 改完源码必须 npm run build，否则「没生效」多半是没构建\n- Windows 沙箱下 exec_command 全被拦，改用 npm pre/post 钩子"}
      />

      <div className="memory-layer-actions">
        <button className={`primary-setting ${savedAt ? "memory-save-success" : ""}`} disabled={!dirty} onClick={onSave}>{savedAt ? <CircleCheck size={14} /> : <Check size={14} />}{savedAt ? "已保存" : `保存${scope === "user" ? "用户档案" : scope === "background" ? "项目背景" : "项目记忆"}`}</button>
        <button className="secondary-setting" disabled={distilling || !hasWorkspace || !pending} title={!hasWorkspace ? "先选择一个工作区" : pending ? `有 ${pending} 天日志满 30 天，可蒸馏进项目记忆` : "暂无满 30 天的日志"} onClick={onDistill}>
          {distilling ? <Spinner /> : <Sparkles size={14} />}蒸馏日志{pending ? `（${pending} 天）` : ""}
        </button>
        {dirty && <span className="memory-layer-dirty">有未保存的修改</span>}
        {snapshot.lastDistillAt && <span className="memory-layer-hint">上次蒸馏 {new Date(snapshot.lastDistillAt).toLocaleString()}</span>}
      </div>

      {!!snapshot.logs.length && (
        <div className="memory-layer-logs">
          <span className="memory-layer-logs-label">近期日志</span>
          {snapshot.logs.map((entry) => <span key={entry.date} className="memory-layer-log-chip" title={`${entry.chars} 字`}>{entry.date} · {entry.chars} 字</span>)}
        </div>
      )}
    </div>
  );
}

function MemoryConfigModal({ gateway, setGateway, action, onClose, onTest, onSave }: {
  gateway: MemoryGatewayState;
  setGateway: (g: MemoryGatewayState) => void;
  action: "save" | "test" | null;
  onClose: () => void;
  onTest: () => void;
  onSave: () => void;
}) {
  const valid = Boolean(gateway.endpoint.trim());
  return createPortal(
    <div className="modal-backdrop memory-config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal memory-config-modal" role="dialog" aria-modal="true" aria-label="云端记忆配置">
        <header>
          <div className="connector-setup-title">
            <span><Cloud size={17} /></span>
            <div><strong>云端记忆配置</strong><p>配置 TencentDB Gateway 后，启用云端记忆时 Codex 会优先从云端召回与保存。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>TencentDB Gateway 地址 <em>必填</em></span><input autoFocus value={gateway.endpoint} onChange={(event) => setGateway({ ...gateway, endpoint: event.target.value })} placeholder="http://127.0.0.1:8420" /></label>
          <div className="settings-grid three memory-config-row"><label><span>Session Key</span><input value={gateway.sessionKey} onChange={(event) => setGateway({ ...gateway, sessionKey: event.target.value })} placeholder="codex-harness" /></label><label><span>User ID</span><input value={gateway.userId} onChange={(event) => setGateway({ ...gateway, userId: event.target.value })} /></label><label><span>API Key <small>加密保存</small></span><input type="password" value={gateway.apiKey} onChange={(event) => setGateway({ ...gateway, apiKey: event.target.value })} placeholder={gateway.hasApiKey ? "已安全保存，留空不修改" : "可选"} /></label></div>
          <div className="connector-example"><Info size={14} /><span>默认 Endpoint <code>http://127.0.0.1:8420</code>；开启云端后会自动写回 Codex 引擎的 <code>memory_recall / memory_save</code> 工具。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="secondary-setting" disabled={!valid || action !== null} onClick={onTest}>{action === "test" ? <Spinner /> : <Wifi size={14} />}测试连接</button>
          <button className="primary-setting" disabled={action !== null} onClick={onSave}>{action === "save" ? <Spinner /> : <Check size={15} />}保存并启用云端</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function SubAgentEditorModal({ draft, onChange, onClose, onSave }: { draft: SubAgentEntry; onChange: (draft: SubAgentEntry) => void; onClose: () => void; onSave: (draft: SubAgentEntry) => void }) {
  const valid = Boolean(draft.name.trim() && draft.systemPrompt.trim());
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal subagent-editor-modal" role="dialog" aria-modal="true" aria-label="编辑子智能体">
        <header>
          <div className="connector-setup-title">
            <span><Bot size={17} /></span>
            <div><strong>{draft.id ? `编辑「${draft.name}」` : "新建子智能体"}</strong><p>子智能体会跟随主对话的模型/沙箱/审批配置；保存后会被 Codex 通过 dynamicTools 调用。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>名称 <em>必填</em></span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：代码审查员 / Bug Hunter / 测试工程师" /></label>
          <label><span>简介 <small>一句话说明它负责什么</small></span><input value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="例如：专门审查 PR 改动并列出潜在问题" /></label>
          <label><span>系统提示词 <em>必填</em></span><textarea rows={6} value={draft.systemPrompt} onChange={(event) => onChange({ ...draft, systemPrompt: event.target.value })} placeholder="例如：你是一名资深前端审查员，专注 React 性能、可访问性与安全问题。请基于用户给定的代码或需求给出结构化结论。" /></label>
          <div className="settings-grid three subagent-config-grid">
            <label><span>推理强度</span><select value={draft.effort} onChange={(event) => onChange({ ...draft, effort: event.target.value })}>{ALL_EFFORTS.map((level) => <option key={level} value={level}>{effortLabels[level] ?? level}</option>)}</select></label>
            <label><span>模型</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritModel} onChange={(event) => onChange({ ...draft, inheritModel: event.target.checked, model: event.target.checked ? undefined : draft.model })} />跟随主对话</label>
              {!draft.inheritModel && <input value={draft.model ?? ""} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="例如：claude-sonnet-4" />}
            </label>
            <label><span>沙箱</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritSandbox} onChange={(event) => onChange({ ...draft, inheritSandbox: event.target.checked, sandbox: event.target.checked ? undefined : draft.sandbox })} />跟随主对话</label>
              {!draft.inheritSandbox && <select value={draft.sandbox ?? "workspace-write"} onChange={(event) => onChange({ ...draft, sandbox: event.target.value as any })}><option value="read-only">只读</option><option value="workspace-write">工作区写入</option><option value="danger-full-access">完全访问</option></select>}
            </label>
          </div>
          <div className="settings-grid three subagent-config-grid">
            <label><span>审批策略</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.inheritApproval} onChange={(event) => onChange({ ...draft, inheritApproval: event.target.checked, approvalPolicy: event.target.checked ? undefined : draft.approvalPolicy })} />跟随主对话</label>
              {!draft.inheritApproval && <select value={draft.approvalPolicy ?? "on-request"} onChange={(event) => onChange({ ...draft, approvalPolicy: event.target.value as any })}><option value="never">从不</option><option value="on-request">按需</option><option value="on-failure">失败时</option><option value="untrusted">不可信</option></select>}
            </label>
            <label><span>状态</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />已启用</label>
            </label>
            <label><span>工具名</span>
              <div className="subagent-tool-name"><code>subagent_invoke</code></div>
            </label>
          </div>
          <div className="connector-example"><Info size={14} /><span>Codex 调用时会附带 <code>name</code> 与 <code>query</code>；主会话配置变更后，子智能体会自动跟随。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid} onClick={() => onSave(draft)}><Check size={15} />保存</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ExpertTeamEditorModal({ draft, onChange, onClose, onSave }: { draft: ExpertTeamConfig; onChange: (draft: ExpertTeamConfig) => void; onClose: () => void; onSave: (draft: ExpertTeamConfig) => void }) {
  const valid = Boolean(draft.displayName.zh.trim() && draft.lead.name.trim() && draft.lead.systemPrompt.trim());
  const setLead = (patch: Partial<ExpertTeamMember>) => onChange({ ...draft, lead: { ...draft.lead, ...patch } });
  const setMember = (index: number, patch: Partial<ExpertTeamMember>) => onChange({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, ...patch } : m) });
  const setTag = (index: number, value: string) => onChange({ ...draft, tags: draft.tags.map((t, i) => i === index ? { ...t, zh: value, en: value } : t) });
  const setPrompt = (index: number, value: string) => onChange({ ...draft, quickPrompts: draft.quickPrompts.map((p, i) => i === index ? { ...p, zh: value, en: value } : p) });
  const categoryOptions = [
    ["01-ProductDesign", "产品设计"], ["02-Engineering", "技术工程"], ["03-GameSpatial", "游戏空间"],
    ["04-DataAI", "数据智能"], ["05-MarketingGrowth", "营销增长"], ["06-ContentCreative", "内容创作"],
    ["07-SalesCommerce", "销售商务"], ["08-FinanceInvestment", "金融投资"], ["09-OperationsHR", "运营人力"],
    ["10-ProjectQuality", "项目质量"], ["11-SecurityCompliance", "法务安全"], ["12-IndustryConsultant", "行业顾问"],
  ];
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal expert-team-editor-modal" role="dialog" aria-modal="true" aria-label="编辑专家团">
        <header>
          <div className="connector-setup-title">
            <span><Users size={17} /></span>
            <div><strong>{draft.teamId ? `编辑「${draft.displayName.zh}」` : "新建专家团"}</strong><p>复刻 WorkBuddy 专家团：主理人编排，成员独立产出，按 SOP 分阶段协作。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <div className="settings-grid two expert-team-grid">
            <label><span>团队名称（中文） <em>必填</em></span><input autoFocus value={draft.displayName.zh} onChange={(event) => { const zh = event.target.value; onChange({ ...draft, displayName: { ...draft.displayName, zh }, profession: { ...draft.profession, zh } }); }} placeholder="例如：软件开发专家团" /></label>
            <label><span>团队名称（英文）</span><input value={draft.displayName.en} onChange={(event) => { const en = event.target.value; onChange({ ...draft, displayName: { ...draft.displayName, en }, profession: { ...draft.profession, en } }); }} placeholder="例如：Software Dev Team" /></label>
          </div>
          <div className="settings-grid three expert-team-grid">
            <label><span>行业分类</span><select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value })}>{categoryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label><span>启用状态</span>
              <label className="subagent-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />已启用</label>
            </label>
            <label><span>团队 ID <small>kebab-case，留空自动生成</small></span><input value={draft.teamId} onChange={(event) => onChange({ ...draft, teamId: event.target.value })} placeholder="例如：software-dev-team" /></label>
          </div>
          <label><span>展示描述 <small>中文 40-50 字</small></span><textarea rows={2} value={draft.description.zh} onChange={(event) => onChange({ ...draft, description: { ...draft.description, zh: event.target.value } })} placeholder="例如：由产品、架构、开发、测试四人协同，从需求澄清到交付验收全流程把关。" /></label>
          <div className="settings-grid three expert-team-grid">
            {[0, 1, 2].map((index) => <label key={index}><span>标签 {index + 1}</span><input value={draft.tags[index]?.zh ?? ""} onChange={(event) => setTag(index, event.target.value)} placeholder="例如：需求梳理" /></label>)}
          </div>
          <div className="settings-grid three expert-team-grid">
            {[0, 1, 2].map((index) => <label key={index}><span>推荐提示词 {index + 1}</span><input value={draft.quickPrompts[index]?.zh ?? ""} onChange={(event) => setPrompt(index, event.target.value)} placeholder="例如：请带领团队完成我的任务" /></label>)}
          </div>
          <div className="expert-team-section">
             <div className="expert-team-section-title"><strong>主理人 <small>负责编排调度，不显示个人姓名</small></strong></div>
            <div className="settings-grid three expert-team-grid">
               <label><span>内部角色标识</span><input value={draft.lead.name} onChange={(event) => setLead({ name: event.target.value })} placeholder="例如：delivery-lead" /></label>
              <label><span>职业头衔</span><input value={draft.lead.profession.zh} onChange={(event) => setLead({ profession: { ...draft.lead.profession, zh: event.target.value } })} placeholder="例如：交付总监" /></label>
              <label><span>成员 ID <small>kebab-case</small></span><input value={draft.lead.id} onChange={(event) => setLead({ id: event.target.value })} placeholder="例如：software-dev-team-lead" /></label>
            </div>
            <label><span>一句话职责</span><input value={draft.lead.description} onChange={(event) => setLead({ description: event.target.value })} placeholder="例如：编排调度整个团队，把控交付节奏与质量" /></label>
            <label><span>主理人系统提示词 <em>必填</em></span><textarea rows={5} value={draft.lead.systemPrompt} onChange={(event) => setLead({ systemPrompt: event.target.value })} placeholder={"例如：你是团队主理人，负责编排调度成员…\n协作铁律：由你亲自编排、成员独立产出、信息经你中转、采信成员结论。"} /></label>
          </div>
          <div className="expert-team-section">
            <div className="expert-team-section-title"><strong>团队成员 <small>{draft.members.length} 人 · 每个成员独立会话产出</small></strong>
              <button className="secondary-setting" onClick={() => onChange({ ...draft, members: [...draft.members, { id: "", name: "", profession: { zh: "", en: "" }, description: "", systemPrompt: "" }] })}><Plus size={12} />添加成员</button>
            </div>
            {draft.members.map((member, index) => (
              <div className="expert-team-member" key={index}>
                 <div className="expert-team-member-head"><strong>成员 {index + 1} · {member.profession.zh || "未命名角色"}</strong>
                  <button className="icon-button" title="删除成员" onClick={() => onChange({ ...draft, members: draft.members.filter((_, i) => i !== index) })}><Trash2 size={13} /></button>
                </div>
                <div className="settings-grid three expert-team-grid">
                   <label><span>内部角色标识</span><input value={member.name} onChange={(event) => setMember(index, { name: event.target.value })} placeholder="例如：engineer" /></label>
                  <label><span>职业头衔</span><input value={member.profession.zh} onChange={(event) => setMember(index, { profession: { ...member.profession, zh: event.target.value } })} placeholder="例如：开发工程师" /></label>
                  <label><span>成员 ID <small>kebab-case</small></span><input value={member.id} onChange={(event) => setMember(index, { id: event.target.value })} placeholder="例如：engineer" /></label>
                </div>
                <label><span>一句话职责</span><input value={member.description} onChange={(event) => setMember(index, { description: event.target.value })} placeholder="例如：代码实现" /></label>
                <label><span>系统提示词 <em>必填</em></span><textarea rows={4} value={member.systemPrompt} onChange={(event) => setMember(index, { systemPrompt: event.target.value })} placeholder={"例如：你是团队成员，负责…\n完成后通过 SendMessage 将完整结果回传给主理人。"} /></label>
              </div>
            ))}
            {!draft.members.length && <div className="expert-team-member-empty">还没有成员，点击「添加成员」创建第一个。</div>}
          </div>
          <label><span>标准工作流程（SOP）</span><textarea rows={6} value={draft.sop} onChange={(event) => onChange({ ...draft, sop: event.target.value })} placeholder={"例如：\n### Phase 1（并行）：…\n### Phase 2（串行）：…\n### Phase N：主理人汇总输出"} /></label>
          <div className="connector-example"><Info size={14} /><span>发起团队会话后，主理人（lead）会在独立会话中通过 <code>team_member_invoke(memberId, query)</code> 调度成员，按 SOP 分阶段协作，最终汇总交付。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid} onClick={() => onSave(draft)}><Check size={15} />保存专家团</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

type CommandEditorDraft = { mode: "new" | "edit"; name: string; source: CommandSource; description: string; argumentHint: string; allowedTools: string; model: string; body: string; prevFilePath?: string };

function CommandEditorModal({ draft, saving, onChange, onClose, onSave }: {
  draft: CommandEditorDraft;
  saving: boolean;
  onChange: (draft: CommandEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const valid = Boolean(draft.name.trim() && draft.body.trim());
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="connector-setup-modal command-editor-modal" role="dialog" aria-modal="true" aria-label={draft.mode === "edit" ? "编辑命令" : "新建命令"}>
        <header>
          <div className="connector-setup-title">
            <span><TerminalSquare size={17} /></span>
            <div><strong>{draft.mode === "edit" ? `编辑 /${draft.name}` : "新建自定义命令"}</strong><p>保存为 commands/*.md 文件，输入框里敲 <code>/{draft.name || "命令名"}</code> 即可触发。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <div className="settings-grid two command-editor-grid">
            <label><span>命令名 <em>必填</em> <small>不含斜杠</small></span><input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：git:commit（冒号分层，如 frontend:build）" /></label>
            <label><span>存放位置</span>
              <select value={draft.source} onChange={(event) => onChange({ ...draft, source: event.target.value as CommandSource })}>
                <option value="project">项目级（当前工作区 .codex/commands/）</option>
                <option value="global">个人全局（$CODEX_HOME/commands/）</option>
              </select>
            </label>
          </div>
          <label><span>描述 <small>在命令列表与补全提示中展示</small></span><input value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="例如：创建 git 提交（自动收集状态与变更）" /></label>
          <div className="settings-grid three command-editor-grid">
            <label><span>参数提示</span><input value={draft.argumentHint} onChange={(event) => onChange({ ...draft, argumentHint: event.target.value })} placeholder="例如：[message] 或 [pr-number]" /></label>
            <label><span>允许工具</span><input value={draft.allowedTools} onChange={(event) => onChange({ ...draft, allowedTools: event.target.value })} placeholder="例如：Bash(git:*), Read" /></label>
            <label><span>指定模型</span><input value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} placeholder="例如：gemini-3.1-pro" /></label>
          </div>
          <label><span>命令内容 <em>必填</em></span>
            <textarea rows={9} value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} placeholder={"例如：\n请为我运行 `npm run test -- $1` 并总结结果。未提供测试文件则运行全部测试。"} />
          </label>
          <div className="connector-example"><Info size={14} /><span>模板语法：<code>$1</code>…<code>$9</code> 位置参数、<code>$ARGUMENTS</code> 全部参数；<code>@src/utils/helpers.js</code> 注入文件内容；行首 <code>!`git status`</code> 执行 shell 命令并把输出作为上下文。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="primary-setting" disabled={!valid || saving} onClick={onSave}>{saving ? <Spinner /> : <Check size={15} />}保存命令</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** 全局搜索命中预览弹窗：会话全文由主进程读 rollout 提供；记忆/任务/技能就地展示全文与详情。
 * 只读预览——不影响当前会话；底部按钮跳转到真正管理该内容的位置。 */
function SearchPreviewModal({ target, onClose, onOpenThread, onOpenSettings, onCopyThreadId }: {
  target: SearchPreviewTarget;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  onOpenSettings: (page: string) => void;
  onCopyThreadId?: (id: string) => void;
}) {
  const [loading, setLoading] = useState(target.kind === "thread");
  const [preview, setPreview] = useState<{ name: string; updatedAt: number; cwd: string; archived: boolean; messages: { role: "user" | "assistant"; text: string }[]; truncated: number; truncatedMessages: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (target.kind !== "thread") { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setFailed(false);
    window.codex.previewConversation(target.id)
      .then((data) => { if (live) { setPreview(data); if (!data) setFailed(true); } })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [target]);

  const headIcon = target.kind === "thread" ? <MessageSquare size={15} /> : target.kind === "memory" ? <Archive size={15} /> : target.kind === "task" ? <Clock3 size={15} /> : <Zap size={15} />;
  const headLabel = target.kind === "thread" ? "会话全文" : target.kind === "memory" ? "记忆全文" : target.kind === "task" ? "定时任务" : "技能详情";
  let titleText = target.kind === "thread" ? target.title : target.kind === "memory" ? (target.content.split("\n")[0].trim().slice(0, 80) || "(空记忆)") : target.name;
  return (
    <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-preview-modal" role="dialog" aria-modal="true" aria-label={headLabel}>
        <header>
          <span className={`search-preview-kind search-preview-kind-${target.kind}`}>{headIcon}{headLabel}</span>
          <strong className="search-preview-title" title={titleText}>{titleText}</strong>
          {target.kind === "thread" && onCopyThreadId && (
            <button className="icon-button" title="复制会话 ID（粘贴到其他会话发送即可引用这条会话）" onClick={() => onCopyThreadId(target.id)}><Copy size={16} /></button>
          )}
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="search-preview-body">
          {target.kind === "thread" && (loading ? (
            <div className="search-preview-loading"><Spinner />正在读取会话原档…</div>
          ) : failed || !preview ? (
            <div className="index-empty">
              <MessageSquare size={22} />
              <strong>未能读取该会话</strong>
              <p>本机没有找到该会话的 rollout 原档，点击下方「打开会话」可直接查看（会跳转到对话界面）。</p>
            </div>
          ) : (
            <>
              <p className="search-preview-meta">
                {preview.name} · {preview.messages.length} 条消息 · {preview.archived ? "已归档 · " : ""}{preview.updatedAt ? new Date(preview.updatedAt).toLocaleString("zh-CN", { hour12: false }) : ""}
              </p>
              {preview.messages.length === 0 ? (
                <div className="index-empty"><MessageSquare size={22} /><strong>这个会话还没有可见消息</strong><p>可能是刚创建、尚未对话的空会话。</p></div>
              ) : (
                <div className="search-preview-conversation">
                  {preview.messages.map((message, index) => (
                    <div className={`search-preview-msg ${message.role === "user" ? "user" : "assistant"}`} key={index}>
                      <span className="search-preview-role">{message.role === "user" ? "User" : "Assistant"}</span>
                      <div className="search-preview-text">{message.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {(preview.truncatedMessages > 0 || preview.truncated > 0) && (
                <p className="search-preview-truncated">会话较长，预览已截断：{preview.truncatedMessages > 0 ? `${preview.truncatedMessages} 条消息未显示 · ` : ""}{preview.truncated > 0 ? `${preview.truncated} 条超长消息被裁剪` : ""}。要看完整内容请打开会话。</p>
              )}
            </>
          ))}
          {target.kind === "memory" && (
            <>
              <p className="search-preview-meta">{target.category || "未分类"} · {target.sourceThreadId ? `来自会话 ${target.sourceThreadId.slice(0, 8)}` : "手动保存"}</p>
              <div className="search-preview-raw">{target.content}</div>
            </>
          )}
          {target.kind === "task" && (
            <div className="search-preview-task">
              <div className="search-preview-raw">{target.prompt}</div>
              <dl>
                {target.schedule ? <div><dt>执行计划</dt><dd>{target.schedule}</dd></div> : null}
                <div><dt>状态</dt><dd>{target.enabled === false ? "已停用" : "已启用"}</dd></div>
              </dl>
            </div>
          )}
          {target.kind === "skill" && (
            <div className="search-preview-raw">{target.description || "（该技能没有附加说明，可在技能页查看详情）"}</div>
          )}
        </div>
        <footer>
          <span className="search-preview-foot-note">{target.kind === "thread" ? "只读预览 · 不影响当前对话" : ""}</span>
          <div>
            {target.kind === "thread" && <button className="primary-setting" onClick={() => { onOpenThread(target.id); }}><MessageSquare size={14} />打开会话继续</button>}
            {target.kind === "task" && <button className="primary-setting" onClick={() => { onOpenSettings("schedule"); }}><Clock3 size={14} />去自动化管理</button>}
            {target.kind === "skill" && <button className="primary-setting" onClick={() => { onOpenSettings("skills"); }}><Zap size={14} />去技能管理</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}

/** 会话全量恢复（含分页兜底）：引擎已弃用大线程的「全量水合」（deprecationNotice：
 * "Full-history hydration is deprecated for paginated threads; use excludeTurns: true,
 * then page with thread/turns/list"）——大线程 resume 可能只回元数据、turns 为空，
 * 表现就是「切会话后上个会话的回答没了」。因此 resume 后 turns 为空时改用
 * thread/turns/list 分页（asc + itemsView:full）拉齐全部回合再返回。
 * excludeTurns:true 的调用（权限推送等元数据场景）原样透传，不做额外请求。 */
async function resumeThreadWithTurns(params: { threadId: string; excludeTurns?: boolean } & Record<string, unknown>): Promise<any> {
  const result = await window.codex.request("thread/resume", params);
  const thread = result?.thread;
  if (params.excludeTurns || !thread || (Array.isArray(thread.turns) && thread.turns.length > 0)) return result;
  try {
    // 从最新往回取（desc）：小会话第一页就到头（正常取全量）；大会话取最近几页立即渲染，
    // 不再从最老的历史一页页爬——旧策略 asc 全量分页是「切会话要等十几秒」的主因。
    // 最新内容优先到达 = 用户点开即见最新消息；更早的历史按需（翻上去时 resume 补全）。
    const turns: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const pageResult: any = await window.codex.request("thread/turns/list", { threadId: params.threadId, limit: 200, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}) });
      const data = Array.isArray(pageResult?.data) ? pageResult.data : [];
      turns.push(...data);
      cursor = pageResult?.nextCursor ?? null;
      if (!cursor) break; // 到底了 = 全量取完（绝大多数会话在此结束）
    }
    turns.reverse(); // desc 取的倒序翻回时间正序
    if (turns.length) thread.turns = turns;
  } catch { /* 分页失败维持原结果，不影响会话打开 */ }
  return result;
}

export default function App() {
  const [serverStatus, setServerStatus] = useState("starting");
  // null=首次使用/明确退出，true=跳过登录，false=已成功登录。
  // 旧逻辑把 false 也解释成“显示登录页”，导致每次重启都要重新输入已安全保存的 API Key。
  const [showLogin, setShowLogin] = useState(() => {
    const state = localStorage.getItem("login-skipped");
    return state == null || state === "logout";
  });
  // 账号切换只改变认证/模型配置，保留当前打开的本地会话；登录完成后自动恢复。
  const accountSwitchThreadRef = useRef<string | null>(null);
  const [modelId, setModelId] = useState(() => localStorage.getItem("default-model") ?? "");
  // 历史遗留兜底：旧版本可能存过 minimal/xhigh/ultra，读取时归一化到引擎真实支持的档位
  const [effort, setEffort] = useState(() => normalizeEffort(localStorage.getItem("default-effort")) || DEFAULT_EFFORT);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const threadRef = useRef<Thread | null>(null);
  // 心跳监控联动：记录「引擎无响应→自动重启」标记，ready 时自动恢复当前线程；
  // 以及发送/运行态的快照 ref，供 status:error 分支复位（避免闭包读到旧 state）。
  const engineRestartedRef = useRef(false);
  const sendingRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  // 多会话运行状态必须按 threadId 隔离。单个 runningThreadId 会让 A 完成时清掉
  // 正在运行的 B，也会让切换到 B 后仍沿用 A 的停止按钮/排队逻辑。
  const [runningThreadIds, setRunningThreadIds] = useState<Set<string>>(() => new Set());
  const runningThreadIdsRef = useRef<Set<string>>(new Set());
  const runningTurnIdsRef = useRef<Map<string, string>>(new Map());
  const runningStartedAtRef = useRef<Map<string, number>>(new Map());
  const markThreadRunning = useCallback((threadId: string, turnId?: string, startedAt = Date.now()) => {
    if (!threadId) return;
    const next = new Set(runningThreadIdsRef.current);
    next.add(threadId);
    runningThreadIdsRef.current = next;
    setRunningThreadIds(next);
    if (turnId) runningTurnIdsRef.current.set(threadId, turnId);
    if (!runningStartedAtRef.current.has(threadId)) runningStartedAtRef.current.set(threadId, startedAt);
  }, []);
  const markThreadStopped = useCallback((threadId?: string) => {
    if (!threadId) return;
    const next = new Set(runningThreadIdsRef.current);
    next.delete(threadId);
    runningThreadIdsRef.current = next;
    setRunningThreadIds(next);
    runningTurnIdsRef.current.delete(threadId);
    runningStartedAtRef.current.delete(threadId);
  }, []);
  const clearRunningThreads = useCallback(() => {
    runningThreadIdsRef.current = new Set();
    runningTurnIdsRef.current.clear();
    runningStartedAtRef.current.clear();
    setRunningThreadIds(new Set());
  }, []);
  const [workspace, setWorkspace] = useState(localStorage.getItem("workspace") ?? "");
  const [prompt, setPrompt] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  // WorkBuddy 式附件菜单子面板：本地文件/引用对话文件/专家（技能、连接器已有独立面板）
  const [attachSubmenu, setAttachSubmenu] = useState<"none" | "files" | "thread-files" | "experts" | "skills" | "connectors">("none");
  const [threadFileQuery, setThreadFileQuery] = useState("");
  const [expertQuery, setExpertQuery] = useState("");
  // 子面板自适应方向（水平+垂直）：主菜单（宽 218px）右缘放不下 250px 子面板时向左翻转；
  // 主菜单下方放不下子面板高度时向上翻转（避免被窗口底边截断）
  const quickMenuRef = useRef<HTMLDivElement>(null);
  const quickMenuPanelRef = useRef<HTMLDivElement>(null);
  const [quickMenuFlipUp, setQuickMenuFlipUp] = useState(false);
  const [submenuFlip, setSubmenuFlip] = useState(false);
  const [submenuTop, setSubmenuTop] = useState(0);
  const [quickMenuViewport, setQuickMenuViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const update = () => setQuickMenuViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [attachmentMenuOpen]);
  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && quickMenuRef.current?.contains(target)) return;
      if (submenuHoverTimer.current) window.clearTimeout(submenuHoverTimer.current);
      if (submenuCloseTimer.current) window.clearTimeout(submenuCloseTimer.current);
      setAttachSubmenu("none");
      setAttachmentMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [attachmentMenuOpen]);
  useLayoutEffect(() => {
    if (!attachmentMenuOpen) { setQuickMenuFlipUp(false); setSubmenuFlip(false); setSubmenuTop(0); return; }
    const buttonRect = quickMenuRef.current?.getBoundingClientRect();
    if (!buttonRect) return;
    const menuHeight = quickMenuPanelRef.current?.offsetHeight || 190;
    const flipMain = window.innerHeight - buttonRect.bottom < menuHeight + 8 && buttonRect.top > window.innerHeight - buttonRect.bottom;
    setQuickMenuFlipUp(flipMain);
    if (attachSubmenu === "none") { setSubmenuFlip(false); setSubmenuTop(0); return; }
    const menu = quickMenuPanelRef.current;
    const panel = menu?.querySelector(`[data-submenu-panel="${attachSubmenu}"]`) as HTMLElement | null;
    const item = menu?.querySelector('[data-submenu-open="true"]') as HTMLElement | null;
    if (!menu || !item) return;
    const menuRect = menu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const panelWidth = panel?.offsetWidth || 250;
    const panelHeight = panel?.offsetHeight || (attachSubmenu === "files" ? 46 : 320);
    setSubmenuFlip(menuRect.right + 6 + panelWidth > window.innerWidth - 8 && menuRect.left >= panelWidth + 14);
    const desiredTop = itemRect.top - menuRect.top;
    const minTop = 8 - menuRect.top;
    const maxTop = window.innerHeight - 8 - menuRect.top - panelHeight;
    setSubmenuTop(Math.round(Math.max(minTop, Math.min(desiredTop, maxTop))));
  }, [attachmentMenuOpen, attachSubmenu, quickMenuFlipUp, quickMenuViewport]);
  // WorkBuddy 同款 hover 交互：悬停菜单项 80ms 展开二级，移开 150ms 收起（悬浮在二级上不收）
  const submenuHoverTimer = useRef<number | null>(null);
  const submenuCloseTimer = useRef<number | null>(null);
  const scheduleSubmenu = (target: "files" | "thread-files" | "experts" | "skills" | "connectors") => {
    if (submenuCloseTimer.current) { window.clearTimeout(submenuCloseTimer.current); submenuCloseTimer.current = null; }
    if (submenuHoverTimer.current) window.clearTimeout(submenuHoverTimer.current);
    submenuHoverTimer.current = window.setTimeout(() => setAttachSubmenu(target), 80);
  };
  const scheduleSubmenuClose = () => {
    if (submenuHoverTimer.current) { window.clearTimeout(submenuHoverTimer.current); submenuHoverTimer.current = null; }
    if (submenuCloseTimer.current) window.clearTimeout(submenuCloseTimer.current);
    submenuCloseTimer.current = window.setTimeout(() => setAttachSubmenu("none"), 150);
  };
  // 悬停到二级面板上时取消关闭（WorkBuddy keep-open）
  useEffect(() => {
    if (!attachmentMenuOpen || attachSubmenu === "none") return;
    const pop = quickMenuPanelRef.current;
    if (!pop) return;
    const onEnter = () => { if (submenuCloseTimer.current) { window.clearTimeout(submenuCloseTimer.current); submenuCloseTimer.current = null; } };
    const panel = pop.querySelector(`[data-submenu-panel="${attachSubmenu}"]`);
    panel?.addEventListener("mouseenter", onEnter);
    return () => panel?.removeEventListener("mouseenter", onEnter);
  }, [attachmentMenuOpen, attachSubmenu]);
  // +号按钮点击转动动画：每次点击重新触发（key 递增重建节点）
  const [plusSpinTick, setPlusSpinTick] = useState(0);
  // 输入框提示词增强（WorkBuddy enhance 按钮复刻）：enhancing = 请求中可取消；backup = 增强成功后的原文（点按钮还原）
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const enhanceBackupRef = useRef<string | null>(null);
  const [hasEnhanceBackup, setHasEnhanceBackup] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<{ name: string; description: string }[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkillEntry[]>([]);
  const [marketSkills, setMarketSkills] = useState<MarketSkillEntry[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketPage, setMarketPage] = useState(1);
  const [marketPageSize] = useState(18);
  const [installingMarketSkill, setInstallingMarketSkill] = useState<string | null>(null);
  // 插件市场（codex-marketplace.com）状态
  const [pluginInstall, setPluginInstall] = useState<PluginInstallState | null>(null);
  const [pluginMarketItems, setPluginMarketItems] = useState<PluginMarketEntry[]>([]);
  const [pluginMarketLoading, setPluginMarketLoading] = useState(false);
  const [pluginMarketTotal, setPluginMarketTotal] = useState(0);
  const [pluginMarketPage, setPluginMarketPage] = useState(1);
  const [pluginMarketPageSize] = useState(18);
  const [installingMarketPlugin, setInstallingMarketPlugin] = useState<string | null>(null);
  const [pluginMarketCategory, setPluginMarketCategory] = useState("全部");
  const [pluginMarketSearch, setPluginMarketSearch] = useState("");
  // SkillHub MCP 市场筛选
  const [mcpMarketCategory, setMcpMarketCategory] = useState("全部");
  const [mcpMarketSearch, setMcpMarketSearch] = useState("");
  const [marketPreview, setMarketPreview] = useState<MarketPreviewState | null>(null);
  // 内置浏览器「外部打开」请求：文件预览等处发起，seq 区分同一 URL 的连续打开
  const [browserOpenReq, setBrowserOpenReq] = useState<{ url: string; seq: number } | null>(null);
  const openInBrowserPane = useCallback((url: string) => {
    setRightOpen(true);
    setRightTab("browser");
    setBrowserOpenReq({ url, seq: Date.now() });
  }, []);
  // 中转站账户（sub2api）：余额/套餐同步与一键生成供应商
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayActive, setRelayActive] = useState<RelayActive | null>(() => {
    try { return JSON.parse(localStorage.getItem("relay-active-v1") ?? "null"); } catch { return null; }
  });
  // OpenAI 官方订阅当前生效账号标识：切换账号时变化，驱动输入框额度徽标立即刷新（避免同 provider 下切号不更新）
  const [openaiActiveAcct, setOpenaiActiveAcct] = useState<string | null>(null);
  const [skillInstall, setSkillInstall] = useState<SkillInstallState | null>(null);
  const [skillRemove, setSkillRemove] = useState<SkillRemoveState | null>(null);
  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft>({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} });
  const [connectorEditorOpen, setConnectorEditorOpen] = useState(false);
  const [connectorSaving, setConnectorSaving] = useState(false);
  const [connectorSecret, setConnectorSecret] = useState("");
  const [connectorTemplates, setConnectorTemplates] = useState<ConnectorTemplate[]>([]);
  const [connectorTemplateModal, setConnectorTemplateModal] = useState<ConnectorTemplate | null>(null);
  const [connectorOAuth, setConnectorOAuth] = useState<ConnectorOAuthEvent | null>(null);
  const [connectorTemplateValues, setConnectorTemplateValues] = useState<Record<string, string>>({});
  const [connectorTemplateSaving, setConnectorTemplateSaving] = useState(false);
  const [memoryConfigOpen, setMemoryConfigOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [contextItems, setContextItems] = useState<{ id: string; role: "用户" | "Codex"; text: string }[]>([]);
  // 输入框上方的引用条：点击消息「引用」后在此展示，发送时以块引用前缀拼进消息文本
  const [quoteItem, setQuoteItem] = useState<{ id: string; text: string } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const sendInFlightRef = useRef(false);
  // ── 429 限流自动重试（应用层兜底）──
  // 引擎侧 request_max_retries/stream_max_retries 耗尽后 turn 仍以限流失败结束时，
  // 把原输入自动重发，最多 RATE_LIMIT_MAX_ATTEMPTS 次，退避 5s→120s 逐次放长。
  // 不区分模型/供应商——任何模型限流都走这条兜底；用户可停止或立即重试。
  const [rateLimitRetry, setRateLimitRetry] = useState<{ threadId: string; attempt: number; retryAt: number } | null>(null);
  const rateLimitTimerRef = useRef<number | null>(null);
  const rateLimitAttemptRef = useRef(0);
  const retryContextRef = useRef<{ threadId: string; input: any[]; model: string; effort: string | null; personality: string | null } | null>(null);
  const [, setRateLimitTick] = useState(0);
  useEffect(() => {
    if (!rateLimitRetry) return;
    const tick = window.setInterval(() => setRateLimitTick((n) => n + 1), 1000);
    return () => window.clearInterval(tick);
  }, [rateLimitRetry?.threadId, rateLimitRetry?.attempt]);

  function clearRateLimitTimer() {
    if (rateLimitTimerRef.current != null) { window.clearTimeout(rateLimitTimerRef.current); rateLimitTimerRef.current = null; }
  }

  function cancelRateLimitRetry(silent = false) {
    clearRateLimitTimer();
    setRateLimitRetry(null);
    rateLimitAttemptRef.current = 0;
    retryContextRef.current = null;
    if (!silent) showToast("已停止限流重试", "不再自动重发该消息");
  }

  async function executeRateLimitRetry() {
    clearRateLimitTimer();
    const ctx = retryContextRef.current;
    const attempt = rateLimitAttemptRef.current;
    if (!ctx || !attempt) { setRateLimitRetry(null); return; }
    setRateLimitRetry(null);
    setSending(true);
    setInterrupting(false);
    setWorkStartedAt(Date.now());
    markThreadRunning(ctx.threadId);
    try {
      const result: any = await window.codex.request("turn/start", {
        threadId: ctx.threadId,
        input: ctx.input,
        model: ctx.model,
        effort: ctx.effort,
        personality: ctx.personality,
        // 限流重试这一轮也要带上沙箱，否则重试后会掉回会话创建时的旧权限
        sandboxPolicy: sandboxPolicy(sandbox, threadRef.current?.cwd ?? workspace ?? ""),
      });
      if (result?.turn?.id) {
        setActiveTurnId(result.turn.id);
        markThreadRunning(ctx.threadId, result.turn.id);
      }
      showToast("限流重试已发出", `第 ${attempt}/${RATE_LIMIT_MAX_ATTEMPTS} 次重试已被接受，任务继续运行`);
    } catch (error: any) {
      setSending(false);
      markThreadStopped(ctx.threadId);
      setWorkStartedAt(null);
      if (isRateLimitError(error?.message) && attempt < RATE_LIMIT_MAX_ATTEMPTS) {
        showToast("仍被限流", `第 ${attempt} 次重试仍失败，稍后自动继续`);
        scheduleRateLimitRetry(attempt + 1);
      } else {
        setNotice(error?.message ?? "限流重试失败");
        cancelRateLimitRetry(true);
      }
    }
  }

  function scheduleRateLimitRetry(attempt: number) {
    const ctx = retryContextRef.current;
    if (!ctx) return;
    if (attempt > RATE_LIMIT_MAX_ATTEMPTS) {
      cancelRateLimitRetry(true);
      showToast("限流重试放弃", `已连续重试 ${RATE_LIMIT_MAX_ATTEMPTS} 次仍被限流，请稍后手动重发`);
      return;
    }
    rateLimitAttemptRef.current = attempt;
    const delay = rateLimitBackoffMs(attempt);
    setSending(false);
    setActiveTurnId(null);
    markThreadStopped(ctx.threadId);
    setInterrupting(false);
    setWorkStartedAt(null);
    setRateLimitRetry({ threadId: ctx.threadId, attempt, retryAt: Date.now() + delay });
    clearRateLimitTimer();
    rateLimitTimerRef.current = window.setTimeout(() => void executeRateLimitRetry(), delay);
  }
  const compactPendingRef = useRef(new Set<string>());
  const [interrupting, setInterrupting] = useState(false);
  const [optimisticInput, setOptimisticInput] = useState<ThreadItem | null>(null);
  const optimisticTurnIdRef = useRef<string | null>(null);
  const optimisticBaselineRef = useRef<{ threadId: string | null; turnIds: Set<string> }>({ threadId: null, turnIds: new Set() });
  // 只有目标回合里出现了非空 userMessage，才说明临时气泡已经被真实消息接管。
  // “新增了一个 turn”不够，因为 turn/started 的 userMessage 经常只有 id、content 为空。
  // 心跳监控联动：sending/activeTurnId 的快照 ref（status:error 复位时用最新值）
  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { activeTurnIdRef.current = activeTurnId; }, [activeTurnId]);
  const optimisticConfirmed = useMemo(() => {
    if (!optimisticInput) return false;
    const target = optimisticTurnIdRef.current ? thread?.turns.find((turn) => turn.id === optimisticTurnIdRef.current) : null;
    if (target?.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, optimisticInput.content ?? []))) return true;
    // 兜底：事件可能先于 turn/start 响应到达。只检查本次发送后新增的回合，
    // 并按用户可见正文匹配，避免隐藏的记忆/技能/引用段导致真实消息与乐观消息无法去重。
    const baseline = optimisticBaselineRef.current;
    return Boolean(thread?.turns.some((turn) => {
      if (baseline.threadId === thread.id && baseline.turnIds.has(turn.id)) return false;
      return turn.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, optimisticInput.content ?? []));
    }));
  }, [optimisticInput, thread]);
  useEffect(() => {
    if (!optimisticInput || !optimisticConfirmed) return;
    optimisticTurnIdRef.current = null;
    setOptimisticInput(null);
  }, [optimisticConfirmed, optimisticInput]);
  const [openingThread, setOpeningThread] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [diff, setDiff] = useState("");
  const [tokenUsage, setTokenUsage] = useState<any>(null);
  const tokenUsageRef = useRef<any>(null);
  // 部分 0.0.1 兼容上游会把 last 的缓存量按增量上报、输入量却按当前总量上报，
  // 导致任务越长命中率越低。用 total 的连续快照做同口径差值，作为本轮展示兜底。
  const tokenUsageTotalsRef = useRef(new Map<string, UsageCounterSnapshot>());
  const derivedTokenUsageRef = useRef(new Map<string, any>());
  const normalizeTokenUsage = useCallback((raw: any, threadId?: string) => {
    if (!raw || !threadId) return raw;
    const totalUsage = usageBucket(raw, "total");
    if (!totalUsage) return raw;
    const current = usageCounterSnapshot(totalUsage);
    const previous = tokenUsageTotalsRef.current.get(threadId);
    tokenUsageTotalsRef.current.set(threadId, current);
    if (previous && (current.input < previous.input || current.cached < previous.cached)) {
      derivedTokenUsageRef.current.delete(threadId);
      return raw;
    }
    if (previous && current.input >= previous.input && current.cached >= previous.cached) {
      const inputTokens = current.input - previous.input;
      const cachedInputTokens = Math.min(inputTokens, current.cached - previous.cached);
      if (inputTokens > 0) {
        const derivedLast = {
          inputTokens,
          cachedInputTokens,
          outputTokens: Math.max(0, current.output - previous.output),
          totalTokens: Math.max(0, current.total - previous.total),
        };
        derivedTokenUsageRef.current.set(threadId, derivedLast);
        return { ...raw, derivedLast };
      }
    }
    const derivedLast = derivedTokenUsageRef.current.get(threadId);
    return derivedLast ? { ...raw, derivedLast } : raw;
  }, []);
  // 回合开始时间（turnId -> 时间戳），用于统计「最长聊天时长」
  const turnStartedAtRef = useRef(new Map<string, number>());
  // 当前生效的模型名（统计按模型用量时避免闭包拿到旧值）
  const activeModelRef = useRef("");
  const [usageStats, setUsageStats] = useState(() => readUsageStats());
  // 流式 delta 合帧缓冲：同一帧的多条 delta 一次 setThread
  const streamRafRef = useRef(0);
  const pendingDeltaRef = useRef<{ method: string; params: any }[]>([]);
  // 上次 delta 落盘时刻：用于判断「新一轮出字」，首字立即渲染不等 rAF
  const lastFlushAtRef = useRef(0);
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("right-panel-open") === "true");  // 启动默认展开：迁移旧的折叠偏好，桌面端始终先给完整导航；用户仍可手动收起。
  const [desktopAuto, setDesktopAuto] = useState(true);
  const [browserAuto, setBrowserAuto] = useState(true);
  const [autoCompactRatio, setAutoCompactRatio] = useState(0.8);
  const [hardwareAccel, setHardwareAccel] = useState<"auto" | "force" | "off">("auto");
  const [restartPending, setRestartPending] = useState(false);

  // SSH 服务器连接管理：设置页「SSH 服务器」分区，列表持久化在 userData/ssh-servers.json
  const [sshServers, setSshServers] = useState<SshServer[]>([]);
  const [sshLoaded, setSshLoaded] = useState(false);
  const [sshBusyId, setSshBusyId] = useState<string | null>(null);
  const [sshTestingId, setSshTestingId] = useState<string | null>(null);
  const [sshDraft, setSshDraft] = useState<SshServer | null>(null);
  const [sshSaving, setSshSaving] = useState(false);
  // 列表筛选：关键字搜索 + 状态分段 + 勾选批量操作
  const [sshQuery, setSshQuery] = useState("");
  const [sshFilter, setSshFilter] = useState<"all" | "on" | "off" | "star">("all");
  const [sshChecked, setSshChecked] = useState<string[]>([]);
  const [sshBatchBusy, setSshBatchBusy] = useState(false);
  // 内置终端会话与一次性命令执行
  const [sshTerminal, setSshTerminal] = useState<SshServer | null>(null);
  const [sshExecTarget, setSshExecTarget] = useState<SshServer | null>(null);
  // 编辑器内「测试连接」的结果：草稿未保存也能测，结果只在弹窗内展示
  const [sshEditorTest, setSshEditorTest] = useState<{ ok: boolean; message: string } | null>(null);
  // 联网搜索 UI 入口已整体下架（2026-09-04：引擎沙箱本就允许联网，web_search 工具默认常开，
  // 无需用户切换）。app-settings.webSearch 默认值仍由主进程写进 config.toml，引擎能力不受影响。
  useEffect(() => { void window.codex.readAppSettings().then((settings) => { setDesktopAuto(settings.desktopAutomation !== false); setBrowserAuto(settings.browserAutomation !== false); setAutoCompactRatio(typeof settings.autoCompactRatio === "number" ? settings.autoCompactRatio : 0.8); setHardwareAccel(settings.hardwareAcceleration ?? "auto"); }).catch(() => undefined); }, []);
  // 桌面/浏览器自动化是能力总闸：开关直接决定引擎能不能用，同时联动 nuphus MCP 与配套技能。
  // 具体实现在 applyGroup（见「能力总闸联动」块），这里只做转发，保证常规页是唯一入口。
  const toggleDesktopAuto = (next: boolean) => { void applyGroup("desktop-automation", next); };
  const toggleBrowserAuto = (next: boolean) => { void applyGroup("browser-automation", next); };
  // 硬件加速模式（设置 → 通用）：写入 app-settings，主进程下次启动时在 app ready 前应用。需重启生效。
  const changeHardwareAccel = (next: "auto" | "force" | "off") => {
    if (next === hardwareAccel) return;
    setHardwareAccel(next);
    setRestartPending(true);
    const label = next === "force" ? "强制开启硬件加速" : next === "off" ? "关闭硬件加速" : "自动";
    setNotice(`硬件加速已设为「${label}」，重启应用后生效${next === "force" ? "（适合低配机/软件渲染卡顿）" : ""}`);
    void window.codex.saveAppSettings({ hardwareAcceleration: next }).catch(() => { setHardwareAccel(hardwareAccel); setRestartPending(false); });
  };

  // —— Codex 引擎更新（设置 → 控制台底部） ——
  const [engineVersion, setEngineVersion] = useState("");
  const [engineCheck, setEngineCheck] = useState<{ state: "idle" | "checking" | "latest" | "available" | "error"; latest?: string; message?: string }>({ state: "idle" });
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [engineUpdateLog, setEngineUpdateLog] = useState<string[]>([]);
  const [engineUpdatePercent, setEngineUpdatePercent] = useState<number | null>(null);
  const [engineUpdateStageText, setEngineUpdateStageText] = useState("准备更新…");
  const [engineUpdateResult, setEngineUpdateResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [relaunchCountdown, setRelaunchCountdown] = useState<number | null>(null);
  useEffect(() => { void window.codex.engineInfo().then((info) => setEngineVersion(info.version)).catch(() => undefined); }, []);
  useEffect(() => window.codex.onEngineUpdateProgress((event) => {
    const stageTextMap: Record<string, string> = { wait: "等待当前任务结束…", query: "查询最新版本…", download: `下载引擎包 ${Math.round((event.percent ?? 0) * 100)}%`, extract: "解压引擎包…", verify: "校验新引擎…", replace: "替换引擎文件…", done: "更新完成" };
    const text = event.stage === "download" ? stageTextMap.download : (stageTextMap[event.stage] || event.detail || event.stage);
    setEngineUpdateStageText(text);
    setEngineUpdatePercent(event.stage === "download" ? (event.percent ?? 0) : null);
    const logText = event.stage === "download" ? text : (event.detail || event.stage);
    setEngineUpdateLog((current) => [...current.slice(-9), logText]);
  }), []);
  useEffect(() => {
    if (relaunchCountdown == null) return;
    if (relaunchCountdown <= 0) { void window.codex.relaunchApp(); return; }
    const timer = setTimeout(() => setRelaunchCountdown((value) => (value == null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [relaunchCountdown]);
  const checkEngineUpdateNow = async () => {
    setEngineCheck({ state: "checking" });
    try {
      const info = await window.codex.engineCheckUpdate();
      setEngineVersion(info.current);
      setEngineCheck(info.hasUpdate ? { state: "available", latest: info.latest } : { state: "latest", latest: info.latest });
    } catch (error: any) {
      setEngineCheck({ state: "error", message: error?.message ?? "检查失败" });
    }
  };
  const performEngineUpdateNow = async () => {
    if (engineUpdating) return;
    if (!(await openAppConfirm("更新 Codex 引擎", `确定把 Codex 引擎更新到 ${engineCheck.latest} 吗？\n· 更新会先停止引擎（正在运行的任务会先等它结束）\n· 下载约 30MB，失败会自动回滚旧版本\n· 完成后应用将自动重启生效`, "立即更新"))) return;
    setEngineUpdating(true);
    setEngineUpdateLog([]);
    setEngineUpdatePercent(null);
    setEngineUpdateStageText("准备更新…");
    setEngineUpdateResult(null);
    try {
      const result = await window.codex.enginePerformUpdate();
      if (result.ok) {
        setEngineUpdateLog((current) => [...current, result.message]);
        setEngineVersion(`codex-cli ${result.version}`);
        setEngineCheck({ state: "latest", latest: result.version });
        setNotice("引擎更新完成，应用即将自动重启…");
        setRelaunchCountdown(3);
      } else {
        setEngineUpdateResult({ ok: false, message: result.message });
      }
    } catch (error: any) {
      setEngineUpdateResult({ ok: false, message: error?.message ?? "更新失败" });
    } finally {
      setEngineUpdating(false);
    }
  };

  // —— SSH 服务器连接管理 ——
  const emptySshJump = (): SshJumpHost => ({ host: "", port: 22, username: "", authType: "password", password: "", privateKey: "", keyPath: "", passphrase: "" });
  const emptySshDraft = (): SshServer => ({
    id: "", name: "", host: "", port: 22, username: "root", authType: "password", password: "", privateKey: "", keyPath: "",
    passphrase: "", enabled: true, createdAt: "", group: "", tags: [], notes: "", favorite: false, startupCommand: "",
    remotePath: "", keepaliveInterval: 30, connectTimeout: 10, termType: "xterm-256color", jumpHost: null,
  });
  const sshDraftIssues = (draft: SshServer) => {
    const issues: string[] = [];
    if (!draft.name.trim()) issues.push("连接名称未填写");
    if (!draft.host.trim()) issues.push("主机地址未填写");
    if (!draft.username.trim()) issues.push("用户名未填写");
    if (draft.port && (draft.port < 1 || draft.port > 65535)) issues.push("端口需在 1-65535 之间");
    if (draft.authType === "key" && !draft.privateKey?.trim() && !draft.keyPath?.trim()) issues.push("私钥认证需要私钥内容或私钥文件路径");
    if (draft.jumpHost?.host?.trim() && !draft.jumpHost.username?.trim()) issues.push("跳板机用户名未填写");
    return issues;
  };
  const sshDraftValid = (draft: SshServer) => sshDraftIssues(draft).length === 0;
  /** 列表过滤：关键字（名称/主机/用户名/标签/分组/备注）+ 状态分段 */
  const sshVisible = useMemo(() => {
    const keyword = sshQuery.trim().toLowerCase();
    return sshServers.filter((server) => {
      if (sshFilter === "on" && !server.enabled) return false;
      if (sshFilter === "off" && server.enabled) return false;
      if (sshFilter === "star" && !server.favorite) return false;
      if (!keyword) return true;
      return [server.name, server.host, server.username, server.group ?? "", server.notes ?? "", (server.tags ?? []).join(" ")]
        .join(" ").toLowerCase().includes(keyword);
    });
  }, [sshServers, sshQuery, sshFilter]);
  const sshCheckedSet = useMemo(() => new Set(sshChecked), [sshChecked]);
  const sshToggleChecked = (id: string) => setSshChecked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  async function saveSshEntry() {
    if (!sshDraft || !sshDraftValid(sshDraft)) return;
    setSshSaving(true);
    try {
      const servers = await window.codex.saveSshServer({
        ...sshDraft,
        tags: (sshDraft.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
        jumpHost: sshDraft.jumpHost?.host?.trim() ? sshDraft.jumpHost : null,
      });
      setSshServers(servers);
      setSshDraft(null);
      setNotice(`SSH 服务器「${sshDraft.name}」已保存`);
    } catch (error: any) { setNotice(`保存 SSH 服务器失败：${error.message}`); }
    finally { setSshSaving(false); }
  }

  /** 编辑器内测试：直接拿草稿去连，不落盘，方便边填边验证 */
  async function testSshDraft() {
    if (!sshDraft || !sshDraftValid(sshDraft)) return;
    setSshTestingId("draft");
    setSshEditorTest(null);
    try {
      const result = await window.codex.testSshServer(sshDraft);
      setSshEditorTest({
        ok: result.ok,
        message: result.ok
          ? `连接成功（${result.latencyMs ?? "?"}ms）${result.serverInfo?.os ? ` · ${result.serverInfo.os}` : ""}${result.serverInfo?.hostname ? ` · ${result.serverInfo.hostname}` : ""}`
          : `连接失败：${result.error ?? "未知错误"}`,
      });
    } catch (error: any) {
      setSshEditorTest({ ok: false, message: `测试失败：${error.message}` });
    } finally { setSshTestingId(null); }
  }

  async function toggleSshEntry(server: SshServer, next: boolean) {
    setSshBusyId(server.id);
    try {
      const servers = await window.codex.setSshServersEnabled([server.id], next);
      setSshServers(servers);
      setNotice(`SSH 服务器「${server.name}」已${next ? "启用" : "停用"}`);
    } catch (error: any) { setNotice(`切换 SSH 服务器状态失败：${error.message}`); }
    finally { setSshBusyId(null); }
  }

  /** 批量启停：勾选集为空时直接返回，避免空请求 */
  async function toggleSshBatch(next: boolean) {
    if (!sshChecked.length) return;
    setSshBatchBusy(true);
    try {
      setSshServers(await window.codex.setSshServersEnabled(sshChecked, next));
      setNotice(`已${next ? "启用" : "停用"} ${sshChecked.length} 台 SSH 服务器`);
      setSshChecked([]);
    } catch (error: any) { setNotice(`批量${next ? "启用" : "停用"}失败：${error.message}`); }
    finally { setSshBatchBusy(false); }
  }

  /** 连接测试：成功后回写延迟/指纹/远端系统信息，失败回写错误原因，卡片常驻显示 */
  async function testSshEntry(server: SshServer, silent = false) {
    setSshTestingId(server.id);
    try {
      const result = await window.codex.testSshServer(server);
      const servers = await window.codex.saveSshServer({
        ...server,
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        lastTestError: result.ok ? "" : (result.error ?? "未知错误"),
        lastTestLatencyMs: result.latencyMs,
        lastFingerprint: result.fingerprint,
        lastServerInfo: result.serverInfo,
        lastConnectedAt: result.ok ? new Date().toISOString() : server.lastConnectedAt,
      });
      setSshServers(servers);
      if (!silent) {
        if (result.ok) setNotice(`SSH 服务器「${server.name}」连接成功（${result.latencyMs ?? "?"}ms）`);
        else setNotice(`SSH 服务器「${server.name}」连接失败：${result.error ?? "未知错误"}`);
      }
      return result;
    } catch (error: any) {
      if (!silent) setNotice(`测试 SSH 连接失败：${error.message}`);
      return { ok: false as const, error: error.message };
    } finally { setSshTestingId(null); }
  }

  async function testSshBatch() {
    if (!sshChecked.length) return;
    setSshBatchBusy(true);
    const targets = sshServers.filter((server) => sshChecked.includes(server.id));
    let passed = 0;
    for (const server of targets) {
      const result = await testSshEntry(server, true);
      if (result.ok) passed += 1;
    }
    setNotice(`批量测试完成：${passed}/${targets.length} 台连通`);
    setSshBatchBusy(false);
  }

  async function removeSshEntries(ids: string[]) {
    if (!ids.length) return;
    setSshBatchBusy(true);
    try {
      setSshServers(await window.codex.deleteSshServers(ids));
      setSshChecked((current) => current.filter((id) => !ids.includes(id)));
      setNotice(ids.length > 1 ? `已删除 ${ids.length} 台 SSH 服务器` : `SSH 服务器已删除`);
    } catch (error: any) { setNotice(`删除 SSH 服务器失败：${error.message}`); }
    finally { setSshBatchBusy(false); }
  }

  /** 复制连接：以「副本」形式新建，凭据一并复制，方便改几个字段就能连第二台机器 */
  async function duplicateSshEntry(server: SshServer) {
    try {
      const servers = await window.codex.saveSshServer({
        ...server,
        id: "",
        name: `${server.name} 副本`,
        createdAt: "",
        lastTestAt: undefined,
        lastTestOk: undefined,
        lastTestError: "",
        lastFingerprint: undefined,
        lastServerInfo: undefined,
        lastConnectedAt: undefined,
      });
      setSshServers(servers);
      setNotice(`已复制为「${server.name} 副本」`);
    } catch (error: any) { setNotice(`复制 SSH 连接失败：${error.message}`); }
  }

  async function toggleSshFavorite(server: SshServer) {
    try {
      setSshServers(await window.codex.saveSshServer({ ...server, favorite: !server.favorite }));
    } catch (error: any) { setNotice(`收藏失败：${error.message}`); }
  }

  /** 导出：默认剔除密码/私钥，需要迁移机器时可勾选「包含凭据」 */
  async function exportSshEntries(includeSecrets: boolean) {
    const targets = sshChecked.length ? sshServers.filter((server) => sshChecked.includes(server.id)) : sshServers;
    if (!targets.length) { setNotice("没有可导出的 SSH 连接"); return; }
    const path = await window.codex.exportSshServers(targets, includeSecrets);
    if (path) setNotice(`已导出 ${targets.length} 台 SSH 服务器到 ${path}`);
  }

  async function importSshEntries() {
    setSshBatchBusy(true);
    try {
      const servers = await window.codex.importSshServers();
      if (!servers) { setSshBatchBusy(false); return; }
      setSshServers(servers);
      setNotice(`SSH 连接导入完成，当前共 ${servers.length} 台`);
    } catch (error: any) { setNotice(`导入失败：${error.message}`); }
    finally { setSshBatchBusy(false); }
  }

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (!localStorage.getItem("sidebar-default-expanded-v1")) {
      localStorage.setItem("sidebar-default-expanded-v1", "true");
      localStorage.setItem("sidebar-collapsed", "false");
      return false;
    }
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  const [rightTab, setRightTab] = useState<string>(() => "");
  const [openTabs, setOpenTabs] = useState<{ key: string; name: string }[]>([]);
  const [recentlyClosed, setRecentlyClosed] = useState<{ key: string; name: string; at: number }[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [goalsExpanded, setGoalsExpanded] = useState(false);
  // 收纳到右侧边（仅持久化用户点击行为；hover 由 CSS 处理，无需 React hover state）
  const [goalsDocked, setGoalsDocked] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteTab, setPaletteTab] = useState<"all" | "ops" | "tasks" | "files">("all");
  const [keepAwake, setKeepAwake] = useState(() => localStorage.getItem("keep-awake") === "true");
  const [ctxMenuOpen, setCtxMenuOpen] = useState(false);
  const [skillHubCategory, setSkillHubCategory] = useState("总排行");
  const [skillHubSearch, setSkillHubSearch] = useState("");
  const [skillHubFilterCategory, setSkillHubFilterCategory] = useState("");
  const [skillsManageOnly, setSkillsManageOnly] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState("");
  const [connectorsManageOnly, setConnectorsManageOnly] = useState(false);
  // 连接器卡片：勾选集合 + 单卡开关 / 批量启停的忙碌态
  const [connectorChecked, setConnectorChecked] = useState<string[]>([]);
  const [connectorStatusBusy, setConnectorStatusBusy] = useState<string | null>(null);
  const [connectorBatchBusy, setConnectorBatchBusy] = useState<"enable" | "disable" | null>(null);
  // app-server MCP 状态卡：引擎直管服务器的启停覆盖表 + 勾选/忙碌态。
  // 覆盖表只记录被显式改过的项，没记过的一律视为启用。
  const [mcpOverrides, setMcpOverrides] = useState<Record<string, boolean>>({});
  // 各 MCP 服务器的按工具权限档位（deny/ask/allow），复刻 WorkBuddy 工具级权限模型
  const [mcpToolPermissions, setMcpToolPermissions] = useState<Record<string, Record<string, "deny" | "ask" | "allow">>>({});
  const [mcpServerChecked, setMcpServerChecked] = useState<string[]>([]);
  const [mcpServerStatusBusy, setMcpServerStatusBusy] = useState<string | null>(null);
  const [mcpServerBatchBusy, setMcpServerBatchBusy] = useState<"enable" | "disable" | null>(null);
  const [mcpServerSearch, setMcpServerSearch] = useState("");
  const [subAgents, setSubAgents] = useState<SubAgentEntry[]>([]);
  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentEntry | null>(null);
  const [subAgentEditorOpen, setSubAgentEditorOpen] = useState(false);
  const [subAgentRunning, setSubAgentRunning] = useState<string | null>(null);
  // RPA：正在执行的配方 id + agent 向用户的提问卡（resolve 回调挂在 state 里，按钮点击后放行 tool call）
  // agent_ask 不再全局弹窗：挂在所属会话上，贴输入框上方展示；用户不在该会话时只发通知，切回再显示
  const [rpaRunning, setRpaRunning] = useState<string | null>(null);
  const [agentAsk, setAgentAsk] = useState<{ threadId: string; question: string; options: string[]; recommended: string | null; allowFree: boolean; resolve: (answer: string) => void } | null>(null);
  const [rpaRecipes, setRpaRecipes] = useState<any[]>([]);
  const [taskList, setTaskList] = useState<any[]>([]);
  // 应用内输入/确认弹窗：避免 Electron 原生 prompt 不可用，以及系统 confirm 抢走窗口焦点。
  // threadPermPushAt：每会话最近一次权限推送时间（settings/updated 旧值回推的忽略窗口依据）
  const threadPermPushAtRef = useRef<Map<string, number>>(new Map());
  const appPromptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [appConfirm, setAppConfirm] = useState<{ title: string; text: string; confirmLabel: string; resolve: (confirmed: boolean) => void } | null>(null);
  const [appPrompt, setAppPrompt] = useState<{ title: string; value: string; multiline?: boolean; resolve: (text: string | null) => void } | null>(null);
  // 记忆卡片全文预览：卡片本身只显示 3 行截断，点开看完整内容
  const [memoryPreview, setMemoryPreview] = useState<any>(null);
  // 全局搜索命中预览（记忆中心→全局搜索）：会话全文由主进程读 rollout 原档提供
  const [searchPreview, setSearchPreview] = useState<SearchPreviewTarget | null>(null);
  // 记忆中心大弹窗：设置页「记忆」只做总览，条目浏览/常驻记忆编辑/存储切换都在这里完成
  const [memoryCenterOpen, setMemoryCenterOpen] = useState(false);
  const [memoryCenterTab, setMemoryCenterTab] = useState<"library" | "search" | "layers" | "storage">("library");
  const [memoryProjectWorkspace, setMemoryProjectWorkspace] = useState(() => workspace || "__all__");
  const [memoryProjectEnabled, setMemoryProjectEnabled] = useState(false);
  const [memoryProjectMenuOpen, setMemoryProjectMenuOpen] = useState(false);
  const memoryProjectPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMemoryProjectWorkspace(workspace || "__all__"); }, [workspace]);
  useEffect(() => {
    if (!memoryProjectMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !memoryProjectPickerRef.current?.contains(target)) setMemoryProjectMenuOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMemoryProjectMenuOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", onKeyDown, true); };
  }, [memoryProjectMenuOpen]);
  function openAppPrompt(title: string, defaultValue = "", multiline = false): Promise<string | null> {
    return new Promise((resolve) => setAppPrompt({ title, value: defaultValue, multiline, resolve }));
  }
  function openAppConfirm(title: string, text: string, confirmLabel = "确定"): Promise<boolean> {
    return new Promise((resolve) => setAppConfirm({ title, text, confirmLabel, resolve }));
  }
  useLayoutEffect(() => {
    if (!appPrompt) return;
    const focusPrompt = () => {
      const input = appPromptInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.select();
    };
    focusPrompt();
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== appPromptInputRef.current) focusPrompt();
    });
    return () => cancelAnimationFrame(frame);
  }, [appPrompt]);
  // 专家团（Team 型专家）：团队列表 + 编辑 + 成员调度状态
  const [expertTeams, setExpertTeams] = useState<ExpertTeamConfig[]>([]);
  const [expertTeamDraft, setExpertTeamDraft] = useState<ExpertTeamConfig | null>(null);
  const [expertTeamEditorOpen, setExpertTeamEditorOpen] = useState(false);
  const [expertTeamRunning, setExpertTeamRunning] = useState<string | null>(null);
  const [expertTeamMemberRunning, setExpertTeamMemberRunning] = useState<{ teamId: string; memberName: string } | null>(null);
  // 每张专家团卡片独立选择的项目地址（teamId -> cwd）；未选择时用全局 workspace
  const [teamCwdMap, setTeamCwdMap] = useState<Record<string, string>>({});  // 成员直达会话进行中标记（key = teamId:memberId），用于成员 chip 的 loading 态
  const [expertTeamMemberDirect, setExpertTeamMemberDirect] = useState<string | null>(null);
  // threadId -> teamId 映射：tool call 事件只带 threadId，据此解析当前团队
  const teamThreadMapRef = useRef<Map<string, string>>(new Map());
  // 团队父会话自己的运行配置。后台会话调度成员时不能读取当前屏幕上的 workspace/model，
  // 否则切到另一个会话后会把新会话配置错误套给旧团队。
  const teamThreadConfigRef = useRef<Map<string, { teamId: string; cwd: string; model: string; effort?: string; sandbox: string; approvalPolicy: string }>>(new Map());
  // 把「threadId → 团队成员解析」注册进模块级注册表，聊天区深处的 ItemView 渲染
  // team_member_invoke 工具卡时能查到成员头像（不逐层传 props，见 entity-avatar.ts 注释）
  useEffect(() => {
    for (const [threadId, teamId] of teamThreadMapRef.current) {
      const team = expertTeams.find((entry) => entry.teamId === teamId);
      if (!team) continue;
      registerThreadTeam(threadId, (memberId) => {
        const member = [team.lead, ...team.members].find((entry) => entry.id === memberId);
        if (!member) return null;
        const isLead = member.id === team.lead.id;
        return { id: member.id, name: member.name, label: expertRoleLabel(member, isLead), isLead };
      });
    }
    return () => { for (const threadId of teamThreadMapRef.current.keys()) unregisterThreadTeam(threadId); };
  }, [expertTeams]);
  // defer 预建的空会话：threadId -> 首条待注入角色。用户在该空会话发出第一条消息时，
  // 发送管线自动包装成 SYSTEM TASK（渲染折叠为「需求已发起」），包装后即清除本映射。
  const pendingExpertRoleRef = useRef<Map<string, ExpertPendingRole>>(new Map());
  // 角色映射同时落 localStorage：空会话可能闲置到应用重启后用户才发首条消息，
  // 重启后 ref 已空，send() 会从 localStorage 兜底取回角色包装。key = localStorage 键。
  const EXPERT_ROLE_STORE_KEY = "expert-pending-roles";
  const rememberExpertRole = (threadId: string, role: ExpertPendingRole) => {
    pendingExpertRoleRef.current.set(threadId, role);
    try {
      const next = { ...(JSON.parse(localStorage.getItem(EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>), [threadId]: role };
      localStorage.setItem(EXPERT_ROLE_STORE_KEY, JSON.stringify(next));
    } catch { /* 存储失败仅影响重启后的首条包装，不阻塞 */ }
  };
  const forgetExpertRole = (threadId: string) => {
    pendingExpertRoleRef.current.delete(threadId);
    try {
      const store = JSON.parse(localStorage.getItem(EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>;
      if (store[threadId]) { delete store[threadId]; localStorage.setItem(EXPERT_ROLE_STORE_KEY, JSON.stringify(store)); }
    } catch { /* ignore */ }
  };
  const readStoredExpertRole = (threadId: string): ExpertPendingRole | undefined => {
    if (pendingExpertRoleRef.current.has(threadId)) return pendingExpertRoleRef.current.get(threadId);
    try { return (JSON.parse(localStorage.getItem(EXPERT_ROLE_STORE_KEY) || "{}") as Record<string, ExpertPendingRole>)[threadId]; }
    catch { return undefined; }
  };
  // 导入记录新建的空会话：threadId -> 待附外部对话记录。首条消息发送时随消息附上（见 send），
  // 成功后清除。pendingImportThreads 只存「有记录的线程 id」做响应式判断（渲染用），
  // 记录全文在 localStorage（key = PENDING_IMPORT_STORE_KEY），避免把大文本塞进 state 造成流式渲染卡顿。
  const [pendingImportThreads, setPendingImportThreads] = useState<Record<string, true>>(() => {
    const store = readPendingImportStore();
    return Object.keys(store).reduce<Record<string, true>>((acc, id) => { acc[id] = true; return acc; }, {});
  });
  const rememberPendingImport = (threadId: string, payload: PendingImportPayload) => {
    try {
      const next = { ...readPendingImportStore(), [threadId]: payload };
      localStorage.setItem(PENDING_IMPORT_STORE_KEY, JSON.stringify(next));
    } catch { /* 存储失败仅影响重启后恢复，不阻塞 */ }
    setPendingImportThreads((current) => ({ ...current, [threadId]: true }));
  };
  const forgetPendingImport = (threadId: string) => {
    try {
      const store = readPendingImportStore();
      if (store[threadId]) { delete store[threadId]; localStorage.setItem(PENDING_IMPORT_STORE_KEY, JSON.stringify(store)); }
    } catch { /* ignore */ }
    setPendingImportThreads((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  };
  const readStoredPendingImport = (threadId: string): PendingImportPayload | undefined => {
    try { return readPendingImportStore()[threadId]; } catch { return undefined; }
  };
  const [panelWidth, setPanelWidth] = useState(() => Math.min(560, Math.max(240, Number(localStorage.getItem("panel-width")) || 308)));
  const dragWidthRef = useRef(panelWidth);
  const shellRef = useRef<HTMLDivElement>(null);
  function startPanelDrag(event: ReactMouseEvent) {
    event.preventDefault();
    // 性能关键：拖拽期间直接改 shell 的 grid 样式（不走 React state）——
    // 此前每个 mousemove setPanelWidth 触发整棵应用重渲染，拖动明显卡顿。
    // mouseup 才提交 state 并落盘，重渲染仅一次。
    const shell = shellRef.current;
    const sidebarCollapsedNow = sidebarCollapsed;
    const move = (e: MouseEvent) => {
      const width = Math.min(560, Math.max(240, window.innerWidth - e.clientX));
      dragWidthRef.current = width;
      if (shell) shell.style.gridTemplateColumns = `${sidebarCollapsedNow ? "minmax(0, 1fr)" : "256px minmax(0, 1fr)"} 1px ${width}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      localStorage.setItem("panel-width", String(dragWidthRef.current));
      setPanelWidth(dragWidthRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  const [planSteps, setPlanSteps] = useState<{ step: string; status: string }[]>([]);
  const [goalText, setGoalText] = useState("");
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(false);
  // ── /plan 计划模式（引擎原生 collaborationMode=plan）──
  // planOnceRef：一次性旗标，下一次 send() 以 plan 协作模式启动回合；
  // 方案回合正常结束后进入 planConfirm，用户确认后再以默认模式原任务执行。
  const planOnceRef = useRef(false);
  const planTurnRef = useRef<{ threadId: string; turnId: string } | null>(null);
  const [planArmed, setPlanArmed] = useState(false); // 输入框小徽标：下一条消息将以计划模式执行，可叉掉
  const [planRunning, setPlanRunning] = useState(false); // 计划回合执行中，徽标保持显示，叉掉=中断
  const [planConfirm, setPlanConfirm] = useState<{ threadId: string; text: string } | null>(null);
  const [planFeedback, setPlanFeedback] = useState(""); // 方案审阅卡的提意见输入框
  // ── /goal 目标模式（引擎原生 thread goal：自动 continuation，模型用 update_goal 判定达成）──
  // goalStatus: active/paused/blocked/usageLimited/budgetLimited/complete（引擎 ThreadGoalStatus）
  const [goalStatus, setGoalStatus] = useState<string | null>(null);
  // 目标卡生命周期：任务运行结束 → 清单自动收纳 → 20s 后卡片自动消失；
  // 新任务开始（或压缩/plan 更新带来的运行态回升）立即恢复显示并清掉倒计时。
  const [goalsAutoGone, setGoalsAutoGone] = useState(false);
  const goalsAutoGoneTimerRef = useRef<number | null>(null);
  const goalsPrevRunningRef = useRef(false);
  const goalsTaskRunning = Boolean(sending || activeTurnId);
  useEffect(() => {
    const wasRunning = goalsPrevRunningRef.current;
    goalsPrevRunningRef.current = goalsTaskRunning;
    if (goalsTaskRunning) {
      // 新任务开始：恢复显示、清掉未到期的消失倒计时
      if (goalsAutoGoneTimerRef.current) { window.clearTimeout(goalsAutoGoneTimerRef.current); goalsAutoGoneTimerRef.current = null; }
      setGoalsAutoGone(false);
      return;
    }
    // 只在运行 → 空闲的下降沿触发（挂载时本就空闲不动作）
    if (!wasRunning) return;
    setGoalsExpanded(false);
    goalsAutoGoneTimerRef.current = window.setTimeout(() => { setGoalsAutoGone(true); goalsAutoGoneTimerRef.current = null; }, 20000);
    return () => { if (goalsAutoGoneTimerRef.current) { window.clearTimeout(goalsAutoGoneTimerRef.current); goalsAutoGoneTimerRef.current = null; } };
  }, [goalsTaskRunning]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReport, setReviewReport] = useState("");
  const reviewTurnRef = useRef<string | null>(null);
  const [treePath, setTreePath] = useState("");
  const [treeEntries, setTreeEntries] = useState<TreeEntry[]>([]);
  // ZCode 式树形：每个目录的子项缓存 + 已展开目录集合（原地下级展开，不再整树切换目录）
  const [treeChildren, setTreeChildren] = useState<Record<string, TreeEntry[]>>({});
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);
  const [browserHome, setBrowserHome] = useState(() => localStorage.getItem("browser-home") ?? "https://github.com/openai/codex");
  const [browserUrl, setBrowserUrl] = useState("");
  const [browserDraft, setBrowserDraft] = useState("");
  // 浏览器面板默认就是 CloakBrowser 指纹模式：不再提供切换 UI；保留字段以兼容既有渲染分支
  const [browserMode] = useState<"cloak" | "internal">("cloak");
  const [cloakPage, setCloakPage] = useState("");
  const [cloakStatus, setCloakStatus] = useState("");
  // 浏览器收藏夹 + 历史（localStorage 持久化）
  const [browserBookmarks, setBrowserBookmarks] = useState<{ url: string; title: string }[]>(() => { try { return JSON.parse(localStorage.getItem("browser-bookmarks") ?? "[]"); } catch { return []; } });
  const [browserHistory, setBrowserHistory] = useState<{ url: string; title: string; at: number }[]>(() => { try { return JSON.parse(localStorage.getItem("browser-history") ?? "[]"); } catch { return []; } });
  const [browserDrawer, setBrowserDrawer] = useState<"" | "bookmarks" | "history">("");
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"" | "export" | "import" | "export-md" | "import-md">("");
  // cloak 首页快捷站点：收藏夹优先（≤6），不足补内置常用站点
  const homeSites = useMemo(() => {
    const list: { name: string; url: string; color?: string }[] = browserBookmarks.slice(0, 6).map((b) => ({ name: b.title || b.url, url: b.url }));
    for (const s of QUICK_SITES) {
      if (list.length >= 6) break;
      if (!list.some((x) => x.url === s.url)) list.push({ name: s.name, url: s.url, color: s.color });
    }
    return list;
  }, [browserBookmarks]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueDragIndex, setQueueDragIndex] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarFlyout, setSidebarFlyout] = useState(false);
  const [threadRowMenu, setThreadRowMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar-sections-collapsed") || "[]") as string[]); } catch { return new Set<string>(); }
  });
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("sidebar-sections-collapsed", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // 会话行「等待用户操作」动态徽标：侧栏对应会话上亮起需审批/需选择/需确认字样
  // 优先级：需审批 > 需选择 > 需确认；审批请求缺 threadId 时归当前会话
  const threadAttention = useMemo(() => {
    const map = new Map<string, string>();
    const priority: Record<string, number> = { "需审批": 3, "需选择": 2, "需确认": 1 };
    const setLabel = (threadId: string, label: string) => {
      if (!threadId) return;
      const existing = map.get(threadId);
      if (!existing || priority[label] > priority[existing]) map.set(threadId, label);
    };
    for (const request of pending) {
      const tid = String(request.params?.threadId ?? threadRef.current?.id ?? "");
      if (request.method === "item/tool/requestUserInput") setLabel(tid, "需选择");
      else if (request.method === "mcpServer/elicitation/request") setLabel(tid, "需确认");
      else setLabel(tid, "需审批"); // 审批类与其余默认渲染「批准」卡的 serverRequest
    }
    if (agentAsk) setLabel(agentAsk.threadId, "需选择");
    return map;
  }, [pending, agentAsk]);
  const renderThreadRow = (entry: Thread) => {
    const running = runningThreadIds.has(entry.id) || entry.status === "inProgress" || entry.status === "running";
    const attentionLabel = threadAttention.get(entry.id);
    const attentionTone = attentionLabel === "需审批" ? "approval" : attentionLabel === "需选择" ? "choice" : "confirm";
    return (
    <div className={`thread-row ${thread?.id === entry.id ? "active" : ""} ${running ? "running" : "ready"} ${threadRowMenu?.id === entry.id ? "menu-open" : ""}`} key={entry.id}>
      <button title={runningThreadIds.has(entry.id) || entry.status === "inProgress" || entry.status === "running" ? "任务运行中" : "双击修改任务名称"} onClick={() => void openThread(entry.id)}>
        <span className="thread-row-title-line" onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); void openAppPrompt("修改任务名称", cleanThreadDisplayTitle(entry.name, { preview: entry.preview })).then((next) => { if (next?.trim()) void renameThread(entry.id, next); }); }}><span>{cleanThreadDisplayTitle(entry.name, { preview: entry.preview })}</span>{attentionLabel && <span className={`thread-attention-badge tone-${attentionTone}`}>{attentionLabel}</span>}</span><small>{basename(entry.cwd)} · {timeAgo(entry.updatedAt)}</small>
      </button>
      <div className="thread-actions">
        <button className={`thread-pin-button ${pinnedThreads.includes(entry.id) ? "pinned" : ""}`} title={pinnedThreads.includes(entry.id) ? "取消置顶" : "置顶会话"} onClick={(event) => { event.stopPropagation(); togglePinThread(entry.id); }}><Pin size={13} /></button>
        <button className="thread-archive-button" title="归档会话" onClick={(event) => { event.stopPropagation(); void archiveThread(entry.id); }}><Archive size={13} /></button>
        <button className="thread-more-button" title="会话操作" aria-expanded={threadRowMenu?.id === entry.id} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const menuHeight = 250; setThreadRowMenu((current) => current?.id === entry.id ? null : { id: entry.id, top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8)), right: Math.max(8, window.innerWidth - rect.right) }); }}><MoreHorizontal size={14} /></button>
        {openingThread === entry.id ? <Spinner /> : running ? <span className="thread-running-indicator" title="任务运行中"><i /><i /><i /></span> : null}
        {threadRowMenu?.id === entry.id && createPortal(<>
          <button className="thread-row-menu-backdrop" aria-label="关闭会话菜单" onClick={() => setThreadRowMenu(null)} />
          <div className="thread-row-menu" role="menu" style={{ top: threadRowMenu.top, right: threadRowMenu.right }}>
            <button onClick={() => { setThreadRowMenu(null); void exportThreadsMarkdown([entry.id]); }}><FileText size={13} /><span>导出会话</span><small>.md</small></button>
            <button onClick={() => { setThreadRowMenu(null); void exportThreadsBackup([entry.id]); }}><Download size={13} /><span>完整备份</span><small>.json</small></button>
            <button onClick={() => { setThreadRowMenu(null); void openAppPrompt("重命名任务", cleanThreadDisplayTitle(entry.name, { preview: entry.preview })).then((next) => { if (next?.trim()) void renameThread(entry.id, next); }); }}><PenLine size={13} /><span>重命名</span></button>
            <button onClick={() => { setThreadRowMenu(null); void forkThreadFromSidebar(entry); }}><GitBranch size={13} /><span>分支</span></button>
            <button onClick={() => { setThreadRowMenu(null); void copyThreadReferenceId(entry); }}><Copy size={13} /><span>复制会话 ID</span></button>
            <button className="danger" onClick={() => { setThreadRowMenu(null); void deleteThread(entry.id); }}><Trash2 size={13} /><span>删除</span></button>
          </div>
        </>, document.body)}
      </div>
    </div>
  );
  };
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 完全自主模式：所有新任务默认拥有完整本机访问与无需审批的执行权限。
  // 使用版本化迁移，覆盖此前 workspace-write 的历史偏好。
  const [approvalPolicy, setApprovalPolicy] = useState(() => {
    if (!localStorage.getItem("full-autonomy-default-v1")) {
      localStorage.setItem("full-autonomy-default-v1", "true");
      localStorage.setItem("default-sandbox", "danger-full-access");
      localStorage.setItem("default-approval", "never");
    }
    return "never";
  });
  const [sandbox, setSandbox] = useState(() => {
    const saved = localStorage.getItem("default-sandbox");
    if (!localStorage.getItem("full-autonomy-default-v1")) {
      localStorage.setItem("full-autonomy-default-v1", "true");
      localStorage.setItem("default-sandbox", "danger-full-access");
      localStorage.setItem("default-approval", "never");
      return "danger-full-access";
    }
    return saved === "read-only" || saved === "workspace-write" || saved === "danger-full-access" ? saved : "danger-full-access";
  });
  const [personality, setPersonality] = useState(() => localStorage.getItem("default-personality") ?? "pragmatic");
  const [notice, setNotice] = useState("");
  // 上下文压缩进度/结果（短暂 toast，不进系统事件流，避免之前那种常驻 timeline 卡片）
  const [compactToast, setCompactToast] = useState<{ state: "running" | "success" | "error"; message?: string; threadId: string } | null>(null);
  // 信息面板弹窗：/queue /skills /mcp 等查询命令的输出改为居中弹窗展示（不再插入消息流灰色横幅）
  const [infoModal, setInfoModal] = useState<{ title: string; body: string; markdown?: boolean } | null>(null);
  // 项目树高亮：openFile 后标出当前打开的文件，让用户看到「点了哪个」
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null);
  // 高亮变化时：项目树里对应条目滚到视口内（用 data-tree-path 精确锁定）
  useEffect(() => {
    if (!highlightedFilePath) return;
    const target = highlightedFilePath.replace(/\\/g, "/");
    const escape = (s: string) => s.replace(/"/g, '\\"');
    const candidates = [
      `[data-tree-path="${escape(target)}"]`,
      `[data-tree-path$="/${escape(basename(highlightedFilePath))}"]`,
    ];
    const el = candidates.map((sel) => document.querySelector(sel)).find((node): node is HTMLElement => Boolean(node));
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [highlightedFilePath, treeEntries, treePath]);
  // 通知自动消失：内容变化重置计时，2.6s 后自动清除（关闭按钮仍可立即关）
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { void Promise.all([window.codex.listLocalSkills(), window.codex.listConnectors(), window.codex.listSubAgents(), window.codex.listConnectorTemplates(), window.codex.listExpertTeams()]).then(([skills, connectorList, agentList, templateList, teamList]) => { setLocalSkills(skills); setConnectors(connectorList); setSubAgents(agentList); setConnectorTemplates(templateList); setExpertTeams(teamList); }).catch(() => undefined); }, []);
  // RPA 配方与任务清单：进入应用拉一次，设置页/清单面板共享这份数据
  useEffect(() => {
    void window.codex.listRpaRecipes().then(setRpaRecipes).catch(() => undefined);
    void window.codex.listTasks().then(setTaskList).catch(() => undefined);
  }, []);
  useEffect(() => window.codex.onConnectorOAuth((event) => {
    setConnectorOAuth(event);
    if (event.phase === "authorized") {
      setConnectorTemplateModal(null);
      setConnectorTemplateValues({});
      setNotice(event.message);
      void window.codex.listConnectors().then(setConnectors).catch(() => undefined);
    }
  }), []);
  // 市场列表改为「进页才拉取」+ 搜索防抖（见 settingsContentReady 之后的门控效果）；
  // 原先这里挂载即全量请求 SkillHub/插件市场，启动与每个搜索按键都会打远端接口
  const buildStamp = "20260831-1830";
  const [lightbox, setLightbox] = useState<{ path: string; alt: string } | null>(null);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  // 本回合 hook 注入徽标（静默）：完成回复时展示在 footer 末尾
  const [hookPulse, setHookPulse] = useState<{ count: number; hooks: { name: string; done: boolean }[]; at: number }>({ count: 0, hooks: [], at: 0 });
  // 写代码模式（ponytail）开关状态：默认开启，与「常规」页的总闸联动
  const [ponytailOn, setPonytailOn] = useState(true);
  // 各渠道真实连接状态（微信/Telegram 网关是否在线）
  const [channelOnline, setChannelOnline] = useState<Record<string, boolean | undefined>>({ weixin: false, telegram: false, feishu: false, dingtalk: false, qq: false, "wecom-webhook": false });
  useEffect(() => { void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined); }, []);
  // 刚切换会话：首跳用瞬时滚动（auto），之后的流式跟随仍用平滑
  const switchJumpRef = useRef(false);
  // 会话消息缓存（复刻 WorkBuddy 切换体验）：打开过的会话缓存 thread，切回时秒开渲染，
  // 后台 thread/resume 刷新；有实质变化才替换，避免无感闪烁。
  const threadCacheRef = useRef(new Map<string, Thread>());
  // 会话真实绑定的供应商登记表（resume 响应回带 modelProvider 时记录）。发送前据此判断
  // 「会话绑定的供应商 ≠ 当前激活供应商」→ 自动迁移，防止引擎全局 Key 换了而旧会话还
  // 向旧供应商发请求（401 无限重连）。不依赖 UI 下拉框（下拉可能已被切换动作改掉）。
  const threadProviderRef = useRef(new Map<string, string>());
  // 无缓存切换时的恢复遮罩：盖住旧内容直到新会话渲染完成（不再让旧内容残留+跳顶）；
  // 缓存秒开也走遮罩——给"刚切过去就在最新消息位置"的视觉过渡，避免内容直接落底的突兀
  const [switchingThreadId, setSwitchingThreadId] = useState<string | null>(null);
  // 切换序号：快速连点时只让最新一次 resume 落地（旧响应丢弃，防止内容串台）
  const switchSeqRef = useRef(0);
  // 各会话最近一次完整 thread/resume 的时间：频繁来回切换时，30 秒内且无运行回合的会话
  // 跳过重复 resume（全量加载长会话是"频繁切换会卡"的主因；期间无事件流说明内容没变）
  const recentResumeAtRef = useRef(new Map<string, number>());
  // 分页游标：每个会话最近一次 turns/list 的 nextCursor，供「显示更早的消息」按需续拉
  const turnsCursorRef = useRef(new Map<string, string | null>());
  // fade-out 动画控制：jumpToBottom settled 后等一帧再让遮罩淡出，避免内容继续增高
  // 时遮罩提前消失导致"切过去在中间"；markSettled 每次触发都重置 timer，保证只有最后
  // 一次稳定后才真正卸载
  const [switchingFading, setSwitchingFading] = useState(false);
  const fadeOutTimerRef = useRef<number | null>(null);
  useEffect(() => { void window.codex.ponytailModeGet?.().then((mode) => setPonytailOn(mode !== "off")).catch(() => undefined); }, []);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") ?? "light");
  // 账户菜单（点左下角头像/名字弹出）：界面语言 / 界面主题 / 界面缩放 / 使用统计 / 用户中心 / 退出登录
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountMenuSub, setAccountMenuSub] = useState<"lang" | "theme" | "zoom" | "update" | null>(null);
  // 自更新：网页源（发布站）/ GitHub Releases 双源可切换，源选择持久化 localStorage
  const [updateSource, setUpdateSourceState] = useState<"web" | "github">(() => (localStorage.getItem("update-source") === "github" ? "github" : "web"));
  const setUpdateSource = (source: "web" | "github") => {
    setUpdateSourceState(source);
    localStorage.setItem("update-source", source);
  };
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string; reason?: string } | null>(null);
  const [updateCurrentVersion, setUpdateCurrentVersion] = useState<string>("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string>("");
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  // 启动静默检查发现新版本 → 弹出的通知卡片（用户关掉后本次会话不再弹）
  const [updateNotice, setUpdateNotice] = useState<{ version?: string; changelog?: string; size?: number; mandatory?: boolean } | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [accountMenuOpen]);
  // 启动时静默检查一次：有新版本就弹通知卡片；无更新或出错一律不打扰
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await window.codex.updateCheck?.({ source: updateSource });
        if (cancelled || !r?.ok) return;
        setUpdateInfo(r.info ?? null);
        setUpdateCurrentVersion(r.currentVersion ?? "");
        if (r.info?.hasUpdate) {
          setUpdateNotice({ version: r.info.version, changelog: r.info.changelog, size: r.info.size, mandatory: r.info.mandatory });
        }
      } catch (err) {
        // 静默：网络不通、发布站不可达都不打扰用户
        console.warn("[update] startup check failed:", err);
      }
    })();
    return () => { cancelled = true; };
    // 仅启动时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 下载进度：主进程通过 updates:download-progress 推送
  useEffect(() => {
    const off = window.codex.updateOnProgress?.((percent: number) => setUpdateProgress(percent));
    return () => { off?.(); };
  }, []);
  const runUpdateCheck = async () => {
    setUpdateChecking(true);
    setUpdateError("");
    try {
      const r = await window.codex.updateCheck?.({ source: updateSource });
      if (!r) throw new Error("IPC 不可用");
      if (!r.ok) throw new Error(r.error || "检查失败");
      setUpdateInfo(r.info ?? null);
      setUpdateCurrentVersion(r.currentVersion ?? "");
    } catch (err: any) {
      setUpdateError(err?.message || String(err));
    } finally {
      setUpdateChecking(false);
    }
  };
  /** 下载安装包 → 自动打开安装程序；唤起失败则退化为打开所在文件夹 */
  const runUpdateDownload = async () => {
    if (!updateInfo?.downloadUrl) return;
    setUpdateDownloading(true);
    setUpdateProgress(0);
    setUpdateError("");
    try {
      const r = await window.codex.updateDownload?.({
        downloadUrl: updateInfo.downloadUrl,
        filename: updateInfo.filename || "codex-harness-update.bin",
      });
      if (!r?.ok) throw new Error(r?.error || "下载失败");
      const started = await window.codex.updateInstall?.(r.path!);
      if (!started?.ok) {
        void window.codex.updateReveal?.(r.path!);
        showToast?.(`已下载 v${updateInfo.version}，请手动安装`, "");
      } else {
        setUpdateNotice(null);
        showToast?.(`正在打开 v${updateInfo.version} 安装程序`, "");
      }
    } catch (err: any) {
      setUpdateError(err?.message || String(err));
    } finally {
      setUpdateDownloading(false);
      setUpdateProgress(0);
    }
  };
  // 打开网站反馈页：带上当前版本与系统信息（管理员可据此复现）；URL 跟随用户配置的更新服务器
  const openFeedbackPage = () => {
    const ua = navigator.userAgent;
    const os = /Windows NT 10/.test(ua) ? "Windows 10/11"
      : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS"
      : /Linux/.test(ua) ? "Linux"
      : navigator.platform || "";
    const qs = new URLSearchParams();
    if (updateCurrentVersion) qs.set("v", updateCurrentVersion);
    if (os) qs.set("os", os);
    // 发布中心地址固定（与更新源同一站点），用户无需配置
    const base = "https://www.jvszzp.ltd";
    const url = `${base}/feedback.html${qs.toString() ? `?${qs.toString()}` : ""}`;
    setAccountMenuOpen(false);
    void window.codex.openExternal(url);
  };
  const [uiLang, setUiLang] = useState(() => localStorage.getItem("ui-lang") ?? "zh");
  const [uiZoom, setUiZoom] = useState(() => Number(localStorage.getItem("ui-zoom") ?? "1"));
  useEffect(() => { document.documentElement.dataset.uiLang = uiLang; localStorage.setItem("ui-lang", uiLang); }, [uiLang]);
  useEffect(() => { (document.body.style as any).zoom = String(uiZoom); localStorage.setItem("ui-zoom", String(uiZoom)); }, [uiZoom]);
  // 让模块级 widget 卡片跟随主题（widget iframe 背景/文字色）
  useEffect(() => { widgetDark = theme === "dark"; return () => { widgetDark = false; }; }, [theme]);
  const [uiFont, setUiFont] = useState(() => localStorage.getItem("ui-font") ?? "default");
  useEffect(() => {
    document.documentElement.dataset.uiFont = uiFont;
  }, [uiFont]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 未配置的 PPtoken 推荐卡可被用户「禁用」（仅置灰，不写引擎存储；配置真实密钥后走 setProviderEnabled）
  const [pptokenCardOff, setPptokenCardOff] = useState(() => localStorage.getItem("pptoken-card-off") === "1");
  useEffect(() => { try { localStorage.setItem("pptoken-card-off", pptokenCardOff ? "1" : "0"); } catch { /* ignore */ } }, [pptokenCardOff]);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toolsStatus, setToolsStatus] = useState<{ id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string }[]>([]);
  const refreshToolsStatus = () => { window.codex.toolStatus().then(setToolsStatus).catch(() => setToolsStatus([])); };
  const [devRuntimes, setDevRuntimes] = useState<DevRuntimeEntry[]>([]);
  const [runtimeInstalling, setRuntimeInstalling] = useState<string | null>(null);
  const [runtimeProgress, setRuntimeProgress] = useState<Record<string, string>>({});
  const refreshDevRuntimes = () => { window.codex.listRuntimes().then(setDevRuntimes).catch(() => setDevRuntimes([])); };
  useEffect(() => window.codex.onRuntimeProgress((event) => {
    setRuntimeProgress((current) => ({ ...current, [event.id]: event.message.split(/\r?\n/).at(-1) || event.message }));
    if (event.done) { setRuntimeInstalling(null); refreshDevRuntimes(); }
  }), []);
  async function installDevRuntime(id: string) {
    setRuntimeInstalling(id);
    setRuntimeProgress((current) => ({ ...current, [id]: "准备下载…" }));
    try {
      const result = await window.codex.installRuntime(id);
      setDevRuntimes(result.runtimes);
      // 同步能力总闸联动开关（桌面/浏览器自动化）与工具状态，安装后立即生效
      await Promise.all([refreshSettingsResources(), refreshToolsStatus()]);
      setNotice("开发工具安装成功，Codex 引擎已刷新");
    } catch (error: any) {
      setNotice(`开发工具安装失败：${error.message}`);
    } finally { setRuntimeInstalling(null); }
  }
  useEffect(() => { if (settingsOpen) refreshToolsStatus(); }, [settingsOpen]);
  useEffect(() => { if (settingsOpen && settingsPage === "devtools") refreshDevRuntimes(); }, [settingsOpen, settingsPage]);
  // 进入「SSH 服务器」分区时拉取一次服务器列表
  useEffect(() => {
    if (settingsOpen && settingsPage === "ssh" && !sshLoaded) {
      void window.codex.listSshServers().then((servers) => { setSshServers(servers); setSshLoaded(true); }).catch(() => setSshLoaded(true));
    }
  }, [settingsOpen, settingsPage, sshLoaded]);
  const [settingsResources, setSettingsResources] = useState<{ skills: any[]; hooks: any[]; plugins: any[]; mcp: any[] }>({ skills: [], hooks: [], plugins: [], mcp: [] });
  const installedTotalCount = useMemo(() => {
    const localNames = new Set(localSkills.map((entry) => entry.name.toLowerCase()));
    const localByPath = new Set(localSkills.map((entry) => entry.path));
    const builtin = settingsResources.skills.filter((entry: any) => !localByPath.has(entry.path) && !localNames.has((entry.name ?? "").toLowerCase()));
    return builtin.length + localSkills.length;
  }, [localSkills, settingsResources.skills]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginInstalledOnly, setPluginInstalledOnly] = useState(false);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const [pluginBatchBusy, setPluginBatchBusy] = useState<"enable" | "disable" | null>(null);
  const [skillBatchBusy, setSkillBatchBusy] = useState<"enable" | "disable" | null>(null);
  // 勾选集合：批量操作只作用于勾选的条目，而不是「当前筛选出的全部」
  const [pluginChecked, setPluginChecked] = useState<string[]>([]);
  const [skillChecked, setSkillChecked] = useState<string[]>([]);
  const [skillManageSearch, setSkillManageSearch] = useState("");
  // —— 命令页（复刻 WorkBuddy 命令界面）：内置 + 自定义 + 技能 ——
  const [customCommands, setCustomCommands] = useState<CustomCommandEntry[]>([]);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandFilter, setCommandFilter] = useState<"all" | "custom" | "builtin" | "skill">("all");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandEditor, setCommandEditor] = useState<{ mode: "new" | "edit"; name: string; source: CommandSource; description: string; argumentHint: string; allowedTools: string; model: string; body: string; prevFilePath?: string } | null>(null);
  const [commandDelete, setCommandDelete] = useState<CustomCommandEntry | null>(null);
  const [commandBusyKey, setCommandBusyKey] = useState<string | null>(null);
  const refreshCommands = useCallback(async () => {
    setCommandBusy(true);
    try { setCustomCommands(await window.codex.listCommands({ cwd: workspace ?? undefined })); }
    catch (error: any) { setNotice(`命令列表加载失败：${error.message}`); }
    finally { setCommandBusy(false); }
  }, [workspace, setNotice]);
  useEffect(() => { if (settingsOpen) void refreshCommands(); }, [settingsOpen, workspace, refreshCommands]);
  // 保存命令（新建或更新）后刷新列表
  async function persistCommand() {
    if (!commandEditor) return;
    const draft = commandEditor;
    const name = draft.name.trim();
    if (!name) { setNotice("命令名不能为空"); return; }
    if (commandBusyKey) return;
    setCommandBusyKey("save");
    try {
      await window.codex.saveCommand({
        name,
        source: draft.source,
        description: draft.description,
        argumentHint: draft.argumentHint,
        allowedTools: draft.allowedTools,
        model: draft.model,
        body: draft.body,
        prevFilePath: draft.mode === "edit" ? draft.prevFilePath : undefined,
        cwd: workspace ?? undefined,
      });
      setCommandEditor(null);
      setNotice(draft.mode === "edit" ? `命令 /${name} 已更新` : `命令 /${name} 已创建`);
      await refreshCommands();
    } catch (error: any) {
      setNotice(error.message);
    } finally {
      setCommandBusyKey(null);
    }
  }
  async function confirmDeleteCommand() {
    if (!commandDelete) return;
    setCommandBusyKey("delete");
    try {
      await window.codex.deleteCommand(commandDelete.filePath);
      setCommandDelete(null);
      setNotice(`命令 /${commandDelete.name} 已删除`);
      await refreshCommands();
    } catch (error: any) {
      setNotice(`删除失败：${error.message}`);
    } finally {
      setCommandBusyKey(null);
    }
  }
  /** 从输入框使用命令：内置 / 自定义都填 /name 进入输入框；技能则直接引用 */
  function useCommand(name: string, kind: "builtin" | "custom" | "skill", skill?: any) {
    if (kind === "skill" && skill) {
      setSelectedSkills((current) => current.some((entry: any) => entry.name === skill.name) ? current : [...current, skill]);
      setSettingsOpen(false);
      setNotice(`已引用技能：${skill.name}`);
      return;
    }
    setPrompt(`/${name} `);
    setSettingsOpen(false);
  }
  const [hookTrusting, setHookTrusting] = useState(false);
  const [hookBusy, setHookBusy] = useState<string | null>(null);
  const [linkedBusy, setLinkedBusy] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "Codex 用户");
  const [userAvatar, setUserAvatar] = useState<{ type: string; value: string } | null>(() => { try { const p = JSON.parse(localStorage.getItem("user-profile") || "{}"); return p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null; } catch { return null; } });
  // 用户名权威源是个性化 nickname（存 userData/personalization.json，重启不丢）：
  // 启动时异步回读并覆盖 localStorage 缓存（localStorage 在应用退出瞬间可能没 flush，导致"重启恢复默认"）。
  useEffect(() => {
    void window.codex.readPersonalization().then((cfg) => {
      if (cfg?.nickname) { setUsername(cfg.nickname); localStorage.setItem("username", cfg.nickname); }
    }).catch(() => undefined);
  }, []);
  // 左下角账户名：点击进入行内编辑，Enter/失焦保存、Esc 取消
  const [accountEditing, setAccountEditing] = useState(false);
  const [accountDraft, setAccountDraft] = useState("");
  const accountNameRef = useRef<HTMLInputElement>(null);
  const saveAccountName = () => {
    const next = accountDraft.trim();
    if (next && next !== username) {
      setUsername(next);
      localStorage.setItem("username", next); // 缓存，供下次启动秒显
      // 联动引擎：昵称写进 AGENTS.md（Codex 每个请求动态加载），下次对话引擎就知道怎么称呼用户
      void window.codex.setNickname(next).then(() => setNotice(`已更新称呼「${next}」，Codex 下次对话会这样称呼你`)).catch((error: any) => setNotice(`称呼已更新，但同步到引擎失败：${error?.message ?? error}`));
    }
    setAccountEditing(false);
  };
  const startAccountEdit = () => { setAccountDraft(username); setAccountEditing(true); };
  // 欢迎语：按时段 + 用户名组合，副语随机挑一条；useMemo 保证打字等重渲染不会让问候语跳变
  const [greeting, greetSub] = useMemo(() => {
    const hour = new Date().getHours();
    const period = hour < 6 ? "night" : hour < 11 ? "morning" : hour < 13 ? "noon" : hour < 18 ? "afternoon" : "evening";
    // 主问候保持纯渐变文字（不带 emoji）：emoji 在 background-clip:text 的 -webkit-text-fill-color:transparent 下
    // 会随文字一起变透明、渲染成黑色方块。emoji 视觉集中放在副语和建议卡里也够了
    const hello: Record<string, string> = { night: "夜深了", morning: "早上好", noon: "中午好", afternoon: "下午好", evening: "晚上好" };
    const pools: Record<string, string[]> = {
      night: ["🌙 这个点还醒着，是遇到棘手的问题了吗？说来听听，我陪你收尾。", "💡 凌晨的灵感最值钱——想清楚了就丢给我，剩下的体力活我来。", "🛏️ 夜深了，麻烦交给我，你负责早点休息。", "🌌 世界都睡了，你的问题我醒着。别硬撑，一起把它收掉。", "🕯️ 夜里的坚持值得被善待——把难题放下这边，休息交给时间。", "☕ 深夜的咖啡我陪你喝，代码我陪你写，你只管说想做成什么。"],
      morning: ["🌅 新的一天，从一句提问开始。想先推进哪件事？", "☕ 咖啡备好了吗？把今天的第一个任务丢过来吧。", "🚀 清晨头脑最清醒，正适合啃硬骨头。想从哪儿开始？", "☀️ 今天的太阳和昨天不一样，昨天的难题今天说不定一句话就通了。", "🌤️ 早上好，把今天最不想做的那件事交给我，剩下的都轻松。", "🌿 新的一天刚刚铺开，选一件小事开始，胜利感会滚雪球。"],
      noon: ["🍚 忙了一上午，先吃口饭也没关系——下午的任务可以先交给我。", "😴 午安！趁午休整理一下思路，下午开工就省力了。", "🔥 中午好，要不要趁热把上午没解决的问题清一清？", "🍵 吃饱了才有力气改变世界——先歇会儿，活儿我记着呢。", "⛅ 午间小憩是聪明的投资，醒来把想法丢给我接着干。", "🥢 上午没做完的别焦虑，下午的你有的是办法。"],
      afternoon: ["😌 下午好！困意上头的时刻，最适合把重复劳动交出去。", "📋 午后的活儿看着多？拆开一件一件来，细节我来盯。", "🍰 下午茶时间，顺便聊点正事？琐碎的活儿尽管丢给我。", "🍂 下午容易犯困，思路却最诚实——想说点什么，我都在。", "🧋 来杯奶茶的时间，够我们把一件麻烦事聊明白。", "🪟 阳光正好，把窗边的位置留给灵感，跑腿的活儿归我。"],
      evening: ["🌇 今天辛苦了，剩下的收尾让我来分担。", "🌃 夜幕降临，正适合安安静静解决一两个悬而未决的问题。", "✨ 晚上好，复盘、总结还是继续推进？交给我就行。", "🍵 忙了一天，别忘了给自己倒杯水——这边的事不着急，说清楚就好。", "🌙 夜色温柔，适合把白天的毛躁磨成晚上的成品。", "🏠 快到家了吗？今天的最后一件事，交给我来收尾。"],
    };
    const pool = pools[period];
    // 默认昵称（Codex 用户）不硬拼逗号，显得更自然；自定义昵称才带称呼
    const named = username !== "Codex 用户" ? `${hello[period]}，${username}` : hello[period];
    return [named, pool[Math.floor(Math.random() * pool.length)]] as const;
  }, [username]);
  const [mobileRemoteOpen, setMobileRemoteOpen] = useState(false);
  const [botManagerOpen, setBotManagerOpen] = useState(false);
  // 机器人管理弹窗打开期间轮询渠道在线状态（5s）：扫码绑定成功/断开时左侧徽章即时跟上，
  // 不依赖网关 log 事件转发链路（09-08 反馈：扫码连接成功但状态一直「未连接」）
  useEffect(() => {
    if (!botManagerOpen) return;
    void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined);
    const timer = window.setInterval(() => { void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [botManagerOpen]);
  // 频道机器人流式回复设置（全局，主进程 bot-stream.json）：弹窗打开时加载
  const [botStream, setBotStream] = useState<{ enabled: boolean; thinking: boolean; tools: boolean }>({ enabled: true, thinking: true, tools: true });
  useEffect(() => {
    if (!botManagerOpen) return;
    void window.codex.botStreamGet?.().then(setBotStream).catch(() => undefined);
  }, [botManagerOpen]);
  const updateBotStream = (next: { enabled: boolean; thinking: boolean; tools: boolean }) => {
    setBotStream(next);
    void window.codex.botStreamSet?.(next).then(setBotStream).catch(() => undefined);
  };
  // 频道机器人会话绑定：机器人消息固定在选定会话中继续（可选老会话；持久化在主进程）
  const [botBindings, setBotBindings] = useState<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>({ wechat: null, telegram: null });
  useEffect(() => {
    if (!botManagerOpen) return;
    void window.codex.botBindingGet?.().then(setBotBindings).catch(() => undefined);
  }, [botManagerOpen]);
  const setBotBinding = async (channel: "wechat" | "telegram", threadId: string | null, title?: string) => {
    try {
      const next = await window.codex.botBindingSet?.({ channel, threadId, title });
      setBotBindings((cur) => ({ ...cur, [channel]: next ?? null }));
      showToast("绑定已更新", threadId ? "机器人后续消息将在所选会话中继续" : "机器人已解绑，下一条消息将开启新会话");
    } catch { showToast("绑定失败", "请稍后重试"); }
  };
  const [bots, setBots] = useState<{ id: string; name: string; channel: string; enabled: boolean }[]>(() => { try { return JSON.parse(localStorage.getItem("bots") ?? "[]"); } catch { return []; } });
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  // 打开机器人管理弹窗默认选中已配置的机器人（优先已启用的），不再显示空详情页
  useEffect(() => {
    if (!botManagerOpen) return;
    if (bots.some((b) => b.id === activeBotId)) return;
    const first = bots.find((b) => b.enabled) ?? bots[0];
    if (first) { setActiveBotId(first.id); setBotChannelPick(null); }
  }, [botManagerOpen, bots, activeBotId]);

  useEffect(() => {
    if (!botManagerOpen) return;
    void window.codex.botBindingGet?.().then(setBotBindings).catch(() => undefined);
    const off = window.codex.onBotBindingChanged?.((bindings) => setBotBindings({ wechat: (bindings as any)?.wechat ?? null, telegram: (bindings as any)?.telegram ?? null }));
    return () => { off?.(); };
  }, [botManagerOpen]);
  const [botChannelPick, setBotChannelPick] = useState<string | null>(null);
  const [botQr, setBotQr] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteDevices, setRemoteDevices] = useState<any[]>([]);
  const [remoteStatus, setRemoteStatus] = useState("idle");
  void remoteStatus; /* WIP: 用户远控状态尚未接线，先占位防 noUnusedLocals */
  const [remoteCmd, setRemoteCmd] = useState("");
  const [remoteLog, setRemoteLog] = useState<string[]>([]);
  void remoteDevices; void remoteCmd; void remoteLog; void setRemoteCmd; void setRemoteLog; /* WIP: 用户远控面板尚未接线，先占位防 noUnusedLocals */
  const [remoteQr, setRemoteQr] = useState("");
  const [userDataPath, setUserDataPath] = useState("");
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [inlineRename, setInlineRename] = useState(false);
  const inlineRenameRef = useRef<HTMLInputElement>(null);
  const [interruptedTurns, setInterruptedTurns] = useState<Record<string, number>>({});
  const [stoppedElapsed, setStoppedElapsed] = useState<Record<string, number>>({});
  const closeTaskMenu = () => setTaskMenuOpen(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // 流式跟随：用户滚到底时为 true（持续自动跟 agent 最新内容），向上滚看历史时为 false
  const stickToBottomRef = useRef(true);
  const [workStartedAt, setWorkStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineWrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const composerInputRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  // 编辑框 DOM 当前序列化结果：区分「用户输入回流」与「外部置值需重建」（见 ComposerEditor）
  const composerDomValueRef = useRef<string | null>(null);

  // 输入框区块（多行撑高 / 计划审阅卡 / 队列卡 / 引用条 / 模式横幅）高度一变，
  // 消息区可视高度就被压缩——贴底跟随若不重申，底部回复会被裁在输入框上沿下
  //（用户看到的「输入框遮住消息」）。贴底时任何高度变化都立刻重新贴底；
  // 用户主动上滚（stick=false）则不打扰。
  useLayoutEffect(() => {
    const wrap = composerWrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // 空态（docked-center）输入框悬浮在欢迎页上，无消息可遮
      if (wrap.classList.contains("docked-center")) return;
      if (!stickToBottomRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      // .timeline 有 scroll-behavior:smooth，直接赋值 scrollTop 会触发平滑动画导致跟随滞后，须瞬时贴底
      el.style.scrollBehavior = "auto";
      el.scrollTop = el.scrollHeight;
      el.style.scrollBehavior = "";
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /** 生成内联图片 chip：删除→清 images；主体点击→预览；任何变更→DOM 序列化回流状态 */
  const makeComposerChip = useCallback((path: string) => createInlineImageChip(
    path,
    (target) => setImages((current) => current.filter((entry) => entry !== target)),
    (target) => setLightbox({ path: target, alt: "待发送图片" }),
    () => syncComposerFromDom(),
  ), []);

  /** 编辑框 DOM → 状态：序列化 prompt（images 跟随占位符，chip 被退格删除时同步收敛） */
  function syncComposerFromDom() {
    const el = composerInputRef.current;
    if (!el) return;
    const next = serializeComposerDom(el);
    composerDomValueRef.current = next;
    setImages(promptImagePaths(next));
    onPromptChange(next);
  }

  // 覆盖层焦点归还：设置页/删除确认框等遮罩关闭后，浏览器把焦点丢给 body，
  // 输入框随之失焦（表现为删除完回到对话框打字没反应）。统一在遮罩关闭时把焦点
  // 还给打开前的元素，卸载掉了就还给输入框；原生 confirm/alert 同样兜住。
  useEffect(() => {
    return installFocusReturn({
      doc: document,
      win: window as unknown as Record<string, unknown>,
      schedule: (callback) => requestAnimationFrame(() => callback()),
      getFallback: () => composerInputRef.current,
    });
  }, []);

  // 消息操作回调走 ref 转发：身份永远稳定，memo 化的回合视图不会因回调重建而失效，
  // 同时内部始终读取最新闭包（thread/sending 等状态不会过期）
  const messageHandlersRef = useRef<FoldHandlers | null>(null);
  messageHandlersRef.current = {
    onCopy: (text) => void copyMessage(text),
    onQuote: (text) => quoteMessage(text),
    onImageCopy: (path) => void copyImage(path),
    onFork: (turnId) => void forkFromTurn(turnId),
    onEdit: (turnId, item) => void editResend(turnId, item),
    onOpenFile: (path) => void openFile(path),
    onOpenThread: (id) => void openThread(id),
  };
  const messageHandlers = useMemo<FoldHandlers>(() => ({
    onCopy: (text) => messageHandlersRef.current?.onCopy(text),
    onQuote: (text) => messageHandlersRef.current?.onQuote(text),
    onImageCopy: (path) => messageHandlersRef.current?.onImageCopy(path),
    onFork: (turnId) => messageHandlersRef.current?.onFork(turnId),
    onEdit: (turnId, item) => messageHandlersRef.current?.onEdit(turnId, item),
    onOpenFile: (path) => messageHandlersRef.current?.onOpenFile(path),
    onOpenThread: (id) => messageHandlersRef.current?.onOpenThread?.(id),
  }), []);

  const {
    memoryEnabled, memories, setMemories, memoryCategory, setMemoryCategory, memorySaveCategory, setMemorySaveCategory, memorySavedAt,
    memoryDraft, setMemoryDraft, memoryStatus, setMemoryStatus,
    memoryGateway, setMemoryGateway, memoryGatewayAction,
    memoryMode, updateMemoryMode, workspaceMemoryEnabled, updateWorkspaceMemory,
    saveMemoryRecord, deleteMemoryRecord, deleteMemoryGroup, resetMemory,
    testMemoryGateway, saveMemoryGateway, setMemoryEnabled,
  } = useMemory({ threadId: thread?.id, activeTurnId, workspace });

  const memoryProjectOptions = useMemo(() => {
    const paths = new Set<string>();
    if (workspace) paths.add(workspace);
    for (const entry of threads) if (entry.cwd) paths.add(entry.cwd);
    for (const entry of memories) if (entry.workspace) paths.add(entry.workspace);
    return [...paths].sort((a, b) => basename(a).localeCompare(basename(b), "zh-CN") || a.localeCompare(b));
  }, [memories, threads, workspace]);
  const memoryManagementWorkspace = memoryProjectWorkspace === "__all__" ? "" : memoryProjectWorkspace;
  useEffect(() => {
    let cancelled = false;
    if (!memoryManagementWorkspace) { setMemoryProjectEnabled(false); return () => { cancelled = true; }; }
    void window.codex.readWorkspaceMemoryEnabled(memoryManagementWorkspace).then((enabled) => {
      if (!cancelled) setMemoryProjectEnabled(Boolean(enabled));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [memoryManagementWorkspace]);
  const memoryEntryBelongsToProject = useCallback((entry: MemoryRecord, project: string) => {
    if (!project || project === "__all__") return true;
    return !entry.workspace || entry.workspace === project || Boolean(entry.sourceThreadId && threads.some((thread) => thread.id === entry.sourceThreadId && thread.cwd === project));
  }, [threads]);
  const memoryVisibleRecords = useMemo(
    () => memories.filter((entry) => memoryEntryBelongsToProject(entry, memoryProjectWorkspace)),
    [memories, memoryProjectWorkspace, memoryEntryBelongsToProject],
  );

  // 记忆按会话（threadId）聚合 + P 级漏斗分层。
  // threads 来自 refreshThreads（侧边栏同一份数据），手动保存的（无 sourceThreadId）独立成组。
  const memoryTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of threads) {
      const name = (t.name ?? "").trim() || `会话 ${t.id.slice(0, 8)}`;
      map.set(t.id, name);
    }
    return (id: string) => map.get(id);
  }, [threads]);
  const memoryGroups = useMemo(() => groupMemoriesByThread(memoryVisibleRecords, memoryTitleById), [memoryVisibleRecords, memoryTitleById]);
  // 按当前选中的分类筛选（漏斗内仍展示，但只显示该分类下的组）
  const memoryGroupsFiltered = useMemo(
    () => memoryCategory ? memoryGroups.filter((g) => g.items.some((it) => it.category === memoryCategory)) : memoryGroups,
    [memoryGroups, memoryCategory],
  );

  // ── 记忆分层：L0 用户档案 / L1 项目记忆 / L2 每日日志 ──
  // 这三层是「常驻注入」的，和上面 memory.json 的碎片检索池（L3，按需召回）互不替代。
  const [memoryLayers, setMemoryLayers] = useState<MemoryLayersSnapshot | null>(null);
  const [memoryLayerScope, setMemoryLayerScope] = useState<"user" | "background" | "project">("user");
  const [memoryLayerDraft, setMemoryLayerDraft] = useState("");
  const [memoryLayerSavedAt, setMemoryLayerSavedAt] = useState<number | null>(null);
  const [memoryDistilling, setMemoryDistilling] = useState(false);

  const applyMemoryLayers = useCallback((snapshot: MemoryLayersSnapshot, scope: "user" | "background" | "project") => {
    setMemoryLayers(snapshot);
    setMemoryLayerDraft(scope === "user" ? snapshot.user : scope === "background" ? snapshot.background : snapshot.project);
  }, []);
  // 打开记忆设置页或切换工作区时拉一次快照；切 tab 也要重载，否则会拿另一个作用域的内容覆盖草稿
  useEffect(() => {
    if (settingsPage !== "memory") return;
    let cancelled = false;
    setMemoryLayers(null);
    void window.codex.readMemoryLayers(memoryManagementWorkspace || undefined)
      .then((snapshot) => { if (!cancelled) applyMemoryLayers(snapshot, memoryLayerScope); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [settingsPage, memoryManagementWorkspace, memoryLayerScope, applyMemoryLayers]);

  const memoryLayerDirty = useMemo(
    () => (memoryLayers ? memoryLayerDraft !== (memoryLayerScope === "user" ? memoryLayers.user : memoryLayerScope === "background" ? memoryLayers.background : memoryLayers.project) : false),
    [memoryLayerDraft, memoryLayers, memoryLayerScope],
  );

  async function saveMemoryLayer() {
    const scope = memoryLayerScope;
    if ((scope === "project" || scope === "background") && !memoryManagementWorkspace) { setMemoryStatus("请先在记忆中心选择项目"); return; }
    try {
      applyMemoryLayers(await window.codex.writeMemoryLayer({ scope, content: memoryLayerDraft, workspace: memoryManagementWorkspace || undefined }), scope);
      setMemoryLayerSavedAt(Date.now());
      window.setTimeout(() => setMemoryLayerSavedAt(null), 2200);
      setMemoryStatus(scope === "user" ? "用户档案已保存 · 下一条消息起生效" : scope === "background" ? "项目背景已保存 · 该项目的新会话会优先读取" : "项目记忆已保存 · 下一条消息起生效");
    } catch (error: any) { setMemoryStatus(error.message); }
  }

  async function runMemoryDistill() {
    if (!memoryManagementWorkspace) { setMemoryStatus("请先在记忆中心选择项目"); return; }
    setMemoryDistilling(true);
    try {
      const result = await window.codex.distillMemory(memoryManagementWorkspace);
      applyMemoryLayers(await window.codex.readMemoryLayers(memoryManagementWorkspace), memoryLayerScope);
      setMemoryStatus(`蒸馏完成：${result.dates.length} 天日志已提炼进项目记忆（${result.added} 字）`);
    } catch (error: any) { setMemoryStatus(error.message); }
    finally { setMemoryDistilling(false); }
  }

  async function togglePinned(id: string) {
    const entry = memories.find((item) => item.id === id);
    if (!entry) return;
    try {
      const saved = await window.codex.saveMemory({ id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, pinned: !(entry as any).pinned, workspace: (entry as any).workspace });
      setMemories((current) => current.map((item) => item.id === id ? saved : item));
      setMemoryStatus(saved.pinned ? "已置顶为核心记忆" : "已取消置顶");
    } catch (error: any) { setMemoryStatus(error.message); }
  }

  async function clearSelectedMemory() {
    if (memoryProjectWorkspace === "__all__") {
      await resetMemory();
      return;
    }
    const count = await deleteMemoryGroup((entry) => memoryEntryBelongsToProject(entry, memoryProjectWorkspace) && Boolean(entry.workspace || entry.sourceThreadId));
    setMemoryStatus(count ? `已清空项目「${basename(memoryProjectWorkspace)}」的 ${count} 条记忆（全局记忆未删除）` : `项目「${basename(memoryProjectWorkspace)}」没有可清理的项目记忆`);
  }

  const {
    scheduledTasks, setScheduledTasks, scheduleDraft, setScheduleDraft,
    autoFormVisible, setAutoFormVisible, scheduleStatus,
    saveSchedule, toggleSchedule, deleteSchedule, runSchedule,
    editSchedule,
  } = useScheduler();

  const {
    channelBot, setChannelBot, channelDraft, setChannelDraft,
    channelAction, channelStatus, setChannelStatus,
    saveChannelBot, testChannelBot, chooseChannelWorkspace,
  } = useChannelBot();

  const {
    customModel, setCustomModel, customDraft, setCustomDraft, providersList, currentProvider,
    editingProvider, setEditingProvider, savingSettings, providerModels, modelSourceProvider,
    refreshActive,
    probingProvider, providerStatus, switchingModel, saveCustomModel, probeProvider, probeActiveProvider,
    selectProvider, removeProvider, setProviderModel, removeProviderModel,
    upsertProviderModel, setProviderEnabled, probeOneModel, adoptSavedProvider, saveCustomDraft,
  } = useModelProviders({
    onAutoSelect: (modelId, effort) => {
      setModelId((current) => current || modelId);
      setEffort((current) => current || effort || DEFAULT_EFFORT);
    },
    onSelect: (modelId, effort) => {
      setModelId(modelId);
      localStorage.setItem("default-model", modelId);
      if (effort) setEffort(effort);
    },
    onNotice: setNotice,
    onProbeSuccess: (title, detail) => showToast(title, detail),
    // 设置页保存等路径已触发引擎重启生效：清掉「待重启生效」banner，避免残留误导
    onEngineApplied: () => setPendingRestart(null),
  });
  // 进入中转站/官方订阅/模型页时刷新生效供应商：这些页的互斥判断依赖 customModel，
  // 状态过期（如另一处刚停用/启用）会导致「明明没有生效供应商却全灰」的死锁
  useEffect(() => {
    if (settingsOpen && (settingsPage === "relay" || settingsPage === "openai" || settingsPage === "model")) refreshActive();
  }, [settingsOpen, settingsPage, refreshActive]);
  // 进入模型配置页直接展开「已配置好的（当前生效）供应商」，不再停在空白表单
  // ——用 ref 记账，页面关闭才复位，避免用户点「添加供应商」后被自动打开盖掉。
  const providerAutoOpenRef = useRef(false);
  useEffect(() => {
    if (!settingsOpen) { providerAutoOpenRef.current = false; return; }
    if (settingsPage !== "model" || providerAutoOpenRef.current || editingProvider || !customModel) return;
    const target = providersList.find((entry) => entry.provider === customModel.provider);
    if (!target) return;
    providerAutoOpenRef.current = true;
    setEditingProvider(target.provider);
    setEditingName(false);
    setCustomDraft({ provider: target.provider, name: target.name, model: target.model, baseUrl: target.baseUrl, contextWindow: String(target.contextWindow ?? 128000), wireApi: target.wireApi ?? "responses", apiKey: "", models: target.models ?? (target.model ? [{ id: target.model }] : []), enabled: target.enabled ?? true });
  }, [settingsOpen, settingsPage, customModel, providersList, editingProvider]);
  // 供应商切换「待重启生效」：切换只保存配置不重启引擎（不打断正在运行的会话），
  // 用户点 banner 的「重启生效」或下次启动时才让新供应商生效。生效前消息继续用原供应商。
  const [pendingRestart, setPendingRestart] = useState<{ provider: string; model: string; label: string; prevProvider: string; prevModel: string } | null>(null);
  const pendingRestartRef = useRef(pendingRestart);
  pendingRestartRef.current = pendingRestart;
  // 中转站一键切换：复用已有 key（按分组匹配）或新建 → 生成/更新供应商 → 选中生效。
  // 失败时抛回给调用方（中转站页面常驻显示错误），relay-active 只在全部成功后写入。
  const relayActivate = useCallback(async (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }, retried = false): Promise<void> => {
    setRelayBusy(true);
    try {
      const resolved = explicitKey ? await resolveRelayKeyTarget(explicitKey) : await resolveRelayTarget(mode, group);
      let probeError: string = "";
      try {
        const probe = await window.codex.probeCustomModel({ provider: resolved.provider, baseUrl: resolved.gateway, apiKey: resolved.apiKey, wireApi: "responses" });
        const models: string[] = probe?.models ?? [];
        if (!models.length) throw new Error("网关探测不到可用模型，请检查站点地址");
        // 优选通用对话/代码模型，避免默认选中 auto-review 之类的附属模型
        const defaultModel = models.find((mid: string) => /gpt|codex|claude|gemini|deepseek|grok/i.test(mid) && !/auto-review/i.test(mid))
          || models.find((mid: string) => !/image|embedding|moderation|audio|tts|whisper|auto-review/i.test(mid))
          || models[0];
        const saved = await window.codex.saveCustomModel({
          provider: resolved.provider,
          name: resolved.displayName,
          model: defaultModel,
          baseUrl: resolved.gateway,
          contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 256000,
          wireApi: "responses",
          apiKey: resolved.apiKey,
          // 模型参数同步内置规格表（userData/model-specs.json 优先）：上下文/最大输出/思考档位/视觉模态
          models: models.map((mid: string) => {
            const spec = matchModelSpec(mid);
            return {
              id: mid,
              contextWindow: spec?.contextWindow ?? 256000,
              maxOutputTokens: spec?.maxOutputTokens,
              efforts: spec?.efforts ?? ["low", "medium", "high"],
              inputTypes: spec?.inputTypes ?? (["text"] as ("text" | "image" | "video")[]),
              outputTypes: spec?.outputTypes ?? (["text"] as ("text" | "image" | "video")[]),
            };
          }),
          enabled: true,
        });
        const id = `custom:${saved.provider}:${saved.model}`;
        setModelId(id);
        localStorage.setItem("default-model", id);
        adoptSavedProvider(saved, models);
        // switchedAt 标记本次切换时刻：即便同网关不同账号复用同一 provider 字符串，
        // 也能让输入框余额徽标、模型配置等下游 UI 强制跟着刷新，避免「切换了但没反应」。
        const active: RelayActive = { ...resolved.active, switchedAt: Date.now() };
        setRelayActive(active);
        writeRelayActive(active);
        setNotice(`已切换：${resolved.displayName} · 模型 ${defaultModel}`);
        // 中转站一键切换已立即重启引擎生效：清掉可能残留的「待重启生效」banner
        setPendingRestart(null);
      } catch (error: any) {
        probeError = String(error?.message ?? error);
        // 部分站点（如 pptoken）要求 key 必须绑定分组：无分组 key 直接 403。自动改绑第一个订阅分组重试一次。
        if (!retried && resolved.active.groupId == null && /HTTP 40[13]|assigned to any group|分组/.test(probeError)) {
          const ov = await window.codex.relayOverview().catch(() => null);
          const subs: any[] = ov?.subscriptions ?? [];
          if (subs.length) {
            const fallback = { group_id: Number(subs[0].group_id), group_name: String(subs[0].group_name ?? "默认分组") };
            setNotice(`该站点要求密钥必须绑定分组，已自动改绑「${fallback.group_name}」重试…`);
            await relayActivate("plan", fallback, undefined, true);
            return;
          }
        }
        throw error;
      }
    } catch (error: any) {
      const message = "中转站切换失败：" + (error.message ?? error);
      setNotice(message);
      throw new Error(error.message ?? error);
    } finally {
      setRelayBusy(false);
    }
  }, [adoptSavedProvider, setNotice, setModelId]);
  // 启用 OpenAI 官方订阅：伪供应商 openai-official（引擎不写 model_provider，走 auth.json ChatGPT 凭据）
  const activateOfficialProvider = useCallback(async (modelsInput?: string[]) => {
    // 代理先落盘再触发引擎重启（顺序敏感：applyCustomModel 读文件注入引擎环境）
    await window.codex.openaiSetProxy(localStorage.getItem("openai-proxy") ?? "").catch(() => undefined);
    // 模型列表优先从官方接口拉真实的（跟随官方更新），失败才用静态兜底表
    const models = (modelsInput?.length ? modelsInput : await window.codex.openaiModels().catch(() => OFFICIAL_MODELS));
    const defaultModel = models[0];
    const saved = await window.codex.saveCustomModel({
      provider: "openai-official",
      name: "OpenAI 官方订阅",
      model: defaultModel,
      baseUrl: "https://chatgpt.com/backend-api/codex",
      contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 400_000,
      wireApi: "responses",
      models: models.map((mid: string) => {
        const spec = matchModelSpec(mid);
        return {
          id: mid,
          contextWindow: spec?.contextWindow ?? 400_000,
          maxOutputTokens: spec?.maxOutputTokens,
          efforts: spec?.efforts ?? ["low", "medium", "high"],
          inputTypes: spec?.inputTypes ?? (["text"] as ("text" | "image" | "video")[]),
          outputTypes: ["text"] as ("text" | "image" | "video")[],
        };
      }),
      enabled: true,
    });
    const id = `custom:${saved.provider}:${saved.model}`;
    setModelId(id);
    localStorage.setItem("default-model", id);
    adoptSavedProvider(saved, models);
    setNotice(`已启用 OpenAI 官方订阅 · 模型 ${defaultModel}`);
  }, [adoptSavedProvider, setNotice, setModelId]);
  // 外部模型规格（userData/model-specs.json）启动装载一次：数据与代码分离，更新模型数据无需重新构建
  useEffect(() => { void loadExternalSpecs(); }, []);
  // 启动时把 localStorage 里的 OpenAI 代理种子进主进程（引擎/官方接口要用），不依赖重新登录
  useEffect(() => {
    const proxy = localStorage.getItem("openai-proxy");
    if (proxy) void window.codex.openaiSetProxy(proxy).catch(() => undefined);
  }, []);
  // 兼容旧版本：本机已有安全保存的 API Key，但还没有登录状态标记时，自动进入主界面。
  // 明确点过“退出登录”会写 logout，不走这里。
  useEffect(() => {
    if (!customModel?.hasKey) return;
    const state = localStorage.getItem("login-skipped");
    if (state == null) {
      localStorage.setItem("login-skipped", "false");
      setShowLogin(false);
    }
  }, [customModel?.hasKey]);

  // 欢迎页副语：使用内置文案池（按时段随机），温暖不烧 token；AI 生成机制已移除
  // （曾经的隐藏线程方案会在会话列表残留「欢迎语指令」线程，且每天启动都烧一次模型调用）

  const {
    filePreview, setFilePreview, fileTabs, closeTab, fileEditing, setFileEditing,
    fileDraft, setFileDraft, savingFile, openFile: rawOpenFile, saveFilePreview,
  } = useFilePreview({ workspace, onNotice: setNotice });
  // 包装一层：用户每次点文件卡都顺手把项目树高亮打到对应条目上；
  // 若路径是相对/裸文件名，则尝试拼 workspace 变成绝对路径再读（引擎解析相对路径基准是 cwd，裸文件名会读不到）
  const openFile = useCallback((path: string) => {
    let resolved = path;
    const looksRelative = !/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("/") && !path.startsWith("~/");
    if (looksRelative && workspace) {
      const sep = workspace.includes("\\") ? "\\" : "/";
      resolved = `${workspace.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
    }
    setHighlightedFilePath(resolved);
    // 联动：自动切到项目树面板，展开文件所在目录（树形模式下父目录惰性加载+展开，不动 root）
    const dir = resolved.replace(/[\\/][^\\/]+$/, "");
    if (dir) {
      void fetchChildren(dir);
      setTreeExpanded((current) => { const next = new Set(current); next.add(dir); return next; });
    }
    setRightTab("tree");
    setRightOpen(true);
    return rawOpenFile(resolved);
  }, [rawOpenFile, workspace, treePath]);

  // 该模型声明支持的思考档位：优先读模型条目 efforts，缺省用 CUSTOM_MODEL_EFFORTS。
  // 与主进程 buildModelCatalog 同源（那边 filter 白名单也是这几个档位），保证 UI 选项 = 引擎真实支持。
  const customModelEfforts = useMemo(() => {
    const declared = (customModel?.models ?? []).find((m) => m.id === customModel?.model)?.efforts ?? [];
    const allowed = ALL_EFFORTS as readonly string[];
    const cleaned = declared.filter((effort): effort is string => allowed.includes(effort));
    return cleaned.length ? cleaned : [...CUSTOM_MODEL_EFFORTS];
  }, [customModel?.model, customModel?.models]);
  const customModelOption: Model | null = customModel ? {
    id: `custom:${customModel.provider}:${customModel.model}`,
    model: customModel.model,
    displayName: `${customModel.name} · ${customModel.model}`,
    description: customModel.baseUrl,
    supportedReasoningEfforts: customModelEfforts.map((reasoningEffort) => ({ reasoningEffort, description: effortLabels[reasoningEffort] ?? reasoningEffort })),
    defaultReasoningEffort: DEFAULT_EFFORT,
    supportsPersonality: true,
    isDefault: false,
  } : null;
  const allModels = useMemo(() => {
    // 下拉框展示「所有启用供应商」的模型（不再只显示当前生效供应商）：
    // - 生效供应商的模型排最前（保留用户已配置顺序）
    // - 其他启用供应商的模型跟在后面，用「供应商名 · 模型」区分
    // - 每个模型 id 形如 `custom:<provider>:<model>`，跨供应商切换走 chooseModel
    const out: Model[] = [];
    const seen = new Set<string>();
    const effortsOf = (providerModels: ProviderModelConfig[] | undefined, modelId: string): { reasoningEffort: string; description: string }[] => {
      const declared = (providerModels ?? []).find((m) => m.id === modelId)?.efforts ?? [];
      const allowed = ALL_EFFORTS as readonly string[];
      const cleaned = declared.filter((effort): effort is string => allowed.includes(effort));
      const list = cleaned.length ? cleaned : [...CUSTOM_MODEL_EFFORTS];
      return list.map((reasoningEffort) => ({ reasoningEffort, description: effortLabels[reasoningEffort] ?? reasoningEffort }));
    };
    const pushModels = (provider: string, providerName: string, providerModels: ProviderModelConfig[] | undefined, modelIds: (string | undefined)[], isActive: boolean) => {
      for (const model of modelIds) {
        if (!model || seen.has(model)) continue;
        seen.add(model);
        const modelMeta = (providerModels ?? []).find((m) => m.id === model);
        out.push({
          ...(customModelOption ?? { id: "", displayName: "", description: "", supportsPersonality: true, isDefault: false }),
          id: `custom:${provider}:${model}`,
          model,
          provider,
          providerName,
          isActive,
          displayName: isActive ? model : `${providerName} · ${model}`,
          description: providerName + (isActive ? "" : "（非当前供应商）"),
          supportedReasoningEfforts: effortsOf(providerModels, model),
          defaultReasoningEffort: customModelOption?.defaultReasoningEffort ?? DEFAULT_EFFORT,
          inputTypes: modelMeta?.inputTypes,
        });
      }
    };
    // 当前生效供应商：models 列表 + 生效 model（排最前）
    const activeProvider = customModel?.provider;
    const activeModels = [...new Set([...(customModel?.models ?? []).filter((m) => m.enabled !== false).map((m) => m.id), customModel?.model].filter(Boolean))] as string[];
    if (activeModels.length) pushModels(activeProvider ?? "custom", customModel?.name ?? "自定义供应商", customModel?.models, activeModels, true);
    // 其他启用供应商：providersList 里 enabled !== false 且 provider !== 当前
    for (const p of providersList) {
      if (p.provider === activeProvider) continue;
      if (p.enabled === false) continue;
      const models = [...new Set([...(p.models ?? []).filter((m) => m.enabled !== false).map((m) => m.id), p.model].filter(Boolean))] as string[];
      if (models.length) pushModels(p.provider, p.name, p.models, models, false);
    }
    // 没有已配置模型时回退到探测到的模型列表
    if (!out.length && providerModels?.length) {
      for (const model of [...new Set(providerModels)].slice(0, 20)) pushModels(customModel?.provider ?? "custom", customModel?.name ?? "自定义供应商", undefined, [model], true);
    }
    return out;
  }, [providerModels, customModel, customModelOption, providersList]);
  // 模型兜底：当前选择不在可用列表里时（如曾选中探测出来的无效模型），自动回落到
  // 已配置的默认模型，避免 turn/start 带上无效模型导致引擎不回复。
  useEffect(() => {
    if (!customModel?.model) return;
    if (allModels.some((entry) => entry.id === modelId || entry.model === modelId)) return;
    const fallback = `custom:${customModel.provider}:${customModel.model}`;
    setModelId(fallback);
    if (threadRef.current?.id) saveThreadModel(threadRef.current.id, fallback);
    else localStorage.setItem("default-model", fallback);
  }, [customModel, allModels, modelId]);
  // 供应商下已配置的模型清单：已保存的 models + 输入框里尚未保存的那个
  // probe 拉到的可用模型只属于探测时的那家供应商，换供应商后不再用于补全
  const modelSuggestions = modelSourceProvider === customDraft.provider ? (providerModels ?? []) : [];
  // —— 模型设置页（图一/图二排版）状态 ——
  const [modelEditor, setModelEditor] = useState<{ mode: "add" | "edit"; originalId: string | null; paramsDirty?: boolean; draft: { id: string; contextWindow: string; maxOutputTokens: string; inputTypes: ("text" | "image" | "video")[]; outputTypes: ("text" | "image" | "video")[]; efforts: string[] } } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const openModelEditor = (m?: { id: string; contextWindow?: number; maxOutputTokens?: number; inputTypes?: ("text" | "image" | "video")[]; outputTypes?: ("text" | "image" | "video")[]; efforts?: string[] }) => setModelEditor({
    mode: m ? "edit" : "add",
    originalId: m?.id ?? null,
    paramsDirty: false,
    draft: {
      id: m?.id ?? "",
      contextWindow: String(m?.contextWindow ?? (Number(customDraft.contextWindow) || 128000)),
      maxOutputTokens: m?.maxOutputTokens ? String(m.maxOutputTokens) : "",
      inputTypes: m?.inputTypes ?? ["text"],
      outputTypes: m?.outputTypes ?? ["text"],
      efforts: m?.efforts?.length ? m.efforts : [...ALL_EFFORTS],
    },
  });
  // 编辑器标题里显示的供应商名：编辑已存供应商时显示它的名字，防止同名模型改错供应商
  const targetProviderHint = modelEditor?.originalId && (customModel?.models ?? []).some((m) => m.id === modelEditor.originalId) && customModel?.provider !== customDraft.provider ? customModel?.name : "";
  const saveModelEditor = async () => {
    if (!modelEditor) return;
    const id = modelEditor.draft.id.trim();
    if (!id) { setNotice("模型 ID 不能为空"); return; }
    // 编辑「已保存供应商」的模型时（含输入框「更多」直达的编辑弹窗），editingProvider
    // 可能为空——此时按 originalId 归属回落到 customModel 的供应商，否则只进本地草稿、
    // 永远不持久化（表现：勾了最高保存后，思考菜单里不出现该档位，2026-09-04 反馈）。
    const targetProvider = editingProvider ?? ((modelEditor.originalId && (customModel?.models ?? []).some((m) => m.id === modelEditor.originalId)) ? customModel!.provider : null);
    if (modelEditor.mode === "edit" && modelEditor.originalId && modelEditor.originalId !== id) await removeProviderModel(targetProvider ?? customDraft.provider, modelEditor.originalId);
    if (targetProvider) {
      await upsertProviderModel(targetProvider, {
        id,
        contextWindow: Number(modelEditor.draft.contextWindow) || undefined,
        maxOutputTokens: Number(modelEditor.draft.maxOutputTokens) || undefined,
        inputTypes: modelEditor.draft.inputTypes,
        outputTypes: modelEditor.draft.outputTypes,
        efforts: modelEditor.draft.efforts.length ? modelEditor.draft.efforts : undefined,
      });
      setModelEditor(null);
      return;
    }
    // 新供应商还没保存：合并出完整草稿直接持久化——一次保存即生效，不再要求外层再点一次保存
    const model: ProviderModelConfig = {
      id,
      enabled: true,
      contextWindow: Number(modelEditor.draft.contextWindow) || undefined,
      maxOutputTokens: Number(modelEditor.draft.maxOutputTokens) || undefined,
      inputTypes: modelEditor.draft.inputTypes,
      outputTypes: modelEditor.draft.outputTypes,
      efforts: modelEditor.draft.efforts.length ? modelEditor.draft.efforts : undefined,
    };
    const mergedDraft = { ...customDraft, models: [...(customDraft.models ?? []).filter((m) => m.id !== modelEditor.originalId), model] };
    setCustomDraft(mergedDraft);
    setModelEditor(null);
    void saveCustomDraft(mergedDraft);
  };
  const selectedModel = allModels.find((entry) => entry.id === modelId || entry.model === modelId);
  const usingCustomModel = Boolean(customModel && modelId);
  // 官方订阅：thread/start 什么都不传（无 modelProvider、无内联 config）——
  // 引擎走内置 openai 通道 + auth.json ChatGPT 登录凭据，与实测通过的协议复现完全一致；
  // 任何内联 provider 定义（哪怕 requires_openai_auth=true）都会触发 CODEX_HARNESS_API_KEY 校验导致报错（实证）。
  const providerConfig = useMemo(() => usingCustomModel && customModel && customModel.provider !== "openai-official" ? {
    modelProvider: customModel.provider,
    config: {
      model_provider: customModel.provider,
      model_providers: {
        [customModel.provider]: {
          name: customModel.name,
          base_url: customModel.baseUrl,
          env_key: "CODEX_HARNESS_API_KEY",
          wire_api: "responses" as const,
          requires_openai_auth: false,
        },
      },
    },
  } : {}, [usingCustomModel, customModel]);
  const listThreads = useMemo(() => projectFilter ? threads.filter((entry) => entry.cwd === projectFilter) : threads, [threads, projectFilter]);
  // 侧边栏视图模式：分组（按时间） vs 项目（按 cwd）；与 WorkBuddy 项目列表对齐
  const [viewTab, setViewTab] = useState<"groups" | "projects">(() => (localStorage.getItem("sidebar-view-tab-v1") === "projects" ? "projects" : "groups"));
  useEffect(() => { try { localStorage.setItem("sidebar-view-tab-v1", viewTab); } catch { /* ignore */ } }, [viewTab]);
  // 项目展开状态：每个 cwd 独立控制；Set 表示已展开
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar-projects-expanded-v1") || "[]") as string[]); } catch { return new Set<string>(); }
  });
  const toggleProjectExpanded = useCallback((cwd: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // 项目右键菜单
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  // 会话置顶：纯前端偏好（引擎无 pin API），用 localStorage 存 id 列表。
  // 置顶的会话在侧栏固定排在最前（置顶组内仍按时间倒序），unpin 后回到原时间序。
  const [pinnedThreads, setPinnedThreads] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinned-threads") ?? "[]") as string[]; } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("pinned-threads", JSON.stringify(pinnedThreads)); } catch { /* ignore */ }
  }, [pinnedThreads]);
  function togglePinThread(id: string) {
    setPinnedThreads((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }
  const projectGroups = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const entry of listThreads) map.set(entry.cwd, [...(map.get(entry.cwd) ?? []), entry]);
    return [...map.entries()].sort((a, b) => Math.max(...b[1].map((entry) => entry.updatedAt)) - Math.max(...a[1].map((entry) => entry.updatedAt)));
  }, [listThreads]);
  const allProjectsCollapsed = projectGroups.length > 0 && projectGroups.every(([cwd]) => !expandedProjects.has(cwd));
  const toggleAllProjects = useCallback(() => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      const expand = projectGroups.every(([cwd]) => !next.has(cwd));
      for (const [cwd] of projectGroups) {
        if (expand) next.add(cwd);
        else next.delete(cwd);
      }
      try { localStorage.setItem("sidebar-projects-expanded-v1", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [projectGroups]);
  const groupedThreads = useMemo(() => {
    const groups = groupThreadsByTime(listThreads);
    const pinned = listThreads.filter((entry) => pinnedThreads.includes(entry.id));
    if (!pinned.length) return groups;
    // 置顶组固定排最前：仅保留未归档里的置顶项，组内按时间倒序
    return [{ key: "pinned", label: "置顶", items: pinned.sort((a, b) => b.updatedAt - a.updatedAt) }, ...groups.filter((g) => g.key !== "pinned")];
  }, [listThreads, pinnedThreads]);
  const allGroupsCollapsed = groupedThreads.length > 0 && groupedThreads.every((group) => collapsedSections.has(group.key));
  const toggleAllGroups = useCallback(() => {
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      const collapse = !groupedThreads.every((group) => next.has(group.key));
      for (const group of groupedThreads) {
        if (collapse) next.add(group.key);
        else next.delete(group.key);
      }
      try { localStorage.setItem("sidebar-sections-collapsed", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [groupedThreads]);
  const sidebarAllCollapsed = viewTab === "groups" ? allGroupsCollapsed : allProjectsCollapsed;
  const toggleAllSidebarSections = viewTab === "groups" ? toggleAllGroups : toggleAllProjects;
  // 「清空当前视图」批量删除按钮已下架（2026-09-04 反馈：侧栏顶部太容易误触）。
  // purgeCurrentTab / currentTabIds 一并移除；批量删除能力保留在单条任务右键/菜单里。
/** 长会话首屏最多渲染的回合数：软件渲染下全量挂载几千个回合是「切会话慢」的主因，
 *  默认只渲染最近这么多回合，更早的由「显示更早的 N 条消息」按需展开。 */
const TURN_WINDOW = 40;
/** 常用命令置顶顺序（用户高频：模型/思考/计划/目标/压缩优先） */
const COMMON_COMMAND_ORDER = ["plan", "goal", "model", "effort", "compact", "new", "resume", "review", "status", "help"];
const commandMatches = useMemo(() => {
    if (!prompt.startsWith("/") || prompt.includes(" ")) return [];
    const query = prompt.slice(1).toLowerCase();
    const matches = slashCommands.filter(([name, description]) => name.includes(query) || description.includes(query));
    // 排序：① 前缀命中排前（打 /p 时 plan 置顶）；② 同级按常用度（COMMON_COMMAND_ORDER）；③ 其余按目录序
    const commonRank = (name: string) => { const i = COMMON_COMMAND_ORDER.indexOf(name); return i === -1 ? COMMON_COMMAND_ORDER.length : i; };
    return matches.sort((a, b) =>
      Number(b[0].startsWith(query)) - Number(a[0].startsWith(query))
      || commonRank(a[0]) - commonRank(b[0]));
  }, [prompt]);
  /** 技能目录（本地 + 引擎，规范化去重）：技能子面板与输入框「#」技能面板共用同一份数据源，
   *  避免两处各自去重导致同一技能在一处显示、另一处重复。每条都带一句中文注释。 */
  const mergedSkillCatalog = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; description: string; note: string; path: string }[] = [];
    const push = (entry: { name: string; description?: string; descriptionZh?: string; path?: string; category?: string }) => {
      const key = normSkillName(entry.name);
      if (!key || seen.has(key)) return; // 同名（含插件限定名）只保留第一条（本地优先）
      seen.add(key);
      out.push({ name: shortSkillName(entry.name), description: entry.description ?? "", note: skillZhNote(entry), path: entry.path ?? "" });
    };
    for (const entry of localSkills) push(entry);
    for (const entry of settingsResources.skills) push(entry);
    return out;
  }, [localSkills, settingsResources.skills]);
  /** 输入框「#」技能面板：与「/」命令面板同款触发条件（以 # 开头且未输入空格）与同款展示效果
   *  （#技能名 + 中文注释），让技能可以直接在输入流里被看见和引用。 */
  const skillCommandMatches = useMemo(
    () => (prompt.startsWith("#") && !prompt.includes(" ") ? matchSkillCatalog(mergedSkillCatalog, prompt.slice(1)) : []),
    [prompt, mergedSkillCatalog],
  );
  const availableContextItems = useMemo(() => {
    if (!thread) return [];
    const query = contextQuery.trim().toLowerCase();
    const entries = thread.turns.flatMap((turn) => turn.items
      .filter((item) => item.type === "userMessage" || item.type === "agentMessage")
      .map((item) => ({ id: item.id, role: item.type === "userMessage" ? "用户" as const : "Codex" as const, text: (item.type === "userMessage" ? userDisplayText(itemText(item)) : itemText(item).trim()) }))
      .filter((item) => item.text));
    return entries.filter((item) => !contextItems.some((selected) => selected.id === item.id))
      .filter((item) => !query || item.text.toLowerCase().includes(query))
      .slice(-16).reverse();
  }, [thread, contextItems, contextQuery]);

  // 「引用对话中的文件」候选：当前会话所有消息里出现过的文件/图片路径（附件段、localImage、文本中的绝对路径）
  const threadFileCandidates = useMemo(() => {
    if (!thread) return [];
    const found: { path: string; source: string }[] = [];
    const push = (path: string, source: string) => {
      const trimmed = path.trim();
      if (!trimmed || /^[a-z]+:\/\//i.test(trimmed) && !/^[a-zA-Z]:\\/.test(trimmed)) return; // 跳过 http(s)/data URL，保留盘符路径
      if (!/[\\/]/.test(trimmed) && !isImagePath(trimmed)) return; // 无路径分隔符的非图片（误抓词）跳过
      found.push({ path: trimmed, source });
    };
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === "localImage" || item.type === "local_image") push(item.path, "图片附件");
        if (item.type === "userMessage") {
          const text = itemText(item);
          for (const m of text.matchAll(/(?:\[附件文件\][\s\S]*?\[附件结束\])|(?:[A-Za-z]:\\[^\s"'\u3001\u3002，。；）]+)|(?:\/(?:Users|home|mnt|opt|var|tmp)\/[^\s"'\u3001\u3002，。；）]+)/g)) {
            const seg = m[0];
            if (seg.startsWith("[附件文件]")) {
              for (const line of seg.split("\n")) {
                const p = line.replace(/^-\s*/, "").trim();
                if (p && !p.startsWith("[")) push(p, "附件");
              }
            } else push(seg, "消息中提及");
          }
          for (const part of (item.content ?? []) as any[]) {
            if (isImagePart(part) && part.path) push(part.path, "图片附件");
          }
        }
      }
    }
    return found.reverse(); // 最新的在前
  }, [thread]);

  function addSystemEvent(title: string, text: string, tone: SystemEvent["tone"] = "info") {
    setSystemEvents((current) => [...current, { id: crypto.randomUUID(), title, text, tone }]);
  }

  function setCompactEventState(state: "running" | "success" | "error", detail?: string) {
    const content = state === "running"
      ? { message: "正在压缩上下文" }
      : state === "success"
        ? { message: "上下文压缩成功" }
        : { message: detail ? `上下文压缩失败：${detail}` : "上下文压缩失败" };
    const threadId = Array.from(compactPendingRef.current)[0] ?? threadRef.current?.id ?? "";
    setCompactToast({ state, message: content.message, threadId });
  }

  /** 压缩分隔线只保留最新一条：新一轮压缩开始/完成时，把时间线里更早的 contextCompaction
   *  项从渲染状态中移除（只改本地渲染副本，不动引擎 rollout）。旧「成功」分隔线一直挂着，
   *  新压缩一开始就上下两条叠在一起，被当成多余展示（用户实测）。 */
  function pruneSupersededCompactions(keepId: string) {
    if (!keepId) return;
    setThread((current) => {
      if (!current) return current;
      let changed = false;
      const turns = current.turns.map((turn) => {
        const before = (turn.items ?? []).length;
        const items = (turn.items ?? []).filter((item) => item.type !== "contextCompaction" || String(item.id) === keepId);
        if (items.length !== before) { changed = true; return { ...turn, items }; }
        return turn;
      });
      if (!changed) return current;
      const next = { ...current, turns };
      threadRef.current = next;
      threadCacheRef.current.set(current.id, next);
      return next;
    });
  }

  // 压缩分隔线：success/error 常驻（用户可手动 × 关闭），running 300s 没收到完成事件才标记失败。
  // 90s 的旧超时会把大上下文的真实模型压缩（几分钟很常见）误判成失败——已实测踩坑。
  useEffect(() => {
    if (!compactToast) return;
    if (compactToast.state === "running") {
      // running 兜底超时：引擎吞请求 / 不发完成事件时不会一直卡住
      const timer = window.setTimeout(() => {
        setCompactToast((current) => current?.state === "running" ? { state: "error", message: "上下文压缩失败：压缩耗时超过 5 分钟仍未返回，可稍后重试 /compact", threadId: current.threadId } : current);
      }, 300000);
      return () => window.clearTimeout(timer);
    }
  }, [compactToast]);

  /** 一次性状态通知：使用现有 toast，不写入对话历史。 */
  function showToast(title: string, text?: unknown) {
    const detail = String(text ?? "").replace(/\s+/g, " ").trim();
    setNotice(detail ? `${title}：${detail.slice(0, 220)}` : title);
  }

  /** /context 与 /status 共用：估算当前线程上下文占用（本地用法统计 + 回合 usage） */
  function contextUsageText() {
    const windowTokens = Number(customModel?.contextWindow) || 0;
    const agentItems = thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "agentMessage") ?? [];
    const userItems = thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "userMessage") ?? [];
    const agentChars = agentItems.reduce((sum, item) => sum + (itemText(item) ?? "").length, 0);
    const userChars = userItems.reduce((sum, item) => sum + (itemText(item) ?? "").length, 0);
    const estimated = Math.round((agentChars + userChars) / 3.2); // 中文按 ~3.2 字符/token 估算
    const latestTurn = thread?.turns.at(-1);
    const reported = typeof latestTurn?.usage?.contextTokens === "number" ? latestTurn.usage.contextTokens : typeof latestTurn?.usage?.input_tokens === "number" ? latestTurn.usage.input_tokens : null;
    const total = Math.max(estimated, reported ?? 0);
    const pct = windowTokens ? Math.min(100, Math.round((total / windowTokens) * 100)) : null;
    const stats = readUsageStats();
    const line = windowTokens ? `窗口上限：${formatTokens(windowTokens)} tokens` : "窗口上限：未知";
    const used = `估算占用：${formatTokens(total)} tokens${pct != null ? `（${pct}%）` : ""}`;
    const life = `本地累计：${formatTokens(stats.inputTokens + stats.outputTokens)} tokens · ${stats.turns} 回合`;
    const turn = `当前线程：${thread?.turns.length ?? 0} 回合 · ${agentItems.length} 条回复 · 约 ${formatTokens(estimated)} tokens`;
    const tip = pct != null && pct > 80 ? "⚠️ 上下文接近上限，建议 /compact 压缩或 /new 开新任务。" : "建议上下文占用超过 80% 时执行 /compact 或开启新任务。";
    return [line, used, life, turn, tip].join("\n");
  }

  // Hook 注入反馈：静默记录到回合徽标（不产生系统卡），最新回复 footer 末尾展示小钩子图标
  function addHookEvent(running: boolean, hookName: string) {
    setHookPulse((current) => ({
      count: running ? current.count + 1 : current.count,
      hooks: current.hooks.some((entry) => entry.name === hookName)
        ? current.hooks.map((entry) => entry.name === hookName ? { name: hookName, done: !running } : entry)
        : [...current.hooks, { name: hookName, done: !running }],
      at: Date.now(),
    }));
  }

  useEffect(() => { threadRef.current = thread; }, [thread]);
  // 自定义命令展开后的待发送文本：runSlashCommand 命中 .md 模板后放入，send() 直接消费
  const pendingCommandTextRef = useRef<string | null>(null);
  // 回到底部按钮：内容可滚动且当前视口距底部超过一屏的 25% 时出现
  // 缓存 update，供「内容变化」时直接调用而不必重建监听器
  const updateBottomStateRef = useRef<() => void>(() => {});
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      const dist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setAwayFromBottom(dist > scroller.clientHeight * 0.25);
      // 向上滚动立即解除跟随（不等 25% 迟滞阈值）：wheel 只覆盖滚轮/触摸板，
      // 拖滚动条、键盘 PageUp/方向键只产生 scroll 事件——靠"scrollTop 变小"识别向上。
      // 没有这条，流式期间用户在迟滞区（4px~25% 视口）内往上拖会被下一帧拉回底部，
      // 即"往上看回答会自动下滑直到回答给完"。
      if (scroller.scrollTop < lastTop - 2 && dist > 4) stickToBottomRef.current = false;
      // 迟滞：距底 ≤4px 重新开启跟随；>25% 视口才关闭。中间地带保持原状，
      // 避免流式内容增高时 stick 反复翻转（此前 smooth 滚动动画的中间滚动事件
      // 会误关跟随，导致"消息发了不显示、停止后才出现"）。
      if (dist <= 4) stickToBottomRef.current = true;
      else if (dist > scroller.clientHeight * 0.25) stickToBottomRef.current = false;
      lastTop = scroller.scrollTop;
    };
    // 向上滚轮 = 用户主动浏览，立即停止底部跟随（不等 25% 阈值，防止跟流式滚动打架）。
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stickToBottomRef.current = false;
    };
    updateBottomStateRef.current = update;
    // rAF 节流：scroll 事件密集时 update 会读 scrollHeight/scrollTop 强制同步布局
    let raf = 0;
    let lastTop = scroller.scrollTop; // 供 update 识别"向上滚动"（拖滚动条/键盘）
    const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; update(); }); };
    update();
    // 绑定只跟会话走：若依赖 thread，流式出字每帧都会销毁重建 ResizeObserver + 监听器，
    // 长回复下纯粹是白烧帧预算。内容变化走下方独立的 effect 调用 update。
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true });
    const onPacketReveal = () => requestAnimationFrame(() => {
      update();
      if (stickToBottomRef.current) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    });
    window.addEventListener("codex:packet-reveal", onPacketReveal);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("wheel", onWheel);
      window.removeEventListener("codex:packet-reveal", onPacketReveal);
    };
  }, [thread?.id, scrollRef]);
  // 流式出字时 scrollHeight 在涨，但既不触发 resize 也不触发 scroll，
  // 必须主动刷一次，否则「回到底部」按钮的出现时机是错的。
  useEffect(() => { updateBottomStateRef.current(); }, [thread]);
  // 流式跟随：thread 变化（agent 追加/更新 item）时，若用户仍在底部则滚到底。
  // 必须用 behavior:"auto"：CSS 里 .timeline 是 scroll-behavior:smooth，
  // 直接赋 scrollTop 会走平滑动画，动画中途的滚动事件会误判"用户离开底部"。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 刚切换会话：瞬时定位到最新消息并开启跟随（用户预期：切过去就在最新消息）。
    // 必须瞬时：.timeline 的 CSS scroll-behavior:smooth 会让 scrollTo 走平滑动画，
    // 表现为"从上往下滚动"，且动画目标基于发起时的 scrollHeight，内容随后增高会停在半路。
    // 这里消费后立即重置，之后的流式更新走常规 stick 跟随（smooth 跟手）。
    if (switchJumpRef.current) {
      switchJumpRef.current = false;
      stickToBottomRef.current = true;
      jumpToBottom(el);
      return;
    }
    if (!stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [thread]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    // 同步窗口外观：深色模式下标题栏 overlay 与背景跟随主题（不再残留浅色外框）
    void window.codex.themeApply(theme).catch(() => undefined);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("right-panel-open", String(rightOpen));
  }, [rightOpen]);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [chatSearchHistoryOpen, setChatSearchHistoryOpen] = useState(false);
  const [chatSearchHistory, setChatSearchHistory] = useState<string[]>(() => {
    try { const raw = localStorage.getItem("chat-search-history"); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
  });
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const chatSearchHistoryRef = useRef<HTMLDivElement>(null);
  const chatSearchResults = useMemo(() => {
    if (!chatSearchOpen || !chatSearchQuery.trim()) return [] as { turnId: string; itemId: string; type: string; text: string }[];
    const q = chatSearchQuery.trim().toLowerCase();
    return collectMessageTexts(thread).filter((m) => m.text.toLowerCase().includes(q));
  }, [chatSearchOpen, chatSearchQuery, thread]);
  // 搜索结果消息高亮打标（DOM 级，随结果/当前项变化重打）
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.querySelectorAll<HTMLElement>(".msg-search-hit, .msg-search-hit-current").forEach((n) => n.classList.remove("msg-search-hit", "msg-search-hit-current"));
    if (!scroller || !chatSearchOpen || !chatSearchResults.length) return;
    if (chatSearchIndex >= chatSearchResults.length) setChatSearchIndex(0);
    chatSearchResults.forEach((m, i) => {
      const el = locateMatchEl(scroller, m);
      if (!el) return;
      if (i === chatSearchIndex) { el.classList.add("msg-search-hit", "msg-search-hit-current"); }
      else { el.classList.add("msg-search-hit"); }
    });
  }, [chatSearchOpen, chatSearchResults, chatSearchIndex, thread]);
  const chatSearchGo = useCallback((dir: 1 | -1) => {
    const scroller = scrollRef.current;
    if (!scroller || !chatSearchResults.length) return;
    const next = (chatSearchIndex + dir + chatSearchResults.length) % chatSearchResults.length;
    setChatSearchIndex(next);
    locateMatchEl(scroller, chatSearchResults[next])?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [chatSearchResults, chatSearchIndex]);
  const pushChatSearchHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setChatSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((entry) => entry !== trimmed)].slice(0, 10);
      try { localStorage.setItem("chat-search-history", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const removeChatSearchHistory = useCallback((entry: string) => {
    setChatSearchHistory((prev) => {
      const next = prev.filter((item) => item !== entry);
      try { localStorage.setItem("chat-search-history", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const clearChatSearchHistory = useCallback(() => {
    setChatSearchHistory([]);
    try { localStorage.removeItem("chat-search-history"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void window.codex.getUsername().then(setUsername).catch(() => undefined); }, []);
  useEffect(() => {
    openImageLightbox = (path: string, alt: string) => setLightbox({ path, alt });
    return () => { openImageLightbox = null; };
  }, []);
  useEffect(() => {
    // 让模块级组件（InlineFileCards 缩略图等）能解析相对/裸路径 → 绝对路径
    resolveFilePath = (path: string) => {
      if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("~/") || path.startsWith("http")) return path;
      if (!workspace) return path;
      const sep = workspace.includes("\\") ? "\\" : "/";
      return `${workspace.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
    };
    return () => { resolveFilePath = null; };
  }, [workspace]);
  // 会话路径台账缓存：thread 引用不变就复用，变化才重建（裸文件名 → 会话中出现过的绝对路径）
  const knownFilesRef = useRef<{ src: typeof thread | null; map: Map<string, string> }>({ src: null, map: new Map() });
  useEffect(() => {
    lookupKnownFile = (name: string) => {
      const key = name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
      if (!key) return null;
      if (knownFilesRef.current.src !== thread) {
        const map = new Map<string, string>();
        collectKnownPaths(thread, map);
        knownFilesRef.current = { src: thread, map };
      }
      return knownFilesRef.current.map.get(key) ?? null;
    };
    notifyFileMissing = (message: string) => showToast("未找到文件", message);
    return () => { lookupKnownFile = null; notifyFileMissing = null; };
  });
  useEffect(() => { void window.codex.getUserData().then(setUserDataPath).catch(() => undefined); }, []);
  useEffect(() => { if (activeBotId && botChannelPick) void window.codex.remoteQrcode(activeBotId).then((svg) => setBotQr(svg)).catch(() => undefined); else setBotQr(""); }, [activeBotId, botChannelPick]);
  useEffect(() => { if (localStorage.getItem("keep-awake") === "true") void window.codex.setAwake(true); }, []);
  useEffect(() => {
    // 手机设备上线：自动新建一个会话窗（新任务）
    const offDevice = window.codex.onRemoteDevice((device) => {
      startNewThread();
      setRemoteDevices((current) => current.some((d) => d.id === device.id) ? current : [...current, { id: device.id, name: device.name, connectedAt: Date.now() }]);
      showToast("远程设备已连接", `${device.name} 已接入`);
    });
    // 手机指令：写入输入框并自动发送到当前会话（斜杠指令直接执行）
    const offCommand = window.codex.onRemoteCommand(({ command }) => {
      const text = String(command ?? "").trim();
      if (!text) return;
      if (text.startsWith("/")) { void runSlashCommand(text); return; }
      setPrompt(text);
      setTimeout(() => { (document.querySelector("form.composer") as HTMLFormElement | null)?.requestSubmit(); }, 120);
    });
    return () => { offDevice(); offCommand(); };
  }, []);
  useEffect(() => {
    if (showLogin) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        if (key === "f") { event.preventDefault(); setChatSearchOpen(true); queueMicrotask(() => chatSearchRef.current?.focus()); }
        else if (key === "n") { event.preventDefault(); startNewThread(); }
        else if (key === "p") { event.preventDefault(); setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }
        else if (key === "s") { event.preventDefault(); setSettingsPage("general"); setSettingsOpen(true); }
        else if (key === "/") { event.preventDefault(); composerInputRef.current?.focus(); }
        return;
      }
      if (key === "n") { event.preventDefault(); startNewThread(); }
      else if (key === "k") { event.preventDefault(); setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }
      else if (key === "o") { event.preventDefault(); void chooseWorkspace(); }
      else if (key === "b") { event.preventDefault(); setRightOpen((current) => !current); }
      else if (key === "j") { event.preventDefault(); setRightOpen(true); openPanelTab("terminal", workspace ? basename(workspace) : "终端"); }
      else if (key === ",") { event.preventDefault(); setSettingsPage("general"); setSettingsOpen(true); }
      else if (key === "l") { event.preventDefault(); composerInputRef.current?.focus(); }
      else if (key === "p") { event.preventDefault(); setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLogin]);
  // 全局 ESC：从最上层弹窗开始关闭；焦点在输入控件里时先退出焦点，再按同一栈关弹窗
  // （否则问答卡/输入弹窗聚焦时按 ESC 会被这里吞掉，转而关掉底下的设置弹窗）。
  useEffect(() => {
    if (showLogin) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag))) {
        if (target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio" && target.type !== "button") target.blur();
      }
      const closers: Array<() => boolean> = [
        () => { if (skillInstall && (skillInstall.failed || skillInstall.current >= 7)) { setSkillInstall(null); return true; } return false; },
        () => { if (skillRemove && (skillRemove.failed || skillRemove.current > 5)) { setSkillRemove(null); return true; } return false; },
        () => { if (agentAsk) { agentAsk.resolve(""); setAgentAsk(null); return true; } return false; },
        () => { if (appConfirm) { appConfirm.resolve(false); setAppConfirm(null); return true; } return false; },
        () => { if (appPrompt) { appPrompt.resolve(null); setAppPrompt(null); return true; } return false; },
        () => { if (searchPreview) { setSearchPreview(null); return true; } return false; },
        () => { if (memoryPreview) { setMemoryPreview(null); return true; } return false; },
        () => { if (filePreview) { setFilePreview(null); return true; } return false; },
        () => { if (lightbox) { setLightbox(null); return true; } return false; },
        () => { if (modelEditor) { setModelEditor(null); return true; } return false; },
        () => { if (connectorEditorOpen) { setConnectorEditorOpen(false); return true; } return false; },
        () => { if (connectorTemplateModal) { setConnectorTemplateModal(null); return true; } return false; },
        () => { if (commandEditor) { setCommandEditor(null); return true; } return false; },
        () => { if (subAgentEditorOpen) { setSubAgentEditorOpen(false); return true; } return false; },
        () => { if (expertTeamEditorOpen) { setExpertTeamEditorOpen(false); return true; } return false; },
        () => { if (goalsOpen) { setGoalsOpen(false); return true; } return false; },
        () => { if (memoryConfigOpen) { setMemoryConfigOpen(false); return true; } return false; },
        () => { if (memoryCenterOpen) { setMemoryCenterOpen(false); return true; } return false; },
        () => { if (infoModal) { setInfoModal(null); return true; } return false; },
        () => { if (autoFormVisible) { setAutoFormVisible(false); return true; } return false; },
        () => { if (reviewReport) { setReviewReport(""); return true; } return false; },
        () => { if (settingsOpen) { setSettingsOpen(false); return true; } return false; },
        () => { if (shortcutsOpen) { setShortcutsOpen(false); return true; } return false; },
        () => { if (paletteOpen) { setPaletteOpen(false); return true; } return false; },
        () => { if (skillMenuOpen) { setSkillMenuOpen(false); return true; } return false; },
        () => { if (connectorMenuOpen) { setConnectorMenuOpen(false); return true; } return false; },
        () => { if (attachmentMenuOpen) { setAttachmentMenuOpen(false); return true; } return false; },
        () => { if (contextOpen) { setContextOpen(false); return true; } return false; },
        () => { if (switcherOpen) { setSwitcherOpen(false); return true; } return false; },
        () => { if (mobileNav) { setMobileNav(false); return true; } return false; },
        () => { if (chatSearchOpen) { setChatSearchOpen(false); return true; } return false; },
        () => { if (browserMenuOpen) { setBrowserMenuOpen(false); return true; } return false; },
        () => { if (sidebarFlyout) { setSidebarFlyout(false); return true; } return false; },
        () => { if (taskMenuOpen) { setTaskMenuOpen(false); return true; } return false; },
        () => { if (botManagerOpen) { setBotManagerOpen(false); return true; } return false; },
        () => { if (mobileRemoteOpen) { setMobileRemoteOpen(false); return true; } return false; },
        () => { if (ctxMenuOpen) { setCtxMenuOpen(false); return true; } return false; },
        () => { if (accountMenuOpen) { setAccountMenuOpen(false); return true; } return false; },
      ];
      for (const close of closers) if (close()) { event.preventDefault(); return; }
      if (rightOpen) { setRightOpen(false); event.preventDefault(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLogin, skillInstall, skillRemove, agentAsk, appConfirm, appPrompt, memoryPreview, searchPreview, filePreview, lightbox, modelEditor, connectorEditorOpen, connectorTemplateModal, commandEditor, subAgentEditorOpen, expertTeamEditorOpen, goalsOpen, memoryCenterOpen, memoryConfigOpen, infoModal, reviewReport, settingsOpen, shortcutsOpen, paletteOpen, skillMenuOpen, connectorMenuOpen, attachmentMenuOpen, contextOpen, switcherOpen, mobileNav, sidebarFlyout, autoFormVisible, taskMenuOpen, botManagerOpen, mobileRemoteOpen, ctxMenuOpen, accountMenuOpen, rightOpen]);
  useEffect(() => {
    if (workStartedAt == null) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [workStartedAt]);

  async function refreshThreads() {
    // 主侧栏只展示未归档会话；归档记录由「设置 → 归档管理」单独查看、恢复或删除。
    const result = await window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false });
    setThreads(result.data ?? []);
  }

  // 后台会话（渠道机器人/手机端等在主进程创建的线程）不进当前会话事件流，
  // 侧栏列表无从感知其出现与更新 → turn/started|completed 时防抖刷新一次。
  const sidebarRefreshTimerRef = useRef<number | null>(null);
  function scheduleSidebarRefresh() {
    if (sidebarRefreshTimerRef.current != null) return;
    sidebarRefreshTimerRef.current = window.setTimeout(() => { sidebarRefreshTimerRef.current = null; void refreshThreads(); }, 600);
  }

  async function refreshQueue(threadId: string) {
    try {
      const result = await window.codex.request("thread/queue/list", { threadId, limit: 100 });
      if (threadRef.current?.id === threadId) setQueue(result.data ?? []);
    } catch { /* 空会话/无 rollout 的线程没有消息队列，静默跳过 */ }
  }

  /** 惰性加载某目录子项进缓存（不改变树 root 与当前视图） */
  async function fetchChildren(path: string) {
    if (!path) return;
    if (treeChildren[path]) return;
    try {
      const result = await window.codex.request("fs/readDirectory", { path });
      const entries = (result.entries ?? []).sort((a: TreeEntry, b: TreeEntry) => Number(b.isDirectory) - Number(a.isDirectory) || a.fileName.localeCompare(b.fileName));
      setTreeChildren((current) => ({ ...current, [path]: entries }));
    } catch (error: any) {
      setTreeChildren((current) => ({ ...current, [path]: [] }));
      setNotice(`读取项目树失败：${error.message}`);
    }
  }
  /** 展开/收起目录（首次展开时惰性加载子项） */
  function toggleTreeDir(dir: string) {
    setTreeExpanded((current) => {
      const next = new Set(current);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
    void fetchChildren(dir);
  }
  /** 切换树的根目录（root 层；兼容 tree-location 显示与文件搜索） */
  async function loadTree(path: string) {
    if (!path) return;
    setTreeLoading(true);
    try {
      const result = await window.codex.request("fs/readDirectory", { path });
      const entries = (result.entries ?? []).sort((a: TreeEntry, b: TreeEntry) => Number(b.isDirectory) - Number(a.isDirectory) || a.fileName.localeCompare(b.fileName));
      setTreePath(path);
      setTreeEntries(entries);
      setTreeChildren((current) => ({ ...current, [path]: entries }));
    } catch (error: any) {
      setNotice(`读取项目树失败：${error.message}`);
    } finally {
      setTreeLoading(false);
    }
  }
  function describeCloakEvent(event: { event?: string; message?: string; url?: string; title?: string }) {
    switch (event.event) {
      case "boot": return "助手进程已启动，等待首次打开";
      case "launching": return "指纹浏览器启动中…（首次会下载/加载内核，稍慢）";
      case "ready": return "CloakBrowser 已就绪";
      case "opened": return `已打开：${event.title ? `${event.title} — ` : ""}${event.url ?? ""}`;
      case "nav-error": return `页面导航失败：${event.message}`;
      case "error": return `错误：${event.message}`;
      case "closed": return "指纹浏览器窗口已关闭";
      case "exit": return "助手进程已退出";
      default: return "";
    }
  }

  async function openInCloak(url: string) {
    setCloakPage(url);
    setCloakStatus("正在提交给 CloakBrowser…");
    try {
      const result = await window.codex.openInCloakBrowser(url);
      if (!result.ok) {
        setNotice(`CloakBrowser 打开失败：${result.detail}（可切换回内置视图）`);
        setCloakStatus(`提交失败：${result.detail}`);
        return;
      }
      setCloakStatus("已提交，等待窗口响应…");
    } catch (error: any) {
      setNotice(`CloakBrowser 打开失败：${error.message}`);
      setCloakStatus(`提交失败：${error.message}`);
      return;
    }
    window.setTimeout(() => {
      void window.codex.cloakBrowserStatus().then((status) => {
        const text = describeCloakEvent(status);
        if (text) setCloakStatus(text);
      });
    }, 5000);
  }

  function openBrowser() {
    const raw = browserDraft.trim();
    if (!raw) return;
    // 地址栏通行做法：裸域名自动补 https://，含空格/明显不是网址的输入走搜索引擎
    const searchEngine = localStorage.getItem("browser-search-engine") || "https://www.bing.com/search?q=";
    const looksLikeUrl = /^https?:\/\//i.test(raw)
      ? true
      : !/\s/.test(raw) && (/^localhost(:\d+)?(\/\S*)?$/i.test(raw) || /^[a-z0-9][a-z0-9.-]*(\.[a-z]{2,})(:\d+)?(\/\S*)?$/i.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/\S*)?$/.test(raw));
    let target: string;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { setNotice("仅支持 HTTP(S) 地址"); return; }
        target = parsed.toString();
      } catch (error: any) {
        setNotice(`浏览器地址无效：${error.message}`);
        return;
      }
    } else if (looksLikeUrl) {
      target = new URL(`https://${raw}`).toString();
    } else {
      // 搜索词：交给默认搜索引擎（可见视图直接导航；指纹窗口同样打开搜索结果页）
      target = searchEngine + encodeURIComponent(raw);
    }
    if (browserMode === "cloak") void openInCloak(target);
    else setBrowserUrl(target);
    // 记录历史（去重置顶，最多 60 条）
    setBrowserHistory((current) => {
      const next = [{ url: target, title: (() => { try { return new URL(target).hostname; } catch { return target; } })(), at: Date.now() }, ...current.filter((entry) => entry.url !== target)].slice(0, 60);
      localStorage.setItem("browser-history", JSON.stringify(next));
      return next;
    });
  }

  function toggleBookmark() {
    const url = browserDraft.trim();
    if (!url) return;
    setBrowserBookmarks((current) => {
      const exists = current.some((entry) => entry.url === url);
      const next = exists ? current.filter((entry) => entry.url !== url) : [{ url, title: (() => { try { return new URL(url).hostname; } catch { return url; } })() }, ...current].slice(0, 30);
      localStorage.setItem("browser-bookmarks", JSON.stringify(next));
      return next;
    });
  }

  async function deleteQueued(id: string) {
    if (!thread) return;
    try {
      await window.codex.request("thread/queue/delete", { threadId: thread.id, queuedSubmissionId: id });
      setQueue((current) => current.filter((entry) => entry.id !== id));
    } catch (error: any) {
      setNotice(`删除排队消息失败：${error.message}`);
    }
  }

  async function reorderQueued(from: number, to: number) {
    if (!thread || from === to || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setQueue(next);
    try {
      await window.codex.request("thread/queue/reorder", { threadId: thread.id, queuedSubmissionIds: next.map((entry) => entry.id) });
    } catch (error: any) {
      setNotice(`调整队列顺序失败：${error.message}`);
      void refreshQueue(thread.id);
    }
  }

  function editQueued(entry: QueueItem) {
    setPrompt(inputText(entry.input));
    void deleteQueued(entry.id);
  }

  async function saveQueued(entry: QueueItem, text: string) {
    if (!thread) return;
    const images = (entry.input ?? []).filter(isImagePart).map(normalizeImagePartForSend).filter(Boolean);
    const nextText = text.trim();
    try {
      await deleteQueued(entry.id);
      const input = [
        ...(nextText || images.length ? [{ type: "text", text: nextText, text_elements: [] }] : []),
        ...images,
      ];
      if (input.length) await window.codex.request("thread/queue/add", { threadId: thread.id, input, clientUserMessageId: crypto.randomUUID() });
      void refreshQueue(thread.id);
    } catch (error: any) {
      setNotice(`保存排队消息失败：${error.message}`);
    }
  }

  async function startQueued(id?: string) {
    if (!thread) return;
    const entry = id ? queue.find((q) => q.id === id) : undefined;
    // 「立即」= 提供思路：有活跃回合时用 turn/steer 把这条消息追加到当前回合（不打断，让任务继续跑）；
    // 空闲时才把它启动成一个新回合。turn/steer 不触发 turn/started，只是给正在跑的回合补一段用户输入。
    if (activeTurnId && entry) {
      try {
        await window.codex.request("turn/steer", {
          threadId: thread.id,
          expectedTurnId: activeTurnId,
          input: entry.input,
          ...(entry.clientUserMessageId ? { clientUserMessageId: entry.clientUserMessageId } : {}),
        });
        await deleteQueued(entry.id);
        void refreshQueue(thread.id);
        showToast("发送成功", "排队消息已提供给当前任务");
      } catch (error: any) {
        showToast("发送失败", error.message);
      }
      return;
    }
    try {
      await window.codex.request("thread/queue/start", { threadId: thread.id, ...(id ? { queuedSubmissionId: id } : {}) });
      void refreshQueue(thread.id);
      showToast("发送成功", "排队消息已开始执行");
    } catch (error: any) {
      showToast("发送失败", error.message);
    }
  }

  async function refreshSettingsResources(opts: { mcpDetail?: boolean } = {}) {
    setResourceLoading(true);
    setResourceError("");
    const cwd = workspace ? [workspace] : [];
    const failures: string[] = [];
    // mcpDetail=true 才做 toolsAndAuthOnly 全量枚举（会拉起全部 MCP 服务）；
    // 已加载过详情的会话内后续刷新沿用，避免其他分区操作把 MCP 状态刷丢
    const wantMcpDetail = opts.mcpDetail === true || mcpDetailLoadedRef.current;
    if (opts.mcpDetail === true) mcpDetailLoadedRef.current = true;
    // 每项独立容错：某个接口不被当前 Codex 版本支持时，不能拖垮整批数据
    const safe = async (label: string, run: () => Promise<any>, fallback: any) => {
      try { return await run(); } catch (error: any) {
        let msg = String(error.message ?? error);
        // Cloudflare 挑战页/超长 HTML 不要甩到界面上，降级成一句人话
        if (/<html|__cf_chl|challenge/i.test(msg)) msg = "请求被 Cloudflare 人机验证拦截（该项需要可直连 OpenAI 的网络或代理）";
        else if (msg.length > 160) msg = msg.slice(0, 160) + "…";
        failures.push(`${label}（${msg}）`);
        return fallback;
      }
    };
    const [skillsResult, hooksResult, pluginsResult, memoryResult, taskResult, mcpResult] = await Promise.all([
      safe("技能", () => window.codex.request("skills/list", { cwds: cwd, forceReload: false }), { data: [] }),
      safe("钩子", () => window.codex.request("hooks/list", { cwds: cwd }), { data: [] }),
      // 不要用 forceRefetch：它会去远端重新拉取 marketplace（Codex 自带 git 不走系统代理，会卡到超时）；
      // 实测本地 config.toml 的改动在普通列表里就能立刻反映。
      safe("插件", () => window.codex.request("plugin/list", { cwds: cwd, forceRefetch: false }), { marketplaces: [] }),
      safe("记忆", () => window.codex.listMemory(), []),
      safe("定时任务", () => window.codex.listScheduledTasks(), []),
      wantMcpDetail
        ? safe("MCP", () => window.codex.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(threadRef.current?.id ? { threadId: threadRef.current.id } : {}) }), { data: [] })
        : Promise.resolve({ data: settingsResources.mcp }),
    ]);
    setSettingsResources({
      skills: (skillsResult.data ?? []).flatMap((entry: any) => entry.skills ?? []),
      // hooks/list 的 data 是按 cwd 分组的数组（[{ cwd, hooks: [...] }]），必须摊平，
      // 否则渲染层拿到的是分组对象，页面上只会渲染出空白卡片（ponytail 的钩子就是这样“消失”的）。
      hooks: (hooksResult.data ?? []).flatMap((entry: any) => entry.hooks ?? []),
      plugins: (pluginsResult.marketplaces ?? [])
        // 官方精选市场（openai-api-curated）需 ChatGPT 账号登录才能装，API Key 方式装不了；
        // 与其显示一堆点不动的「虚假卡片」，直接不展示，用户需要的插件走「开发工具」随包内置。
        .filter((marketplace: any) => marketplace.name !== "openai-api-curated")
        .flatMap((marketplace: any) => (marketplace.plugins ?? []).map((plugin: any) => ({ ...plugin, marketplaceName: marketplace.name, marketplacePath: marketplace.path }))),
      mcp: mcpResult.data ?? [],
    });
    setMemories(memoryResult ?? []);
    setScheduledTasks(taskResult ?? []);
    // 引擎直管 MCP 的启停覆盖表，跟着每次刷新一起回读，保证卡片开关显示的是真实状态
    setMcpOverrides(await window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>));
    // 各 MCP 服务器的按工具权限档位，同样每次刷新回读
    setMcpToolPermissions(await window.codex.readMcpToolPermissions().catch(() => ({})));
    setResourceError(failures.length ? `以下数据读取失败：${failures.join("、")}` : "");
    setResourceLoading(false);
  }

  async function trustAllHooks() {
    setHookTrusting(true);
    try {
      const result = await window.codex.trustHooks(workspace ? [workspace] : []);
      if (result.failures?.length) setNotice(`部分钩子信任失败：${result.failures.join("；")}`);
      else setNotice(result.trusted ? `已信任 ${result.trusted} 个钩子，下一轮任务开始执行` : `${result.total} 个钩子都已处于信任状态`);
      await refreshSettingsResources();
    } catch (error: any) { setNotice(`信任钩子失败：${error.message}`); }
    finally { setHookTrusting(false); }
  }

  /** 单条钩子启停：只改这一条，不动插件本体 */
  async function setHookEnabled(hook: any, enabled: boolean) {
    const key = String(hook.key ?? "");
    if (!key) return;
    setHookBusy(key);
    try {
      const result = await window.codex.setHookEnabled({ hookKeys: [key], enabled });
      if (result.failures?.length) throw new Error(result.failures.join("；"));
      await refreshSettingsResources();
      setNotice(`钩子「${hook.eventName ?? key}」已${enabled ? "启用" : "停用"}`);
    } catch (error: any) { setNotice(`钩子${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { setHookBusy(null); }
  }

  /**
   * 联动开关：把插件、它提供的全部钩子、它提供的全部技能一次性对齐。
   * 停用时三者一起停；启用时三者一起起，避免出现「插件开着但钩子是灰的」这种自相矛盾的状态。
   */
  async function setLinkedEnabled(pluginId: string, enabled: boolean, label: string) {
    setLinkedBusy(pluginId);
    try {
      const result = await window.codex.setPluginLinkedEnabled({ pluginId, enabled });
      await Promise.all([refreshSettingsResources(), window.codex.listLocalSkills().then(setLocalSkills)]);
      if (result.failures?.length) setNotice(`${label}：部分联动失败 —— ${result.failures.join("；")}`);
      else setNotice(`已${enabled ? "启用" : "停用"}「${label}」，并同步其钩子与关联技能`);
    } catch (error: any) { setNotice(`联动${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { setLinkedBusy(null); }
  }

  async function changePlugin(plugin: any) {
    const key = String(plugin.name ?? plugin.id ?? "");
    setPluginBusy(key);
    try {
      if (plugin.installed && plugin.id) {
        await window.codex.request("plugin/uninstall", { pluginId: plugin.id });
      } else {
        await window.codex.request("plugin/install", { pluginName: plugin.name, ...(plugin.marketplacePath ? { marketplacePath: plugin.marketplacePath } : { remoteMarketplaceName: plugin.marketplaceName }), installAttemptId: crypto.randomUUID() });
      }
      await refreshSettingsResources();
      setNotice(`插件「${plugin.name}」${plugin.installed ? "已卸载" : "已安装"}`);
    } catch (error: any) {
      // 官方精选市场（openai-api-curated）的插件需要 ChatGPT 账号登录才能装，给明确中文提示
      const msg = String(error.message ?? error);
      if (/chatgpt authentication|remote plugin catalog|requires.*auth/i.test(msg)) {
        setNotice(`插件「${plugin.name}」来自 OpenAI 官方精选市场，需要先登录 ChatGPT 账号（API Key 方式装不了）。要离线内置插件请找我们随包分发。`);
      } else {
        setNotice(`插件操作失败：${msg}`);
      }
    } finally { setPluginBusy(null); }
  }

  /** 插件启停：写入 config.toml 的 [plugins."<id>"] enabled，Codex 下一轮扫描起不再加载被停用的插件 */
  async function setPluginEnabled(plugin: any, enabled: boolean) {
    const id = String(plugin.id ?? plugin.name ?? "");
    if (!id) return;
    if (guardGroupOff({ kind: "plugin", id }, `插件「${pluginDisplayName(plugin)}」`, enabled)) return;
    setPluginBusy(id);
    try {
      const result = await window.codex.setPluginEnabled({ pluginIds: [id], enabled });
      if (result.failures?.length) throw new Error(result.failures.join("；"));
      await refreshSettingsResources();
      setNotice(`插件「${pluginDisplayName(plugin)}」已${enabled ? "启用" : "停用"}`);
    } catch (error: any) { setNotice(`插件${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { setPluginBusy(null); }
  }

  // —— 能力总闸联动：写代码模式 / 桌面自动化 / 浏览器自动化 —— //
  // 派生快照：主开关状态完全由子项状态实时计算（不存 useState），杜绝主/子状态漂移
  const ponytailPluginEntry = useMemo(
    () => (settingsResources.plugins as any[]).find((plugin) => plugin.installed && samePluginId(plugin.id, PONYTAIL_PLUGIN_ID)),
    [settingsResources.plugins],
  );
  const ponytailPluginOn = ponytailPluginEntry?.enabled !== false;
  const ponytailSkillsSnap = useMemo(() => ponytailSubSkills(localSkills as any[]), [localSkills]);
  const desktopSkillSnap = useMemo(() => findCapabilitySkill(localSkills as any[], DESKTOP_SKILL_ID), [localSkills]);
  const browserSkillSnap = useMemo(() => findCapabilitySkill(localSkills as any[], BROWSER_SKILL_ID), [localSkills]);
  const nuphusMcpOn = mcpOverrides[NUPHUS_MCP_ID] !== false; // 覆盖表没记录 = 默认启用
  const capabilitySnapshot: SubToggleSnapshot = useMemo(() => ({
    ponytailOn,
    ponytailPluginOn,
    ponytailSkills: ponytailSkillsSnap,
    desktopAuto,
    browserAuto,
    nuphusMcpOn,
    desktopSkill: desktopSkillSnap,
    browserSkill: browserSkillSnap,
  }), [ponytailOn, ponytailPluginOn, ponytailSkillsSnap, desktopAuto, browserAuto, nuphusMcpOn, desktopSkillSnap, browserSkillSnap]);
  const [groupBusy, setGroupBusy] = useState<CapabilityGroupId | null>(null);
  /** 联动层 IPC 实现（抽出来给「启动自愈」复用）。 */
  const groupIpc: GroupIpc = {
    ponytailModeSet: (mode) => window.codex.ponytailModeSet(mode) as Promise<unknown>,
    setPluginLinkedEnabled: (id, enabled) => window.codex.setPluginLinkedEnabled({ pluginId: id, enabled }),
    saveAppSettings: (patch) => window.codex.saveAppSettings(patch as any),
    setMcpServersEnabled: (ids, enabled) => window.codex.setMcpServersEnabled(ids, enabled),
    setSkillEnabled: (input) => window.codex.setEnabledSkill(input),
  };

  /**
   * 能力总闸联动入口：「常规」页三个开关共用。一次性把该组的所有子项对齐到 target：
   * - writing-code：ponytail 注入开关 + ponytail 插件（含钩子与 6 个子技能）
   * - desktop-automation：app-settings 总闸 + nuphus MCP 启停 + desktop-automation 技能
   * - browser-automation：app-settings 总闸 + browser-automation 技能
   * 失败项聚合返回 toast；silent=true 时完全不提示（启动自愈用）。
   */
  async function applyGroup(groupId: CapabilityGroupId, target: boolean, silent = false) {
    setGroupBusy(groupId);
    try {
      const plan = planAction(capabilitySnapshot, groupId, target);
      if (isEmptyAction(plan)) return;
      const result = await applyAction(plan, groupIpc);
      if (groupId === "writing-code") setPonytailOn(target);
      else if (groupId === "desktop-automation") setDesktopAuto(target);
      else setBrowserAuto(target);
      await Promise.all([
        refreshSettingsResources(),
        window.codex.listLocalSkills().then(setLocalSkills),
        window.codex.readMcpServerOverrides().then(setMcpOverrides).catch(() => undefined),
      ]);
      if (silent) return;
      const label = GROUP_LABELS[groupId];
      if (result.failures.length) {
        setNotice(`${label}部分联动失败：${result.failures.join("；")}`);
        return;
      }
      const parts: string[] = [];
      if (result.applied.ponytailMode) parts.push("注入开关");
      if (result.applied.ponytailLinked) parts.push("ponytail 插件与子技能");
      if (result.applied.nuphus) parts.push("nuphus MCP");
      if (result.applied.desktopSkill) parts.push(`${DESKTOP_SKILL_ID} 技能`);
      if (result.applied.browserSkill) parts.push(`${BROWSER_SKILL_ID} 技能`);
      // 联动后再复算一次：还有没带起来的子项（例如技能目录被改名）就点名提示
      const hint = describePartial(syncedSnapshot(capabilitySnapshot, groupId, target), groupId, MEMBER_LABELS);
      if (hint) setNotice(`${label}已${target ? "开启" : "关闭"}，但 ${hint.pendingLabels.join("、")} 未同步，请到对应页确认`);
      else setNotice(`${label}已${target ? "开启" : "关闭"}${parts.length ? `（已同步 ${parts.join("、")}）` : ""}`);
    } catch (error: any) {
      if (!silent) setNotice(`${GROUP_LABELS[groupId]}联动失败：${error?.message ?? String(error)}`);
    } finally { setGroupBusy(null); }
  }

  // 启动自愈：总闸开着但配套 MCP / 技能是关的（旧版默认值或历史手工关停），一次性补齐，
  // 保证「常规页开着 == 引擎真能用」。每次启动只跑一次，且不弹提示。
  const bootHealRef = useRef(false);
  useEffect(() => {
    if (bootHealRef.current) return;
    bootHealRef.current = true;
    void (async () => {
      try {
        const [skills, overrides, settings, pluginMode, pluginResult] = await Promise.all([
          window.codex.listLocalSkills(),
          window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>),
          window.codex.readAppSettings().catch(() => ({}) as Record<string, unknown>),
          // 写代码模式真实落盘状态：~/.config/ponytail/config.json:defaultMode。
          // 不能拿 ponytailOn 的 useState 默认值当真——那只是 UI 初始值，不是落盘状态。
          (window.codex.ponytailModeGet?.() ?? Promise.resolve("full")).catch(() => "full"),
          window.codex.request("plugin/list", { cwds: workspace ? [workspace] : [], forceRefetch: false }).catch(() => ({ marketplaces: [] })),
        ]);
        const ponytailPluginEntry = ((pluginResult.marketplaces ?? []) as any[])
          .flatMap((marketplace: any) => marketplace.plugins ?? [])
          .find((plugin: any) => plugin.installed && samePluginId(plugin.id, PONYTAIL_PLUGIN_ID));
        const snapshot: SubToggleSnapshot = {
          ponytailOn: pluginMode !== "off",
          ponytailPluginOn: ponytailPluginEntry?.enabled !== false,
          ponytailSkills: ponytailSubSkills(skills as any[]),
          desktopAuto: settings.desktopAutomation !== false,
          browserAuto: settings.browserAutomation !== false,
          nuphusMcpOn: overrides[NUPHUS_MCP_ID] !== false,
          desktopSkill: findCapabilitySkill(skills, DESKTOP_SKILL_ID),
          browserSkill: findCapabilitySkill(skills, BROWSER_SKILL_ID),
        };
        let healed = false;
        for (const groupId of ["writing-code", "desktop-automation", "browser-automation"] as CapabilityGroupId[]) {
          const plan = planAction(snapshot, groupId, true);
          if (isEmptyAction(plan)) continue;
          await applyAction(plan, groupIpc);
          healed = true;
        }
        if (!healed) return;
        setPonytailOn(await window.codex.ponytailModeGet?.().catch(() => "full") !== "off");
        setMcpOverrides(await window.codex.readMcpServerOverrides().catch(() => ({}) as Record<string, boolean>));
        setLocalSkills(await window.codex.listLocalSkills());
        await refreshSettingsResources();
      } catch { /* 自愈失败不阻塞启动 */ }
    })();
  }, []);

  /**
   * 其他 tab（技能 / MCP / 插件 / 钩子）里点击关闭受总闸托管子项的拦截器：
   * 返回 true 表示已拦截（提示去常规页关总闸），false 表示放行。
   */
  function guardGroupOff(
    member: Parameters<typeof guardOffOwner>[1],
    label: string,
    next: boolean,
  ): boolean {
    if (next) return false; // 开启总是允许（不会破坏联动）
    const owner = guardOffOwner(capabilitySnapshot, member);
    if (!owner) return false;
    setNotice(`「${label}」由「${GROUP_LABELS[owner]}」开关控制，请在「控制台」页关闭${GROUP_LABELS[owner]}（否则会被总闸重新拉起）`);
    return true;
  }

  /** 常规页总闸行的「部分启用」提示：列出还没跟着开关走的子项，点开关可一次性对齐。 */
  const capabilityHint = (groupId: CapabilityGroupId): string | null => {
    const hint = describePartial(capabilitySnapshot, groupId, MEMBER_LABELS);
    return hint ? `部分启用（${hint.onCount}/${hint.totalCount}）：${hint.pendingLabels.join("、")} 未同步，点右侧开关可一次性对齐` : null;
  };

  async function batchSetPluginEnabled(plugins: any[], enabled: boolean) {
    const ids = plugins.map((plugin) => String(plugin.id ?? "")).filter(Boolean);
    if (!ids.length) { setNotice(enabled ? "没有可启用的插件" : "没有可停用的插件"); return; }
    setPluginBatchBusy(enabled ? "enable" : "disable");
    try {
      const result = await window.codex.setPluginEnabled({ pluginIds: ids, enabled });
      setPluginChecked([]);
      await refreshSettingsResources();
      if (result.failures?.length) setNotice(`${result.changed} 个插件已${enabled ? "启用" : "停用"}，${result.failures.length} 个失败：${result.failures.join("；")}`);
      else setNotice(`已${enabled ? "启用" : "停用"} ${result.changed} 个插件`);
    } catch (error: any) { setNotice(`批量${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { setPluginBatchBusy(null); }
  }

  /** 技能批量启停：只作用于可移除的本机技能，内置技能由引擎提供、不参与 */
  async function batchSetSkillEnabled(folders: string[], enabled: boolean) {
    if (!folders.length) { setNotice(enabled ? "没有可启用的技能" : "没有可停用的技能"); return; }
    // 批量停用同样要过滤掉受总闸托管的技能，否则会被总闸拉回，批量结果看着成功实际没生效
    const targets = folders.filter((folder) => !guardGroupOff({ kind: "skill", folder }, `技能「${folder}」`, enabled));
    if (!targets.length) return;
    setSkillBatchBusy(enabled ? "enable" : "disable");
    try {
      const result = await window.codex.setEnabledSkillBatch({ folders: targets, enabled });
      setSkillChecked([]);
      setLocalSkills(await window.codex.listLocalSkills());
      await refreshSettingsResources();
      if (result.failures?.length) setNotice(`${result.changed} 个技能已${enabled ? "启用" : "停用"}，${result.failures.length} 个失败：${result.failures.join("；")}`);
      else setNotice(`已${enabled ? "启用" : "停用"} ${result.changed} 个技能`);
    } catch (error: any) { setNotice(`批量${enabled ? "启用" : "停用"}失败：${error.message}`); }
    finally { setSkillBatchBusy(null); }
  }

  useEffect(() => {
    const off = window.codex.onEvent((event) => {
      if (event.kind === "status") {
        setServerStatus(event.status ?? "error");
        // 保存模型、切换或删除当前供应商都会主动重启引擎。主动重启只有
        // starting→ready，不会先发 error；同样要进入恢复分支，否则侧栏会暂时像是
        // “会话全没了”，直到下次手动刷新应用。
        if (event.status === "starting") engineRestartedRef.current = true;
        // 引擎无响应/被心跳监控重启：清掉本地运行态，提示用户（thread 仍留在磁盘，
        // 引擎 ready 后自动 resume 当前线程即可恢复，不丢消息）。
        if (event.status === "error") {
          if (event.message && event.message.includes("重启")) {
            showToast("引擎已自动重启", event.message);
            engineRestartedRef.current = true;
          }
          if (sendingRef.current || activeTurnIdRef.current) {
            setSending(false);
            setActiveTurnId(null);
            clearRunningThreads();
            setWorkStartedAt(null);
          }
        }
        // 引擎重启完成（ready）：自动刷新线程列表，并 resume 之前打开的线程恢复内容。
        if (event.status === "ready" && engineRestartedRef.current) {
          engineRestartedRef.current = false;
          const tid = threadRef.current?.id;
          void refreshThreads();
          if (tid) {
            resumeThreadWithTurns({ threadId: tid, excludeTurns: false }).then((result) => {
              if (result?.thread && threadRef.current?.id === tid) {
                threadRef.current = result.thread;
                threadCacheRef.current.set(tid, result.thread);
                setThread(result.thread);
              }
            }).catch(() => undefined);
          }
        }
        return;
      }
      if (event.kind === "request" && event.id !== undefined && event.method) {
        if (event.method === "currentTime/read") {
          void window.codex.respond(event.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
          return;
        }
        if (event.method === "item/tool/call") {
          void (async () => {
            try {
              const args = typeof event.params?.arguments === "string" ? JSON.parse(event.params.arguments) : event.params?.arguments ?? {};
              if (event.params?.tool === "memory_recall") {
                const result = workspaceMemoryEnabled ? await window.codex.recallMemory(String(args.query ?? ""), workspace) : { context: "", remote: false };
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: result.context || "没有找到相关记忆" }], success: true });
              } else if (event.params?.tool === "memory_save") {
                const cat = String(args.category ?? "临时上下文");
                const result = await window.codex.saveMemory({ category: cat, content: args.content ?? "", sourceThreadId: event.params?.threadId, workspace, pinned: cat === "项目背景" || cat === "工作流/SOP" });
                showToast("已记住", `${cat}：${String(args.content ?? "").slice(0, 60)}（记忆中心可查看 / 跳回本会话）`);
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `记忆已保存：${result.id}` }], success: true });
              } else if (event.params?.tool === "subagent_invoke") {
                setSubAgentRunning(String(args.name ?? ""));
                try {
                  const result = await window.codex.invokeSubAgent({
                    name: String(args.name ?? ""),
                    query: String(args.query ?? ""),
                    cwd: workspace || undefined,
                    model: selectedModel?.model ?? modelName(modelId),
                    effort: effort || undefined,
                    sandbox,
                    approvalPolicy,
                  });
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `[子智能体 ${result.name} 的执行结果]\n${result.output}` }], success: true });
                } finally {
                  setSubAgentRunning(null);
                }
              } else if (event.params?.tool === "team_member_invoke") {
                await invokeTeamMember(args, String(event.params?.threadId ?? ""), event.id!);
              } else if (event.params?.tool === "generate_image") {
                const cfg: any = await window.codex.readBuiltinPlugins().catch(() => null);
                const c = cfg?.image;
                if (!c?.baseUrl || !c?.apiKey || !c?.model) {
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "生图插件未配置：请到 设置 → 插件 → 内置插件 填写 API 地址、密钥和模型。" }], success: false });
                } else {
                  try {
                    const result = await window.codex.generateImage({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, prompt: String(args.prompt ?? "") });
                    await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: result.url ? "图片已生成：" + result.url : "生图未返回图片地址" }], success: Boolean(result.url) });
                  } catch (error: any) {
                    await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "生图失败：" + error.message }], success: false });
                  }
                }
              } else if (event.params?.tool === "describe_image") {
                const cfg: any = await window.codex.readBuiltinPlugins().catch(() => null);
                const c = cfg?.vision;
                if (!c?.baseUrl || !c?.apiKey || !c?.model) {
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "视觉辅助插件未配置：请到 设置 → 插件 → 内置插件 填写视觉模型 API 地址、密钥和模型。" }], success: false });
                } else {
                  try {
                    const result = await window.codex.describeImage({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, imageUrl: String(args.imageUrl ?? ""), prompt: args.prompt ? String(args.prompt) : undefined });
                    await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "[视觉辅助模型识别结果]\n" + (result.text || "（视觉模型未返回描述）") }], success: Boolean(result.text) });
                  } catch (error: any) {
                    await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "识图失败：" + error.message }], success: false });
                  }
                }
              } else if (event.params?.tool === "rpa_save") {
                const result = await window.codex.saveRpaRecipe({ name: String(args.name ?? ""), desc: String(args.desc ?? ""), kind: String(args.kind ?? "browser"), steps: (Array.isArray(args.steps) ? args.steps : [String(args.steps ?? "")]).map(String), target: args.target ? String(args.target) : undefined, workspace: workspace || undefined });
                showToast("RPA 配方已保存", `「${result.name}」共 ${result.steps.length} 步，可在 设置 → RPA 自动化 里管理`);
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `RPA 配方「${result.name}」已保存（${result.steps.length} 步，${result.kind}）。下次说"运行 ${result.name}"即可复用。` }], success: true });
              } else if (event.params?.tool === "rpa_run") {
                if (!args.name) {
                  const list = await window.codex.listRpaRecipes();
                  const text = list.length ? list.map((r: any) => `- ${r.name}（${r.kind === "browser" ? "浏览器" : r.kind === "desktop" ? "桌面" : "混合"}，${r.steps.length} 步${r.lastStatus ? `，上次：${r.lastStatus === "ok" ? "成功" : `失败：${r.lastError ?? ""}`}` : ""}）：${r.desc ?? ""}`).join("\n") : "还没有保存任何 RPA 配方。";
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `[RPA 配方清单]\n${text}` }], success: true });
                } else {
                  const list = await window.codex.listRpaRecipes();
                  const recipe = list.find((r: any) => r.name === String(args.name)) ?? list.find((r: any) => String(args.name).includes(r.name));
                  if (!recipe) {
                    await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `没有找到名为「${args.name}」的配方。可用：${list.map((r: any) => r.name).join("、") || "（空）"}` }], success: false });
                  } else {
                    setRpaRunning(recipe.id);
                    try {
                      const stepsText = recipe.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n");
                      await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `[RPA 配方「${recipe.name}」开始执行，共 ${recipe.steps.length} 步]\n${stepsText}\n请严格按以上步骤逐步执行自动化操作${recipe.target ? `（目标：${recipe.target}）` : ""}，完成后报告每步结果。` }], success: true });
                      window.codex.recordRpaRun({ id: recipe.id, ok: true }).catch(() => undefined);
                    } catch (error: any) {
                      window.codex.recordRpaRun({ id: recipe.id, ok: false, error: error.message }).catch(() => undefined);
                      throw error;
                    } finally {
                      setRpaRunning(null);
                    }
                  }
                }
              } else if (event.params?.tool === "task_add") {
                const task = await window.codex.addTask({ text: String(args.text ?? ""), priority: String(args.priority ?? "medium") });
                showToast("已加入任务清单", task.text);
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `已加入任务清单：${task.text}（优先级：${task.priority}）` }], success: true });
              } else if (event.params?.tool === "task_update") {
                if (!args.id && args.status === undefined && args.text === undefined && !args.done) {
                  const tasks = await window.codex.listTasks();
                  const text = tasks.length ? tasks.map((t: any) => `- [${t.status === "done" ? "x" : " "}] ${t.text}（${t.priority}${t.status === "doing" ? "，进行中" : t.status === "done" ? "，已完成" : ""}）id:${t.id}`).join("\n") : "任务清单为空。";
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `[任务清单]\n${text}` }], success: true });
                } else if (args.done) {
                  await window.codex.deleteTask(String(args.id));
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: "任务已删除。" }], success: true });
                } else {
                  const patch: any = {};
                  if (args.status) patch.status = String(args.status);
                  if (args.text) patch.text = String(args.text);
                  if (args.priority) patch.priority = String(args.priority);
                  const task = await window.codex.updateTask({ id: String(args.id), patch });
                  await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `任务已更新：${task.text} → ${task.status}` }], success: true });
                }
              } else if (event.params?.tool === "agent_ask") {
                const question = String(args.question ?? "请选择：");
                const options: string[] = Array.isArray(args.options) ? args.options.map(String) : [];
                const askThreadId = String(event.params?.threadId ?? threadRef.current?.id ?? "");
                const isCurrentThread = askThreadId && askThreadId === threadRef.current?.id;
                // 不再跨会话弹窗：当前会话内贴输入框上方展示；用户在别的会话时先通知，切回会话再看到卡片
                if (!isCurrentThread) {
                  showToast("Agent 有问题等你回答", `${question.slice(0, 60)}${question.length > 60 ? "…" : ""}（会话：${threads.find((entry) => entry.id === askThreadId)?.name ?? "后台任务"}）`);
                }
                const answer = await new Promise<string>((resolve) => setAgentAsk({ threadId: askThreadId, question, options, recommended: options[0] ?? null, allowFree: args.allowFree !== false, resolve }));
                // ESC 关闭问答卡时 answer 为空串：明确告知引擎用户跳过了选择，避免它等一个不存在的选项
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: answer ? `[用户选择] ${answer}` : "[用户取消了选择] 请继续其它工作，或稍后换一种方式再问。" }], success: true });
              } else {
                await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `Dynamic tool ${event.params?.tool ?? "unknown"} is not registered by this harness.` }], success: false });
              }
            } catch (error: any) {
              await window.codex.respond(event.id!, { contentItems: [{ type: "inputText", text: `${event.params?.tool === "subagent_invoke" ? "子智能体调用失败" : "记忆工具失败"}：${error.message}` }], success: false });
            }
          })();
          return;
        }
        setPending((current) => current.some((entry) => entry.id === event.id) ? current : [...current, { id: event.id!, method: event.method!, params: event.params }]);
        return;
      }
      if (event.kind !== "notification") return;
      const params = event.params ?? {};
      // ── 跨会话生命周期事件：即使属于后台会话也要先处理，用于维护运行指示器 ──
      // 侧边栏转圈必须跟着「真正在运行的会话」，不能因为切到别的会话就跟着跑过去。
      // 这些事件不能被下面的 threadId 过滤挡掉，否则切走后后台会话的
      // turn/started · turn/completed 收不到 → activeTurnId 残留、侧边栏状态不更新。
      if (params.threadId) {
        const method0 = event.method ?? "";
        if (method0 === "turn/started") {
          markThreadRunning(params.threadId, params.turn?.id ?? params.turnId);
        } else if (method0 === "turn/completed") {
          markThreadStopped(params.threadId);
        } else if (method0 === "thread/status/changed") {
          // 侧边栏每个会话的运行状态：即使不是当前会话也要更新，保证切走后转圈还在原会话
          setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, status: params.status } : entry));
          // 状态明确非运行（completed 等）时兜底熄灭转圈，防 turn/completed 事件丢失导致卡转
          if (params.status !== "inProgress" && params.status !== "running") {
            markThreadStopped(params.threadId);
          } else {
            markThreadRunning(params.threadId);
          }
        }
        // 渠道机器人等后台会话的 start/stop：走不到下面的当前会话事件流（threadId 过滤会拦掉），
        // 新建的机器人会话永远进不了侧栏 → 防抖刷新一次 thread/list
        if ((method0 === "turn/started" || method0 === "turn/completed") && params.threadId !== threadRef.current?.id) {
          scheduleSidebarRefresh();
        }
      }
      if (params.threadId && params.threadId !== threadRef.current?.id) return;
      const method = event.method ?? "";
      // 钉顶模式不在首条 delta 就切回底部跟随（旧做法让「钉在视口上边框下方两行」从未
      // 真正出现就被贴底滚动冲掉，表现为「每次新消息位置都不一样」）：视口由钉顶循环接管，
      // 下方内容长满视口后由循环自然交还贴底（衔接无跳变）。stick 本就为 true 时保持即可。
      if (threadStreamMethods.has(method)) {
        // delta 批量落盘：把累积到这一帧的 delta 一次性 apply 成新 thread 引用（只触发一次重渲染）
        const flushDeltas = () => {
          const batch = pendingDeltaRef.current;
          pendingDeltaRef.current = [];
          if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = 0; }
          lastFlushAtRef.current = performance.now();
          lastStreamTsRef.current = Date.now();
          if (!batch.length) return;
          let current = threadRef.current;
          for (const { method: m, params: p } of batch) current = applyThreadEvent(current, m, p);
          if (current !== threadRef.current) {
            threadRef.current = current;
            setThread(current);
            if (current?.id) threadCacheRef.current.set(current.id, current);
          }
        };
        // delta 合帧：同一帧内的多条流式事件合并成一次 setThread，
        // 渲染节奏稳定在 60fps，不随引擎/中转出字的一波一波节奏跳变
        const apply = () => {
          // 结构性事件（item/completed 等）必须排在已缓冲的 delta 之后：
          // 否则会「先落完成态、后补字」，表现为完成后正文被覆盖或整段丢失。
          if (pendingDeltaRef.current.length) flushDeltas();
          lastStreamTsRef.current = Date.now();
          const next = applyThreadEvent(threadRef.current, method, params);
          if (next !== threadRef.current) {
            threadRef.current = next;
            setThread(next);
            if (next?.id) threadCacheRef.current.set(next.id, next);
          }
        };
        if (isDeltaMethod(method)) {
          pendingDeltaRef.current.push({ method, params });
          // 新一轮出字（距上次落盘已超过一帧）立即应用，不等 rAF：
          // 首 token / 停顿后的第一个字必须立刻可见，否则肉眼就是「慢半拍 + 憋一段才冒出来」。
          // 之后同帧内持续到来的 delta 才走 rAF 合帧，避免每字一次全树重渲染。
          if (performance.now() - lastFlushAtRef.current > 24) flushDeltas();
          else if (!streamRafRef.current) streamRafRef.current = requestAnimationFrame(flushDeltas);
          return;
        }
        apply();
      }
      if (reviewTurnRef.current && params.turnId === reviewTurnRef.current) {
        if (method === "item/agentMessage/delta") setReviewReport((current) => current + (params.delta ?? ""));
        else if (method === "item/completed" && params.item?.type === "agentMessage") setReviewReport(params.item.text ?? "");
        else if (method === "turn/completed") {
          setReviewBusy(false);
          reviewTurnRef.current = null;
        }
      }
      if (method === "item/started" && params.item?.type === "reasoning") {
        reasoningStart.set(String(params.item.id ?? params.itemId ?? ""), Date.now());
      } else if (method === "item/completed" && params.item?.type === "reasoning") {
        // 只补记开始时间，不在这里落 reasoningDuration。
        // 深度思考很长时引擎/中转会偶发「提前 completed + 后续继续发 delta」
        // （日志实证 codex_core 报 ReasoningSummaryDelta without active item），
        // 若此时落 duration，reasoningActive 判定（要求 !reasoningDuration.has）
        // 会立刻把运行状态打停，但思考其实还在出字（用户实测：思考跑很久后
        // 运行状态莫名断）。duration 统一在 turn/completed 时结算（见下）。
        const key = String(params.item.id ?? params.itemId ?? "");
        if (!reasoningStart.has(key)) reasoningStart.set(key, Date.now());
      }
      if (method === "item/started" && params.item?.type === "contextCompaction") {
        compactPendingRef.current.add(String(params.threadId ?? threadRef.current?.id ?? ""));
        setCompactEventState("running");
        pruneSupersededCompactions(String(params.item?.id ?? ""));
      } else if (method === "item/completed" && params.item?.type === "contextCompaction") {
        compactPendingRef.current.delete(String(params.threadId ?? threadRef.current?.id ?? ""));
        setCompactEventState("success");
        pruneSupersededCompactions(String(params.item?.id ?? ""));
      }
      if (method === "turn/plan/updated") {
        setPlanSteps((params.plan ?? []).map((step: any) => ({ step: step.step ?? "", status: step.status ?? "pending" })));
      } else if (method === "thread/goal/updated" || method === "thread/goal/set") {
        if (params.goal?.objective) {
          setGoalText(params.goal.objective);
          setGoalStatus(params.goal.status ?? "active");
        } else {
          setGoalText("");
          setGoalStatus(null);
        }
      } else if (method === "turn/completed") {
        // 用本回合新增量累加（旧实现取的是 max，累计 Token 一直是错的）；拿不到增量时按上下文总量兜底
        try {
          const total = usageBucket(tokenUsageRef.current, "total") ?? usageBucket(tokenUsageRef.current, "last");
          const last = usageBucket(tokenUsageRef.current, "last");
          const turnId = String(params?.turn?.id ?? "");
          const startedAt = turnId ? turnStartedAtRef.current.get(turnId) : undefined;
          if (turnId) turnStartedAtRef.current.delete(turnId);
          setUsageStats(recordTurnUsage({
            inputTokens: last?.input_tokens ?? last?.inputTokens ?? total?.input_tokens ?? total?.inputTokens ?? 0,
            outputTokens: last?.output_tokens ?? last?.outputTokens ?? total?.output_tokens ?? total?.outputTokens ?? 0,
            contextTokens: total?.total_tokens ?? total?.totalTokens ?? 0,
            durationMs: startedAt ? Date.now() - startedAt : undefined,
            model: activeModelRef.current || undefined,
          }));
        } catch { /* 统计失败不影响主流程 */ }
      }
      if (method === "turn/started") {
        setSending(true);
        setActiveTurnId(params.turn.id);
        const startedAt = runningStartedAtRef.current.get(params.threadId) ?? Date.now();
        setWorkStartedAt(startedAt);
        turnStartedAtRef.current.set(params.turn.id, Date.now());
        // 不在这里清乐观消息：turn/started 里的 userMessage 可能 content 为空，
        // 清了会导致「乐观气泡没了、服务端消息又没内容」的空窗，消息就「消失」了。
        // 清除完全交给渲染端 optimisticConfirmed 去重（thread.turns 出现同文本 userMessage 才隐藏）。
        // 这里绝不能主动清乐观消息：清早了而服务端 item 又因事件时序没合并进 turns，用户消息就「消失」了。
      } else if (method === "turn/completed") {
        setSending(false);
        setInterrupting(false);
        setActiveTurnId(null);
        markThreadStopped(params.threadId);
        setWorkStartedAt(null);
        // 回合真正结束：统一结算本回合所有 reasoning 的耗时（起点在 item/started 或
        // item/completed 时已记录）。不在 item/completed 结算的原因见上——避免引擎
        // 「提前 completed + 继续发 delta」时运行状态被打断。
        if (params.turn?.items) {
          for (const item of params.turn.items) {
            if (item?.type !== "reasoning") continue;
            const key = String(item.id ?? "");
            if (key && !reasoningDuration.has(key)) {
              const start = reasoningStart.get(key);
              if (start) reasoningDuration.set(key, Date.now() - start);
              reasoningStart.delete(key);
            }
          }
        }
        // 只有服务端回合里的 userMessage 文本和乐观消息匹配才清；
        // 否则保留——清早了而服务端消息又没渲染出来，用户消息就"消失"了
        if (optimisticInput && (params.turn?.items ?? []).some((entry: ThreadItem) => entry.type === "userMessage" && userMessageMatchesInput(entry, optimisticInput.content ?? []))) setOptimisticInput(null);
        if (params.turn.error?.message) showToast("任务失败", params.turn.error.message);
        // 限流失败 → 自动重试（10 次退避）。仅当失败回合属于最近一次发送的线程才接管
        if (params.turn.error?.message && isRateLimitError(params.turn.error.message) && retryContextRef.current?.threadId === params.threadId) {
          scheduleRateLimitRetry(rateLimitAttemptRef.current + 1);
        } else if (!params.turn.error?.message && retryContextRef.current?.threadId === params.threadId) {
          // 回合正常结束：清掉重试上下文，避免之后别的会话失败误用旧输入重发
          cancelRateLimitRetry(true);
        }
        // 运行结束通知：窗口最小化/失焦时弹系统通知，点击通知聚焦回窗口
        try {
          const isCurrent = params.threadId === threadRef.current?.id;
          const blurred = document.visibilityState !== "visible" || !document.hasFocus();
          if (blurred || !isCurrent) {
            const name = cleanThreadDisplayTitle(threads.find((entry) => entry.id === params.threadId)?.name, { preview: threads.find((entry) => entry.id === params.threadId)?.preview }) || firstUserTextInTurn(params.turn).slice(0, 30) || "任务";
            void window.codex.showNotification(params.turn.error?.message ? "任务失败" : "任务完成", `${name.slice(0, 40)} ${params.turn.error?.message ? "运行失败" : "已运行完成"}`);
          }
        } catch { /* 通知失败不影响主流程 */ }
        void window.codex.request("thread/queue/list", { threadId: params.threadId, limit: 1 }).then((result) => result.data?.[0] && window.codex.request("thread/queue/start", { threadId: params.threadId, queuedSubmissionId: result.data[0].id })).catch((error) => showToast("队列启动失败", error.message));
        // 计划模式：方案回合正常结束 → 弹「开始执行」确认条；失败则静默复位（错误已 toast）
        if (planTurnRef.current && planTurnRef.current.threadId === params.threadId && planTurnRef.current.turnId === String(params.turn?.id ?? "")) {
          if (!params.turn.error?.message) {
            const planText = (Array.isArray(params.turn?.items) ? params.turn.items : []).filter((item: any) => item.type === "agentMessage").map((item: any) => itemText(item)).join("\n\n").trim();
            setPlanConfirm({ threadId: params.threadId, text: planText });
            showToast("方案已生成", "确认无误后点击「开始执行」");
          }
          planTurnRef.current = null;
          setPlanRunning(false);
        }
        void refreshThreads();
      } else if (method === "item/started" || method === "item/completed") {
        // 不在这里清空 optimisticInput：清除时机交给渲染端的文本去重，
        // 否则 item/started 与 setThread 的批处理时序差异会让用户消息瞬间消失。
      } else if (method === "hook/started" || method === "hook/completed") {
        addHookEvent(method === "hook/started", String(params.run?.name ?? params.run?.id ?? "Hook"));
      } else if (event.method === "item/autoApprovalReview/started") {
        showToast("正在审查命令权限", "Codex 正在进行自动安全审查");
      } else if (event.method === "item/autoApprovalReview/completed") {
        showToast("命令权限审查完成", params.decisionSource ?? "完成");
      } else if (event.method === "autoApprovalReview/strictReviewRequired") {
        showToast("需要严格审批", "后续命令将逐项请求确认");
      } else if (event.method === "turn/diff/updated") {
        setDiff(params.diff ?? "");
      } else if (event.method === "thread/tokenUsage/updated") {
        const normalizedUsage = normalizeTokenUsage(params.tokenUsage, String(params.threadId ?? threadRef.current?.id ?? ""));
        tokenUsageRef.current = normalizedUsage;
        setTokenUsage(normalizedUsage);
      } else if (event.method === "error") {
        setSending(false);
        setInterrupting(false);
        markThreadStopped(params.threadId);
        // error 通知也可能是限流（引擎 RPC 直接报错）：同样进入自动重试
        const rawError = params.error?.message ?? params.message ?? "";
        const details = String(params.error?.additionalDetails ?? params.additionalDetails ?? "");
        // 引擎的 Reconnecting 是英文原始报错，直接显示不友好——翻译成中文提醒：
        // 401=Key 错配（供应商切换后旧会话），流中断=网关不稳（pptoken 常见），均会自动重试。
        const reconnectMatch = rawError.match(/^Reconnecting\.\.\.\s*(\d+)\/(\d+)/);
        let errorMessage = rawError;
        if (reconnectMatch) {
          const no = reconnectMatch[1], total = reconnectMatch[2];
          if (details.includes("401")) errorMessage = `第 ${no}/${total} 次自动重试：供应商认证失败（API Key 不匹配）。若刚切换过供应商，请停止后重发以自动迁移会话；仍失败请检查该供应商的 Key`;
          else if (/stream (dis)?connected|closed before/i.test(details) || details.includes("httpStatusCode\":null")) errorMessage = `第 ${no}/${total} 次自动重试：上游网关响应中断（模型服务不稳）。引擎正在自动重连，多数情况下稍等即可恢复；持续失败建议换模型或换供应商`;
          else errorMessage = `第 ${no}/${total} 次自动重试：连接中断，引擎正在自动恢复……`;
        } else if (details.includes("401") && /API key format is incorrect/i.test(details)) {
          errorMessage = "供应商认证失败（API Key 与服务商不匹配）：当前供应商的 Key 被发到了另一个服务商。请停止后重发（会自动迁移会话），或检查供应商配置";
        }
        if (errorMessage && isRateLimitError(errorMessage) && retryContextRef.current?.threadId === params.threadId) {
          scheduleRateLimitRetry(rateLimitAttemptRef.current + 1);
        } else if (params.threadId && retryContextRef.current?.threadId === params.threadId) {
          cancelRateLimitRetry(true);
        }
        if (compactPendingRef.current.delete(String(params.threadId ?? threadRef.current?.id ?? ""))) {
          setCompactEventState("error", errorMessage);
        }
        setNotice(errorMessage || "Codex 请求失败");
      } else if (event.method === "serverRequest/resolved") {
        setPending((current) => current.filter((entry) => entry.id !== params.requestId));
      } else if (method === "thread/name/updated") {
        const nextName = params.threadName ?? null;
        setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, name: nextName } : entry));
        const cached = threadCacheRef.current.get(params.threadId);
        if (cached) threadCacheRef.current.set(params.threadId, { ...cached, name: nextName });
        setThread((current) => {
          if (!current || current.id !== params.threadId) return current;
          const next = { ...current, name: nextName };
          threadRef.current = next;
          return next;
        });
      } else if (method === "thread/status/changed") {
        setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, status: params.status } : entry));
      } else if (event.method === "thread/settings/updated") {
        setWorkspace(params.threadSettings.cwd);
        const mode = sandboxMode(params.threadSettings.sandboxPolicy);
        const policy = typeof params.threadSettings.approvalPolicy === "string" ? params.threadSettings.approvalPolicy : approvalPolicy;
        // 用户选择的权限必须原样生效：低权限只让需授权的操作走审批卡，
        // 不减少引擎可用能力，也不被前端自动回写成完全访问。
        // 引擎可能推不带 sandboxPolicy/approvalPolicy 的事件——此时保持用户当前权限，绝不降级覆盖。
        // 若本地已存有该会话的权限（用户明确选过），以本地为准，避免引擎回推的默认值覆盖选择。
        // 变灰根因补刀：openThread 回填后会触发引擎异步回推一条带旧策略的 settings/updated，
        // 若用户刚在胶囊里明确改过权限（5s 内推送过），这条回推是旧值，忽略之。
        const threadId = params.threadId as string | undefined;
        const recentPush = threadId && Date.now() - (threadPermPushAtRef.current.get(threadId) ?? 0) < 5_000;
        const savedPerms = threadId ? loadThreadPermissions(threadId) : null;
        const localSandbox = savedPerms && (savedPerms.sandbox === "danger-full-access" || savedPerms.sandbox === "read-only" || savedPerms.sandbox === "workspace-write") ? savedPerms.sandbox : null;
        const localApproval = savedPerms && (savedPerms.approval === "never" || savedPerms.approval === "on-request" || savedPerms.approval === "untrusted") ? savedPerms.approval : null;
        // 记录可信度（09-10「权限总是掉」的真凶）：本地记录若 == 引擎本次推的值 且 ≠ 全局默认，
        // 说明是旧版本自动回写/引擎回推烙进来的脏数据（用户从没选过）——照单全收会把 UI 拖回
        // 低权限（实测 21:41 起沙箱被拖回 workspace-write，之后每轮都掉）。这种记录忽略，
        // 保持用户当前选择；引擎侧由 openThread 自愈与逐回合 sandboxPolicy 纠正，此处**不回推**
        // （回推会触发引擎再推 settings/updated，5s 节流挡不住周期性循环）。
        const globalDefaultSandbox = (["danger-full-access", "read-only", "workspace-write"] as const).includes(localStorage.getItem("default-sandbox") as never) ? (localStorage.getItem("default-sandbox") as string) : "danger-full-access";
        const globalDefaultApproval = (["never", "on-request", "untrusted"] as const).includes(localStorage.getItem("default-approval") as never) ? (localStorage.getItem("default-approval") as string) : "never";
        const recordTrustedHere = (value: string | null, engineValue: string | null | undefined, globalDefault: string) => Boolean(value) && !(value && engineValue && value === engineValue && value !== globalDefault);
        const trustedSandbox = recordTrustedHere(localSandbox, mode, globalDefaultSandbox) ? localSandbox : null;
        const trustedApproval = recordTrustedHere(localApproval, policy, globalDefaultApproval) ? localApproval : null;
        const effectiveSandbox = recentPush && localSandbox ? localSandbox : (trustedSandbox ?? sandbox ?? globalDefaultSandbox);
        const effectiveApproval = recentPush && localApproval ? localApproval : (trustedApproval ?? approvalPolicy ?? globalDefaultApproval);
        // 引擎回推的 sandboxPolicy 是线程当前状态，可能是被历史降级/创建时旧值，不可作为持久记录——
        // 本地无用户选择时只临时显示（等 resume 恢复给出权威值），绝不落盘。落盘会污染 localPerms，
        // 让 resume 恢复读到灰值并 push 回引擎 → 重启后完全权限被静默降级成 workspace-write（变灰根因）。
        if (effectiveSandbox && threadId && localSandbox) saveThreadPermissions(threadId, effectiveSandbox, effectiveApproval);
        if (effectiveSandbox) setSandbox(effectiveSandbox);
        setApprovalPolicy(effectiveApproval);
        // 思考等级同理：引擎回推的可能是创建时的旧值，本地有每会话记录时以本地为准
        {
          const localEffort = threadId ? loadThreadEffort(threadId) : "";
          setEffort(normalizeEffort(localEffort || params.threadSettings.effort) || "");
        }
        setPersonality(params.threadSettings.personality ?? "none");
      } else if (event.method === "thread/queue/changed") {
        void refreshQueue(params.threadId);
      } else if (event.method === "thread/archived" || event.method === "thread/deleted") {
        setThreads((current) => current.filter((entry) => entry.id !== params.threadId));
        threadCacheRef.current.delete(params.threadId);
        if (threadRef.current?.id === params.threadId) {
          // 引擎侧归档/删除当前会话同样走完整复位（漏 sending 会让发送按钮卡成「停止」）
          startNewThread();
        }
      } else if (event.method === "model/verification") {
        const verificationText = (params.verifications ?? []).map((entry: any) => entry.message ?? JSON.stringify(entry)).join("\n") || "完成";
        // 模型元数据回退属已知无害噪音（自定义模型名不在引擎内置表），不弹「模型校验」卡
        if (/unknown model|fallback (model )?metadata|model metadata.*not found/i.test(verificationText)) return;
        showToast("模型校验", translateEngineNotice(verificationText));
      } else if (event.method === "model/safetyBuffering/updated" && params.showBufferingUi) {
        showToast("模型安全缓冲", params.reasons?.join("；") || "正在检查模型输出");
      } else if (event.method === "thread/compacted") {
        compactPendingRef.current.delete(String(params.threadId ?? threadRef.current?.id ?? ""));
        // 压缩后上下文骤降：清掉 total 差值快照，让引擎随后的 usage 推送不被
        // 「input/cached 单调递增」的差值推导误判（压缩后 input 回落是正常的），
        // ContextRing 才能真实反映压缩后的占用。下一轮对话完成时用量自然刷新。
        {
          const tid = String(params.threadId ?? threadRef.current?.id ?? "");
          if (tid) { tokenUsageTotalsRef.current.delete(tid); derivedTokenUsageRef.current.delete(tid); }
        }
        setCompactEventState("success");
      } else if (event.method === "model/rerouted") {
        showToast("模型已切换", `${params.fromModel} → ${params.toModel}`);
      } else if (["warning", "guardianWarning", "deprecationNotice", "configWarning"].includes(event.method ?? "")) {
        const text = String(params.message ?? params.details ?? "");
        // 已知无害的技术性提示不弹卡（模型元数据回退、压缩英文提示）：
        // - "Unknown model X is used. This will use fallback model metadata."
        //   "Model metadata for X not found. Defaulting to fallback metadata..."
        //   自定义模型名不在引擎内置元数据表时触发，属正常噪音（上下文窗口已在
        //   custom-model.json 里配置，引擎会用用户给的 contextWindow，不影响使用）。
        // - "Heads up: Long threads…"（压缩英文提示）已在上方「上下文已压缩」卡片中翻译。
        if (/unknown model|fallback (model )?metadata|model metadata.*not found/i.test(text)) return;
        // 引擎协议迁移提示（如 Full-history hydration deprecated for paginated threads…）
        // 面向的是宿主开发者：harness 已做 thread/turns/list 分页兜底，弹给用户只会被当成「出 BUG 了」
        if (event.method === "deprecationNotice" && /hydrat|deprecat|use `excludeTurns/i.test(text + " " + String(params.summary ?? ""))) return;
        if (!/long threads|multiple compactions/i.test(text)) showToast(event.method === "configWarning" ? params.summary ?? "配置警告" : "Codex 提示", translateEngineNotice(text) || JSON.stringify(params));
      }
    });
    const offChannel = window.codex.onChannelBotEvent((event) => {
      setChannelBot((current) => current ? { ...current, ...event.status, logs: [...(current.logs ?? []), { at: event.at, level: event.level, message: event.message }].slice(-20) } : current);
      if (event.level === "error") setChannelStatus(event.message);
      // 网关状态变化（微信/Telegram 连接成功）时刷新圆点
      if (/微信|Telegram/.test(event.message)) void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined);
    });
    const offHarness = window.codex.onHarnessEvent((event) => {
      if (event.type === "scheduler") showToast("定时任务", event.message);
      if (event.type === "memory") showToast("记忆", event.message);
      if (event.type === "skill-install") {
        const positions: Record<string, number> = { download: 1, extract: 2, audit: 3, install: 4, register: 5, engine: 6, verify: 6, complete: 7, pending: 7 };
        setSkillInstall((current) => {
          if (!current || current.skill.id !== event.skillId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRegistered: event.stage === "complete" ? true : current.engineRegistered, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
      if (event.type === "skill-remove") {
        const positions: Record<string, number> = { prepare: 1, delete: 2, registry: 3, engine: 4, verify: 5, complete: 6, pending: 6 };
        setSkillRemove((current) => {
          if (!current || current.folder !== event.skillId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRemoved: event.stage === "complete" ? true : current.engineRemoved, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
      if (event.type === "plugin-install") {
        const positions: Record<string, number> = { resolve: 1, download: 2, install: 3, register: 4, engine: 5, verify: 6, complete: 7, pending: 7 };
        setPluginInstall((current) => {
          if (!current || current.plugin.slug !== event.pluginId) return current;
          return { ...current, current: Math.max(current.current, positions[event.stage] ?? current.current), engineRegistered: event.stage === "complete" ? true : current.engineRegistered, engineCheckMessage: ["complete", "pending"].includes(event.stage) ? event.message : current.engineCheckMessage };
        });
      }
    });

    void window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false })
      .then((threadResult) => {
        const list = threadResult.data ?? [];
        setThreads(list);
        setServerStatus("ready");
        // 启动恢复上次会话：不恢复会停在欢迎页，用户一发消息就新建空会话——
        // 表现为「重启后莫名其妙多出一个分支」，而原对话其实还在列表里（09-10 反馈）。
        const lastId = (() => { try { return localStorage.getItem("last-thread"); } catch { return null; } })();
        if (lastId && list.some((entry: any) => entry.id === lastId)) void openThread(lastId);
      })
      .catch(() => setServerStatus("error"))
      .finally(() => setLoading(false));
    return () => { off(); offChannel(); offHarness(); };
  }, []);

  useEffect(() => { if (!loading) void refreshThreads(); }, [loading]);

  // 设置弹窗「骨架先行」：点击入口先画弹窗框架与 loading，重内容与引擎 RPC 延后一帧。
  // 软件渲染（无 GPU 加速）机器上弹窗内容大，同步挂载会造成「点了没反应」的冻结感。
  const [settingsContentReady, setSettingsContentReady] = useState(false);
  useEffect(() => {
    if (!settingsOpen) { setSettingsContentReady(false); return; }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setSettingsContentReady(true);
        void refreshSettingsResources();
      });
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, [settingsOpen, workspace]);
  // MCP 状态（toolsAndAuthOnly 会逐个拉起 MCP 服务枚举工具，CPU 开销大）只在真正进入
  // MCP 管理页时拉取，打开技能/插件等其他分区不再连带触发冷启动争抢。
  const mcpDetailLoadedRef = useRef(false);
  useEffect(() => {
    if (settingsOpen && settingsPage === "mcp" && settingsContentReady && !mcpDetailLoadedRef.current) {
      mcpDetailLoadedRef.current = true;
      void refreshSettingsResources({ mcpDetail: true });
    }
  }, [settingsOpen, settingsPage, settingsContentReady]);
  // 市场列表按需加载：只有对应市场页真正可见时才请求（应用启动不再全量拉取）；
  // 搜索输入 350ms 防抖，避免每个按键都打一次远端接口
  const [skillHubSearchDebounced, setSkillHubSearchDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setSkillHubSearchDebounced(skillHubSearch), 350); return () => clearTimeout(t); }, [skillHubSearch]);
  const [pluginMarketSearchDebounced, setPluginMarketSearchDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setPluginMarketSearchDebounced(pluginMarketSearch), 350); return () => clearTimeout(t); }, [pluginMarketSearch]);
  useEffect(() => {
    if (!settingsOpen || settingsPage !== "skills" || skillsManageOnly) return;
    void refreshMarketSkills(skillHubCategory, skillHubSearchDebounced, marketPage);
  }, [settingsOpen, settingsPage, skillHubCategory, skillHubSearchDebounced, skillsManageOnly, marketPage]);
  useEffect(() => {
    if (!settingsOpen || settingsPage !== "plugins") return;
    void refreshMarketPlugins(pluginMarketCategory, pluginMarketSearchDebounced, pluginMarketPage);
  }, [settingsOpen, settingsPage, pluginMarketCategory, pluginMarketSearchDebounced, pluginMarketPage]);

  useEffect(() => {
    if (!thread) return;
    void window.codex.request("thread/memoryMode/set", { threadId: thread.id, mode: memoryEnabled ? "enabled" : "disabled" }).catch(() => undefined);
  }, [thread?.id]);

  useEffect(() => {
    if (rightTab === "tree" && workspace) void loadTree(workspace);
  }, [rightTab, workspace]);

  useEffect(() => {
    if (thread) void refreshQueue(thread.id);
    else setQueue([]);
  }, [thread?.id]);

  // 流式断流心跳监控：回合进行中但 >90s 没有任何流式事件 → 多半是 turn/completed 丢了
  // （引擎重启/流断掉），向引擎 resume 校对；只有服务端明确已结束而本地还在跑时才落地，
  // 解开「任务早就写完却永远正在运行 + 过程卡片刷屏」的死局。正常流式不受影响。
  const lastStreamTsRef = useRef(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = threadRef.current;
      const lastTurn = current?.turns[current.turns.length - 1];
      if (!current || !lastTurn || !isTurnRunning(lastTurn)) return;
      if (Date.now() - lastStreamTsRef.current < 90_000) return;
      lastStreamTsRef.current = Date.now(); // 防抖：resume 失败也不要每 30s 连环打
      // 心跳校对期间给用户可见反馈：否则「引擎其实在跑但没出字」看起来就是莫名其妙不回复
      const staleTurnId = lastTurn.id;
      const staleThreadName = current.name || "当前会话";
      setSystemEvents((currentEvents) => {
        if (currentEvents.some((event) => event.hookKey === `stream-stale-${staleTurnId}`)) return currentEvents;
        return [...currentEvents, { id: crypto.randomUUID(), title: "回复等待中", text: "超过 90 秒没有收到新内容，正在与引擎校对任务状态……（若上游卡住，可点输入框旁的停止按钮后重发）", tone: "warning", hookKey: `stream-stale-${staleTurnId}` }] as any;
      });
      // 提醒不常驻：无论校对是否确认（上游真卡住时 resume 对不上会一直挂着），25s 后自动撤掉，
      // 避免「回复等待中」占位卡在时间线里不好看；引擎恢复/校对确认时下方也会主动清除。
      window.setTimeout(() => {
        setSystemEvents((currentEvents) => currentEvents.filter((event) => event.hookKey !== `stream-stale-${staleTurnId}`));
      }, 25_000);
      void window.codex.request("thread/resume", { threadId: current.id, excludeTurns: false }).then((result) => {
        if (!result?.thread) return;
        const serverLast = result.thread.turns[result.thread.turns.length - 1];
        const localLast = threadRef.current?.turns[threadRef.current.turns.length - 1];
        if (!serverLast || !localLast || serverLast.id !== localLast.id) return;
        if (isTurnRunning(localLast) && !isTurnRunning(serverLast)) {
          const merged = mergeTurn(threadRef.current, serverLast);
          if (merged && merged !== threadRef.current) {
            threadRef.current = merged;
            threadCacheRef.current.set(merged.id, merged);
            setThread(merged);
            // 校对确认已结束：撤掉等待提示（success 常驻可手动关，不自动消失误导）
            setSystemEvents((currentEvents) => currentEvents.filter((event) => event.hookKey !== `stream-stale-${staleTurnId}`));
            setSystemEvents((currentEvents) => [...currentEvents, { id: crypto.randomUUID(), title: "状态已同步", text: `「${staleThreadName}」的任务实际已在上游完成，界面已恢复。`, tone: "info", hookKey: `stream-settled-${staleTurnId}` }] as any);
          }
        }
      }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // （已删除重复的 smooth 跟随 effect：sticky layout effect 已在 [thread] 变化时
  // 用 behavior:auto 同步跳底，smooth 版本会在长会话切换时产生数秒的滚动动画。）

  function savedEffortFor(model: string | undefined) {
    if (!model) return "";
    try { return (JSON.parse(localStorage.getItem("model-efforts") ?? "{}") as Record<string, string>)[model] ?? ""; } catch { return ""; }
  }

  function rememberEffortFor(model: string | undefined, value: string) {
    if (!model || !value) return;
    try {
      const map = JSON.parse(localStorage.getItem("model-efforts") ?? "{}") as Record<string, string>;
      map[model] = value;
      localStorage.setItem("model-efforts", JSON.stringify(map));
    } catch { /* 忽略 */ }
  }

  async function chooseModel(value: string) {
    const prevLabel = modelName(modelId) || modelId;
    // value 形如 `custom:<provider>:<model>`
    const match = value.match(/^custom:([^:]+):(.+)$/);
    const provider = match?.[1];
    const model = match?.[2] ?? value;
    const next = allModels.find((entry) => entry.id === value || entry.model === value);
    const nextLabel = next?.model ?? modelName(value);
    const currentThreadId = threadRef.current?.id;
    const saveSelection = (nextId: string) => {
      setModelId(nextId);
      if (currentThreadId) saveThreadModel(currentThreadId, nextId);
      else localStorage.setItem("default-model", nextId);
    };
    // 跨供应商切换 = 切换全局 API Key，必须重启引擎生效。用户要求「切换必须重启应用」：
    // 弹窗确认后先落盘配置（apply:false 不重启引擎），再整体重启应用——启动时引擎按新
    // 供应商的 Key 全新注入，状态彻底归位；旧会话下次打开时由发送前迁移自动跟随。
    if (provider && customModel && provider !== customModel.provider) {
      if (!(await openAppConfirm("切换供应商", `将切换到 ${nextLabel || model}，应用将自动重启使配置完全生效。\n正在运行的任务会被中断，会话历史完整保留。\n是否继续？`, "切换并重启应用"))) return;
      try {
        await window.codex.setProviderModel({ provider, model, apply: false }); // 只落盘
        const selectedId = `custom:${provider}:${model}`;
        saveSelection(selectedId);
        localStorage.setItem("default-model", selectedId);
        localStorage.setItem("thread-model-" + (threadRef.current?.id ?? ""), selectedId);
        showToast("已切换", "应用即将重启以完全生效……");
        setTimeout(() => { void window.codex.relaunchApp(); }, 800);
        return;
      } catch (error: any) {
        setNotice(`切换供应商失败：${error.message}`);
        return;
      }
    }
    // 用户主动切模型时给一条会话内提醒（与引擎 sideband 的模型切换事件互为补充）
    if (nextLabel && prevLabel && nextLabel !== prevLabel) showToast("模型已切换", `${prevLabel} → ${nextLabel}`);
    // 切模型的 effort 选择：该模型记过档位用之；否则当前会话已有档位保持不变（会话内不突袭改档）；
    // 都没有才落到模型默认档
    const threadEffort = currentThreadId ? loadThreadEffort(currentThreadId) : "";
    const nextEffort = savedEffortFor(next?.model) || threadEffort || pickDefaultEffort(next?.supportedReasoningEfforts, next?.defaultReasoningEffort);
    setEffort(nextEffort);
    if (nextEffort) {
      localStorage.setItem("default-effort", nextEffort);
      if (currentThreadId) saveThreadEffort(currentThreadId, nextEffort);
    }
    saveSelection(value);

    // 同供应商模型已在 catalog 中，直接更新当前会话即可。这里绝不能调用
    // setProviderModel：它会重写全局配置并重启引擎，导致其他运行会话被终止。
    if (provider && customModel && provider === customModel.provider) {
      try {
        await updateThreadSettings({ model, model_provider: provider, effort: nextEffort || null });
        setNotice(`${threadRef.current ? "当前会话" : "新会话默认"}已选择：${customModel.name} · ${model}`);
        return;
      } catch (error: any) {
        setNotice(error.message);
        return;
      }
    }
    // 无 provider 前缀（内置模型）：只更新线程设置
    void updateThreadSettings({ model: model ?? value, effort: nextEffort || null });
  }

  /** 会话跨供应商迁移：引擎线程绑定创建时的 provider，settings/update 换 provider 会被拒。
   *  唯一官方通道 = thread/resume { modelProvider, config, model }（schema 实证 resume 接受
   *  这三个覆盖参数）——resume 后会话即绑定新供应商，历史完整保留，原会话数据不丢。 */
  async function migrateThreadToProvider(threadId: string, target: { provider: string; model: string; name: string; baseUrl: string; wireApi?: string }): Promise<boolean> {
    try {
      const officialTarget = target.provider === "openai-official";
      const resumeParams: Record<string, unknown> = {
        threadId,
        excludeTurns: true,
        model: target.model,
        // 实证（rollout 07:19:54）：引擎重启后 resume 若不带 sandbox，线程权限被重置成
        // workspace-write+restricted——完全访问静默失效。resume 接受 sandbox 字符串
        // （schema 实证），这里带上当前用户偏好，迁移同时把权限一并钉住。
        sandbox: sandbox,
        approvalPolicy: approvalPolicy,
        // 官方订阅走引擎内置 openai 通道：不传 modelProvider/config（实证：传了即触发
        // CODEX_HARNESS_API_KEY 校验导致流断）；其他供应商内联完整定义
        ...(officialTarget ? {} : {
          modelProvider: target.provider,
          config: {
            model_provider: target.provider,
            model_providers: {
              [target.provider]: {
                name: target.name,
                base_url: target.baseUrl,
                env_key: "CODEX_HARNESS_API_KEY",
                wire_api: (target.wireApi === "chat" ? "chat" : "responses"),
                requires_openai_auth: false,
              },
            },
          },
        }),
      };
      await window.codex.request("thread/resume", resumeParams);
      await updateThreadSettings({ model: target.model, ...(officialTarget ? {} : { model_provider: target.provider }), effort: null });
      // 迁移成功：更新会话绑定供应商登记表（发送前检测依赖此表）
      threadProviderRef.current.set(threadId, target.provider);
      return true;
    } catch { return false; }
  }

  /** 供应商切换「重启生效」：重启引擎使新供应商配置生效，成功后迁移当前会话并刷新 UI 状态。
   *  手动点击 banner 时读 state；引擎空闲自动生效时由 chooseModel 直接传入 pending 对象。 */
  async function applyPendingRestart(pendingOverride?: { provider: string; model: string; label: string; prevProvider: string; prevModel: string } | null) {
    const pending = pendingOverride ?? pendingRestartRef.current;
    if (!pending) return;
    try {
      const updated = await window.codex.applyCustomModel();
      setCustomModel(updated);
      setModelId(`custom:${updated.provider}:${updated.model}`);
      localStorage.setItem("default-model", `custom:${updated.provider}:${updated.model}`);
      // 会话跨供应商迁移（复用 migrateThreadToProvider：resume 后会话即绑定新供应商，
      // 历史完整保留，原会话数据不丢）。
      if (threadRef.current?.id) {
        const migrated = await migrateThreadToProvider(threadRef.current.id, {
          provider: updated.provider, model: updated.model, name: updated.name, baseUrl: updated.baseUrl, wireApi: updated.wireApi,
        });
        if (migrated) {
          showToast("已切换供应商", `当前会话已迁移到 ${updated.name} · ${updated.model}，历史完整保留`);
        } else {
          // 迁移失败（如极老会话）退回接力方案：新会话带上下文
          showToast("已切换供应商", `新会话将使用 ${updated.name} · ${updated.model}（当前会话迁移失败，历史保留在原会话）`);
        }
      } else {
        await updateThreadSettings({ model: updated.model, ...(updated.provider === "openai-official" ? {} : { model_provider: updated.provider }), effort: null });
      }
      setPendingRestart(null);
      setNotice(`已切换到 ${updated.name} · ${updated.model}`);
    } catch (error: any) {
      // 失败时挂上 banner 供手动重试（自动模式失败也可见，避免静默失败）
      if (pendingOverride && !pendingRestartRef.current) setPendingRestart(pendingOverride);
      setNotice(`重启生效失败：${error.message}`);
    }
  }

  /** 撤销待重启的供应商切换：把激活配置恢复为原供应商（只改配置不重启，原会话不受影响） */
  async function cancelPendingRestart() {
    const pending = pendingRestartRef.current;
    if (!pending) return;
    try {
      await window.codex.setProviderModel({ provider: pending.prevProvider, model: pending.prevModel, apply: false });
      setPendingRestart(null);
      showToast("已撤销切换", "继续使用原供应商");
    } catch (error: any) {
      setNotice(`撤销失败：${error.message}`);
    }
  }

  async function updateThreadSettings(values: Record<string, unknown>) {
    if (!thread) return;
    // codex app-server 偶尔会重启（切换供应商/启用禁用），重启后内存里没有旧任务，
    // 直接 thread/settings/update 会报 "thread not found"。自动 re-resume 一次再重试。
    const call = () => window.codex.request("thread/settings/update", { threadId: thread.id, ...values });
    const resume = () => resumeThreadWithTurns({ threadId: thread.id, excludeTurns: false });
    try {
      await call();
    } catch (error: any) {
      const message = String(error?.message ?? "");
      if (message.includes("thread not found")) {
        try {
          const result = await resume();
          if (result?.thread) {
            const loaded = normalizeLoadedThread(result.thread);
            threadRef.current = loaded;
            setThread(loaded);
          }
          await call();
        } catch (retryError: any) {
          setNotice(retryError?.message ?? message);
        }
      } else {
        setNotice(message);
      }
    }
  }

  /** 权限推送（sandbox/approval）必须走 thread/resume 的覆盖参数：
   *  thread/settings/update 的 collaboration Settings 只含 model/developer_instructions/
   *  reasoning_effort，协议 schema 里不含 sandbox（09-06 实证：settings/update 传
   *  sandboxPolicy 对象被静默丢弃 → 胶囊显示完全访问但引擎实际还是 workspace-write，
   *  工作区外 git 写 HOME 被 restricted token 拒）。engine 0.150.1 唯一支持会话中途
   *  改 sandbox 的通道 = thread/resume { sandbox, approvalPolicy }（memory：会话权限
   *  优先级 本地每会话 > 全局 default > resume，resume 正是此链条的权威落点）。
   *  excludeTurns:true 只回线程元数据，不拉回合载荷，开销最小。 */
  async function pushThreadPermissions(id: string, sandboxValue: string, approvalValue: string) {
    if (!id) return;
    // 记录推送时间戳：引擎在设置生效后异步回推一条带旧策略的 settings/updated，
    // 时间窗内的回推是旧值，事件侧据此忽略（防止胶囊被打回灰色）。
    threadPermPushAtRef.current.set(id, Date.now());
    // 双通道推送：settings/update 换审批+沙箱策略（0.153.4 实证接受 sandboxPolicy）；
    // 但引擎重启后 settings/update 对已存在线程**不回读 sandbox**（实证 07:19:54：
    // 重启后首个 turn 权限被重置成 workspace-write，settings/update 推了也没生效）——
    // resume 通道才真正接受 sandbox 字符串（schema 实证）。所以补一发带沙箱的 resume
    // 钉住权限（excludeTurns:true 不拉历史，开销极小）。
    const call = () => window.codex.request("thread/settings/update", { threadId: id, approvalPolicy: approvalValue, sandboxPolicy: sandboxPolicy(sandboxValue, workspace) });
    try {
      await call();
      await window.codex.request("thread/resume", { threadId: id, excludeTurns: true, sandbox: sandboxValue, approvalPolicy: approvalValue });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      // 空会话（还没发过首条消息）没有 rollout，settings/update 会报 "thread not found"——
      // 此时 sandbox 已在 thread/start 创建时按当前偏好写入，无需补救
      if (message.includes("no rollout found") || message.includes("thread not found")) return;
      setNotice(message);
    }
  }

  function changeApproval(value: string) {
    setApprovalPolicy(value);
    localStorage.setItem("default-approval", value);
    if (threadRef.current) saveThreadPermissions(threadRef.current.id, sandbox, value);
    void pushThreadPermissions(threadRef.current?.id ?? "", sandbox, value);
  }

  /** 权限胶囊的组合档位切换：完全访问 = danger-full-access + never；其余档位 = workspace-write + 对应审批。
   *  不能拆成 changeSandbox/changeApproval 先后调——两个 setter 都读旧 state 互相覆盖
   *  （09-04 实证：从完全访问切「变更前确认」只改了审批，沙箱钉死 → 胶囊永远显示完全访问）。 */
  function changePermissionMode(value: string) {
    const sandboxValue = value === "never" ? "danger-full-access" : "workspace-write";
    const approvalValue = value === "never" ? "never" : value;
    setSandbox(sandboxValue);
    setApprovalPolicy(approvalValue);
    if (threadRef.current) saveThreadPermissions(threadRef.current.id, sandboxValue, approvalValue);
    localStorage.setItem("default-sandbox", sandboxValue);
    localStorage.setItem("default-approval", approvalValue);
    void pushThreadPermissions(threadRef.current?.id ?? "", sandboxValue, approvalValue);
  }

  // 设置页全局审批权限的展示值（与 localStorage 双写，进页面读一次）
  const [globalPermApproval, setGlobalPermApproval] = useState(() => localStorage.getItem("default-approval") ?? "on-request");
  /** 设置页「全局审批权限」：只写全局默认并应用到**未被手动改过权限**的会话。
   *  与胶囊（changePermissionMode）的差异：胶囊会把当前会话写进本地记录（= 手动修改，
   *  之后不随全局）；这里不动任何会话的记录——手动改过的对话框保留自己的选择。
   *  全局默认落在 localStorage，重启/换供应商都不会变（沙箱策略同时按档位联动）。 */
  function applyGlobalPermissionMode(value: string) {
    const sandboxValue = value === "never" ? "danger-full-access" : "workspace-write";
    const approvalValue = value === "never" ? "never" : value;
    setGlobalPermApproval(value);
    localStorage.setItem("default-sandbox", sandboxValue);
    localStorage.setItem("default-approval", approvalValue);
    const current = threadRef.current;
    const manual = current ? loadThreadPermissions(current.id) : { sandbox: "", approval: "" };
    if (current && (manual.sandbox || manual.approval)) {
      showToast("全局权限已更新", "当前会话手动改过权限，保留它自己的选择；其余会话与新会话使用新档位");
      return;
    }
    setSandbox(sandboxValue);
    setApprovalPolicy(approvalValue);
    if (current) void pushThreadPermissions(current.id, sandboxValue, approvalValue);
    showToast("全局权限已更新", "所有未手动改过权限的会话与新会话都使用新档位，重启不变");
  }

  function changeSandbox(value: string) {
    // 切换执行范围不会废弃 Codex 的工具或推理能力；只改变命令/文件操作是否需要审批。
    // 从完全访问降级时默认启用按需审批，确保它仍会请求授权并继续执行。
    const nextApproval = value === "danger-full-access" ? "never" : approvalPolicy === "never" ? "on-request" : approvalPolicy;
    setSandbox(value);
    setApprovalPolicy(nextApproval);
    if (threadRef.current) saveThreadPermissions(threadRef.current.id, value, nextApproval);
    localStorage.setItem("default-sandbox", value);
    localStorage.setItem("default-approval", nextApproval);
    void pushThreadPermissions(threadRef.current?.id ?? "", value, nextApproval);
  }

  /** 只切档位、不碰模型声明（供菜单选择/命令与「声明被取消后回落」分别使用） */
  function applyEffort(value: string) {
    setEffort(value);
    localStorage.setItem("default-effort", value);
    rememberEffortFor(selectedModel?.model ?? modelName(modelId), value);
    // 思考等级按会话独立：当前有会话就记到会话上（切回来自动恢复），无会话才只是全局默认
    if (threadRef.current?.id) saveThreadEffort(threadRef.current.id, value);
    void updateThreadSettings({ effort: value });
  }

  function changeEffort(value: string) {
    applyEffort(value);
    // 菜单/命令选到模型未声明的档位时自动补声明：引擎按 catalog 的 supported_reasoning_levels
    // 校验 effort，未声明会被拒。乐观更新生效配置与设置页草稿两份状态（防弹回竞态、保证
    // 思考菜单与模型设置页始终一致）+ 落库（upsertProviderModel 重写 model-catalog.json）。
    const provider = customModel?.provider;
    const targetModelId = selectedModel?.model ?? customModel?.model;
    const current = (customModel?.models ?? []).find((m) => m.id === targetModelId);
    if (provider && current && !(current.efforts ?? []).includes(value)) {
      const patched = { ...current, efforts: [...(current.efforts ?? []), value] };
      const patchModels = (models: any) => (models ?? []).map((m: any) => m.id === patched.id ? patched : m);
      setCustomModel((c: any) => c ? { ...c, models: patchModels(c.models) } : c);
      setCustomDraft((c: any) => ({ ...c, models: patchModels(c.models) }));
      void upsertProviderModel(provider, patched);
    }
  }

  /** 当前模型「已声明」的档位——思考菜单与模型配置勾选的唯一数据源（双向同步）。 */
  const currentEffortOptions = useMemo(() => {
    const declared = (selectedModel?.supportedReasoningEfforts ?? []).map((entry) => entry.reasoningEffort);
    return declared.length ? declared : (customModel ? customModelEfforts : []);
  }, [selectedModel, customModel, customModelEfforts]);

  // 模型配置里取消勾选某档位后，若它正好是当前生效档位，自动回落——否则会把
  // 未声明档位继续发给引擎（引擎按 catalog 校验会拒）。
  useEffect(() => {
    if (!customModel || !currentEffortOptions.length) return;
    if (effort && !currentEffortOptions.includes(effort)) applyEffort(pickDefaultEffort(currentEffortOptions));
  }, [customModel, currentEffortOptions, effort]);

  function changePersonality(value: string) {
    setPersonality(value);
    localStorage.setItem("default-personality", value);
    void updateThreadSettings({ personality: value === "none" ? null : value });
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("消息已复制");
    } catch (error: any) {
      setNotice(`复制失败：${error.message}`);
    }
  }

  async function copyThreadReferenceId(target: { id: string }) {
    try {
      await navigator.clipboard.writeText(`会话 ID：${target.id}`);
      showToast("会话 ID 已复制", "粘贴到其他会话并发送，即可读取这条会话的对话记录");
    } catch (error: any) {
      setNotice(`复制会话 ID 失败：${error.message}`);
    }
  }

  async function loadThreadReference(id: string): Promise<ThreadReferencePayload | null> {
    // 新版桌面端优先从 rollout 原档只读，不触发会话切换；旧版本回退到 app-server resume。
    const previewConversation = (window.codex as any).previewConversation;
    if (typeof previewConversation === "function") {
      try {
        const preview = await previewConversation(id);
        if (preview?.messages?.length) {
          return buildThreadReferencePayload(id, preview.name, preview.messages);
        }
      } catch { /* 继续使用引擎回退 */ }
    }
    const result = await resumeThreadWithTurns({ threadId: id, excludeTurns: false });
    if (!result?.thread) return null;
    const source = normalizeLoadedThread(result.thread as Thread);
    const messages: { role: "user" | "assistant"; text: string }[] = [];
    for (const sourceTurn of source.turns ?? []) {
      for (const item of sourceTurn.items ?? []) {
        if (item.type === "userMessage") {
          const text = userDisplayText(itemText(item));
          if (text) messages.push({ role: "user", text });
        } else if (item.type === "agentMessage") {
          const text = itemText(item).trim();
          if (text) messages.push({ role: "assistant", text });
        }
      }
    }
    return buildThreadReferencePayload(id, source.name || source.preview || "未命名会话", messages);
  }

  async function resolveThreadReferences(text: string, currentThreadId?: string): Promise<{ text: string; blocks: string; referenced: boolean }> {
    const ids = extractThreadReferenceIds(text);
    if (!ids.length) return { text, blocks: "", referenced: false };
    const references: ThreadReferencePayload[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      if (id === currentThreadId?.toLowerCase()) {
        failures.push(`${id.slice(0, 8)}（不能引用当前会话自身）`);
        continue;
      }
      try {
        const reference = await loadThreadReference(id);
        if (reference) references.push(reference);
        else failures.push(`${id.slice(0, 8)}（没有可读取的消息）`);
      } catch {
        failures.push(`${id.slice(0, 8)}（未找到或无法读取）`);
      }
    }
    if (!references.length) throw new Error(`会话引用失败：${failures.join("；")}`);
    if (failures.length) showToast("部分会话引用失败", failures.join("；"));
    return {
      text: stripThreadReferenceIds(text),
      blocks: references.map(formatThreadReferenceBlock).join("\n\n"),
      referenced: true,
    };
  }

  async function editResend(turnId: string, item: ThreadItem) {
    if (!thread) return;
    if (sending || activeTurnId) { setNotice("请先停止当前任务，再编辑重发"); return; }
    if (!customModel || !selectedModel) { setNotice("请先配置并启用自定义模型"); setSettingsOpen(true); return; }
    const text = (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (!text.trim()) { setNotice("该消息没有可编辑的文本"); return; }
    try {
      const forked = await window.codex.request("thread/fork", { threadId: thread.id, beforeTurnId: turnId, excludeTurns: false });
      if (!forked.thread) { setNotice("创建编辑分支失败"); return; }
      threadRef.current = forked.thread;
      setThread(forked.thread);
      setModelId(`custom:${customModel?.provider ?? "custom"}:${forked.model ?? selectedModel?.model ?? customModel?.model ?? ""}`);
      const input = [
        { type: "text", text, text_elements: [] },
        ...(item.content ?? []).filter(isImagePart).map(normalizeImagePartForSend).filter(Boolean),
      ];
      setSending(true);
      setWorkStartedAt(Date.now());
      optimisticTurnIdRef.current = null;
      optimisticBaselineRef.current = { threadId: forked.thread.id, turnIds: new Set((forked.thread.turns ?? []).map((entry: Turn) => entry.id)) };
      const optimisticId = `local-${Date.now()}`;
      justSentIds.add(optimisticId);
      setOptimisticInput({ id: optimisticId, type: "userMessage", content: input });
      // 发送即贴底跟随最新：agent 回复从底部展开，始终自动滚到最新内容
      stickToBottomRef.current = true;
      activeModelRef.current = selectedModel?.model ?? modelName(modelId);
      const result = await window.codex.request("turn/start", {
        threadId: forked.thread.id,
        input,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || null,
        personality: selectedModel?.supportsPersonality ? personality : null,
        approvalPolicy,
        // 沙箱逐回合下发：fork 出的编辑分支同样按当前权限跑（见 send() 里的实证说明）
        sandboxPolicy: sandboxPolicy(sandbox, forked.thread.cwd ?? workspace ?? ""),
      });
      if (result.turn?.id) {
        const hydratedTurn = hydrateTurnUserMessage(result.turn, input);
        optimisticTurnIdRef.current = hydratedTurn.id;
        setActiveTurnId(hydratedTurn.id);
        markThreadRunning(forked.thread.id, hydratedTurn.id);
        saveThreadModel(forked.thread.id, modelId);
        setThread((current) => { const next = mergeTurn(current, hydratedTurn); threadRef.current = next; return next; });
        if (hydratedTurn.items.some((entry) => entry.type === "userMessage" && userMessageMatchesInput(entry, input))) setOptimisticInput(null);
      }
      void refreshThreads();
      showToast("已编辑重发", "已创建分支并重新发送");
    } catch (error: any) {
      setSending(false);
      setWorkStartedAt(null);
      setOptimisticInput(null);
      setNotice(`编辑重发失败：${error.message}`);
    }
  }

  async function copyImage(path: string) {
    try {
      // 本地图片：渲染层 fetch harness-image:// 自定义协议拿不到 blob（复制不了根因），
      // 走主进程 nativeImage → clipboard.write；http URL 才用 fetch + ClipboardItem。
      const local = resolveImagePath(path);
      if (local) {
        await window.codex.writeClipboardImage(local);
        setNotice("图片已复制");
        return;
      }
      const response = await fetch(path);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setNotice("图片已复制");
    } catch (error: any) { setNotice(`复制图片失败：${error.message}`); }
  }

  function quoteMessage(text: string) {
    const clean = text.trim();
    if (!clean) return;
    // 引用条模式：不把引用塞进输入框，而是在输入框上方显示可取消的引用条，发送时再拼块引用
    setQuoteItem({ id: `quote-${Date.now()}`, text: clean });
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function cancelQuote() {
    setQuoteItem(null);
  }

  function addContextItem(item: { id: string; role: "用户" | "Codex"; text: string }) {
    setContextItems((current) => [...current, item]);
    setPrompt((current) => current.replace(/@[^\s]*$/, ""));
    setContextQuery("");
    setContextOpen(false);
  }

  function removeContextItem(id: string) {
    setContextItems((current) => current.filter((item) => item.id !== id));
  }

  /** 引用一个技能：加入本轮技能条（发送时拼成 [本轮已引用技能]）并清掉输入框里的 #查询词。
   *  技能子面板与输入框「#」面板共用，保证两条入口行为一致。 */
  function addSkillReference(skill: { name: string; description: string }) {
    setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, { name: skill.name, description: skill.description }]);
    setPrompt((current) => current.replace(/#[^\s]*$/, ""));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function onPromptChange(value: string) {
    setPrompt(value);
    const at = value.lastIndexOf("@");
    const afterAt = at >= 0 ? value.slice(at + 1) : "";
    if (at >= 0 && !/\s/.test(afterAt)) {
      setContextQuery(afterAt);
      setContextOpen(true);
    } else {
      setContextOpen(false);
    }
  }

  async function forkFromTurn(turnId: string) {
    if (!thread) return;
    try {
      const result = await window.codex.request("thread/fork", { threadId: thread.id, turnId, excludeTurns: false });
      if (result.thread) {
        threadRef.current = result.thread;
        setThread(result.thread);
        setModelId(`custom:${customModel?.provider ?? "custom"}:${result.model ?? selectedModel?.model ?? customModel?.model ?? ""}`);
        await refreshThreads();
        showToast("任务已分支", "已从选定消息创建新的任务分支");
      }
    } catch (error: any) {
      setNotice(`创建分支失败：${error.message}`);
    }
  }

  /** 会话备份导出：threadIds 缺省/空数组 = 全部会话；单条走任务菜单「导出备份」 */
  async function exportThreadsBackup(threadIds?: string[]) {
    setBackupBusy("export");
    try {
      const res = await window.codex.exportThreadsBackup(threadIds && threadIds.length ? threadIds : undefined);
      if (res?.path) setNotice(`已导出 ${res.count} 个会话备份 → ${res.path}`);
    } catch (error: any) { setNotice("导出失败：" + error.message); }
    finally { setBackupBusy(""); }
  }
  /** 会话备份导入：rollout 写回 codex-home 后刷新列表，让会话立即出现在侧边栏 */
  async function importThreadsBackup() {
    setBackupBusy("import");
    try {
      const res = await window.codex.importThreadsBackup();
      if (!res) return; // 用户取消
      await refreshThreads();
      setNotice(res.imported
        ? `已导入 ${res.imported} 个会话${res.skipped ? `，跳过 ${res.skipped} 个已存在` : ""}`
        : `没有可导入的新会话${res.skipped ? `（${res.skipped} 个已存在被跳过，不覆盖）` : ""}`);
    } catch (error: any) { setNotice("导入失败：" + error.message); }
    finally { setBackupBusy(""); }
  }

  /** 会话记录导出为通用 Markdown（对齐官方 Codex /export：User/Assistant 交替、无系统注入，主流 AI 可直接带入） */
  async function exportThreadsMarkdown(threadIds?: string[]) {
    setBackupBusy("export-md");
    try {
      const res = await window.codex.exportThreadsMarkdown(threadIds && threadIds.length ? threadIds : undefined);
      if (res?.path) setNotice(`已导出 ${res.count} 个会话（${res.totalMessages} 条消息）为 Markdown → ${res.path}`);
    } catch (error: any) { setNotice("导出失败：" + error.message); }
    finally { setBackupBusy(""); }
  }

  /** 侧栏指定会话分支：不依赖当前打开的 thread，成功后直接进入新分支。 */
  async function forkThreadFromSidebar(entry: Thread) {
    if (runningThreadIdsRef.current.has(entry.id)) { setNotice("任务运行中，请完成或停止后再分支"); return; }
    try {
      const result = await window.codex.request("thread/fork", { threadId: entry.id, excludeTurns: false });
      if (!result?.thread) throw new Error("引擎未返回新分支");
      const sourceModel = loadThreadModel(entry.id);
      if (sourceModel) saveThreadModel(result.thread.id, sourceModel);
      await refreshThreads();
      await openThread(result.thread.id, result.thread);
      showToast("已创建会话分支", cleanThreadDisplayTitle(entry.name, { preview: entry.preview }));
    } catch (error: any) {
      setNotice(`创建分支失败：${error.message}`);
    }
  }

  /** 导入外部对话记录（主流 AI / 官方 Codex 导出的 .md/.txt 记录）：
   *  主进程选文件→解析→自动新建「导入：原会话名」命名会话并打开到对话框（不自动跑）；
   *  记录暂存为待发送（localStorage），用户发出首条消息时自动整段附上，界面折叠成可展开卡。 */
  async function importConversationMarkdown() {
    setBackupBusy("import-md");
    try {
      const res = await window.codex.importConversationMarkdown({
        cwd: workspace || undefined,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || undefined,
        sandbox,
        approvalPolicy,
        personality: selectedModel?.supportsPersonality ? personality : null,
      });
      if (!res) return; // 用户取消
      rememberPendingImport(res.thread.id, res.imported);
      setSettingsOpen(false);
      await openThread(res.thread.id, res.thread);
      // 新建线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次，让「导入：xxx」立即出现在左侧
      void refreshThreads();
      requestAnimationFrame(() => composerInputRef.current?.focus());
      setNotice(`已导入「${res.imported.title || res.imported.fileName}」并新建会话：直接输入即可继续，记录会在首条消息时自动附上`);
    } catch (error: any) { setNotice("导入失败：" + error.message); }
    finally { setBackupBusy(""); }
  }

  function startNewThread() {
    setChatSearchOpen(false);
    const savedSandbox = localStorage.getItem("default-sandbox") ?? "danger-full-access";
    threadRef.current = null;
    setThread(null);
    // 标准会话未选工作区：不悄悄默认，提醒用户自选（发送时才会真正用到目录）
    if (!workspace) setNotice("尚未选择工作区：当前会话暂用主目录，建议点右上角 📁 选择项目目录");
    // 重置滚动：上个会话若滚在中间，欢迎页会被顶出视口（顶部只露半截建议 chips 幻影）
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = 0; });
    setPrompt("");
    setImages([]);
    setModelId(localStorage.getItem("default-model") ?? modelId);
    setEffort(localStorage.getItem("default-effort") ?? effort);
    setSandbox(savedSandbox);
    setApprovalPolicy(localStorage.getItem("default-approval") ?? (savedSandbox === "danger-full-access" ? "never" : "on-request"));
    setPersonality(localStorage.getItem("default-personality") ?? "pragmatic");
    setDiff("");
    setSystemEvents([]);
    setOptimisticInput(null);
    setSending(false);
    setActiveTurnId(null);
    setInterrupting(false);
    setWorkStartedAt(null);
    closeTaskMenu();
    setMobileNav(false);
    setReviewBusy(false);
    setReviewReport("");
    reviewTurnRef.current = null;
    setPlanSteps([]);
    setGoalText("");
    // 立即与引擎同步一次列表：让左侧会话列表反映最新状态（含刚发起的专家团会话等）
    void refreshThreads();
  }

  async function runSlashCommand(value: string) {
    const [rawName, ...rest] = value.slice(1).trim().split(/\s+/);
    const name = rawName.toLowerCase();
    const argument = rest.join(" ").trim();
    if (!slashCommands.some(([command]) => command === name)) {
      // 自定义命令：命中 $CODEX_HOME/commands 或 .codex/commands 下的 .md 模板，
      // 展开参数/文件引用后作为普通消息发送（复刻 WorkBuddy 自定义命令语义）。
      try {
        const customList = await window.codex.listCommands({ cwd: workspace ?? undefined });
        const custom = customList.find((entry) => entry.name.toLowerCase() === name);
        if (!custom) return false;
        if (custom.argumentHint && !argument) {
          setPrompt(`/${name} `);
          showToast("命令需要参数", `/${name} ${custom.argumentHint}${custom.description ? ` — ${custom.description}` : ""}`);
          return true;
        }
        if (sending) { showToast("任务仍在运行", `请先使用 /stop，再执行 /${name}`); return true; }
        const { text } = await window.codex.expandCommand({ filePath: custom.filePath, argument, cwd: workspace ?? undefined });
        pendingCommandTextRef.current = text;
        setPrompt("");
        await send();
        return true;
      } catch (error: any) {
        showToast(`/${name} 执行失败`, error.message);
        return true;
      }
    }
    setPrompt("");
    try {
      if (name === "model" || name === "permissions") setSettingsOpen(true);
      else if (name === "new") startNewThread();
      else if (name === "resume") { setMobileNav(true); showToast("历史任务", "从左侧任务列表选择要恢复的会话"); }
      else if (name === "cd") await chooseWorkspace();
      else if (name === "pwd") setInfoModal({ title: "当前工作目录", body: workspace || "尚未选择工作区" });
      else if (name === "diff") { setRightOpen(true); showToast("文件改动", "已在右侧面板展示本轮 diff"); }
      else if (name === "status") setInfoModal({ title: "任务状态", body: `模型：${customModel?.model ?? "未配置"}\n思考：${effortLabels[effort] ?? effort}\n风格：${personality === "pragmatic" ? "务实" : personality === "friendly" ? "友好" : "默认"}\n线程：${thread?.status?.type ?? "未开始"}\n回合：${thread?.turns.at(-1)?.status ?? "无"}\n工作区：${workspace || "未选择"}` });
      else if (name === "help") setInfoModal({ title: "可用命令", body: builtinCommandCatalog.map((cmd) => `/${cmd.name}${cmd.hint ? " " + cmd.hint : ""} — ${cmd.description}`).join("\n") });
      else if (name === "context") setInfoModal({ title: "上下文占用", body: contextUsageText() });
      else if (name === "clear") {
        await clearCurrentConversation();
      }
      else if (name === "copy") { const last = thread?.turns.flatMap((turn) => turn.items).filter((item) => item.type === "agentMessage").at(-1); await copyMessage(itemText(last ?? ({} as ThreadItem))); }
      else if (name === "memory") { setSettingsOpen(true); setSettingsPage("memory"); }
      else if (name === "effort") {
        if (!argument) showToast("用法", "/effort 极简|轻量|均衡|标准|深度|极限|max");
        else {
          const alias: Record<string, string> = { 极简: "minimal", 轻量: "low", 均衡: "medium", 标准: "high", 深度: "xhigh", 极限: "ultra", 极少: "minimal", 低: "low", 中: "medium", 高: "high", max: "xhigh", 最高: "ultra", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", ultra: "ultra" };
          const target = alias[argument];
          if (!target) showToast("不支持的思考强度", "可选：极简 / 轻量 / 均衡 / 标准 / 深度 / 极限");
          else { changeEffort(target); showToast("思考强度已更新", effortLabels[target] ?? target); }
        }
      } else if (name === "personality") {
        const alias: Record<string, string> = { 务实: "pragmatic", 友好: "friendly", 默认: "none" };
        const target = alias[argument];
        if (!target) showToast("用法", "/personality 务实|友好|默认");
        else { changePersonality(target); showToast("回复风格已更新", argument); }
      } else if (name === "sandbox") {
        const alias: Record<string, string> = { 只读: "read-only", 工作区可写: "workspace-write", 完全访问: "danger-full-access", "read-only": "read-only", "workspace-write": "workspace-write", "danger-full-access": "danger-full-access" };
        const target = alias[argument];
        if (!target) showToast("用法", "/sandbox 只读|工作区可写|完全访问");
        else { changeSandbox(target); showToast("沙箱已切换", argument); }
      } else if (name === "approval") {
        const alias: Record<string, string> = { 按需: "on-request", 从不: "never", "on-request": "on-request", never: "never" };
        const target = alias[argument];
        if (!target) showToast("用法", "/approval 按需|从不");
        else { changeApproval(target); showToast("审批策略已更新", argument); }
      } else if (name === "stop") await interrupt();
      else {
        if (!thread) { showToast("无法执行", `/${name} 需要先开始一个任务`); return true; }
        if (name === "archive") await archiveThread(thread.id);
        else if (name === "delete") {
          if (await openAppConfirm("清空当前对话", "当前会话及其中的消息将被永久删除，此操作无法撤销。", "永久删除")) {
            await window.codex.request("thread/delete", { threadId: thread.id });
            setThreads((current) => current.filter((entry) => entry.id !== thread.id));
            setThread(null);
          }
        } else if (name === "rename") {
          if (!argument) showToast("用法", "/rename 新名称");
          else await renameThread(thread.id, argument);
        } else if (name === "fork") {
          const result = await window.codex.request("thread/fork", { threadId: thread.id, excludeTurns: false });
          setThread(result.thread);
          setModelId(`custom:${customModel?.provider}:${customModel?.model}`);
          await refreshThreads();
          showToast("任务已分叉", "接下来的对话会写入新的任务分支");
        } else if (name === "compact") {
          compactPendingRef.current.add(thread.id);
          setCompactEventState("running");
          try {
            await window.codex.request("thread/compact/start", { threadId: thread.id });
          } catch (error: any) {
            compactPendingRef.current.delete(thread.id);
            setCompactEventState("error", error.message);
            throw error;
          }
        } else if (name === "review") {
          const target = argument ? { type: "custom", instructions: argument } : { type: "uncommittedChanges" };
          const result = await window.codex.request("review/start", { threadId: thread.id, target, delivery: "inline" });
          setActiveTurnId(result.turn.id);
          markThreadRunning(thread.id, result.turn.id);
        } else if (name === "goal") {
          // /goal 目标模式：引擎原生 thread goal——目标持续存在跨回合，回合结束后引擎
          // 自动 continuation 续跑，模型用 update_goal 工具判定 complete/blocked 后停。
          if (argument === "clear" || argument === "停止" || argument === "stop") {
            await window.codex.request("thread/goal/clear", { threadId: thread.id });
            setGoalText("");
            setGoalStatus(null);
            showToast("目标模式已停止", "已清除长期目标，自动推进结束");
          } else if (argument) {
            await window.codex.request("thread/goal/set", { threadId: thread.id, objective: argument });
            showToast("目标模式已启动", "将自动持续推进直到目标达成；/goal clear 可随时停止");
          } else {
            const result = await window.codex.request("thread/goal/get", { threadId: thread.id });
            const goal = result.goal;
            const statusLabel: Record<string, string> = { active: "进行中", paused: "已暂停", blocked: "受阻", usageLimited: "用量受限", budgetLimited: "预算受限", complete: "已完成" };
            setInfoModal({ title: "目标模式", body: goal?.objective ? `状态：${statusLabel[goal.status ?? ""] ?? goal.status ?? "进行中"}\n目标：${goal.objective}${goal.tokensUsed != null ? `\n已消耗：${goal.tokensUsed} tokens` : ""}` : "尚未设置目标；用法 /goal <目标描述>" });
          }
        } else if (name === "plan") {
          // /plan 计划模式：本轮以引擎原生 plan 协作模式运行（模型只调研+出方案，不执行改动），
          // 方案输出后弹「开始执行」确认条，确认后按方案正常执行。
          if (!argument) showToast("用法", "/plan <任务描述> —— 先出方案，确认后执行");
          else {
            planOnceRef.current = true;
            setPlanArmed(true);
            pendingCommandTextRef.current = argument;
            showToast("计划模式已启动", "本轮只调研并输出方案，确认后才开始执行");
            await send();
          }
        } else if (name === "undo") {
          const result = await window.codex.request("thread/rollback", { threadId: thread.id, numTurns: 1 });
          threadRef.current = result.thread;
          setThread(result.thread);
          showToast("已撤销上一轮", "仅回退对话历史，不会撤销工作区文件改动");
        } else if (name === "queue") {
          const result = await window.codex.request("thread/queue/list", { threadId: thread.id, limit: 100 });
          setInfoModal({ title: "消息队列", body: result.data?.length ? result.data.map((entry: any, index: number) => `${index + 1}. ${entry.input?.find((part: any) => part.type === "text")?.text ?? "附件消息"}`).join("\n") : "队列为空" });
        } else if (name === "skills") {
          const result = await window.codex.request("skills/list", { cwds: workspace ? [workspace] : [], forceReload: false });
          const skills = (result.data ?? []).flatMap((entry: any) => entry.skills ?? []);
          // 描述多为英文：统一走中文注释（输入框「#」面板同款口径），每个技能都有一句中文说明。
          const seen = new Set<string>();
          const rows: string[] = [];
          for (const skill of skills) {
            const key = normSkillName(skill.name);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            rows.push(`${skill.enabled ? "●" : "○"} ${shortSkillName(skill.name)} —— ${skillZhNote(skill)}`);
          }
          setInfoModal({ title: "可用技能", body: rows.length ? `${rows.join("\n")}\n\n提示：在输入框输入 # 可快速引用技能` : "没有发现可用 Skill" });
        } else if (name === "mcp") {
          const result = await window.codex.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", threadId: thread.id });
          setInfoModal({ title: "MCP 服务", body: result.data?.length ? result.data.map((server: any) => `${server.name} - ${server.runtimeStatus?.type ?? server.runtimeStatus ?? server.authStatus}`).join("\n") : "没有配置 MCP 服务" });
        } else if (name === "plugins") {
          const result = await window.codex.request("plugin/list", { cwds: workspace ? [workspace] : [], forceRefetch: false });
          const plugins = (result.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? []);
          setInfoModal({ title: "插件", body: plugins.length ? plugins.map((plugin: any) => `${plugin.installed ? "●" : "○"} ${plugin.name}`).join("\n") : "没有发现插件" });
        } else if (name === "apps") {
          const result = await window.codex.request("app/list", { limit: 100, threadId: thread.id, forceRefetch: false });
          setInfoModal({ title: "Apps", body: result.data?.length ? result.data.map((app: any) => `${app.isEnabled ? "●" : "○"} ${app.name}`).join("\n") : "没有可用 App" });
        }
      }
    } catch (error: any) {
      showToast(`/${name} 执行失败`, error.message);
    }
    return true;
  }

    function startReview(instructions: string) {
    if (!thread) { setNotice("先开始一个任务再运行审查"); return; }
    setReviewBusy(true);
    setReviewReport("");
    void window.codex.request("review/start", {
      threadId: thread.id,
      target: instructions.trim() ? { type: "custom", instructions: instructions.trim() } : { type: "uncommittedChanges" },
      delivery: "inline",
    }).then((result: any) => {
      reviewTurnRef.current = result?.turn?.id ?? null;
      if (!reviewTurnRef.current) { setReviewBusy(false); setNotice("审查未返回回合"); }
    }).catch((error: any) => {
      setReviewBusy(false);
      setNotice(`审查启动失败：${error.message}`);
    });
  }

  async function chooseWorkspace() {
    const value = await window.codex.chooseDirectory();
    if (!value) return;
    setWorkspace(value);
    localStorage.setItem("workspace", value);
    if (thread) {
      const settings = sandbox === "workspace-write" ? { cwd: value, sandboxPolicy: sandboxPolicy(sandbox, value) } : { cwd: value };
      await updateThreadSettings(settings);
    }
  }

  async function chooseImages() {
    const value = await window.codex.chooseImages();
    if (value?.length) insertComposerImages(value);
  }

  async function chooseFiles() {
    const value = await window.codex.chooseFiles();
    setFiles((current) => [...current, ...value]);
  }

  async function refreshMarketSkills(category = skillHubCategory, query = skillHubSearch, page = marketPage) {
    setMarketLoading(true);
    try {
      // category 直接传 SkillHub 榜单名（总排行/近期最热/最新上传/官方精选），主进程映射 section
      const result = await window.codex.listMarketSkills({ category, page, pageSize: marketPageSize, query });
      setMarketSkills(result.items);
      setMarketTotal(result.total);
      setMarketPage(result.page);
    } catch (error: any) { setNotice(`技能市场读取失败：${error.message}`); }
    finally { setMarketLoading(false); }
  }

  async function refreshMarketPlugins(category = pluginMarketCategory, query = pluginMarketSearch, page = pluginMarketPage) {
    setPluginMarketLoading(true);
    try {
      const result = await window.codex.listMarketPlugins({ category, query, page, pageSize: pluginMarketPageSize });
      setPluginMarketItems(result.items);
      setPluginMarketTotal(result.total);
      setPluginMarketPage(result.page);
    } catch (error: any) { setNotice(`插件市场读取失败：${error.message}`); }
    finally { setPluginMarketLoading(false); }
  }

  async function installMarketPlugin(plugin: PluginMarketEntry) {
    setInstallingMarketPlugin(plugin.slug);
    setPluginInstall({ plugin, current: 0 });
    try {
      const installed = await window.codex.installMarketPlugin(plugin);
      await refreshSettingsResources();
      setPluginInstall({ plugin, current: 7, engineRegistered: installed.engineRegistered, engineCheckMessage: installed.engineCheckMessage });
      setNotice(installed.engineRegistered ? `已安装并由 Codex 发现：${installed.name}` : `插件已安装：${installed.name}`);
    } catch (error: any) {
      setPluginInstall((current) => current ? { ...current, failed: error.message } : null);
      setNotice(`安装插件失败：${error.message}`);
    } finally { setInstallingMarketPlugin(null); }
  }

  async function installMarketSkill(skill: MarketSkillEntry) {
    setInstallingMarketSkill(skill.id);
    setSkillInstall({ skill, current: 0 });
    try {
      const installed = await window.codex.installMarketSkill(skill);
      const next = await window.codex.listLocalSkills();
      setLocalSkills(next);
      await refreshSettingsResources();
      setSkillInstall({ skill, current: 7, engineRegistered: installed.engineRegistered, engineCheckMessage: installed.engineCheckMessage });
      setNotice(installed.engineRegistered ? `已安装并由 Codex 发现：${installed.name}` : `技能已安装：${installed.name}`);
    } catch (error: any) {
      setSkillInstall((current) => current ? { ...current, failed: error.message } : null);
      setNotice(`安装技能失败：${error.message}`);
    } finally { setInstallingMarketSkill(null); }
  }

  async function toggleSkillEnabled(entry: LocalSkillEntry) {
    if (!entry.folder) return;
    const enabled = entry.enabled !== false;
    const nextEnabled = !enabled;
    // 受总闸托管的技能（ponytail-* / desktop-automation / browser-automation）关闭时拦截，
    // 统一从「常规」页总闸走，避免子项被总闸拉回导致状态漂移
    if (guardGroupOff({ kind: "skill", folder: entry.folder, name: entry.name, pluginId: (entry as any).pluginId }, `技能「${entry.name}」`, nextEnabled)) return;
    try {
      await window.codex.setEnabledSkill({ folder: entry.folder, enabled: nextEnabled });
      setLocalSkills(await window.codex.listLocalSkills());
      await refreshSettingsResources();
      setNotice(nextEnabled ? `技能已启用：${entry.name}` : `技能已停用：${entry.name}`);
    } catch (error: any) { setNotice(`切换技能状态失败：${error.message}`); }
  }

  async function saveConnector(draft: ConnectorDraft = connectorDraft) {
    setConnectorSaving(true);
    try {
      await window.codex.saveConnector(draft);
      setConnectors(await window.codex.listConnectors());
      await refreshSettingsResources();
      setConnectorEditorOpen(false);
      setConnectorDraft({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} });
      setNotice("连接器已保存，引擎已重启并正在验证 MCP 状态");
    } catch (error: any) { setNotice(`保存连接器失败：${error.message}`); }
    finally { setConnectorSaving(false); }
  }

  /** MCP 市场一键接入：按内置模板直接写入连接器（复用 saveConnector：落盘→重启引擎→验证 MCP 状态），密钥留空后续可在连接器编辑补充 */
  const installMcpServer = (entry: SkillHubMcpEntry) => {
    const cfg = entry.config;
    if (!cfg) { void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); return; }
    void saveConnector({
      name: entry.id,
      transport: cfg.transport,
      command: cfg.command ?? "",
      args: cfg.args ?? [],
      url: cfg.url ?? "",
      headers: cfg.transport === "streamable_http" ? { Authorization: "" } : {},
      env: cfg.env ?? {},
      secrets: {},
    });
  };

  async function startConnectorOAuth() {
    const template = connectorTemplateModal;
    if (!template) return;
    setConnectorOAuth({ templateId: template.id, phase: "waiting", message: "正在启动授权…" });
    try {
      const result = await window.codex.startConnectorOAuth({ templateId: template.id, values: connectorTemplateValues });
      if (!result.ok) setConnectorOAuth({ templateId: template.id, phase: "failed", message: result.message ?? "授权启动失败" });
    } catch (error: any) {
      setConnectorOAuth({ templateId: template.id, phase: "failed", message: error?.message ?? String(error) });
    }
  }

  async function saveConnectorFromTemplate(template: ConnectorTemplate) {
    const values = connectorTemplateValues;
    const draft: ConnectorDraft = { id: template.id, name: template.name, transport: template.transport };
    const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => (values[key] ?? "").trim() || `{${key}}`);
    if (template.transport === "stdio") {
      draft.command = template.command;
      draft.args = (template.args ?? []).map(fill);
      draft.env = { ...template.env };
      for (const field of template.fields) if (field.envVar && values[field.key]?.trim()) draft.env[field.envVar] = values[field.key].trim();
    } else {
      draft.url = fill(template.url ?? "");
      const envHttpHeaders: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const [header, envName] of Object.entries(template.envHttpHeaders ?? {})) {
        envHttpHeaders[header] = envName;
        const tokenField = template.fields.find((field) => field.tokenFor === envName);
        if (tokenField && values[tokenField.key]?.trim()) secrets[envName] = values[tokenField.key].trim();
      }
      if (Object.keys(envHttpHeaders).length) draft.envHttpHeaders = envHttpHeaders;
      if (Object.keys(secrets).length) draft.secrets = secrets;
    }
    setConnectorTemplateSaving(true);
    try {
      await window.codex.saveConnector(draft);
      setConnectors(await window.codex.listConnectors());
      await refreshSettingsResources();
      setConnectorTemplateModal(null);
      setConnectorTemplateValues({});
      setNotice(`${template.name} 连接器已保存，引擎已重启并正在验证 MCP 状态`);
    } catch (error: any) { setNotice(`保存 ${template.name} 连接器失败：${error.message}`); }
    finally { setConnectorTemplateSaving(false); }
  }

  async function removeConnector(id: string) {
    try {
      await window.codex.removeConnector(id);
      setConnectors(await window.codex.listConnectors());
      setConnectorChecked((current) => current.filter((entry) => entry !== id));
      await refreshSettingsResources();
      setNotice("连接器已移除，MCP 配置已更新");
    } catch (error: any) { setNotice(`移除连接器失败：${error.message}`); }
  }

  // 单卡开关：停用后该 MCP 整段从引擎 config.toml 移除，启用时写回，配置与密钥始终保留
  async function setConnectorEnabled(connector: ConnectorEntry, enabled: boolean) {
    setConnectorStatusBusy(connector.id);
    try {
      await window.codex.setConnectorsEnabled([connector.id], enabled);
      setConnectors(await window.codex.listConnectors());
      await refreshSettingsResources();
      setNotice(`${connector.name} 已${enabled ? "启用" : "停用"}，引擎已重启`);
    } catch (error: any) { setNotice(`切换连接器状态失败：${error.message}`); }
    finally { setConnectorStatusBusy(null); }
  }

  async function batchSetConnectorsEnabled(ids: string[], enabled: boolean) {
    if (!ids.length) return;
    setConnectorBatchBusy(enabled ? "enable" : "disable");
    try {
      await window.codex.setConnectorsEnabled(ids, enabled);
      setConnectors(await window.codex.listConnectors());
      setConnectorChecked([]);
      await refreshSettingsResources();
      setNotice(`已批量${enabled ? "启用" : "停用"} ${ids.length} 个连接器，引擎已重启`);
    } catch (error: any) { setNotice(`批量操作失败：${error.message}`); }
    finally { setConnectorBatchBusy(null); }
  }

  /**
   * app-server MCP 状态卡的启停。走 mcp-servers:set-enabled 统一入口：
   * 名字能匹配到连接器的改 connectors.json，其余（内置 nuphus 等）改覆盖表，
   * 两种情况都由主进程重写 config.toml 并重启引擎。
   */
  async function setMcpServerEnabled(name: string, enabled: boolean) {
    // 受总闸托管的 MCP（nuphus）关闭时拦截，统一从「常规」页桌面自动化开关走
    if (guardGroupOff({ kind: "mcp", name }, `MCP「${name}」`, enabled)) return;
    setMcpServerStatusBusy(name);
    try {
      await window.codex.setMcpServersEnabled([name], enabled);
      setMcpOverrides(await window.codex.readMcpServerOverrides());
      if (connectors.some((connector) => connector.id === name)) setConnectors(await window.codex.listConnectors());
      await refreshSettingsResources();
      setNotice(`${name} 已${enabled ? "启用" : "停用"}，引擎已重启`);
    } catch (error: any) { setNotice(`切换 MCP 状态失败：${error.message}`); }
    finally { setMcpServerStatusBusy(null); }
  }

  async function batchSetMcpServersEnabled(ids: string[], enabled: boolean) {
    const targets = ids.filter((id) => !guardGroupOff({ kind: "mcp", name: id }, `MCP「${id}」`, enabled));
    if (!targets.length) return;
    setMcpServerBatchBusy(enabled ? "enable" : "disable");
    try {
      await window.codex.setMcpServersEnabled(targets, enabled);
      setMcpOverrides(await window.codex.readMcpServerOverrides());
      setConnectors(await window.codex.listConnectors());
      setMcpServerChecked([]);
      await refreshSettingsResources();
      setNotice(`已批量${enabled ? "启用" : "停用"} ${targets.length} 个 MCP 服务，引擎已重启`);
    } catch (error: any) { setNotice(`批量操作失败：${error.message}`); }
    finally { setMcpServerBatchBusy(null); }
  }

  /**
   * 给某个 MCP 服务器的某个工具设置权限档位（deny 拒绝 / ask 询问 / allow 放行）。
   * mode 传 null 清除该规则。走 mcp-servers:set-tool-permission，主进程重写
   * config.toml 的 [permissions.*] 段并重启引擎（复刻 WorkBuddy 工具级权限模型）。
   */
  async function setMcpToolPermission(server: string, tool: string, mode: "deny" | "ask" | "allow" | null) {
    setMcpServerStatusBusy(server);
    try {
      const result = await window.codex.setMcpToolPermission(server, tool, mode);
      if (result?.reason === "unknown-server") { setNotice(`「${server}」尚未被引擎识别，无法配置工具权限`); return; }
      setMcpToolPermissions(await window.codex.readMcpToolPermissions());
      await refreshSettingsResources();
      setNotice(mode ? `「${server}.${tool}」已设为「${mode === "deny" ? "拒绝" : mode === "ask" ? "询问" : "放行"}」，引擎已重启` : `已清除「${server}.${tool}」的权限规则`);
    } catch (error: any) { setNotice(`设置工具权限失败：${error.message}`); }
    finally { setMcpServerStatusBusy(null); }
  }

  async function refreshSubAgents() {
    try { setSubAgents(await window.codex.listSubAgents()); }
    catch (error: any) { setNotice(`读取子智能体失败：${error.message}`); }
  }

  async function saveSubAgent(draft: SubAgentEntry) {
    try {
      await window.codex.saveSubAgent(draft);
      await refreshSubAgents();
      setSubAgentEditorOpen(false);
      setSubAgentDraft(null);
      setNotice(draft.id ? "子智能体已更新" : `子智能体「${draft.name}」已创建，Codex 可以调用它干活了`);
    } catch (error: any) { setNotice(`保存子智能体失败：${error.message}`); }
  }

  async function toggleSubAgentEnabled(agent: SubAgentEntry) {
    try {
      await window.codex.saveSubAgent({ ...agent, enabled: !agent.enabled });
      await refreshSubAgents();
      setNotice(`子智能体「${agent.name}」已${agent.enabled ? "停用" : "启用"}`);
    } catch (error: any) { setNotice(`切换失败：${error.message}`); }
  }

  async function deleteSubAgent(id: string) {
    try {
      await window.codex.removeSubAgent(id);
      await refreshSubAgents();
      setNotice("子智能体已删除");
    } catch (error: any) { setNotice(`删除失败：${error.message}`); }
  }

  function openNewSubAgent() {
    setSubAgentDraft({ id: "", name: "", description: "", systemPrompt: "请按你的角色完成任务并返回结构化结果。", effort: "high", inheritModel: true, inheritSandbox: true, inheritApproval: true, enabled: true, createdAt: "", updatedAt: "" });
    setSubAgentEditorOpen(true);
  }
  function openEditSubAgent(agent: SubAgentEntry) {
    setSubAgentDraft({ ...agent });
    setSubAgentEditorOpen(true);
  }

  // —— 专家团（Team 型专家）操作 ——
  async function refreshExpertTeams() {
    try { setExpertTeams(await window.codex.listExpertTeams()); }
    catch (error: any) { setNotice(`读取专家团失败：${error.message}`); }
  }
  async function saveExpertTeam(draft: ExpertTeamConfig) {
    try {
      await window.codex.saveExpertTeam(draft);
      await refreshExpertTeams();
      setExpertTeamEditorOpen(false);
      setExpertTeamDraft(null);
      setNotice(draft.teamId ? `专家团「${draft.displayName.zh}」已更新` : `专家团「${draft.displayName.zh}」已创建`);
    } catch (error: any) { setNotice(`保存专家团失败：${error.message}`); }
  }
  async function toggleExpertTeamEnabled(team: ExpertTeamConfig) {
    try {
      await window.codex.saveExpertTeam({ ...team, enabled: !team.enabled });
      await refreshExpertTeams();
      setNotice(`专家团「${team.displayName.zh}」已${team.enabled ? "停用" : "启用"}`);
    } catch (error: any) { setNotice(`切换失败：${error.message}`); }
  }
  async function deleteExpertTeam(teamId: string) {
    try {
      await window.codex.removeExpertTeam(teamId);
      await refreshExpertTeams();
      setNotice("专家团已删除");
    } catch (error: any) { setNotice(`删除失败：${error.message}`); }
  }
  async function resetExpertTeams() {
    try {
      const teams = await window.codex.resetExpertTeams();
      setExpertTeams(teams);
      setNotice("已恢复内置示例专家团");
    } catch (error: any) { setNotice(`恢复失败：${error.message}`); }
  }
  function openNewExpertTeam() {
    const now = new Date().toISOString();
    setExpertTeamDraft({
      teamId: "", displayName: { zh: "", en: "" }, profession: { zh: "", en: "" },
      description: { zh: "", en: "" }, category: "12-IndustryConsultant",
      tags: [{ zh: "", en: "" }, { zh: "", en: "" }, { zh: "", en: "" }],
      quickPrompts: [{ zh: "", en: "" }, { zh: "", en: "" }, { zh: "", en: "" }],
      lead: { id: "", name: "", profession: { zh: "", en: "" }, description: "", systemPrompt: "" },
      members: [], sop: "", enabled: true, createdAt: now, updatedAt: now,
    });
    setExpertTeamEditorOpen(true);
  }
  function openEditExpertTeam(team: ExpertTeamConfig) {
    setExpertTeamDraft(JSON.parse(JSON.stringify(team)));
    setExpertTeamEditorOpen(true);
  }
  /** 发起团队会话：一键建线程（带 team_member_invoke 工具）+ 注入团队系统提示发首条任务 */
  /** 为某张专家团卡片单独选择项目地址（发起会话时作为该团队的工作目录） */
  async function chooseTeamCwd(teamId: string) {
    const value = await window.codex.chooseDirectory();
    if (!value) return;
    setTeamCwdMap((current) => ({ ...current, [teamId]: value }));
    setNotice("已为该专家团指定项目地址");
  }
  /** 清空某张专家团卡片的项目地址（回退到全局工作区） */
  function clearTeamCwd(teamId: string) {
    setTeamCwdMap((current) => {
      const next = { ...current };
      delete next[teamId];
      return next;
    });
  }
  /** 成员直达会话：点击专家/成员 chip → 立刻新建以「团队名 · 成员名」命名的空会话并跳转，
   *  不弹任务描述弹窗。用户输入的第一条消息由发送管线自动包装成 SYSTEM TASK 注入成员角色。 */
  async function startMemberDirectSession(team: ExpertTeamConfig, member: ExpertTeamMember) {
    if (!customModel || !selectedModel) { setNotice("请先配置并启用自定义模型"); setSettingsOpen(true); return; }
    const teamCwd = teamCwdMap[team.teamId] ?? workspace;
    if (!teamCwd) { await chooseWorkspace(); return; }
    const directKey = `${team.teamId}:${member.id}`;
    setExpertTeamMemberDirect(directKey);
    try {
      const result = await window.codex.startTeamMemberSession({
        teamId: team.teamId,
        memberId: member.id,
        cwd: teamCwd,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || undefined,
        sandbox,
        approvalPolicy,
        personality: selectedModel?.supportsPersonality ? personality : null,
        defer: true,
      });
      teamThreadMapRef.current.set(result.thread.id, team.teamId);
      if (result.role) rememberExpertRole(result.thread.id, result.role);
      setSettingsOpen(false);
      await openThread(result.thread.id, result.thread);
      // 空线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次列表，让新会话立即出现在左侧
      void refreshThreads();
      requestAnimationFrame(() => composerInputRef.current?.focus());
      setNotice(`已进入「${result.thread?.name ?? expertRoleLabel(member)}」会话：直接输入内容即可向该角色提问`);
    } catch (error: any) { setNotice(`发起成员会话失败：${error.message}`); }
    finally { setExpertTeamMemberDirect(null); }
  }
  /** 发起专家团会话：点击「发起会话」→ 立刻新建以团队名命名的空会话并跳转（不弹任务弹窗、不自动跑）；
   *  task 非空（推荐提示词按钮）时预填进输入框，用户可改可发。首条消息由发送管线包装成 SYSTEM TASK。 */
  async function startTeamSession(team: ExpertTeamConfig, task: string) {
    if (!customModel || !selectedModel) { setNotice("请先配置并启用自定义模型"); setSettingsOpen(true); return; }
    const teamCwd = teamCwdMap[team.teamId] ?? workspace;
    if (!teamCwd) { await chooseWorkspace(); return; }
    setExpertTeamRunning(team.teamId);
    try {
      const result = await window.codex.startTeamSession({
        teamId: team.teamId,
        cwd: teamCwd,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || undefined,
        sandbox,
        approvalPolicy,
        personality: selectedModel?.supportsPersonality ? personality : null,
        defer: true,
      });
      teamThreadMapRef.current.set(result.thread.id, team.teamId);
      teamThreadConfigRef.current.set(result.thread.id, {
        teamId: team.teamId,
        cwd: teamCwd,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || undefined,
        sandbox,
        approvalPolicy,
      });
      if (result.role) rememberExpertRole(result.thread.id, result.role);
      setSettingsOpen(false);
      await openThread(result.thread.id, result.thread);
      // 新线程是主进程 thread/start 直接建的，openThread 只切视图不更新左侧列表，
      // 必须显式刷新一次列表，让新会话立即出现在左侧
      void refreshThreads();
      const suggested = (task ?? "").trim();
      setPrompt(suggested);
      requestAnimationFrame(() => composerInputRef.current?.focus());
      setNotice(`已进入「${result.thread?.name ?? team.displayName.zh}」会话：输入你的需求即可让团队开工`);
    } catch (error: any) { setNotice(`发起专家团会话失败：${error.message}`); }
    finally { setExpertTeamRunning(null); }
  }
  /** 在团队会话中调度一个成员（team_member_invoke 工具回调） */
  async function invokeTeamMember(toolArgs: any, threadId: string, respondEventId: number | string) {
    const parentConfig = teamThreadConfigRef.current.get(threadId);
    const teamId = parentConfig?.teamId || teamThreadMapRef.current.get(threadId) || "";
    setExpertTeamMemberRunning({ teamId, memberName: String(toolArgs.memberId ?? "") });
    try {
      const result = await window.codex.invokeTeamMember({
        teamId,
        memberId: String(toolArgs.memberId ?? ""),
        query: String(toolArgs.query ?? ""),
        cwd: parentConfig?.cwd || workspace || undefined,
        model: parentConfig?.model || selectedModel?.model || modelName(modelId),
        effort: parentConfig?.effort || effort || undefined,
        sandbox: parentConfig?.sandbox || sandbox,
        approvalPolicy: parentConfig?.approvalPolicy || approvalPolicy,
      });
      await window.codex.respond(respondEventId, { contentItems: [{ type: "inputText", text: `[专家团成员 ${result.profession || result.name} 的执行结果]\n${result.output}` }], success: true });
    } catch (error: any) {
      await window.codex.respond(respondEventId, { contentItems: [{ type: "inputText", text: `[成员调度失败]\n${error.message}` }], success: false });
    } finally {
      setExpertTeamMemberRunning(null);
    }
  }

  async function importSkill() {
    try {
      const result = await window.codex.importSkill();
      if (!result) return;
      const next = await window.codex.listLocalSkills();
      setLocalSkills(next);
      await refreshSettingsResources();
      setNotice(`技能已导入：${result.name}`);
    } catch (error: any) { setNotice(`导入技能失败：${error.message}`); }
  }

  /** 卸载技能：与安装对称，先用进度弹窗接手（校验→删除→清理登记→重启引擎→确认移除），
   *  主进程逐步回推事件推进进度；结束时报「引擎是否已确认移除」，不再是一闪而过的 toast。 */
  async function removeLocalSkill(entry: { folder?: string; name: string; description?: string }) {
    const folder = entry.folder ?? entry.name;
    setSkillRemove({ folder, name: entry.name, description: entry.description ?? "", current: 0 });
    try {
      const result = await window.codex.removeLocalSkill({ folder, name: entry.name });
      setLocalSkills(await window.codex.listLocalSkills());
      await refreshSettingsResources();
      setSkillRemove((current) => current && current.folder === folder ? { ...current, current: 6, engineRemoved: result?.engineRemoved, engineCheckMessage: result?.engineCheckMessage } : current);
      setNotice(result?.engineRemoved === false ? `技能已删除：${entry.name}（等待引擎下一轮扫描确认）` : `技能已卸载：${entry.name}`);
    } catch (error: any) {
      setSkillRemove((current) => current && current.folder === folder ? { ...current, failed: error.message } : null);
      setNotice(`卸载技能失败：${error.message}`);
      void window.codex.listLocalSkills().then(setLocalSkills).catch(() => undefined);
    }
  }

  /** 粘贴图片：主进程读剪贴板位图落盘（截图/网页复制图都走这条）。
   *  fallbackPath = 粘贴事件里的纯文本，用于「资源管理器复制图片文件」这类
   *  剪贴板无位图、只有路径文本的来源；仅接受单行、无协议、扩展名像图片的路径。 */
  async function pasteImage(fallbackPath = "") {
    const value = await window.codex.readClipboardImage();
    if (value) { insertComposerImages([value]); return; }
    const candidate = fallbackPath.trim();
    if (candidate && !candidate.includes("\n") && !candidate.includes("://") && /\.(png|jpe?g|gif|webp|bmp)$/i.test(candidate)) {
      insertComposerImages([candidate]);
      return;
    }
    setNotice("剪贴板中没有图片");
  }

  /** 触发提示词增强：原文备份 → 调主进程 LLM 润色 → 替换输入框文本。
   *  增强后按钮进入撤销模式（再点还原原文）；用户改动文本即清除备份（WorkBuddy 同款）。 */
  async function runPromptEnhance() {
    // 撤销模式：还原备份原文
    if (!enhanceBusy && hasEnhanceBackup && enhanceBackupRef.current != null) {
      setPrompt(enhanceBackupRef.current);
      enhanceBackupRef.current = null;
      setHasEnhanceBackup(false);
      return;
    }
    const raw = stripImageTokens(prompt).trim();
    if (!raw || enhanceBusy) return;
    setEnhanceBusy(true);
    try {
      const result = await window.codex.enhancePrompt(raw);
      if (!result.ok || !result.text) {
        setNotice(result.error || "增强失败，请重试");
        return;
      }
      enhanceBackupRef.current = prompt;
      setHasEnhanceBackup(true);
      setPrompt((current) => {
        // 保留占位符位置：文本段被替换，占位符原样保留（split 后只替换 text 段）
        const segments = splitPromptSegments(current);
        const enhanced = splitPromptSegments(result.text ?? "").filter((seg) => seg.kind === "text").map((seg) => (seg as any).text).join("\n");
        return segments.map((seg) => seg.kind === "text" ? (seg.text.trim() ? enhanced : "") : imageToken((seg as any).path)).filter(Boolean).join(" ");
      });
      setNotice("提示词已增强，再次点击可还原原文");
    } catch (error: any) {
      setNotice(`增强失败：${error.message ?? error}`);
    } finally {
      setEnhanceBusy(false);
    }
  }

  // 用户修改文本后备份失效（WorkBuddy：内容发散即清 backup，防止误还原覆盖用户输入）
  useEffect(() => {
    if (hasEnhanceBackup && prompt !== enhanceBackupRef.current && !promptIncludesBackup(prompt, enhanceBackupRef.current ?? "")) {
      enhanceBackupRef.current = null;
      setHasEnhanceBackup(false);
    }
  }, [prompt, hasEnhanceBackup]);

  /** 备份有效性判定：prompt 剥离占位符后仍包含备份原文的前 60 字（占位符增删不算发散）。 */
  function promptIncludesBackup(current: string, backup: string) {
    const core = stripImageTokens(backup);
    if (!core) return true;
    return stripImageTokens(current).includes(core.slice(0, Math.min(core.length, 60)));
  }

  /** WorkBuddy 式内联插入：在编辑框光标处直接插入图片 chip 节点（粘贴/选择图片共用），
   *  随后序列化回流 prompt/images——DOM 即时可见，不走重建（否则光标闪跳）。 */
  function insertComposerImages(paths: string[]) {
    if (!paths.length) return;
    const el = composerInputRef.current;
    if (!el) {
      setImages((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
      return;
    }
    el.focus();
    const selection = window.getSelection();
    for (const path of paths) {
      const chip = makeComposerChip(path);
      const range = document.createRange();
      if (selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).startContainer)) {
        const current = selection.getRangeAt(0);
        range.setStart(current.startContainer, current.startOffset);
      } else {
        range.selectNodeContents(el);
      }
      range.collapse(false);
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    syncComposerFromDom();
  }

  /** 轻量 resume：excludeTurns:true 只取会话元数据（引擎不再全量水合历史），
   *  另按 desc 取最新一页回合供首屏——配合回合窗口化，打开成本与会话长度无关。
   *  此前 excludeTurns:false 会让引擎把几千个回合整个序列化回来、然后 turns/list 又取
   *  一遍——「切会话慢」的数据侧主因（渲染侧已窗口化）。 */
  async function resumeThreadLight(params: { threadId: string; sandbox?: string; approvalPolicy?: string }, turnBudget = 200): Promise<any> {
    const result = await window.codex.request("thread/resume", { threadId: params.threadId, excludeTurns: true, sandbox: params.sandbox, approvalPolicy: params.approvalPolicy });
    const thread = result?.thread;
    if (thread && !(Array.isArray(thread.turns) && thread.turns.length)) {
      try {
        const page: any = await window.codex.request("thread/turns/list", { threadId: params.threadId, limit: turnBudget, sortDirection: "desc", itemsView: "full" });
        const data = Array.isArray(page?.data) ? page.data : [];
        if (data.length) thread.turns = [...data].reverse();
        if (page?.nextCursor) turnsCursorRef.current.set(params.threadId, page.nextCursor);
        else turnsCursorRef.current.delete(params.threadId);
      } catch { /* 分页失败维持原结果，不影响会话打开 */ }
    }
    return result;
  }

  /** 展开更早的历史：按游标继续 desc 续拉，直到到底（上限 20 页，防异常死循环）。 */
  async function loadEarlierTurns(id: string) {
    let cursor = turnsCursorRef.current.get(id) ?? null;
    if (!cursor) return;
    const older: any[] = [];
    for (let page = 0; page < 20 && cursor; page++) {
      const result: any = await window.codex.request("thread/turns/list", { threadId: id, limit: 200, sortDirection: "desc", itemsView: "full", cursor }).catch(() => null);
      const data = Array.isArray(result?.data) ? result.data : [];
      if (!data.length) { cursor = null; break; }
      older.push(...data);
      cursor = result?.nextCursor ?? null;
    }
    if (cursor) turnsCursorRef.current.set(id, cursor);
    else turnsCursorRef.current.delete(id);
    if (!older.length) return;
    const earlier = [...older].reverse();
    setThread((current) => {
      if (!current || current.id !== id) return current;
      const next = { ...current, turns: [...earlier, ...(current.turns ?? [])] };
      threadRef.current = next;
      threadCacheRef.current.set(id, next);
      return next;
    });
  }

  async function openThread(id: string, freshThread?: Thread | null) {
    setChatSearchOpen(false);
    // 快速连点防竞态：只有最新一次切换的 resume 响应才允许落地渲染
    const seq = ++switchSeqRef.current;
    setOpeningThread(id);
    // 记住本次打开的会话：重启后据此恢复（否则停在欢迎页，一发消息就新建空会话）
    try { localStorage.setItem("last-thread", id); } catch { /* 隐私模式等：忽略 */ }
    const storedModel = loadThreadModel(id);
    if (storedModel) setModelId(storedModel);
    // 切会话一律显示遮罩（缓存秒开也走）：给"刚切过去就在最新消息位置"的视觉过渡，
    // 避免内容直接落底的突兀；遮罩由 markSettled 在内容稳定后 ~180ms 自动淡出
    setSwitchingThreadId(id);
    setMobileNav(false);
    setDiff("");
    setSystemEvents([]);
    setOptimisticInput(null);
    const knownRunning = runningThreadIdsRef.current.has(id);
    setSending(knownRunning);
    setActiveTurnId(knownRunning ? (runningTurnIdsRef.current.get(id) ?? null) : null);
    setWorkStartedAt(knownRunning ? (runningStartedAtRef.current.get(id) ?? Date.now()) : null);
    setInterrupting(false);
    // 切会话后滚动位置属于旧会话，不能带过来；等新内容渲染后直接跳到最新消息。
    switchJumpRef.current = true;
    closeTaskMenu();
    setReviewBusy(false);
    setReviewReport("");
    reviewTurnRef.current = null;
    setPlanSteps([]);
    setGoalText("");
    setGoalStatus(null);
    // 目标模式状态回填：切会话后从引擎拉当前 goal（引擎原生自动续跑的依据）
    void window.codex.request("thread/goal/get", { threadId: id }).then((result) => {
      if (switchSeqRef.current !== seq) return;
      setGoalText(result.goal?.objective ?? "");
      setGoalStatus(result.goal?.status ?? null);
    }).catch(() => { /* 引擎不支持 goal RPC 时静默 */ });
    // jumpToBottom settled 回调：内容渲染稳定（scrollHeight 连续两帧不变）后才让遮罩
    // 淡出；多次调用重置 timer，保证只有"所有路径的 jumpToBottom 都稳定"后才真正卸载，
    // 避免切到长会话时遮罩提前消失、内容继续增高导致"切过去在中间"。
    const markSettled = () => {
      if (seq !== switchSeqRef.current) return;
      if (fadeOutTimerRef.current != null) window.clearTimeout(fadeOutTimerRef.current);
      setSwitchingFading(true);
      fadeOutTimerRef.current = window.setTimeout(() => {
        if (seq !== switchSeqRef.current) return;
        setSwitchingThreadId((current) => (current === id ? null : current));
        setSwitchingFading(false);
        fadeOutTimerRef.current = null;
      }, 180);
    };
    // 新建线程（主进程已 thread/start + turn/start）：本地直接落地，不走 resume——
    // 刚建的线程还没有 rollout，thread/resume 必报 "no rollout found"，会让界面掉回欢迎页。
    if (freshThread) {
      if (seq !== switchSeqRef.current) return;
      threadRef.current = freshThread;
      threadCacheRef.current.set(id, freshThread);
      setThread(freshThread);
      const initialModel = storedModel || modelId || localStorage.getItem("default-model") || "";
      if (initialModel) {
        setModelId(initialModel);
        saveThreadModel(id, initialModel);
      }
      switchJumpRef.current = true;
      // 线程已按当前用户偏好建好（调用方传入 sandbox/approvalPolicy），直接固化本地权限记录
      setSandbox(sandbox);
      setApprovalPolicy(approvalPolicy);
      saveThreadPermissions(id, sandbox, approvalPolicy);
      const runningTurn = (freshThread.turns ?? []).find((turn: Turn) => turn.status === "inProgress" || turn.status === "running");
      setActiveTurnId(runningTurn?.id ?? null);
      setSending(Boolean(runningTurn));
      setWorkStartedAt(runningTurn ? (runningStartedAtRef.current.get(id) ?? Date.now()) : null);
      if (runningTurn) markThreadRunning(id, runningTurn.id);
      else markThreadStopped(id);
      // 工作区与线程一致（团队卡片可指定独立项目地址）
      if (freshThread.cwd) setWorkspace(freshThread.cwd);
      // 内容渲染完成后瞬时定位到最新消息（两帧重试；带 settled 回调确保遮罩等渲染稳定）
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(scrollRef.current, markSettled)));
      setOpeningThread(null);
      markSettled();
      return;
    }
    // 缓存秒开：打开过的会话立即渲染缓存内容（最新消息已在屏），resume 在后台刷新
    const cached = threadCacheRef.current.get(id);
    if (cached) {
      // 已知仍在后台运行的会话不能做“历史残留运行态归一化”，否则切回来会先
      // 被误改成 completed，随后 resume 又改回 running，造成状态机闪烁甚至错乱。
      const normalizedCache = runningThreadIdsRef.current.has(id) ? cached : normalizeLoadedThread(cached);
      if (normalizedCache !== cached) threadCacheRef.current.set(id, normalizedCache);
      threadRef.current = normalizedCache;
      setThread(normalizedCache);
      const cachedRunningTurn = normalizedCache.turns.find((turn: Turn) => isTurnRunning(turn));
      setActiveTurnId(cachedRunningTurn?.id ?? null);
      setSending(Boolean(cachedRunningTurn));
      setWorkStartedAt(cachedRunningTurn ? (runningStartedAtRef.current.get(id) ?? Date.now()) : null);
      if (cachedRunningTurn) markThreadRunning(id, cachedRunningTurn.id);
      // layout effect 会消费 switchJumpRef 瞬时滚到底；这里再兜底一次（带 settled 回调），
      // 防 markdown/图片在首帧后增高导致没贴底
      requestAnimationFrame(() => jumpToBottom(scrollRef.current, markSettled));
    }
    // 频繁切换优化：缓存已秒开、该会话不在运行、且 30 秒内刚完整 resume 过 → 跳过这轮
    // resume。反复切换时每次都全量加载是卡顿主因；非运行会话期间无事件流，内容不可能变化。
    // 运行中会话必须继续走 resume 对齐引擎状态，不能跳。
    if (cached && !knownRunning && Date.now() - (recentResumeAtRef.current.get(id) ?? 0) < 30_000) {
      recentResumeAtRef.current.set(id, Date.now());
      setOpeningThread(null);
      return;
    }
    try {
      // resume 必带沙箱（schema 实证 resume 接受 sandbox 字符串）：引擎重启后 resume 不带
      // sandbox 会把线程权限重置成 workspace-write+restricted（实证 rollout 07:19:54，
      // 「完全访问静默失效」的真根因）。本地有用户选择用之，否则用全局默认。
      const permForResume = loadThreadPermissions(id);
      const resumeSandbox = permForResume.sandbox === "danger-full-access" || permForResume.sandbox === "read-only" || permForResume.sandbox === "workspace-write"
        ? permForResume.sandbox
        : (localStorage.getItem("default-sandbox") ?? "danger-full-access");
      const resumeApproval = permForResume.approval === "never" || permForResume.approval === "on-request" || permForResume.approval === "untrusted"
        ? permForResume.approval
        : (localStorage.getItem("default-approval") ?? "never");
      // 轻量 resume（excludeTurns:true + 最新一页回合）：不再让引擎全量水合几千个回合——
      // 这是切会话慢的数据侧主因；更早的历史由「显示更早的消息」按需续拉
      const result = await resumeThreadLight({ threadId: id, sandbox: resumeSandbox, approvalPolicy: resumeApproval });
      if (seq !== switchSeqRef.current) return; // 已切到别的会话，丢弃本次结果
      recentResumeAtRef.current.set(id, Date.now());
      // 残留运行态归一化（详见 normalizeLoadedThread）：旧会话丢过 turn/completed 的
      // 回合不能带着 inProgress 进渲染，否则永远走流式分支、展示回退到旧效果。
      const loaded = runningThreadIdsRef.current.has(id) ? result.thread : normalizeLoadedThread(result.thread);
      // 运行中会话：resume 快照可能落后于本地流式积累（切走期间 delta 仍在更新内存）。
      // 整体替换会让正文回退、随后 delta 从快照点重新追加 = 出字动画重放。逐 item 取更长的流式文本。
      const mergedLoaded = cached && loaded ? mergeLongerStreams(cached, loaded) : loaded;
      threadRef.current = mergedLoaded;
      threadCacheRef.current.set(id, mergedLoaded);
      // 秒开后 resume 无实质变化时不替换（避免闪烁）；有变化（后台继续跑/消息补齐）才更新
      const changed = !cached || threadContentChanged(cached, mergedLoaded);
      if (changed) {
        // 内容补齐会再次渲染：重设 switchJump，让这次渲染也瞬时定位（否则 smooth 动画
        // 又会从中间滑到底部，且动画目标基于渲染瞬间的 scrollHeight，易停在半路）
        switchJumpRef.current = true;
      }
      // 历史内容即使没有数据变化，也重新提交一次，让旧会话应用当前折叠标题与样式。
      setThread(mergedLoaded);
      // 内容渲染完成后再次瞬时定位到最新消息（两帧重试，等 React 提交 DOM；带 settled
      // 回调——markSettled 会重置 fade-out timer，确保遮罩等到所有路径都跳完才淡出）
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(scrollRef.current, markSettled)));
      const resultProvider = String(result.modelProvider ?? result.model_provider ?? customModel?.provider ?? "custom");
      // 记录会话真实绑定的供应商（迁移成功后 migrateThreadToProvider 会覆盖为新值）
      threadProviderRef.current.set(id, resultProvider);
      const resultModel = String(result.model ?? "").trim();
      const restoredModel = storedModel || (resultModel ? `custom:${resultProvider}:${resultModel}` : modelId || localStorage.getItem("default-model") || "");
      if (restoredModel) {
        setModelId(restoredModel);
        saveThreadModel(id, restoredModel);
      }
      if (result.reasoningEffort) setEffort(result.reasoningEffort);
      // 思考等级恢复优先级：本地每会话记录（用户在这个会话明确选过）> resume 回带值。
      // 引擎 resume 返回的是会话创建时的 effort，通常更旧；本地记录才是用户最新的选择。
      {
        const localEffort = loadThreadEffort(id);
        if (localEffort) setEffort(localEffort);
        else if (!result.reasoningEffort) setEffort(normalizeEffort(localStorage.getItem("default-effort")) || "");
        saveThreadEffort(id, localEffort || result.reasoningEffort || effort || "");
      }
      // 打开会话后工作区跟随该会话的 cwd（会话创建时锁定的项目目录）。
      setWorkspace(result.cwd);
      // 权限恢复优先级：本地每任务记录（用户在这个会话明确选过）> 全局默认 > resume 响应。
      // 引擎 resume 返回的是会话创建时的值，通常是旧默认，不能覆盖用户当前的全局选择。
      const resumedSandbox = sandboxMode(result.sandboxPolicy ?? result.sandbox ?? (result.thread as any)?.sandboxPolicy);
      const resumedApproval = typeof result.approvalPolicy === "string" ? result.approvalPolicy : undefined;
      const localPerms = loadThreadPermissions(id);
      const validSandbox = (value?: string) => value === "danger-full-access" || value === "read-only" || value === "workspace-write" ? value : null;
      const validApproval = (value?: string) => value === "never" || value === "on-request" || value === "untrusted" ? value : null;
      const savedDefault = validSandbox(localStorage.getItem("default-sandbox") ?? undefined) ?? "danger-full-access";
      const savedDefaultApproval = validApproval(localStorage.getItem("default-approval") ?? undefined) ?? "never";
      // 优先级（09-10 修正「重启后审批档变成变更前确认」）：**用户当前的全局选择权威**。
      // 引擎 resume 返回的是会话创建时的旧档位（resumed），此前被排在全局默认前面——
      // 会话建在「变更前确认」上，就永远回不到用户后来选的档位。
      // 本地每会话记录仅应在用户于该会话显式改过权限时生效；旧版本会在打开时把 resumed
      // 回写进记录（污染），识别特征 = 记录 == 引擎值 且 ≠ 全局默认 → 视为污染忽略。
      const recordTrusted = (value?: string | null) => Boolean(value) && !(value && resumedSandbox && value === resumedSandbox && value !== savedDefault) && !(value && resumedApproval && value === resumedApproval && value !== savedDefaultApproval);
      const nextSandbox = (recordTrusted(localPerms.sandbox) ? validSandbox(localPerms.sandbox) : null) ?? savedDefault;
      const nextApproval = (recordTrusted(localPerms.approval) ? validApproval(localPerms.approval) : null) ?? savedDefaultApproval;
      setSandbox(nextSandbox);
      setApprovalPolicy(nextApproval);
      // 不再把解析结果回写本地记录：回写会把引擎旧值烙进记录，导致用户之后改全局默认
      // 对该会话永不生效。记录只由用户的显式操作（权限胶囊/审批选择）写入。
      // 权限不一致自愈：UI 呈现值与引擎真实值不同 → push 纠正（沙箱与审批任一不同都纠正）。
      if ((resumedSandbox && nextSandbox !== resumedSandbox) || (resumedApproval && nextApproval !== resumedApproval)) {
        void pushThreadPermissions(id, nextSandbox, nextApproval).catch(() => undefined);
      }
      const resumedRunningTurn = loaded.turns.find((turn: Turn) => isTurnRunning(turn));
      setActiveTurnId(resumedRunningTurn?.id ?? null);
      setSending(Boolean(resumedRunningTurn));
      setWorkStartedAt(resumedRunningTurn ? (runningStartedAtRef.current.get(id) ?? Date.now()) : null);
      // 切回一个「引擎仍在后台运行」的会话时，点亮它的侧边栏转圈（跟当前选中解耦）。
      if (resumedRunningTurn) markThreadRunning(id, resumedRunningTurn.id);
      else markThreadStopped(id);
    } catch (error: any) {
      if (seq === switchSeqRef.current) {
        // 空会话（专家/团队 defer 预建、尚无 rollout）在引擎侧没有可 resume 的记录：
        // 用本地列表条目兜底渲染成空会话（欢迎页），用户可继续输入首条消息——角色提示由
        // localStorage 的 pending role 恢复，首条发送仍会包装成 SYSTEM TASK。
        if (/no rollout found|not found|no such thread|unloaded/i.test(String(error?.message))) {
          // 归档刚恢复的会话此时还不在 threads 列表里（refreshThreads 可能尚未提交），
          // 不依赖列表条目，直接构造最小空会话兜底渲染——用户可继续输入首条消息。
          const entry = threads.find((t) => t.id === id);
          const local: Thread = { id, name: entry?.name ?? null, preview: "", cwd: entry?.cwd ?? workspace ?? "", updatedAt: entry?.updatedAt ?? Date.now(), status: null, turns: [] };
          threadRef.current = local;
          threadCacheRef.current.set(id, local);
          setThread(local);
          setSending(false);
          setActiveTurnId(null);
          setWorkStartedAt(null);
          markThreadStopped(id);
          requestAnimationFrame(() => requestAnimationFrame(() => jumpToBottom(scrollRef.current, markSettled)));
          requestAnimationFrame(() => composerInputRef.current?.focus());
          return;
        }
        setNotice(error.message);
      }
    } finally {
      if (seq === switchSeqRef.current) {
        setOpeningThread(null);
        // 兜底淡出遮罩：成功路径里 markSettled 已经被多次调用（cached 秒开 / resume 后），
        // 这里再调一次保证错误路径（resume 抛错/seq 已切走）也能让遮罩淡出；fade-out
        // timer 重置机制保证多次调用安全，最终只有最后一次稳定后才真正卸载。
        markSettled();
        // 焦点还给输入框：归档恢复/切会话后焦点常残留在已卸载的设置弹窗上，表现为"失焦无法输入"
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }
    }
  }

  async function archiveThread(id: string) {
    await window.codex.request("thread/archive", { threadId: id });
    setThreads((current) => current.filter((entry) => entry.id !== id));
    threadCacheRef.current.delete(id);
    if (threadRef.current?.id === id) {
      // 归档当前会话 = 回到全新会话：必须走 startNewThread 完整复位。
      // 之前手工清了一堆状态但漏了 sending/interrupting——会话在运行中被归档后
      // sending 卡 true，发送按钮永远是「停止」，输入框发不出消息。
      startNewThread();
      requestAnimationFrame(() => composerInputRef.current?.focus());
    }
  }

  async function renameThread(id: string, value: string) {
    const name = value.trim();
    if (!name) return;
    const applyName = (entry: Thread) => entry.id === id ? { ...entry, name } : entry;
    setThreads((current) => current.map(applyName));
    const cached = threadCacheRef.current.get(id);
    if (cached) threadCacheRef.current.set(id, applyName(cached));
    if (threadRef.current?.id === id) {
      const next = applyName(threadRef.current);
      threadRef.current = next;
      setThread(next);
    }
    try {
      await window.codex.request("thread/name/set", { threadId: id, name });
      void refreshThreads();
    } catch (error: any) {
      await refreshThreads().catch(() => undefined);
      setNotice(`重命名失败：${error.message}`);
    }
  }

  async function clearCurrentConversation() {
    const id = threadRef.current?.id;
    if (!id) return;
    try {
      await window.codex.request("thread/delete", { threadId: id });
      threadCacheRef.current.delete(id);
      setThreads((current) => current.filter((entry) => entry.id !== id));
      startNewThread();
      await refreshThreads();
      requestAnimationFrame(() => composerInputRef.current?.focus());
      showToast("对话记录已清空", "当前会话已永久删除，可以直接开始新对话");
    } catch (error: any) {
      showToast("清空对话失败", error.message);
    }
  }

  async function unarchiveThread(id: string) {
    await window.codex.request("thread/unarchive", { threadId: id });
    setThreads((current) => current.filter((entry) => entry.id !== id));
  }

  async function deleteThread(id: string) {
    if (!await openAppConfirm("删除会话", "当前会话及其中的消息、工具记录将被永久删除，此操作无法撤销。", "永久删除")) return;
    setOpeningThread(id);
    try {
      await window.codex.request("thread/delete", { threadId: id });
      threadCacheRef.current.delete(id);
      setThreads((current) => current.filter((entry) => entry.id !== id));
      if (threadRef.current?.id === id) {
        threadRef.current = null;
        setThread(null);
        setOptimisticInput(null);
        setActiveTurnId(null);
        markThreadStopped(id);
        setWorkStartedAt(null);
        setSystemEvents([]);
        setPlanSteps([]);
        setGoalText("");
      }
    } catch (error: any) {
      setNotice(`删除任务失败：${error.message}`);
    } finally {
      setOpeningThread(null);
    }
  }

  async function deleteThreadsByCwd(cwd: string) {
    const ids = threads.filter((entry) => entry.cwd === cwd).map((entry) => entry.id);
    if (!ids.length) { setNotice("该项目下已无对话"); return; }
    if (!(await openAppConfirm("删除整个项目", `项目「${basename(cwd)}」下的 ${ids.length} 条任务将被永久删除，此操作无法撤销。`, "永久删除"))) return;
    for (const id of ids) {
      try {
        await window.codex.request("thread/delete", { threadId: id });
        threadCacheRef.current.delete(id);
      } catch (error: any) {
        setNotice(`删除任务失败：${error.message ?? error}`);
      }
    }
    setThreads((current) => current.filter((entry) => entry.cwd !== cwd));
    if (threadRef.current && threadRef.current.cwd === cwd) {
      threadRef.current = null;
      setThread(null);
      setOptimisticInput(null);
      setActiveTurnId(null);
      for (const id of ids) markThreadStopped(id);
      setWorkStartedAt(null);
      setSystemEvents([]);
      setPlanSteps([]);
      setGoalText("");
    }
    if (projectFilter === cwd) setProjectFilter(null);
  }

  async function createEmptyThread(): Promise<Thread | null> {
    const builtinCfg = await window.codex.readBuiltinPlugins().catch(() => null);
    const dynamicTools = [
      ...(builtinCfg?.image?.enabled !== false && builtinCfg?.image?.baseUrl ? [{
        type: "function",
        name: "generate_image",
        description: "生成一张图片并返回可访问的图片地址。用于用户要求画图、配图、示意图等场景。",
        inputSchema: { type: "object", properties: { prompt: { type: "string", description: "图片内容的详细描述（含风格、主体、构图）" } }, required: ["prompt"] },
      }] : []),
      ...(builtinCfg?.vision?.enabled !== false && builtinCfg?.vision?.baseUrl ? [{
        type: "function",
        name: "describe_image",
        description: "当你看不清或无法解析用户提供的图片内容时，调用此工具让视觉模型描述图片并把结果作为依据继续回答。",
        inputSchema: { type: "object", properties: { imageUrl: { type: "string", description: "图片地址或 data URL" }, prompt: { type: "string", description: "你想让视觉模型关注的问题，可省略" } }, required: ["imageUrl"] },
      }] : []),
      ...(memoryEnabled ? [
        { type: "function", name: "memory_recall", description: "按当前任务查询相关的分类记忆。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { type: "function", name: "memory_save", description: "保存可复用的项目事实，必须选择分类。", inputSchema: { type: "object", properties: { category: { type: "string", enum: ["用户偏好", "项目背景", "工作流/SOP", "任务经验", "临时上下文"] }, content: { type: "string" } }, required: ["category", "content"] } },
      ] : []),
      ...subAgentTools(subAgents),
      // RPA 配方与任务清单：让 agent 能存配方/跑配方/维护清单/向用户提问
      { type: "function", name: "rpa_save", description: "把刚跑通的一条自动化流程保存为 RPA 配方，下次可直接复用执行。steps 按顺序写清每一步（网址/点击/输入/桌面操作等），kind 选 browser（浏览器）/desktop（桌面）/mixed。", inputSchema: { type: "object", properties: { name: { type: "string", description: "配方名称，如「每天导出日报」" }, desc: { type: "string", description: "一句话说明用途" }, kind: { type: "string", enum: ["browser", "desktop", "mixed"] }, steps: { type: "array", items: { type: "string" }, description: "按顺序的执行步骤" }, target: { type: "string", description: "起始网址或目标程序，可省略" } }, required: ["name", "steps", "kind"] } },
      { type: "function", name: "rpa_run", description: "列出已保存的 RPA 配方（不传 name），或按名称执行某条配方。执行时按 steps 逐步复现自动化流程。", inputSchema: { type: "object", properties: { name: { type: "string", description: "要执行的配方名称；省略则返回全部配方清单" } } } },
      { type: "function", name: "task_add", description: "把一条任务加入用户的任务清单。", inputSchema: { type: "object", properties: { text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] } }, required: ["text"] } },
      { type: "function", name: "task_update", description: "更新任务清单：列出全部任务（不传任何参数）、改状态或删除。status 只有 todo/doing/done。", inputSchema: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] }, text: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, done: { type: "boolean", description: "删除任务" } } } },
      { type: "function", name: "agent_ask", description: "在对话里向用户展示一组选项并等待选择（提问时必须给出选项）。options 里第一项会作为推荐项高亮，也可以留空让用户自由输入。", inputSchema: { type: "object", properties: { question: { type: "string", description: "要问用户的问题" }, options: { type: "array", items: { type: "string" }, description: "2-4 个候选选项，第一项为推荐" }, allowFree: { type: "boolean", description: "是否允许自由输入，默认允许" } }, required: ["question", "options"] } },
    ];
    const memoryTools = dynamicTools.length ? { dynamicTools } : {};
    const started = await window.codex.request("thread/start", {
      model: selectedModel?.model ?? modelName(modelId),
      cwd: workspace,
      approvalPolicy,
      sandbox,
      sandboxPolicy: sandboxPolicy(sandbox, workspace),
      personality: selectedModel?.supportsPersonality ? personality : null,
      ...providerConfig,
      ...memoryTools,
    });
    const active = started.thread as Thread;
    threadRef.current = active;
    setThread(active);
    if (started?.thread?.id) saveThreadPermissions(started.thread.id, sandbox, approvalPolicy);
    return active;
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    // 自定义命令展开文本优先消费（跳过 / 前缀解析，避免展开结果被二次当命令处理）
    const pendingText = pendingCommandTextRef.current;
    if (pendingText != null) pendingCommandTextRef.current = null;
    const value = (pendingText ?? prompt).trim();
    // 「#技能名」：与「/」命令面板同款——回车或点发送即引用该技能，不把 #查询词当正文发出去。
    // 未匹配到任何技能时按普通文本发送（用户可能真的想发以 # 开头的内容）。
    if (pendingText == null && value.startsWith("#") && !value.includes(" ") && images.length === 0 && files.length === 0) {
      const hit = matchSkillCatalog(mergedSkillCatalog, value.slice(1), 1)[0];
      if (hit) { addSkillReference(hit); return; }
    }
    if (pendingText == null && value.startsWith("/") && images.length === 0) {
      const command = value.slice(1).split(/\s+/, 1)[0].toLowerCase();
      if (thread && runningThreadIdsRef.current.has(thread.id) && !["stop", "status", "diff", "pwd", "model", "permissions", "help", "context", "clear", "copy", "memory", "effort", "personality", "sandbox", "approval", "skills", "mcp", "plugins", "apps", "queue"].includes(command)) {
        showToast("任务仍在运行", `请先使用 /stop，再执行 /${command}`);
        return;
      }
      if (await runSlashCommand(value)) return;
    }
    if (!value && images.length === 0 && files.length === 0) return;
    if (sendInFlightRef.current) return;
    // 用户手动发消息时取消等待中的 429 自动重试（手动发送优先，避免交错）
    if (rateLimitRetry || rateLimitTimerRef.current != null) cancelRateLimitRetry(true);
    sendInFlightRef.current = true;
    try {
    if (!customModel || !selectedModel) {
      planOnceRef.current = false; // /plan 旗标不跨发送泄漏：发送失败即复位
      setPlanArmed(false);
      setNotice("请先配置并启用自定义模型");
      setSettingsOpen(true);
      return;
    }
    // 打开一个使用其他供应商的历史会话时，仅恢复下拉框选择，不立刻重启引擎。
    // 真正发送前：若会话真实绑定的供应商 ≠ 当前激活供应商（引擎全局 Key 已换），
    // 直接发会因 Key 错配 401 无限重连——自动把会话迁移到当前激活供应商。
    // 判定依据是 threadProviderRef 登记表（resume 时记录的线程真实绑定），
    // 不是 UI 下拉框（下拉可能已被切换动作改成新供应商，比不出差异）。
    {
      const currentThread = thread;
      let boundProvider = currentThread?.id ? threadProviderRef.current.get(currentThread.id) : undefined;
      // 登记表无记录（本次启动还没 resume 过该会话）：轻量 resume（不带历史）问引擎要真实绑定，
      // 防止「切换供应商后不重开会话直接发」漏检——引擎是绑定的唯一权威。
      if (currentThread?.id && !boundProvider) {
        try {
          const probe = await window.codex.request("thread/resume", { threadId: currentThread.id, excludeTurns: true });
          const probed = String(probe?.modelProvider ?? probe?.model_provider ?? "").trim();
          if (probed) { threadProviderRef.current.set(currentThread.id, probed); boundProvider = probed; }
        } catch { /* 探测失败按无绑定处理，走正常发送 */ }
      }
      if (boundProvider && customModel && boundProvider !== customModel.provider && currentThread?.id) {
        // 关键：引擎进程是「一个全局 Key」（spawn 时注入 CODEX_HARNESS_API_KEY）。
        // 只 resume 换 base_url 不换 Key → 目标供应商收到旧 Key → INVALID_API_KEY 401
        // （实测：激活 ppz123 后旧 pptoken 会话迁移后仍 401，重启引擎才注入 ppz123 的 Key）。
        // 所以迁移必须走完整切换：写激活 + applyCustomModel 重启引擎（注入新 Key）+ resume。
        try {
          const updated = await window.codex.setProviderModel({ provider: customModel.provider, model: customModel.model });
          setCustomModel(updated);
          const migrated = await migrateThreadToProvider(currentThread.id, customModel);
          if (!migrated) {
            showToast("已切换供应商", `已切换到 ${updated.name} 并重启生效；该会话未能迁移，请新建会话`);
            return;
          }
          const selectedId = `custom:${updated.provider}:${updated.model}`;
          setModelId(selectedId);
          localStorage.setItem("default-model", selectedId);
          saveThreadModel(currentThread.id, selectedId);
          showToast("会话已迁移", `引擎已按 ${updated.name} 的 Key 重启，该会话已切换到 ${updated.model}，可正常发送`);
        } catch (error: any) {
          showToast("暂时不能发送", `迁移失败：${String(error?.message ?? error).slice(0, 80)}`);
          return;
        }
      }
    }
    if (!workspace) {
      planOnceRef.current = false; // /plan 旗标不跨发送泄漏：发送失败即复位
      setPlanArmed(false);
      {
        await chooseWorkspace();
        return;
      }
    }
    let messageText = value;
    let threadReferenceBlocks = "";
    // 内联图片：占位符从文本剥离，图片按占位符出现顺序发送；不在占位符里的遗留附件照旧追加
    const inlineImagePaths = promptImagePaths(messageText);
    if (inlineImagePaths.length) messageText = stripImageTokens(messageText);
    try {
      // 必须用剥离占位符后的 messageText：传原始 value 会把 [图片:...] 编码路径
      // 覆盖回发送文本（09-04 截图实证：气泡里出现整段乱码 token）
      const resolved = await resolveThreadReferences(messageText, thread?.id);
      messageText = resolved.text;
      threadReferenceBlocks = resolved.blocks;
    } catch (error: any) {
      setNotice(error.message);
      return;
    }
    const threadReferenceSuffix = threadReferenceBlocks ? `\n\n${threadReferenceBlocks}` : "";
    if (thread && runningThreadIdsRef.current.has(thread.id)) {
      // 排队消息与正常发送一样带上引用段（引用/文件/技能/上下文），渲染时解析成卡片
      const quotePrefix = quoteItem ? `> ${quoteItem.text.split("\n").join("\n> ")}\n\n` : "";
      const contextPrefix = contextItems.length ? `\n\n[用户指定的对话上下文]\n${contextItems.map((item, index) => `(${index + 1}) ${item.role}：${item.text}`).join("\n\n")}\n[上下文结束]\n` : "";
      const skillPrefix = selectedSkills.length ? `\n\n[本轮已引用技能]\n${selectedSkills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
      const filePrefix = files.length ? `\n\n[附件文件]\n${files.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
      const input = [
        ...((messageText || threadReferenceBlocks || files.length || selectedSkills.length || contextItems.length || quoteItem) ? [{ type: "text", text: `${quotePrefix}${messageText}${contextPrefix}${skillPrefix}${filePrefix}${threadReferenceSuffix}`, text_elements: [] }] : []),
        ...inlineImagePaths.map((path) => ({ type: "localImage", path })),
        ...images.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path })),
      ];
      try {
        await window.codex.request("thread/queue/add", { threadId: thread.id, input, clientUserMessageId: crypto.randomUUID() });
        setPrompt("");
        setQuoteItem(null);
        setContextItems([]);
        setSelectedSkills([]);
        setFiles([]);
        setImages([]);
        void refreshQueue(thread.id);
      } catch (error: any) {
        setNotice(error.message);
      }
      return;
    }
    setSending(true);
    // 立即点亮侧边栏转圈（turn/start 返回前也转）：复用当前会话时立刻标记运行中；
    // 新建会话（thread 为 null）时等 turn/start 返回后再登记。
    if (thread) markThreadRunning(thread.id);
    setNotice("");
    setWorkStartedAt(Date.now());
    let memoryPrefix = "";
    if (memoryEnabled && messageText) {
      // 常驻层无条件前置：L0 用户档案 + L1 项目记忆 + L2 近 3 天日志。
      // L3 碎片池仍按当前输入按需召回，两者互不替代——只做召回的话，
      // 模型永远看不到「这个项目不能做什么」这类不出现在本轮提问里的约束。
      try {
        const standing = await window.codex.readMemoryContext(workspace || undefined, workspaceMemoryEnabled);
        if (standing.text) memoryPrefix += standing.text;
      } catch (error: any) { setMemoryStatus(`常驻记忆读取失败：${error.message}`); }
      if (workspaceMemoryEnabled) {
        try {
          const recalled = await window.codex.recallMemory(messageText, workspace || undefined);
          if (recalled.context) memoryPrefix += `\n\n[Harness 相关记忆，仅供参考]\n${recalled.context}\n[记忆结束]\n`;
        } catch (error: any) { setMemoryStatus(`记忆召回失败：${error.message}`); }
      }
    }
    const quotePrefix = quoteItem ? `> ${quoteItem.text.split("\n").join("\n> ")}\n\n` : "";
    const contextPrefix = contextItems.length ? `\n\n[用户指定的对话上下文]\n${contextItems.map((item, index) => `(${index + 1}) ${item.role}：${item.text}`).join("\n\n")}\n[上下文结束]\n` : "";
    const skillPrefix = selectedSkills.length ? `\n\n[本轮已引用技能]\n${selectedSkills.map((skill) => `- ${skill.name}：${skill.description}`).join("\n")}\n[请按上述技能工作流执行]\n` : "";
    const filePrefix = files.length ? `\n\n[附件文件]\n${files.map((path) => `- ${path}`).join("\n")}\n[附件结束]\n` : "";
    const input = [
      ...((messageText || threadReferenceBlocks || files.length || quoteItem) ? [{ type: "text", text: `${quotePrefix}${messageText}${contextPrefix}${skillPrefix}${filePrefix}${memoryPrefix}${threadReferenceSuffix}`, text_elements: [] }] : []),
      ...inlineImagePaths.map((path) => ({ type: "localImage", path })),
      ...images.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path })),
    ];
    // 专家/团队成员 defer 空会话的首条消息：发送前把用户文本包装成 SYSTEM TASK 段注入角色
    // 系统提示（渲染端按既有约定折叠为「需求已发起」卡片，气泡/引用/复制只暴露用户原文）。
    // 仅在「当前线程还没有任何回合」时生效——包装过一次后线程已非空，后续轮次走普通消息。
    const expertRole = thread && !(thread.turns ?? []).length ? readStoredExpertRole(thread.id) : undefined;
    // 导入会话记录新建的空会话：首条消息同样在「线程无回合」时把外部记录整段附在消息前
    // （渲染端折叠成可展开的「导入的会话记录」卡），发出后标记即清除。与专家角色互斥。
    const pendingImport = thread && !(thread.turns ?? []).length && !expertRole ? readStoredPendingImport(thread.id) : undefined;
    let sendInput = input;
    if (expertRole) {
      const userText = input.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (userText) {
        const kindLabel = expertRole.kind === "team" ? "团队会话" : "成员会话";
        const text = `${expertRole.prefix}[SYSTEM TASK · ${kindLabel}]\n=== 用户需求 ===\n${userText}\n=== END ===\n\n${expertRole.instruction}`;
        sendInput = [{ type: "text", text, text_elements: [] }, ...inlineImagePaths.map((path) => ({ type: "localImage", path })), ...images.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path }))];
      }
    } else if (pendingImport) {
      const userText = input.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (userText) {
        // 块语义自明（[导入的会话记录]），不再拼多余自然语言指令——那会泄漏进 cleanText/气泡/标题
        const text = `[导入的会话记录]\n${fmtImportNote(pendingImport)}\n=== 记录内容 ===\n${pendingImport.text}\n=== 记录结束 ===\n\n${userText}`;
        sendInput = [{ type: "text", text, text_elements: [] }, ...inlineImagePaths.map((path) => ({ type: "localImage", path })), ...images.filter((path) => !inlineImagePaths.includes(path)).map((path) => ({ type: "localImage", path }))];
      }
    }
    optimisticTurnIdRef.current = null;
    optimisticBaselineRef.current = { threadId: thread?.id ?? null, turnIds: new Set((thread?.turns ?? []).map((entry) => entry.id)) };
    const optimisticId = `local-${Date.now()}`;
    justSentIds.add(optimisticId);
    setOptimisticInput({ id: optimisticId, type: "userMessage", content: sendInput });
    // 发送即贴底跟随最新：agent 回复从底部展开，始终自动滚到最新内容
    stickToBottomRef.current = true;
    let createdThreadId: string | null = null;
    try {
      const startTurn = async (target: Thread) => window.codex.request("turn/start", {
        threadId: target.id,
        input: sendInput,
        model: selectedModel?.model ?? modelName(modelId),
        effort: effort || null,
        personality: selectedModel?.supportsPersonality ? personality : null,
        // 审批档位逐回合下发（TurnStartParams.approvalPolicy，协议 schema 实证 09-06）：
        // 权限胶囊切「完全访问/never」后即使 resume 未及时生效，本条回合也按新档位审批
        approvalPolicy,
        // 沙箱策略逐回合下发（TurnStartParams.sandboxPolicy，09-10 真实引擎实证）：
        // turn/start 带 {type:"dangerFullAccess"} 能让该轮与后续轮真正切到完全访问。
        // 历史会话/重启后引擎可能仍按创建时的沙箱跑（表现为「UI 显示完全访问却写不了
        // 工作区外、权限总是掉」），每轮按 UI 当前权限下发是唯一稳的做法。
        sandboxPolicy: sandboxPolicy(sandbox, target.cwd ?? workspace ?? ""),
        // 协作模式的 settings 优先于顶层 effort；漏传时计划模式会回落 medium。
        ...(planOnceRef.current ? { collaborationMode: { mode: "plan", settings: { model: selectedModel?.model ?? modelName(modelId), reasoning_effort: effort || null } } } : {}),
      });
      let active = thread;
      if (!active) {
        active = await createEmptyThread();
        if (!active) throw new Error("创建新会话失败");
        createdThreadId = active.id;
      }
      setPrompt("");
      setQuoteItem(null);
      setContextItems([]);
      setImages([]);
      activeModelRef.current = selectedModel?.model ?? modelName(modelId);
      let result: any;
      try {
        result = await startTurn(active);
      } catch (error: any) {
        const unavailable = /not found|no such thread|unloaded/i.test(String(error?.message));
        if (!unavailable) throw error;

        // 刚由 thread/start 创建的空线程可能还没被 turn/start 立即看见。
        // 原地短暂重试，绝不再创建第二条空线程。
        if (createdThreadId === active.id) {
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          result = await startTurn(active);
        } else {
          // app-server 重启后只会卸载内存中的 thread，磁盘会话仍然有效。
          // 必须先 resume 原会话；只有 resume 也明确返回不存在时才创建新会话。
          let recovered: Thread | null = null;
          try {
            const resumed = await window.codex.request("thread/resume", { threadId: active.id, excludeTurns: false });
            if (resumed?.thread) recovered = normalizeLoadedThread(resumed.thread);
          } catch (resumeError: any) {
            if (!/not found|no such thread/i.test(String(resumeError?.message))) throw resumeError;
          }

          if (recovered) {
            active = recovered;
            threadRef.current = recovered;
            threadCacheRef.current.set(recovered.id, recovered);
            setThread(recovered);
            result = await startTurn(active);
            showToast("会话已恢复", "已在原会话中继续发送");
          } else {
            threadCacheRef.current.delete(active.id);
            active = await createEmptyThread();
            if (!active) throw error;
            createdThreadId = active.id;
            showToast("会话已重建", "原会话确实不存在，已新建会话并重新发送");
            result = await startTurn(active);
          }
        }
      }
      createdThreadId = null;
      if (result.turn?.id) {
        // /plan 计划模式旗标已消费：记住这个方案回合，turn/completed 时弹「开始执行」确认条
        if (planOnceRef.current) {
          planOnceRef.current = false;
          setPlanArmed(false);
          setPlanRunning(true);
          planTurnRef.current = { threadId: active.id, turnId: String(result.turn.id) };
        }
        // 记录限流重试上下文：该回合若以 429 失败，可用原输入在原会话自动重发
        retryContextRef.current = {
          threadId: active.id,
          input: sendInput,
          model: selectedModel?.model ?? modelName(modelId),
          effort: effort || null,
          personality: selectedModel?.supportsPersonality ? personality : null,
        };
        rateLimitAttemptRef.current = 0;
        const hydratedTurn = hydrateTurnUserMessage(result.turn, sendInput);
        optimisticTurnIdRef.current = hydratedTurn.id;
        setActiveTurnId(hydratedTurn.id);
        markThreadRunning(active.id, hydratedTurn.id);
        saveThreadModel(active.id, modelId);
        setThread((current) => {
          const next = mergeTurn(current, hydratedTurn);
          threadRef.current = next;
          return next;
        });
        if (hydratedTurn.items.some((entry) => entry.type === "userMessage" && userMessageMatchesInput(entry, sendInput))) setOptimisticInput(null);
      }
      if (expertRole) forgetExpertRole(active.id);
      // 首条已发出：无论包装是否带上了记录（如只发图没文字），该线程已非空、记录永远附不上了，
      // 清除待发送标记（含 localStorage），避免残留卡在重启后误显示。
      if (readStoredPendingImport(active.id)) forgetPendingImport(active.id);
      void refreshThreads();
    } catch (error: any) {
      // turn/start RPC 直接以限流失败：安排应用层自动重试（10 次退避）
      if (isRateLimitError(error?.message)) {
        const retryThreadId = createdThreadId ?? threadRef.current?.id;
        if (retryThreadId) {
          setSending(false);
          setInterrupting(false);
          setWorkStartedAt(null);
          markThreadStopped(retryThreadId);
          retryContextRef.current = {
            threadId: retryThreadId,
            input: sendInput,
            model: selectedModel?.model ?? modelName(modelId),
            effort: effort || null,
            personality: selectedModel?.supportsPersonality ? personality : null,
          };
          scheduleRateLimitRetry(1);
          return;
        }
      }
      // 彻底失败也必须复位运行态，否则停止按钮一直转、composer 一直锁
      setPlanRunning(false);
      if (createdThreadId && !runningThreadIdsRef.current.has(createdThreadId)) {
        const orphanId = createdThreadId;
        await window.codex.request("thread/delete", { threadId: orphanId }).catch(() => undefined);
        threadCacheRef.current.delete(orphanId);
        setThreads((current) => current.filter((entry) => entry.id !== orphanId));
        if (threadRef.current?.id === orphanId) {
          threadRef.current = null;
          setThread(null);
        }
      }
      setSending(false);
      setActiveTurnId(null);
      markThreadStopped(threadRef.current?.id);
      setInterrupting(false);
      setWorkStartedAt(null);
      setNotice(error.message);
    }
    } finally {
      sendInFlightRef.current = false;
    }
  }

  async function handleLogin(info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }): Promise<boolean> {
    try {
      const preservedThreadId = accountSwitchThreadRef.current;
      // 用户名同步（昵称走 personalization，引擎下次对话就用这个称呼）
      if (info.username) {
        localStorage.setItem("username", info.username);
        setUsername(info.username);
        void window.codex.setNickname(info.username).catch(() => undefined);
      }
      // 1) 探测该端点模型；官方订阅走引擎内置模型目录（chatgpt 网关无裸 /models 探测），跳过探测
      let models: string[];
      if (info.provider === "openai-official") {
        models = OFFICIAL_MODELS;
      } else {
        const probe = await window.codex.probeCustomModel({ provider: info.provider, baseUrl: info.baseUrl, apiKey: info.apiKey, wireApi: "responses" });
        models = probe?.models ?? [];
        if (!models.length) return false;
      }
      // 2) 第一个非多媒体模型生效；已知模型按规格表回填上下文/最大输出/思考档位
      const defaultModel = info.model || models.find((id: string) => !/image|embedding|moderation|audio|tts|whisper|auto-review/i.test(id)) || models[0];
      const allModels = models.map((id: string) => { const spec = matchModelSpec(id); return { id, contextWindow: spec?.contextWindow ?? 256000, maxOutputTokens: spec?.maxOutputTokens, efforts: spec ? [...spec.efforts] : undefined, inputTypes: spec?.inputTypes ? [...spec.inputTypes] : ["text"] as ("text" | "image" | "video")[], outputTypes: ["text"] as ("text" | "image" | "video")[] }; });
      const saved = await window.codex.saveCustomModel({
        provider: info.provider,
        name: info.name,
        model: defaultModel,
        baseUrl: info.baseUrl,
        contextWindow: matchModelSpec(defaultModel)?.contextWindow ?? 256000,
        wireApi: "responses",
        apiKey: info.apiKey,
        models: allModels,
        enabled: true,
      });
      // 3) 选中生效 + 设置思考
      const id = `custom:${saved.provider}:${saved.model}`;
      setModelId(id);
      localStorage.setItem("default-model", id);
      setEffort("high");
      localStorage.setItem("default-effort", "high");
      adoptSavedProvider(saved, models);
      // 4) 进主界面
      localStorage.setItem("login-skipped", "false");
      setShowLogin(false);
      showToast("登录成功", `已创建 ${info.name}，导入 ${models.length} 个模型，默认生效 ${defaultModel}`);
      // 登录/切换账号后只刷新列表，不创建新会话、不清空本地历史；优先恢复切换前打开的线程。
      await refreshThreads().catch(() => undefined);
      if (preservedThreadId) await openThread(preservedThreadId);
      accountSwitchThreadRef.current = null;
      return true;
    } catch (error: any) {
      setNotice("登录失败：" + error.message);
      return false;
    }
  }

  async function handleSkip() {
    localStorage.setItem("login-skipped", "true");
    setShowLogin(false);
  }

  async function handleLogout() {
    if (!(await openAppConfirm("退出登录", "将回到登录界面，本机模型与会话配置都会保留。", "退出登录"))) return;
    accountSwitchThreadRef.current = threadRef.current?.id ?? null;
    localStorage.setItem("login-skipped", "logout");
    // 明确保留 thread、threads、threadCacheRef 和 codex-home/sessions，不因切换账号丢失历史。
    setShowLogin(true);
  }

  // /plan 确认执行：以默认协作模式把「按方案执行」发进同一会话
  function confirmPlanExecution() {
    const pc = planConfirm;
    if (!pc || !thread || thread.id !== pc.threadId || sendInFlightRef.current) return;
    setPlanConfirm(null);
    setPlanFeedback("");
    pendingCommandTextRef.current = "方案已确认，请严格按照上述方案开始执行，完成后总结改动清单。";
    void send();
  }
  function cancelPlanExecution() {
    setPlanConfirm(null);
    setPlanFeedback("");
    showToast("计划模式已取消", "方案保留在对话里，可手动继续");
  }
  // /plan 提意见：不清计划旗标，带着反馈以 plan 模式再跑一轮修订，直到满意再执行
  function submitPlanFeedback() {
    const text = planFeedback.trim();
    if (!planConfirm || !text || !thread || thread.id !== planConfirm.threadId || sendInFlightRef.current) return;
    setPlanConfirm(null);
    setPlanFeedback("");
    planOnceRef.current = true;
    pendingCommandTextRef.current = text;
    showToast("已提交意见", "正在按你的反馈修订方案");
    void send();
  }
  // /goal 停止：清引擎长期目标（引擎随即不再自动续跑）
  function stopGoalLoop() {
    if (!thread) return;
    void window.codex.request("thread/goal/clear", { threadId: thread.id }).then(() => {
      setGoalText("");
      setGoalStatus(null);
      showToast("目标模式已停止", "已清除长期目标，自动推进结束");
    }).catch((error: any) => showToast("停止失败", error.message));
  }

  async function interrupt() {
    if (!thread) return;
    const turnId = activeTurnId ?? runningTurnIdsRef.current.get(thread.id);
    if (!turnId) return;
    setInterrupting(true);
    try {
      await window.codex.request("turn/interrupt", { threadId: thread.id, turnId });
      setInterruptedTurns((current) => ({ ...current, [turnId]: Date.now() }));
      // 在清 workStartedAt 之前算已工作秒数：渲染「你在 X 秒后停止了」需要
      const elapsed = workStartedAt != null ? Math.max(1, Math.round((Date.now() - workStartedAt) / 1000)) : 1;
      setStoppedElapsed((current) => ({ ...current, [turnId]: elapsed }));
      setSending(false);
      setInterrupting(false);
      markThreadStopped(thread.id);
      setWorkStartedAt(null);
      // 保留乐观消息（避免"停止后消息消失"）：从服务端重新拉回合恢复已生成内容
      const resumed = await resumeThreadWithTurns({ threadId: thread.id, excludeTurns: false }).catch(() => null);
      if (resumed?.thread) {
        threadRef.current = resumed.thread;
        setThread(resumed.thread);
        if (optimisticInput && resumed.thread.turns.some((entry: Turn) => entry.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, optimisticInput.content ?? [])))) setOptimisticInput(null);
      }
      void refreshThreads();
    } catch (error: any) {
      setInterrupting(false);
      // 线程已失效（thread not found）：没有可中断的回合，直接复位运行态
      if (/not found|no such thread|unloaded/i.test(String(error?.message))) {
        setSending(false);
        setActiveTurnId(null);
        markThreadStopped(thread.id);
        setWorkStartedAt(null);
        setNotice("原会话已失效，已停止。重新发送会自动重建会话。");
      } else setNotice(error.message);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function closePanelTab(key: string) {
    setOpenTabs((current) => {
      const closed = current.find((tab) => tab.key === key);
      if (closed) setRecentlyClosed((list) => [{ key: closed.key, name: closed.name, at: Date.now() }, ...list.filter((entry) => entry.name !== closed.name)].slice(0, 6));
      const next = current.filter((tab) => tab.key !== key);
      if (rightTab === key) setRightTab(next[0] ? next[0].key : "");
      return next;
    });
  }

  function openPanelTab(key: string, name: string) {
    setOpenTabs((current) => current.some((tab) => tab.key === key) ? current : [...current, { key, name }]);
    setRightTab(key);
    setRecentlyClosed((list) => list.filter((entry) => entry.name !== name));
    setSwitcherOpen(false);
  }

  // 长会话窗口化：默认只渲染最近 TURN_WINDOW 个回合，更早的按需展开。
  // 这台机器是软件渲染（无 GPU），把几千个回合一次性挂进 React 是「切会话要等很久」的主因
  // ——content-visibility 只省绘制，省不掉建元素与 Markdown 解析的成本。
  const [earlyTurnExpanded, setEarlyTurnExpanded] = useState<Record<string, boolean>>({});
  const allItems = thread?.turns.flatMap((turn) => turn.items) ?? [];
  const isEmpty = !thread && !allItems.length;
  // 欢迎页（空会话）自动聚焦输入框：docked-center 的 absolute 定位 + 过渡动画期间命中区域会
  // 短暂偏移，用户点好几次才聚焦。进入欢迎页直接聚焦，从根上绕开「点不进去」。
  useEffect(() => {
    if (!showLogin && isEmpty) {
      const raf = requestAnimationFrame(() => composerInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [isEmpty, showLogin]);
  // 无缓存切换会话期间（thread 尚未恢复），顶部标题先用列表里的名称，避免闪「新任务」
  const switchingMeta = switchingThreadId ? threads.find((entry) => entry.id === switchingThreadId) : null;

  const paletteSections = (() => {
    const q = paletteQuery.toLowerCase();
    const match = (label: string) => label.toLowerCase().includes(q);
    const ops = [
      { group: "建议", label: "新任务", shortcut: "Ctrl+N", icon: MessageSquarePlus, run: () => startNewThread() },
      { group: "建议", label: "打开工作区", shortcut: "Ctrl+O", icon: FolderOpen, run: () => void chooseWorkspace() },
      { group: "建议", label: "设置", icon: Settings2, run: () => { setSettingsPage("general"); setSettingsOpen(true); } },
      { group: "面板", label: "切换侧边栏", shortcut: "Ctrl+B", icon: PanelRightOpen, run: () => setRightOpen((current) => !current) },
      { group: "面板", label: "切换终端", shortcut: "Ctrl+J", icon: TerminalSquare, run: () => openPanelTab("terminal", workspace ? basename(workspace) : "终端") },
      { group: "面板", label: "切换预览", icon: Globe2, run: () => openPanelTab("browser", "浏览器") },
      { group: "面板", label: "打开变更视图", icon: GitBranch, run: () => openPanelTab("review", "变更") },
      { group: "面板", label: "添加项目树标签", icon: FolderTree, run: () => openPanelTab("tree", "项目树") },
      { group: "配置", label: "自动化", icon: Clock3, run: () => { setSettingsPage("schedule"); setSettingsOpen(true); } },
      { group: "配置", label: "模型设置", icon: Bot, run: () => { setSettingsPage("model"); setSettingsOpen(true); } },
      { group: "配置", label: "插件", icon: Store, run: () => { setSettingsPage("plugins"); setSettingsOpen(true); } },
      { group: "配置", label: "记忆", icon: Archive, run: () => { setSettingsPage("memory"); setSettingsOpen(true); } },
    ].filter((row) => match(row.label));
    const tasks = threads.filter((entry) => (entry.name ?? "").toLowerCase().includes(q) || (entry.preview ?? "").toLowerCase().includes(q)).map((entry) => ({ group: "任务", label: cleanThreadDisplayTitle(entry.name, { preview: entry.preview }), icon: MessageSquare, run: () => void openThread(entry.id) }));
    const files = treeEntries.filter((entry) => !entry.isDirectory && entry.fileName.toLowerCase().includes(q)).map((entry) => ({ group: "文件", label: entry.fileName, icon: FileCode2, run: () => void openFile(`${treePath || workspace}${treePath || workspace ? (treePath.includes("\\") ? "\\" : "/") : ""}${entry.fileName}`) }));
    const sections: { group: string; rows: any[] }[] = [];
    if (paletteTab === "all" || paletteTab === "ops") for (const group of ["建议", "面板", "配置"]) {
      const rows = ops.filter((row) => row.group === group);
      if (rows.length) sections.push({ group, rows });
    }
    if ((paletteTab === "all" || paletteTab === "tasks") && tasks.length) sections.push({ group: "任务", rows: tasks });
    if ((paletteTab === "all" || paletteTab === "files") && files.length) sections.push({ group: "文件", rows: files });
    return sections;
  })();
  const fileTruncated = filePreview?.kind === "text" && filePreview.content.length >= 200_000;
  const usage = tokenUsage?.total ?? tokenUsage?.last ?? tokenUsage;
  const lastUsage = tokenUsage?.last ?? usage;
  const completedTurns = thread?.turns.filter((turn) => turn.status !== "inProgress") ?? [];
  const latestCompletedTurn = completedTurns.at(-1);
  const stats = usageStats;
  const activeFlags: string[] = thread?.status?.activeFlags ?? [];
  const waitingForApproval = activeFlags.includes("waitingOnApproval") || pending.some((request) => request.method.toLowerCase().includes("approval"));
  const waitingForInput = activeFlags.includes("waitingOnUserInput");
  // 当前会话只读取自己的运行状态；其他后台任务继续在侧栏独立显示，不影响本会话按钮。
  const activeThreadRunning = Boolean(thread && (runningThreadIds.has(thread.id) || thread.turns.some((turn) => isTurnRunning(turn))));
  // 团队会话里正在被调度的成员（主理人通过 team_member_invoke 分发子任务时点亮其头像）
  const activeThreadMemberRunning = expertTeamMemberRunning && thread && expertTeamMemberRunning.teamId === (teamThreadMapRef.current.get(thread.id) || teamThreadConfigRef.current.get(thread.id)?.teamId) ? expertTeamMemberRunning : null;
  const activeMemberTeam = activeThreadMemberRunning ? expertTeams.find((team) => team.teamId === activeThreadMemberRunning.teamId) ?? null : null;
  const activeMember = activeMemberTeam && activeThreadMemberRunning ? [activeMemberTeam.lead, ...activeMemberTeam.members].find((member) => member.id === activeThreadMemberRunning.memberName) ?? null : null;
  const activityLabel = interrupting ? "正在停止" : waitingForApproval ? "等待你的确认" : waitingForInput ? "等待你的输入" : activeMember ? `专家「${activeMember.profession.zh || activeMember.name}」执行中` : subAgentRunning ? `子智能体「${subAgentRunning}」执行中` : activeThreadRunning ? (workStartedAt != null ? `已工作 ${Math.max(1, Math.round((nowTick - workStartedAt) / 1000))} 秒` : "Codex 正在处理") : "";
  // 上下文压缩后的缓存重建窗口：压缩重写了提示词前缀，上游缓存命中需要 1~3 轮才恢复
  // （rollout 实测：压缩后 last.cached=0 连续 2 轮，第 3 轮回到 98%）。窗口内 0% 不是 bug。
  const recentCompaction = useMemo(() => {
    if (!thread) return false;
    const turns = thread.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].items?.some((item) => item.type === "contextCompaction")) return turns.length - 1 - i < 3;
    }
    return false;
  }, [thread]);
  const saveInlineRename = () => {
    const next = renameDraft.trim();
    if (next && thread) void renameThread(thread.id, next);
    setInlineRename(false);
  };

  if (showLogin) {
    return (
      <LoginScreen onSkip={() => void handleSkip()} onLogin={(info) => handleLogin(info)} />
    );
  }


  // 顶栏操作簇（📁 工作区 / ⋯ 任务菜单 / 新建终端 / 右栏开关）：右栏关闭时嵌在
  // topbar 右端、开启时嵌在右栏顶条右端——两处都紧贴右上角原生窗口钮，且都是
  // 拖拽容器的【子元素】（no-drag 豁免），fixed 悬浮层会被拖拽区吞掉点击（实测）。
  const topbarActionsNode = (
    <>
                <div className="ctx-picker">
          <button className="icon-button ctx-picker-btn" title="工作区上下文（当前会话使用的项目目录）" onClick={() => setCtxMenuOpen((current) => !current)}><FolderOpen size={16} /></button>
          {ctxMenuOpen && <>
            <div className="menu-backdrop" onClick={() => setCtxMenuOpen(false)} />
            <div className="task-menu ctx-menu">
              <button onClick={() => { setCtxMenuOpen(false); void chooseWorkspace(); }}><FolderOpen size={14} />{workspace ? "选择其他目录…" : "选择工作区目录"}</button>
              {workspace && <button onClick={() => setCtxMenuOpen(false)}><FolderOpen size={14} /><span className="ctx-current-name">资源管理器 · {basename(workspace)}</span><Check size={14} className="ctx-check" /></button>}
            </div>
          </>}
        </div>
        <div className="task-menu-wrap">
          <button className="icon-button" title="当前任务操作" onClick={() => setTaskMenuOpen((current) => !current)}><MoreHorizontal size={18} /></button>
          {taskMenuOpen && <>
            <div className="menu-backdrop" onClick={closeTaskMenu} />
            <div className="task-menu" role="menu">
              <div className="task-menu-sections">
                <div className="task-menu-section">
                  <span className="task-menu-label">当前任务</span>
                  <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/compact"); }}><Minimize2 size={14} /><span>压缩上下文</span></button>
                  <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/review"); }}><Search size={14} /><span>审查代码改动</span></button>
                  <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/undo"); }}><RotateCcw size={14} /><span>撤销上一轮</span></button>
                </div>
                <div className="task-menu-section">
                  <span className="task-menu-label">工作区</span>
                  <button onClick={() => { closeTaskMenu(); setRightOpen(true); setRightTab("tree"); }}><FolderTree size={14} /><span>浏览项目文件</span></button>
                  <button disabled={!thread} onClick={() => { closeTaskMenu(); void runSlashCommand("/queue"); }}><ListChecks size={14} /><span>消息队列</span></button>
                </div>
              </div>
            </div>
          </>}
        </div>
        <button className="icon-button" title="新建终端标签页" onClick={() => { setRightOpen(true); setRightTab("terminal"); }}><TerminalSquare size={16} /></button>
        <button className="icon-button" title={rightOpen ? "收起右侧面板" : "展开右侧面板"} onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    </>
  );
  return (
    <div
      ref={shellRef}
      className={`app-shell ${rightOpen ? "with-context" : ""} ${sidebarCollapsed ? "side-collapsed" : ""} ${narrow ? "narrow" : ""}`}
      // 右侧上下文面板仅在用户显式开启后参与网格；收起左栏时不能塞入一个 0px 首列，
      // 否则 CSS Grid 会保留隐式轨道，把 workspace 挤到最右侧。
      style={rightOpen ? { gridTemplateColumns: sidebarCollapsed ? `minmax(0, 1fr) 1px ${panelWidth}px` : `256px minmax(0, 1fr) 1px ${panelWidth}px` } : undefined}
    >
      {sidebarCollapsed && <div className="sidebar-hotzone" aria-hidden onMouseEnter={() => setSidebarFlyout(true)} />}
        <header className="topbar">
        {sidebarCollapsed && !narrow && <button className="icon-button sidebar-reveal" title="展开侧边栏" onClick={() => { setSidebarCollapsed(false); setSidebarFlyout(false); localStorage.setItem("sidebar-collapsed", "false"); }}><Menu size={18} /></button>}
        <button className="icon-button mobile-menu" title="打开导航" onClick={() => setMobileNav(!mobileNav)}><Menu size={18} /></button>
        <div className={`task-title ${activeThreadRunning ? "running" : "ready"}`}>
          {inlineRename ? <input ref={inlineRenameRef} value={renameDraft} aria-label="任务名称" onChange={(event) => setRenameDraft(event.target.value)} onBlur={saveInlineRename} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveInlineRename(); } if (event.key === "Escape") { event.preventDefault(); setInlineRename(false); } }} /> : <strong title="双击修改任务名称" onDoubleClick={() => { if (!thread) return; setRenameDraft(cleanThreadDisplayTitle(thread.name, { preview: thread.preview })); setInlineRename(true); queueMicrotask(() => { inlineRenameRef.current?.focus(); inlineRenameRef.current?.select(); }); }}>{cleanThreadDisplayTitle(thread?.name, { preview: thread?.preview, fallback: cleanThreadDisplayTitle(switchingMeta?.name, { preview: switchingMeta?.preview, fallback: "新任务" }) })}</strong>}
          <span>{workspace || "尚未选择工作区"}</span>
          {subAgentRunning && <span className="subagent-badge" title={`子智能体「${subAgentRunning}」执行中`}><Bot size={13} className="subagent-pulse" /><em>{subAgentRunning}</em><i>执行中</i></span>}
        </div>
        <div className="topbar-actions">{topbarActionsNode}</div>
      </header>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""} ${sidebarFlyout ? "flyout-open" : ""}`} onMouseEnter={() => sidebarCollapsed && setSidebarFlyout(true)} onMouseLeave={() => sidebarCollapsed && setSidebarFlyout(false)}>
        <div className="brand-row">
          <button className={`brand-mark sidebar-toggle ${sidebarCollapsed ? "is-collapsed" : "is-expanded"}`} aria-label={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} title={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={() => { if (narrow) return; const next = !sidebarCollapsed; setSidebarCollapsed(next); localStorage.setItem("sidebar-collapsed", String(next)); }}>
            <span className="ch-logo" aria-hidden="true"><i>C</i><i>H</i></span>
            <span className="sidebar-toggle-arrow"><ArrowLeft size={13} strokeWidth={2.4} /></span>
          </button>
          {!sidebarCollapsed && <div><strong>Codex Harness</strong><span>Desktop</span></div>}
        </div>
        <div className="sidebar-tabs" role="tablist" aria-label="导航">
          <button className="sidebar-tab" onClick={() => { startNewThread(); }}><MessageSquarePlus size={15} /><span>新建任务</span><kbd>Ctrl N</kbd></button>
          <button className="sidebar-tab" onClick={() => { setSettingsPage("schedule"); setSettingsOpen(true); setMobileNav(false); }}><Clock3 size={15} /><span>自动化</span></button>
          <button className="sidebar-tab" onClick={() => { setSettingsPage("skills"); setSettingsOpen(true); setMobileNav(false); }}><Zap size={15} /><span>技能中心</span></button>
          <button className="sidebar-tab" onClick={() => { setSettingsPage("plugins"); setSettingsOpen(true); setMobileNav(false); }}><Store size={15} /><span>插件市场</span></button>
          <button className="sidebar-tab" onClick={() => { setSettingsPage("teams"); setSettingsOpen(true); setMobileNav(false); }}><Users size={15} /><span>专家团</span></button>
          <button className="sidebar-tab" onClick={() => { setSettingsPage("backup"); setSettingsOpen(true); setMobileNav(false); }}><Download size={15} /><span>会话备份</span></button>
        </div>
        <button className="search-box" title="搜索任务与操作（Ctrl+K）" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }}><Search size={15} /><span>搜索任务</span><kbd>Ctrl K</kbd></button>
        {projectFilter && <button className="filter-chip" title="清除项目筛选" onClick={() => setProjectFilter(null)}><FolderOpen size={12} />{basename(projectFilter)}<X size={12} /></button>}
        <div className="view-tabs" role="tablist" aria-label="视图">
          <button className={`view-tab ${viewTab === "groups" ? "active" : ""}`} onClick={() => setViewTab("groups")} title="按时间分组"><Hash size={14} /><span>分组</span></button>
          <button className={`view-tab ${viewTab === "projects" ? "active" : ""}`} onClick={() => setViewTab("projects")} title="按项目分组"><FolderOpen size={14} /><span>项目</span></button>
          <div className="view-toolbar">
            <button className="view-toolbar-btn" title="刷新会话列表" onClick={() => { void refreshThreads().then(() => showToast("会话列表已刷新", "已重新读取全部会话")); }}><ListRestart size={14} /></button>
            <button className="view-toolbar-btn" title={sidebarAllCollapsed ? "全部展开" : "全部折叠"} onClick={toggleAllSidebarSections} disabled={viewTab === "groups" ? !groupedThreads.length : !projectGroups.length}>{sidebarAllCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}</button>
          </div>
        </div>
        <div className="thread-list">
          {loading ? Array.from({ length: 5 }).map((_, index) => <div className="thread-skeleton shimmer" key={index} />) : viewTab === "projects" ? (
            <div className="project-list">
              {projectGroups.length ? projectGroups.map(([cwd, items]) => {
                const expanded = expandedProjects.has(cwd);
                return (
                  <div key={cwd} className={`project-item ${expanded ? "expanded" : "collapsed"} ${projectMenu === cwd ? "menu-open" : ""}`}>
                    <div className="project-item-head" onMouseLeave={() => setProjectMenu((current) => current === cwd ? null : current)}>
                      <button className="project-item-toggle" title={expanded ? "折叠项目" : "展开项目"} onClick={() => toggleProjectExpanded(cwd)}>
                        <ChevronDown size={12} className={`project-item-chevron ${expanded ? "open" : ""}`} />
                        <FolderOpen size={13} />
                        <strong>{basename(cwd)}</strong>
                        <em>{items.length}</em>
                      </button>
                      <button className="project-item-menu-btn" title="项目操作" aria-expanded={projectMenu === cwd} onClick={(event) => { event.stopPropagation(); setProjectMenu(projectMenu === cwd ? null : cwd); }}><MoreHorizontal size={14} /></button>
                      {projectMenu === cwd && <div className="project-menu">
                        <button onClick={() => { setProjectMenu(null); setProjectFilter(cwd); setMobileNav(false); }}><FolderOpen size={14} />只看该项目</button>
                        <button className="danger" onClick={() => { setProjectMenu(null); void deleteThreadsByCwd(cwd); }}><Trash2 size={14} />移除（删除全部对话）</button>
                      </div>}
                    </div>
                    {expanded && <div className="project-item-body">{[...items].sort((a, b) => Number(pinnedThreads.includes(b.id)) - Number(pinnedThreads.includes(a.id)) || b.updatedAt - a.updatedAt).map(renderThreadRow)}</div>}
                  </div>
                );
              }) : <div className="empty-list">暂无项目</div>}
            </div>
          ) : listThreads.length ? (
            <>
              {groupedThreads.map((g) => (
                <section className="conv-section" key={g.key}>
                  <button className="conv-section-label" title="折叠/展开分组" onClick={() => toggleSection(g.key)}>
                    <ChevronDown size={12} className={`conv-section-chevron ${collapsedSections.has(g.key) ? "" : "open"}`} />
                    <span>{g.label}</span><em>{g.items.length}</em>
                  </button>
                  {!collapsedSections.has(g.key) && <div className="conv-section-body">{g.items.map(renderThreadRow)}</div>}
                </section>
              ))}
            </>
          ) : <div className="empty-list">{threads.length ? "当前筛选下暂无任务" : "暂无任务"}</div>}
        </div>
        <div className="account-row">
          <button className="account-avatar" title="账户菜单" onClick={() => { setAccountMenuSub(null); setAccountMenuOpen(!accountMenuOpen); }}>{userAvatar?.type === "image" && userAvatar.value ? <img src={userAvatar.value} alt="头像" /> : userAvatar?.type === "emoji" && userAvatar.value ? <span className="account-avatar-emoji">{userAvatar.value}</span> : <span className="account-avatar-letter">{username.trim().charAt(0).toUpperCase() || "?"}</span>}</button>
          {accountEditing ? (
            <input ref={accountNameRef} className="account-name-input" aria-label="修改名称" maxLength={24} autoFocus onFocus={(event) => event.currentTarget.select()} value={accountDraft} onChange={(event) => setAccountDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveAccountName(); } if (event.key === "Escape") { event.preventDefault(); setAccountEditing(false); } }} onBlur={saveAccountName} />
          ) : (
            <button className="account-name" title="账户菜单" onClick={() => { setAccountMenuSub(null); setAccountMenuOpen(!accountMenuOpen); }}>{username}</button>
          )}
          {accountMenuOpen && (
            <div className="account-menu" role="menu" ref={accountMenuRef}>
              {accountMenuSub === null && <>
                <button className="account-menu-item" onClick={() => setAccountMenuSub("lang")}><Globe2 size={15} /><span>界面语言</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                <div className="account-menu-item account-menu-theme" role="menuitem">
                  <Sun size={15} /><span>界面主题</span>
                  <span className="theme-quick">
                    <button type="button" title="浅色" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={13} /></button>
                    <button type="button" title="深色" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={13} /></button>
                  </span>
                </div>
                <button className="account-menu-item" onClick={() => setAccountMenuSub("zoom")}><ZoomIn size={15} /><span>界面缩放</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                <button className="account-menu-item" onClick={() => setAccountMenuSub("update")}>
                  <RefreshCw size={15} />
                  <span>检查更新</span>
                  {updateInfo?.hasUpdate ? <span className="account-menu-dot" title={`v${updateInfo.version} 可用`} /> : null}
                  <ChevronRight size={14} className="account-menu-arrow" />
                </button>
                <div className="account-menu-sep" />
                <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("usage"); setSettingsOpen(true); }}><CircleGauge size={15} /><span>使用统计</span></button>
                <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("user"); setSettingsOpen(true); setMobileNav(false); }}><UserRound size={15} /><span>用户中心</span></button>
                <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); void window.codex.openExternal("https://www.jvszzp.ltd/feedback.html"); }}><MessageSquarePlus size={15} /><span>问题反馈</span><ExternalLink size={12} className="account-menu-arrow" /></button>
                <div className="account-menu-sep" />
                <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); handleLogout(); }}><LogOut size={15} /><span>退出登录</span></button>
              </>}
              {accountMenuSub === "lang" && <>
                <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>界面语言</span></button>
                <button className={`account-menu-item ${uiLang === "zh" ? "current" : ""}`} onClick={() => { setUiLang("zh"); setAccountMenuSub(null); }}><span>简体中文</span>{uiLang === "zh" && <Check size={14} />}</button>
                <button className={`account-menu-item ${uiLang === "en" ? "current" : ""}`} onClick={() => { setUiLang("en"); setAccountMenuSub(null); showToast("英文界面即将上线", "当前版本先提供简体中文"); }}><span>English</span>{uiLang === "en" && <Check size={14} />}</button>
              </>}
              {accountMenuSub === "zoom" && <>
                <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>界面缩放</span></button>
                {[0.8, 0.9, 1, 1.1, 1.25].map((factor) => (
                  <button key={factor} className={`account-menu-item ${uiZoom === factor ? "current" : ""}`} onClick={() => { setUiZoom(factor); setAccountMenuSub(null); }}>
                    <span>{Math.round(factor * 100)}%</span>{uiZoom === factor && <Check size={14} />}
                  </button>
                ))}
              </>}
              {accountMenuSub === "update" && <>
                <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>检查更新</span></button>
                <div className="account-menu-section">
                  <div className="account-menu-row"><span className="account-menu-label">当前版本</span><span className="account-menu-value mono">v{updateCurrentVersion || "—"}</span></div>
                  <div className="account-menu-row"><span className="account-menu-label">更新地址</span><span className="account-menu-value">{updateSource === "github" ? "GitHub Releases" : "官方发布站"}</span></div>
                  <div className="account-menu-toggle-row">
                    <button type="button" className={`account-menu-toggle ${updateSource === "web" ? "active" : ""}`} title="自建发布站（国内下载较快）" onClick={() => { setUpdateSource("web"); setUpdateInfo(null); }}>网页</button>
                    <button type="button" className={`account-menu-toggle ${updateSource === "github" ? "active" : ""}`} title="GitHub Releases（开源仓库）" onClick={() => { setUpdateSource("github"); setUpdateInfo(null); }}>GitHub</button>
                  </div>
                </div>
                <button className="account-menu-item" onClick={() => void runUpdateCheck()} disabled={updateChecking}>
                  <RefreshCw size={15} className={updateChecking ? "spin" : ""} />
                  <span>{updateChecking ? "检查中…" : "检查更新"}</span>
                </button>
                {updateError ? <div className="account-menu-error">{updateError}</div> : null}
                {updateInfo && !updateInfo.hasUpdate ? (
                  <div className="account-menu-success">
                    <CircleCheck size={14} /><span>已是最新版本</span>
                  </div>
                ) : null}
                {updateInfo?.hasUpdate ? <>
                  <div className="account-menu-sep" />
                  <div className="account-menu-section">
                    <div className="account-menu-row"><span className="account-menu-label">新版本</span><span className="account-menu-value mono">v{updateInfo.version}</span></div>
                    {updateInfo.size ? <div className="account-menu-row"><span className="account-menu-label">大小</span><span className="account-menu-value">{((updateInfo.size / 1024 / 1024) || 0).toFixed(1)} MB</span></div> : null}
                  </div>
                  {updateInfo.changelog ? <div className="account-menu-changelog">{updateInfo.changelog}</div> : null}
                  <button className="account-menu-item primary" onClick={() => void runUpdateDownload()} disabled={updateDownloading}>
                    <Download size={15} className={updateDownloading ? "pulse" : ""} />
                    <span>{updateDownloading ? (updateProgress > 0 ? `下载中 ${Math.round(updateProgress * 100)}%` : "下载中…") : "立即更新"}</span>
                  </button>
                </> : null}
                <div className="account-menu-sep" />
                <button className="account-menu-item" title="打开发布中心反馈页（自动携带版本与系统信息）" onClick={openFeedbackPage}><MessageSquare size={15} /><span>遇到问题？去反馈</span><ExternalLink size={13} className="account-menu-arrow" /></button>
              </>}
            </div>
          )}
          <button className="account-icon" title="移动端远程控制" onClick={() => { setMobileRemoteOpen(true); void window.codex.remoteStart().then((r) => setRemoteUrl(r.url)).catch(() => undefined); void window.codex.remoteStatus().then((s) => { setRemoteStatus(s.status); setRemoteDevices(s.devices); setRemoteUrl(s.url); }).catch(() => undefined); void window.codex.remoteQrcode().then((svg) => setRemoteQr(svg)).catch(() => undefined); }}><Smartphone size={15} /></button>
          <button className="sidebar-settings" title="设置" onClick={() => { setSettingsPage("appearance"); setSettingsOpen(true); setMobileNav(false); }}><Settings2 size={16} /></button>
        </div>
      </aside>

      <main className="workspace">

        <div className="timeline-wrap" ref={timelineWrapRef}>
          {thread && <MemoMessageRuler turns={thread.turns} scrollRef={scrollRef} containerRef={timelineWrapRef} onJump={jumpToTurn} />}
          <div className={`timeline ${isEmpty ? "empty-state" : ""}`} ref={scrollRef}>
          {isEmpty ? (
            <div className="welcome-state">
              <div className="welcome-mark"><Code2 strokeWidth={0.5} size={96} /></div>
              <h1 className="welcome-greet">{greeting}</h1>
              <p className="welcome-sub">{greetSub}</p>
            </div>
          ) : null}
          {/* 导入会话记录后、尚未发送首条消息：记录预览卡常驻消息区顶部；发送后转为消息内的导入卡 */}
          {thread && (thread.turns ?? []).length === 0 && pendingImportThreads[thread.id] ? <PendingImportSlot key={thread.id} threadId={thread.id} onDiscard={() => forgetPendingImport(thread.id)} /> : null}
          {/* 长会话窗口化：默认只挂最近 TURN_WINDOW 个回合，更早的按需展开。
              软件渲染下全量挂载几千个回合是「切换会话慢」的主因，这里把首屏成本封顶。 */}
          {thread && thread.turns.length > TURN_WINDOW && !earlyTurnExpanded[thread.id] && (
            <button type="button" className="load-earlier-turns" onClick={() => { setEarlyTurnExpanded((current) => ({ ...current, [thread.id]: true })); void loadEarlierTurns(thread.id); }}>
              <ChevronDown size={13} style={{ transform: "rotate(180deg)" }} />
              显示更早的 {thread.turns.length - TURN_WINDOW} 条消息
              <small>为加快打开速度，默认只渲染最近 {TURN_WINDOW} 条</small>
            </button>
          )}
          {thread?.turns.slice(thread.turns.length > TURN_WINDOW && !earlyTurnExpanded[thread.id] ? thread.turns.length - TURN_WINDOW : 0).map((turn) => <MemoTurnView turn={turn} isLastTurn={turn.id === thread.turns[thread.turns.length - 1]?.id} usage={turn.usage ?? (turn.id === latestCompletedTurn?.id ? lastUsage : null)} tokenUsage={tokenUsage} fallbackWindow={customModel?.contextWindow} waitingForApproval={waitingForApproval && turn.id === activeTurnId} interruptedAt={interruptedTurns[turn.id]} elapsedSeconds={stoppedElapsed[turn.id]} handlers={messageHandlers} hooks={hookPulse.hooks.length > 0 && turn.id === latestCompletedTurn?.id ? hookPulse.hooks : null} key={turn.id} />)}
          {optimisticInput && !optimisticConfirmed && <ItemView item={optimisticInput} pending onCopy={messageHandlers.onCopy} onQuote={messageHandlers.onQuote} onImageCopy={messageHandlers.onImageCopy} onOpenFile={messageHandlers.onOpenFile} />}
          {lightbox && <ImageLightbox path={lightbox.path} alt={lightbox.alt} onClose={() => setLightbox(null)} onCopy={() => void copyImage(lightbox.path)} />}
          {systemEvents.map((event) => <div className={`system-event ${event.tone ?? "info"}`} key={event.id}><strong>{event.tone === "success" ? <CircleCheck size={13} className="system-event-icon" /> : null}{event.title}</strong><Markdown>{event.text}</Markdown></div>)}
          {/* 上下文压缩分隔线：两边虚线 + 中间文字，状态切换带过渡；success/error 常驻可手动关闭，
              只属于发起压缩的会话。成功态若时间线里已有 contextCompaction 项（同样渲染为成功分隔线），
              跳过这条 toast 避免重复显示常驻卡 */}
          {compactToast && compactToast.state !== "running" && compactToast.threadId === thread?.id && !(compactToast.state === "success" && (thread?.turns ?? []).some((t) => (t.items ?? []).some((i) => i.type === "contextCompaction"))) && (
            <div className={`compact-divider compact-divider--${compactToast.state} compact-divider--settled`} role="status" aria-label="上下文压缩状态">
              <i className="compact-divider-line" aria-hidden />
              <span className="compact-divider-text">
                {compactToast.state === "error" ? <CircleX size={13} /> : <CircleCheck size={13} />}
                {compactToast.message}
              </span>
              <button type="button" className="compact-divider-close" title="关闭此条记录" aria-label="关闭" onClick={() => setCompactToast(null)}><X size={12} /></button>
              <i className="compact-divider-line" aria-hidden />
            </div>
          )}
          {compactToast && compactToast.state === "running" && compactToast.threadId === thread?.id && !(thread?.turns ?? []).some((t) => (t.items ?? []).some((i) => i.type === "contextCompaction" && (i.status === "inProgress" || i.status === "running"))) && (
            <div className={`compact-divider compact-divider--running`} role="status" aria-label="上下文压缩状态">
              <i className="compact-divider-line" aria-hidden />
              <span className="compact-divider-text">
                <LoaderCircle size={13} className="spin" />
                {compactToast.message}
              </span>
              <i className="compact-divider-line" aria-hidden />
            </div>
          )}
          {pending.filter((request) => !request.params?.threadId || request.params.threadId === thread?.id).map((request) => <RequestCard request={request} key={request.id} onDone={() => setPending((current) => current.filter((entry) => entry.id !== request.id))} />)}
          {activityLabel && <div className={`working-indicator ${waitingForApproval || waitingForInput ? "paused" : ""}`}>
            {activeMember
              ? <span className="expert-working-avatar" style={{ background: AVATAR_GRADIENTS[avatarToneOf(activeMember.id || activeMember.name)] }} aria-hidden="true">{expertRoleLabel(activeMember, activeMember.id === activeMemberTeam?.lead.id).slice(0, 1)}</span>
              : waitingForApproval ? <ShieldCheck size={15} />
              : waitingForInput ? <MessageSquarePlus size={15} />
              : subAgentRunning ? <Bot className="process-running-icon subagent-pulse" size={15} />
              : <Bot className="process-running-icon" size={15} />}
            <span>{activityLabel}</span>
          </div>}
          {/* 底部留白只按回合状态：活跃回合给 compact 跟随留白；空闲态一律不留空白。
              乐观气泡不再触发大缓冲（它会在服务端消息确认后消失，大缓冲会残留成空白）。 */}
          {(activeTurnId || sending || (optimisticInput && !optimisticConfirmed)) ? <div className="timeline-bottom-spacer compact" aria-hidden />
            : null}
        </div>
          {switchingThreadId && (
            <div className={`thread-switch-overlay ${switchingFading ? "fading" : ""}`} role="status"><Spinner /><span>正在恢复会话…</span></div>
          )}
          {awayFromBottom && (
            <button
              className="jump-bottom"
              title="回到底部"
              onClick={() => { stickToBottomRef.current = true; const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }}
            ><ArrowDown size={16} /></button>
          )}
        </div>

        {goalsOpen && !goalsAutoGone && thread && (goalText || planSteps.length > 0) && (
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
              </div>}
            </div>
            {/* 收纳后露出的窄标签：点击展开面板 */}
            <button className={`goals-handle ${goalsDocked ? "visible" : ""}`} title="展开目标面板" onClick={() => setGoalsDocked(false)}>
              <Target size={14} />
              <span>目标</span>
              <span className="goals-handle-count">{planSteps.filter((s) => s.status === "completed").length}/{planSteps.length}</span>
            </button>
          </>
        )}

        <div ref={composerWrapRef} className={`composer-wrap ${isEmpty ? "docked-center" : ""}`}>
          {/* /plan 计划模式确认条：方案回合结束后出现，确认后才执行 */}
          {planConfirm && planConfirm.threadId === thread?.id && (
            <div className="agent-ask-inline plan-review" role="dialog" aria-label="方案确认">
              <header><ListChecks size={15} /><strong>方案已生成，请审阅</strong></header>
              {planConfirm.text && <p className="plan-review-summary" title="点击查看方案全文" onClick={() => setInfoModal({ title: "执行方案预览", body: planConfirm.text || "未捕获到方案正文，请查看对话中最后一条回复。", markdown: true })}>{planConfirm.text}</p>}
              <div className="plan-review-actions">
                <button className="primary-setting" onClick={confirmPlanExecution}>开始执行</button>
                <button onClick={() => setInfoModal({ title: "执行方案预览", body: planConfirm.text || "未捕获到方案正文，请查看对话中最后一条回复。", markdown: true })}>查看方案</button>
                <button onClick={cancelPlanExecution}>取消</button>
              </div>
              <form className="plan-review-feedback" onSubmit={(event) => { event.preventDefault(); submitPlanFeedback(); }}>
                <input value={planFeedback} onChange={(event) => setPlanFeedback(event.target.value)} placeholder="对方案提意见，让它再改一版（如：换成高铁、预算砍半）…" />
                <button type="submit" className="primary-setting" disabled={!planFeedback.trim()}>提意见</button>
              </form>
            </div>
          )}
          {/* /goal 目标模式状态条：引擎原生自动续跑中，可随时停止 */}
          {thread && goalText && (
            <div className={`mode-banner goal-loop ${goalStatus === "complete" ? "done" : ""}`} role="status" aria-label="目标模式">
              <Target size={14} className="mode-banner-icon" />
              <span className="mode-banner-text"><b>目标模式{goalStatus === "complete" ? " · 已完成" : goalStatus === "blocked" ? " · 受阻" : goalStatus === "paused" ? " · 已暂停" : " · 自动推进中"}</b>{goalText}</span>
              {goalStatus !== "complete" && <button onClick={stopGoalLoop}>停止</button>}
            </div>
          )}
          {/* Agent 提问卡：贴输入框上方、与输入框同宽；只属于发起它的会话，不跨会话弹窗 */}
          {agentAsk && agentAsk.threadId === thread?.id && (
            <div className="agent-ask-inline" role="dialog" aria-label="Agent 提问">
              <header><Sparkles size={15} /><strong>Agent 想问你</strong></header>
              <p className="agent-ask-question">{agentAsk.question}</p>
              <div className="agent-ask-options">
                {agentAsk.options.map((option, index) => (
                  <button key={index} className={option === agentAsk.recommended ? "agent-ask-option recommended" : "agent-ask-option"} onClick={() => { agentAsk.resolve(option); setAgentAsk(null); }}>
                    {option === agentAsk.recommended && <span className="agent-ask-badge">推荐</span>}
                    {option}
                  </button>
                ))}
              </div>
              {agentAsk.allowFree && (
                <form className="agent-ask-free" onSubmit={(e) => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("freeText") as HTMLInputElement); if (input.value.trim()) { agentAsk.resolve(input.value.trim()); setAgentAsk(null); } }}>
                  <input name="freeText" placeholder="或者输入你的想法…" />
                  <button type="submit" className="primary-setting"><Check size={14} />回复</button>
                </form>
              )}
            </div>
          )}
          {notice && createPortal(
            (() => {
              const tone = noticeTone(notice);
              const NoticeIcon = tone === "success" ? <CircleCheck size={16} /> : tone === "error" ? <X size={16} /> : tone === "warning" ? <AlertTriangle size={16} /> : <Info size={16} />;
              return (
                <div className={`notice notice-toast notice--${tone}`} role="status">
                  <span className="notice-icon">{NoticeIcon}</span>
                  <span className="notice-text">{notice}</span>
                  <button title="关闭" onClick={() => setNotice("")}><X size={13} /></button>
                </div>
              );
            })(),
            document.body,
          )}
          {/* 启动静默检查发现新版本 → 通知卡片（非阻塞，可稍后/关闭） */}
          {updateNotice && createPortal(
            <div className="update-card" role="status" aria-label="发现新版本">
              <div className="update-card-head">
                <span className="update-card-icon"><Download size={16} /></span>
                <div className="update-card-title">
                  <strong>发现新版本 v{updateNotice.version}</strong>
                  <span className="update-card-sub">{updateNotice.mandatory ? "建议尽快更新" : "有新版本可用"}</span>
                </div>
                <button title="关闭" onClick={() => setUpdateNotice(null)}><X size={13} /></button>
              </div>
              {updateNotice.changelog ? <div className="update-card-body">{updateNotice.changelog}</div> : null}
              <div className="update-card-actions">
                <button onClick={() => setUpdateNotice(null)}>稍后</button>
                <button className="primary" onClick={() => void runUpdateDownload()} disabled={updateDownloading}>
                  {updateDownloading ? (updateProgress > 0 ? `下载中 ${Math.round(updateProgress * 100)}%` : "下载中…") : "立即更新"}
                </button>
              </div>
            </div>,
            document.body,
          )}
          {infoModal && createPortal(
            <div className="info-modal-mask" onClick={() => setInfoModal(null)}>
              <div className="info-modal" role="dialog" aria-label={infoModal.title} onClick={(event) => event.stopPropagation()}>
                <header><Info size={15} className="info-modal-icon" /><strong>{infoModal.title}</strong><button title="关闭" onClick={() => setInfoModal(null)}><X size={14} /></button></header>
                {infoModal.markdown ? <div className="info-modal-markdown"><Markdown>{infoModal.body}</Markdown></div> : <pre>{infoModal.body}</pre>}
              </div>
            </div>,
            document.body,
          )}
          {/* 429 限流自动重试状态条：倒计时 + 立即重试 / 停止（对所有模型生效） */}
          {rateLimitRetry && (
            <div className="rate-limit-retry-bar" role="status" aria-label="限流自动重试中">
              <LoaderCircle size={15} className="spin" />
              <span className="rate-limit-retry-text">
                模型限流（429），<b>第 {rateLimitRetry.attempt}/{RATE_LIMIT_MAX_ATTEMPTS}</b> 次重试将在{" "}
                <b>{Math.max(0, Math.ceil((rateLimitRetry.retryAt - Date.now()) / 1000))}s</b> 后自动进行
              </span>
              <button type="button" onClick={() => void executeRateLimitRetry()}>立即重试</button>
              <button type="button" onClick={() => cancelRateLimitRetry()}>停止</button>
            </div>
          )}
          {thread && <QueuedMessageList entries={queue} onOpenFile={messageHandlers.onOpenFile} onQuote={messageHandlers.onQuote} onDelete={(id) => void deleteQueued(id)} onStart={(id) => void startQueued(id)} onSave={(entry, text) => void saveQueued(entry, text)} onReorder={(from, to) => void reorderQueued(from, to)} dragIndex={queueDragIndex} setDragIndex={setQueueDragIndex} />}
          {/* 图片以内联 chip 展示（composer-input-shell 内），此处只保留文件附件条 */}
          {files.length > 0 && <div className="attachment-strip">{files.map((path) => <div className="file-attachment" key={path}><FileCode2 size={18} /><span>{basename(path)}</span><button title="移除" onClick={() => setFiles(files.filter((entry) => entry !== path))}><X size={13} /></button></div>)}</div>}
          {commandMatches.length > 0 && <div className="command-palette" role="listbox" aria-label="Codex 指令">{commandMatches.map(([name, description]) => <button type="button" role="option" key={name} onClick={() => { if (["rename", "review", "goal", "plan", "effort", "personality", "sandbox", "approval", "fork"].includes(name)) setPrompt(`/${name} `); else void runSlashCommand(`/${name}`); }}><code>/{name}</code><span className="command-desc">{description}</span></button>)}</div>}
          {/* 「#」技能面板：与「/」命令面板同款展示（等宽技能名 + 中文注释列），点击即引用该技能 */}
          {skillCommandMatches.length > 0 && <div className="command-palette skill-palette" role="listbox" aria-label="可用技能">{skillCommandMatches.map((skill) => <button type="button" role="option" key={skill.name} title={`${skill.name}：${skill.note}`} onClick={() => addSkillReference(skill)}><code>#{skill.name}</code><span className="command-desc">{skill.note}</span></button>)}</div>}
          {contextOpen && <div className="context-picker" role="listbox" aria-label="引用本次对话上下文">
            <div className="context-picker-head"><span>引用本次对话</span><small>选择后会随本条消息发送</small></div>
            {availableContextItems.length ? availableContextItems.map((item) => <button type="button" role="option" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => addContextItem(item)}><b>{item.role}</b><span>{item.text}</span></button>) : <p>没有匹配的历史消息</p>}
          </div>}
          {/* 供应商切换「待重启生效」banner：切换只保存配置，重启前不打断任何会话 */}
          {pendingRestart && (
            <div className="provider-restart-banner">
              <div className="provider-restart-banner-text">
                <RefreshCw size={13} />
                <span>已选择 <b>{pendingRestart.label}</b>，<b>重启后生效</b> —— 当前会话继续使用原供应商，正在运行的任务不受影响</span>
              </div>
              <div className="provider-restart-banner-actions">
                <button type="button" className="provider-restart-banner-btn primary" onClick={() => void applyPendingRestart()}><RefreshCw size={13} />重启生效</button>
                <button type="button" className="provider-restart-banner-btn" onClick={() => void cancelPendingRestart()}><X size={13} />撤销</button>
              </div>
            </div>
          )}
          <form className="composer" onSubmit={send}>
            {quoteItem && <div className="quote-bar">
              <Quote size={13} className="quote-bar-icon" />
              <span className="quote-bar-label">引用</span>
              <em className="quote-bar-text" title={quoteItem.text}>{quoteItem.text}</em>
              <button type="button" title="取消引用" onClick={cancelQuote}><X size={13} /></button>
            </div>}
            {(contextItems.length > 0 || selectedSkills.length > 0) && <div className="context-chip-row" aria-label="已引用上下文与技能">{contextItems.map((item) => <span className="context-chip" key={item.id}><Quote size={12} /><b>{item.role}</b><em>{item.text}</em><button type="button" title="移除引用" onClick={() => removeContextItem(item.id)}><X size={12} /></button></span>)}{selectedSkills.map((skill) => <span className="context-chip skill-chip" key={skill.name}><Zap size={12} /><b>技能</b><em>{skill.name}</em><button type="button" title="移除技能" onClick={() => setSelectedSkills((current) => current.filter((entry) => entry.name !== skill.name))}><X size={12} /></button></span>)}</div>}
            <div className="composer-input-shell">
              {(planArmed || planRunning) && <button type="button" className={`mode-chip-float chip-plan ${planRunning ? "running" : ""}`} title={planRunning ? "计划模式 · 方案生成中（点击中断）" : "计划模式 · 下一条消息先出方案（点击退出）"} onClick={() => { if (planRunning) { void interrupt(); } else { planOnceRef.current = false; setPlanArmed(false); showToast("计划模式已退出", "下一条消息按普通模式执行"); } }}><ListChecks size={13} /></button>}
              {thread && goalText && goalStatus !== "complete" && <button type="button" className="mode-chip-float chip-goal" title="目标模式 · 自动推进中（点击停止）" onClick={stopGoalLoop}><Target size={13} /></button>}
              <ComposerEditor value={prompt} placeholder="向 Codex 提问，使用 / 选择命令、@ 引用上下文、# 引用技能" editorRef={composerInputRef} domValueRef={composerDomValueRef} makeChip={makeComposerChip} onValueInput={onPromptChange} onKeyDown={(event) => { if (skillCommandMatches.length && event.key === "Enter") { event.preventDefault(); addSkillReference(skillCommandMatches[0]); return; } if (skillCommandMatches.length && event.key === "Escape") { event.preventDefault(); setPrompt(""); return; } if (contextOpen && event.key === "Enter" && availableContextItems[0]) { event.preventDefault(); addContextItem(availableContextItems[0]); return; } if (event.key === "Escape" && contextOpen) { event.preventDefault(); setContextOpen(false); return; } onComposerKeyDown(event); }} onBlur={() => setTimeout(() => setContextOpen(false), 120)} onPasteImage={(text) => void pasteImage(text)} onPasteFiles={(paths) => {
                    const added = paths.filter((p) => !files.includes(p));
                    if (!added.length) return;
                    setFiles((current) => [...new Set([...current, ...added])]);
                    setNotice(`已粘贴 ${added.length} 个文件附件`);
                  }} />
            </div>
            <div className="composer-actions">
              <div className="composer-left">
                <div className="composer-quick-menu" ref={quickMenuRef}>
                  <button
                    type="button"
                    className="icon-button plus-spin-button"
                    title="添加文件、技能或连接器"
                    aria-expanded={attachmentMenuOpen}
                    onClick={() => {
                      setPlusSpinTick((tick) => tick + 1);
                      setAttachmentMenuOpen((current) => {
                        if (current) setAttachSubmenu("none");
                        return !current;
                      });
                      setSkillMenuOpen(false);
                      setConnectorMenuOpen(false);
                    }}
                  ><Plus key={plusSpinTick} size={19} className="plus-spin" /></button>
                  {attachmentMenuOpen && <div ref={quickMenuPanelRef} className={`composer-quick-pop ${quickMenuFlipUp ? "flip-main-up" : ""}`}>
                    <button type="button" data-submenu-open={attachSubmenu === "files" || undefined} onMouseEnter={() => scheduleSubmenu("files")} onMouseLeave={scheduleSubmenuClose} onClick={() => setAttachSubmenu((current) => current === "files" ? "none" : "files")}><Plus size={16} /><span>添加文件</span><ChevronDown size={14} className="submenu-chevron" /></button>
                    <button type="button" data-submenu-open={attachSubmenu === "thread-files" || undefined} onMouseEnter={() => scheduleSubmenu("thread-files")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "thread-files" ? "none" : "thread-files"); setThreadFileQuery(""); }}><Quote size={16} /><span>引用对话中的文件</span><ChevronDown size={14} className="submenu-chevron" /></button>
                    <button type="button" data-submenu-open={attachSubmenu === "experts" || undefined} onMouseEnter={() => scheduleSubmenu("experts")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "experts" ? "none" : "experts"); setExpertQuery(""); }}><Users size={16} /><span>专家</span><ChevronDown size={14} className="submenu-chevron" /></button>
                    <button type="button" data-submenu-open={attachSubmenu === "skills" || undefined} onMouseEnter={() => { scheduleSubmenu("skills"); // 打开时实时刷新已安装技能：localSkills 只在启动时拉一次，中途装的技能不刷新就看不到（同步问题）
                      void window.codex.listLocalSkills().then(setLocalSkills).catch(() => undefined); }} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "skills" ? "none" : "skills"); setSkillQuery(""); void window.codex.listLocalSkills().then(setLocalSkills).catch(() => undefined); }}><Zap size={16} /><span>技能</span><ChevronDown size={14} className="submenu-chevron" /></button>
                    <button type="button" data-submenu-open={attachSubmenu === "connectors" || undefined} onMouseEnter={() => scheduleSubmenu("connectors")} onMouseLeave={scheduleSubmenuClose} onClick={() => { setAttachSubmenu((current) => current === "connectors" ? "none" : "connectors"); setConnectorSearch(""); }}><Link2 size={16} /><span>连接器</span><ChevronDown size={14} className="submenu-chevron" /></button>

                {/* 添加文件子菜单：暂只保留本地文件（云端入口待定，不留占位） */}
                {attachSubmenu === "files" && <div className={`composer-quick-pop submenu-pop files-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="files" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                  <button type="button" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); void chooseFiles(); }}><FileUp size={15} /><span>本地文件</span></button>
                </div>}
                {/* 引用对话中的文件：带搜索框的子面板（过滤当前会话消息里出现过的文件路径） */}
                {attachSubmenu === "thread-files" && <div className={`composer-quick-pop submenu-pop thread-files-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="thread-files" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                  <ThreadFilePicker
                    query={threadFileQuery}
                    onQuery={setThreadFileQuery}
                    candidates={threadFileCandidates}
                    onPick={(path) => { setFiles((current) => current.includes(path) ? current : [...current, path]); setAttachmentMenuOpen(false); setAttachSubmenu("none"); setNotice(`已引用文件：${basename(path)}`); }}
                    onClose={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}
                  />
                </div>}
                {/* 专家子面板：搜索 + 专家团成员列表 + 召唤更多（进专家团设置页） */}
                {attachSubmenu === "experts" && <div className={`composer-quick-pop submenu-pop experts-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="experts" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                  <div className="submenu-search"><Search size={13} /><input autoFocus value={expertQuery} onChange={(event) => setExpertQuery(event.target.value)} placeholder="搜索专家" /></div>
                  <div className="submenu-list">
                    {expertTeams.filter((team) => team.enabled).flatMap((team) => [team.lead, ...team.members].filter((member) => !expertQuery.trim() || expertRoleLabel(member, member.id === team.lead.id).includes(expertQuery.trim())).map((member) => (
                      <button type="button" key={`${team.teamId}:${member.id}`} onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); void startMemberDirectSession(team, member); }}>
                        <span className={`expert-menu-avatar${member.id === team.lead.id ? " is-lead" : ""}`} style={member.id === team.lead.id ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}>{expertRoleLabel(member, member.id === team.lead.id).slice(0, 1)}</span>
                        <span className="expert-menu-name">{expertRoleLabel(member, member.id === team.lead.id)}</span>
                        <small>{team.profession.zh || team.displayName.zh}</small>
                      </button>
                    )))}
                    {!expertTeams.some((team) => team.enabled) && <p className="submenu-empty">还没有启用的专家团</p>}
                  </div>
                  <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("teams"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>召唤更多专家</span></button>
                </div>}
                {/* 技能子面板：搜索 + 已安装技能列表 + 管理入口（贴一级菜单，同专家面板形态） */}
                {attachSubmenu === "skills" && <div className={`composer-quick-pop submenu-pop skills-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="skills" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                  <div className="submenu-search"><Search size={13} /><input autoFocus value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="搜索已安装技能" /></div>
                  <div className="submenu-list">
                    {(() => {
                      // 数据源统一走 mergedSkillCatalog（本地 + 引擎，规范化去重，附中文注释）：
                      // 原先此处只显示前 8 条，列表一长就看不到后面的技能（自我进化技能就是这样"没透"）。
                      // 面板本身有 max-height + overflow-y，直接全量展示由滚动承载。
                      const q = skillQuery.trim().toLowerCase();
                      return mergedSkillCatalog
                        .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.note.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
                        .map((skill) => <button type="button" key={skill.name} title={`${skill.name}：${skill.note}`} onClick={() => { addSkillReference(skill); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}><Zap size={15} /><span className="expert-menu-name">{skill.name}</span><small>{skill.note}</small></button>);
                    })()}
                    {!skillQuery.trim() && !mergedSkillCatalog.length && <p className="submenu-empty">还没有安装技能</p>}
                  </div>
                  <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("skills"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>管理技能中心</span></button>
                </div>}
                {/* 连接器子面板：搜索 + 已配置连接器列表 + 管理入口 */}
                {attachSubmenu === "connectors" && <div className={`composer-quick-pop submenu-pop connectors-submenu ${submenuFlip ? "flip-left" : ""}`} data-submenu-panel="connectors" style={{ "--submenu-top": `${submenuTop}px` } as React.CSSProperties}>
                  <div className="submenu-search"><Search size={13} /><input autoFocus value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} placeholder="搜索已配置连接器" /></div>
                  <div className="submenu-list">
                    {connectors.filter((connector) => connector.name.includes(connectorSearch) || connector.id.includes(connectorSearch)).slice(0, 8).map((connector) => <button type="button" key={connector.id} onClick={() => { setPrompt((current) => `${current}${current ? "\n" : ""}[本轮可使用连接器：${connector.name}]`); setAttachmentMenuOpen(false); setAttachSubmenu("none"); }}><Link2 size={15} /><span className="expert-menu-name">{connector.name}</span><small>{connector.transport === "stdio" ? connector.command : connector.url}</small></button>)}
                    {!connectors.length && <p className="submenu-empty">尚未配置真实 MCP 连接器</p>}
                  </div>
                  <button type="button" className="submenu-manage" onClick={() => { setAttachmentMenuOpen(false); setAttachSubmenu("none"); setSettingsPage("mcp"); setSettingsOpen(true); }}><ArrowUpRight size={14} /><span>管理连接器</span></button>
                </div>}
                  </div>}
                </div>
                <ComposerMenu icon={ShieldCheck} label="权限" title="权限模式" tone={sandbox === "danger-full-access" ? "danger" : undefined} value={sandbox === "danger-full-access" ? "never" : approvalPolicy} options={approvalMenuOptions(sandbox === "danger-full-access")} onChange={changePermissionMode} />
              </div>
              <div className="composer-right">
                <div className="model-controls composer-model-controls">
                  {relayActive && customModel?.provider === relayActive.provider && <RelayBalanceBadge active={relayActive} />}
                  {customModel?.provider === "openai-official" && <OpenaiBalanceBadge accountKey={openaiActiveAcct ?? "openai-official"} />}
                  <ContextUsageBadge tokenUsage={tokenUsage} fallbackWindow={customModel?.models?.find((m) => m.id === customModel?.model)?.contextWindow ?? customModel?.contextWindow} recentCompaction={recentCompaction} onCompact={() => { if (thread?.id) { compactPendingRef.current.add(thread.id); setCompactEventState("running"); window.codex.request("thread/compact/start", { threadId: thread.id }).catch((error: any) => { compactPendingRef.current.delete(thread.id); setCompactEventState("error", error.message); }); } }} />
                  <ComposerMenu icon={Bot} label="模型" title="模型" disabled={!customModel} value={modelId} options={[...allModels.map((model) => ({
                    value: model.id,
                    title: (model.inputTypes ?? []).some((t) => t === "image" || t === "video") ? `${model.model} · 视觉` : model.model,
                    // 当前供应商不需要重复说明；跨供应商模型只补充供应商名称用于区分。
                    desc: model.isActive ? "" : model.providerName,
                  })), { value: "__model_settings__", title: "更多设置…", desc: "打开模型配置，勾选思考档位" }]} toneOf={(option) => option.value === "__model_settings__" ? undefined : avatarToneOf(option.desc || option.title)} onChange={(value) => {
                    if (value === "__model_settings__") { setSettingsPage("model"); setSettingsOpen(true); const live = customModel?.models?.find((m) => m.id === customModel?.model); if (live) openModelEditor(live); return; }
                    chooseModel(value);
                  }} />
                  <ComposerMenu icon={Zap} label="思考" title="请求思考强度（由引擎与供应商决定实际支持）" value={effort} options={[...effortMenuOptions.filter((option) => !currentEffortOptions.length || currentEffortOptions.includes(option.value)).map((option) => option.value === "ultra" && (selectedModel?.model ?? modelName(modelId)) === "deepseek-v4-flash" ? { ...option, desc: "当前引擎实际发送 high，与标准档相同。" } : option), { value: "__model_settings__", title: "更多档位…", desc: "打开模型配置，管理各模型档位勾选" }]} onChange={(value) => {
                    if (value === "__model_settings__") { setSettingsPage("model"); setSettingsOpen(true); const live = customModel?.models?.find((m) => m.id === customModel?.model); if (live) openModelEditor(live); return; }
                    changeEffort(value);
                  }} />
                </div>
                {(prompt.trim() || hasEnhanceBackup) && !activeThreadRunning && (
                  <button
                    type="button"
                    className={`enhance-button ${enhanceBusy ? "loading" : ""} ${hasEnhanceBackup && !enhanceBusy ? "revert" : ""}`}
                    title={enhanceBusy ? "增强中，点击取消" : hasEnhanceBackup ? "还原为原文" : "AI 优化提示词"}
                    aria-label={enhanceBusy ? "增强中，点击取消" : hasEnhanceBackup ? "还原为原文" : "AI 优化提示词"}
                    disabled={enhanceBusy ? false : !prompt.trim()}
                    onClick={() => {
                      if (enhanceBusy) { setEnhanceBusy(false); setNotice("已取消增强"); return; }
                      void runPromptEnhance();
                    }}
                  >
                    {enhanceBusy ? <Spinner /> : hasEnhanceBackup ? <RotateCcw size={16} /> : <Sparkles size={16} />}
                  </button>
                )}
                {/* 任务运行中：输入框有内容 → 显示发送（点击加入排队，不丢消息），旁边保留停止；
                    输入框为空 → 只显示停止。此前运行中恒显示停止，想排队也得先清空输入框。 */}
                {activeThreadRunning && (prompt.trim() || quoteItem || images.length || files.length) ? (
                  <>
                    <button type="button" className="stop-button" title="停止当前任务" disabled={interrupting} onClick={() => void interrupt()}>
                      {interrupting ? <Spinner /> : <CircleStop size={18} />}
                    </button>
                    <button type="submit" className="send-button" title="发送（任务运行中，将加入排队）"><Send size={18} /></button>
                  </>
                ) : activeThreadRunning ? (
                  <button type="button" className="stop-button" title="停止" disabled={interrupting} onClick={() => void interrupt()}>
                    {interrupting ? <Spinner /> : <CircleStop size={18} />}
                  </button>
                ) : (
                  <button type="submit" className="send-button" title="发送" disabled={!prompt.trim() && !quoteItem && !images.length && !files.length}><Send size={18} /></button>
                )}
              </div>
            </div>
          </form>
          {isEmpty && (
            <div className="suggest-row">
              {[["📊", "周报总结", "汇总本周的提交与改动，生成一份周报总结"], ["🐞", "报错修复", "定位并修复项目里最近的报错，并补充回归测试"], ["🎞️", "PPT 制作", "根据 README 制作一份项目介绍 PPT"], ["⏰", "闲时任务", "规划一个闲时后台自动化任务"]].map(([emoji, label, prompt]: any) => (
                <button key={label} onClick={() => { if (label === "闲时任务") { setSettingsPage("schedule"); setSettingsOpen(true); } else setPrompt(prompt); }}><span className="suggest-emoji">{emoji}</span>{label}</button>
              ))}
            </div>
          )}
        </div>
      </main>

      {rightOpen && <div className="panel-divider" onMouseDown={startPanelDrag} />}

      {rightOpen && <aside className="context-panel">
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
      </aside>}

      {paletteOpen && <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
        <div className="palette">
          <div className="palette-input"><Search size={14} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setPaletteOpen(false); if (event.key === "Enter") (document.querySelector(".palette-row") as HTMLElement | null)?.click(); }} placeholder="搜索操作、任务或文件" /></div>
          <div className="palette-tabs">
            {[["all", "全部", LayoutGrid], ["ops", "操作", Wrench], ["tasks", "任务", MessageSquare], ["files", "文件", FolderOpen]].map(([key, label, Icon]: any) => <button key={key} className={paletteTab === key ? "active" : ""} onClick={() => setPaletteTab(key)}><Icon size={12} />{label}</button>)}
          </div>
          {paletteSections.map((section) => <div key={section.group}>
            <div className="palette-section">{section.group}</div>
            {section.rows.map((row: any) => { const Icon = row.icon; return (
              <button className="palette-row" key={row.label} onClick={() => { setPaletteOpen(false); row.run(); }}>
                <Icon size={14} />
                <span className="palette-label">{row.label}</span>
                {row.shortcut && <kbd>{row.shortcut}</kbd>}
              </button>
            ); })}
          </div>)}
          {!paletteSections.length && <div className="switcher-empty">没有匹配的结果</div>}
        </div>
      </div>}
      {mobileRemoteOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileRemoteOpen(false); }}>
        <div className="remote-panel2" role="dialog" aria-label="移动端远程控制">
          <header><div className="remote-head-left"><Smartphone size={19} /><div><strong>移动端远程控制</strong><small>扫码或在手机上打开链接，即可远程控制当前工作区。</small></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setMobileRemoteOpen(false)}><X size={17} /></button></header>
          <div className="remote-columns">
            <div className="remote-col">
              <div className="remote-col-title"><Smartphone size={15} /><strong>手机扫码连接</strong></div>
              <p className="remote-col-desc">用手机<b>相机</b>扫一扫（若扫码识别成文本，请选「打开链接」）。{remoteUrl?.startsWith("https") ? "手机无需与电脑同一 Wi-Fi。" : "手机需与电脑同一 Wi-Fi。"}</p>
              <div className="remote-conn-card">
                <div className="remote-conn-left"><div className="remote-conn-title"><strong>等待手机连接</strong><span className="remote-ready"><span className="remote-ready-dot" />已就绪</span></div><small>用手机扫码，或在手机上打开链接。</small></div>
                <button className="remote-stop-btn" title="停止服务" onClick={async () => { await window.codex.remoteStop(); setMobileRemoteOpen(false); }}><Link2 size={13} />停止</button>
              </div>
              <div className="remote-scan-row"><span>无法扫码？可以在手机上打开链接。</span>
                <button className="remote-mini-btn" title="刷新二维码" onClick={() => void window.codex.remoteQrcode().then((svg) => setRemoteQr(svg))}><RefreshCw size={13} />刷新二维码</button>
                <button className="remote-mini-btn" title="复制链接" onClick={() => { if (remoteUrl) void navigator.clipboard.writeText(remoteUrl); }}><Copy size={13} />复制链接</button>
              </div>
              {remoteUrl ? (
                <div className="remote-qr-box" dangerouslySetInnerHTML={{ __html: remoteQr }} />
              ) : (
                <div className="remote-qr-box" style={{ placeContent: "center", textAlign: "center", color: "var(--muted)", fontSize: "13px", lineHeight: 1.6 }}>
                  <div>公网隧道暂不可用</div>
                  <div style={{ fontSize: "11.5px", marginTop: "6px" }}>请确保电脑能访问外网，或改用同一 Wi-Fi 下直接访问局域网地址。</div>
                </div>
              )}
            </div>
            <div className="remote-col">
              <div className="remote-col-title"><Link2 size={15} /><strong>使用 Bot Channel</strong></div>
              <p className="remote-col-desc">连接聊天 Bot，适合更长时间的移动端访问。</p>
              {[["微信", "", "从微信会话打开这个工作区。"], ["飞书", "中国", "在飞书群里 @机器人 打开这个工作区。"]].map(([name, region, desc]: any) => (
                <div className="bot-channel-card" key={name}>
                  <div className="bot-channel-head">
                    <strong>{name}{region && <span className="bot-region">{region}</span>}</strong>
                    <button className="bot-config-link" onClick={() => { setMobileRemoteOpen(false); setBotManagerOpen(true); }}>去配置</button>
                  </div>
                  <small>{desc}</small>
                </div>
              ))}
              <button className="remote-manage-btn" onClick={() => setBotManagerOpen(true)}><Link2 size={13} />机器人管理</button>
            </div>
          </div>
        </div>
      </div>}
      {botManagerOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBotManagerOpen(false); }}>
        <div className="bot-manager" role="dialog" aria-label="机器人">
          <header><div className="bot-head-left"><Link2 size={17} /><strong>机器人</strong><small>把外部聊天工具和 Webhook 接入 ZCode 机器人。</small></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setBotManagerOpen(false)}><X size={17} /></button></header>
          <div className="bot-columns">
            <div className="bot-side">
              <button className="bot-new-btn" onClick={() => { const id = crypto.randomUUID(); setBots((cur) => { const next = [...cur, { id, name: "新机器人", channel: "", enabled: false }]; localStorage.setItem("bots", JSON.stringify(next)); return next; }); setActiveBotId(id); setBotChannelPick(null); showToast("机器人已创建", "选择渠道并扫码绑定后即可使用"); }}><Plus size={14} />新建机器人</button>
              <div className="bot-list">
                {bots.map((bot) => {
                  const online = botOnlineOf(bot, channelOnline);
                  return (
                  <button key={bot.id} className={"bot-item " + (bot.id === activeBotId ? "active" : "")} onClick={() => { setActiveBotId(bot.id); setBotChannelPick(null); }}>
                    <span className="bot-icon">{bot.channel === "feishu" ? "🐦" : bot.channel === "wechat" ? "💬" : bot.channel === "telegram" ? "✈️" : bot.channel === "dingtalk" ? "📌" : bot.channel === "qq" ? "🐧" : bot.channel === "wecom-webhook" ? "📣" : "🤖"}</span>
                    <span className="bot-item-main"><strong>{bot.name}</strong><small>{botChannelName(bot.channel) || "未选择渠道"}</small></span>
                    <span className={"bot-conn " + (online ? "on" : "")} title={online ? "已连接" : "未连接"}>{online ? "已连接" : "未连接"}</span>
                  </button>
                  );
                })}
                {!bots.length && <p className="muted">还没有机器人，点上方新建。</p>}
              </div>
            </div>
            <div className="bot-detail">
              {(() => { const activeBot = bots.find((b) => b.id === activeBotId); if (!activeBot) return <div className="bot-empty"><p className="muted">从左侧选择一个机器人，或新建一个。</p></div>; return (<>
                <div className="bot-detail-head">
                  <div><strong>{activeBot.name}</strong></div>
                  <label className="bot-switch"><input type="checkbox" checked={activeBot.enabled} onChange={() => setBots((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, enabled: !b.enabled } : b); localStorage.setItem("bots", JSON.stringify(next)); return next; })} /><span /></label>
                </div>
                {(() => { const online = Boolean(activeBot.channel) && botOnlineOf(activeBot, channelOnline); return (<>
                <p className={"bot-status-line" + (online ? " online" : "")}>{online ? "● 已连接" : activeBot.enabled ? "● 已启用" : "○ 未启用"}</p>
                {online ? (
                  <div className="bot-connected-card">
                    <span className="bot-connected-badge">✓ 已连接</span>
                    <div className="bot-connected-main">
                      <strong>{botChannelName(activeBot.channel)}</strong>
                      <small>{activeBot.channel === "wechat" ? "消息会实时回推到微信，无需重新扫码。换渠道请删除机器人后重新新建。" : "该机器人已连接，无需重新扫码。换渠道请删除机器人后重新新建。"}</small>
                    </div>
                  </div>
                ) : (<>
                <div className="bot-channel-grid">
                  {([["wechat", "微信", "手机微信扫码登录，在微信里直接聊。", "中国"], ["telegram", "Telegram", "填 Bot Token 连接（@BotFather 创建）。", ""], ["feishu", "飞书", "填 App ID/Secret，群里 @机器人对话。", "中国"], ["dingtalk", "钉钉", "填 Client ID/Secret，群内 @机器人。", "中国"], ["qq", "QQ 机器人", "填 AppID/Secret（q.qq.com 实名创建）。", "中国"], ["wecom-webhook", "企微推送", "群机器人 Webhook，推送任务通知。", "中国"]] as const).map(([key, name, desc, region]) => (
                    <button key={key} className={"bot-channel-opt " + (botChannelPick === key ? "picked" : "")} onClick={() => { setBotChannelPick(key); setBots((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, channel: key } : b); localStorage.setItem("bots", JSON.stringify(next)); return next; }); }}>
                      <strong>{name}{region ? <span className="bot-region">{region}</span> : null}</strong>
                      <small>{desc}</small>
                    </button>
                  ))}
                </div>
                {botChannelPick && <BotBindCard bot={activeBot} onBound={(deviceName) => { setBots((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, enabled: true } : b); localStorage.setItem("bots", JSON.stringify(next)); return next; }); void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined); showToast("机器人已连接", `${activeBot.name} 已通过 ${deviceName} 连接`); }} />}
                </>)}
                </>); })()}
                {(Boolean(activeBot.channel) && ["wechat", "telegram", "feishu", "dingtalk", "qq"].includes(activeBot.channel)) && (() => { // 绑定会话：创建时即可配置（连上后锁定；企微推送为单向通知无会话）
                  const ch = activeBot.channel;
                  const bound = (botBindings as Record<string, { threadId: string; title: string; updatedAt: number } | null>)[ch] ?? null;
                  const botBound = Boolean(bound); // 已绑定过：创建后不支持切换会话
                  const boundInList = bound && threads.some((t) => t.id === bound.threadId);
                  // 已被任一机器人绑定的会话灰掉不可选（一个会话只服务一个机器人）；当前机器人自己的绑定除外
                  const takenIds = new Set(Object.values(botBindings).flatMap((b) => (b?.threadId ? [b.threadId] : [])));
                  const fmtTime = (n: number) => new Date(n > 1e12 ? n : n * 1000).toLocaleDateString("zh-CN");
                  return (
                    <div className="bot-detail-row">
                      <div><strong>绑定会话</strong><small>{botBound ? "已绑定：仅可切回「自动新会话」，其他已有会话不可切换（若要换目录请选自动新会话后重新选）" : "下一条消息将自动开新会话并绑定"}</small></div>
                      <select className="bot-select" value={bound?.threadId ?? ""} title={botBound ? "已绑定：可切回「自动新会话」（下次消息新建会话）；不支持切换到其他已有会话" : undefined} onChange={(event) => {
                        const v = event.target.value || null;
                        const t = threads.find((x) => x.id === v);
                        void setBotBinding(ch as "wechat" | "telegram", v, t ? (t.name || t.preview || "").slice(0, 40) : undefined);
                      }}>
                        <option value="">自动新会话</option>
                        {!boundInList && bound && <option value={bound.threadId}>{bound.title || `会话 ${bound.threadId.slice(0, 8)}`}</option>}
                        {threads.map((t) => {
                          const taken = takenIds.has(t.id) && bound?.threadId !== t.id;
                          return <option key={t.id} value={t.id} disabled={taken}>{`${(t.name || t.preview || t.id.slice(0, 12)).slice(0, 30)} · ${fmtTime(t.updatedAt)}${taken ? "（已被机器人绑定）" : ""}`}</option>;
                        })}
                      </select>
                    </div>
                  );
                })()}                <div className="bot-detail-row">
                  <div><strong>机器人回复粒度</strong><small>回复助手正文和文件变更，隐藏工具调用过程。</small></div>
                  <select className="bot-select" value={(activeBot as any).granularity ?? "standard"} onChange={(event) => setBots((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, granularity: event.target.value } : b); localStorage.setItem("bots", JSON.stringify(next)); return next; })}>
                    <option value="standard">标准回复</option>
                    <option value="concise">简洁回复</option>
                    <option value="verbose">详细回复</option>
                  </select>
                </div>
                <div className="bot-detail-row">
                  <div><strong>流式回复</strong><small>开启后机器人边生成边推送正文（微信逐段追加 / Telegram 实时改写），不用干等完整回复。</small></div>
                  <label className="bot-switch"><input type="checkbox" checked={botStream.enabled} onChange={(event) => updateBotStream({ ...botStream, enabled: event.target.checked })} /><span /></label>
                </div>
                {botStream.enabled && (<>
                  <div className="bot-detail-row">
                    <div><strong>同步思考内容</strong><small>开启：模型的思考摘要实时推送到聊天端；关闭：不推送思考过程。</small></div>
                    <label className="bot-switch"><input type="checkbox" checked={botStream.thinking} onChange={(event) => updateBotStream({ ...botStream, thinking: event.target.checked })} /><span /></label>
                  </div>
                  <div className="bot-detail-row">
                    <div><strong>同步工具内容</strong><small>开启：命令执行 / 工具调用过程实时推送；关闭：只推送正文。</small></div>
                    <label className="bot-switch"><input type="checkbox" checked={botStream.tools} onChange={(event) => updateBotStream({ ...botStream, tools: event.target.checked })} /><span /></label>
                  </div>
                </>)}
                <div className="bot-detail-row">
                  <div><strong>工作区访问范围</strong><small>这个机器人可以使用所有已配置的工作区。</small></div>
                  <select className="bot-select" value={(activeBot as any).scope ?? "all"} onChange={(event) => setBots((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, scope: event.target.value } : b); localStorage.setItem("bots", JSON.stringify(next)); return next; })}>
                    <option value="all">所有工作区</option>
                    <option value="current">仅当前工作区</option>
                  </select>
                </div>
                <div className="bot-delete-row"><div><strong>删除机器人</strong><small>移除这个机器人，并断开其渠道连接（微信/Telegram 需重新扫码绑定）。</small></div><button className="bot-delete-btn" onClick={async () => {
                  // 删除必须同步断开渠道会话：网关凭据（微信 token/Telegram token）是主进程全局的，
                  // 只删 UI 记录的话同渠道新建会被判定「已连接」直接复用旧会话，扫码入口都不出现
                  try {
                    if (activeBot.channel === "wechat") await window.codex.weixinLogout();
                    if (activeBot.channel === "telegram") await window.codex.telegramLogout();
                    void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined);
                  } catch { /* 断开失败不阻塞删除 */ }
                  setBots((cur) => { const next = cur.filter((b) => b.id !== activeBot.id); localStorage.setItem("bots", JSON.stringify(next)); return next; }); setActiveBotId(null); showToast("机器人已删除", "渠道连接已断开，可随时重新新建并绑定");
                }}><Trash2 size={13} />删除机器人</button></div>
              </>); })()}
            </div>
          </div>
        </div>
      </div>}
{autoFormVisible && <div className="modal-backdrop schedule-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAutoFormVisible(false); }}><div className="schedule-modal" role="dialog" aria-modal="true" aria-label="定时任务">
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
              </div></div>}
      {appPrompt && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { appPrompt.resolve(null); setAppPrompt(null); } }}>
        <div className="agent-ask-card" role="dialog" aria-modal="true" aria-label={appPrompt.title}>
          <header><PenLine size={16} /><strong>{appPrompt.title}</strong></header>
          <form className="agent-ask-free app-prompt-form" onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("promptText") as HTMLInputElement | HTMLTextAreaElement; appPrompt.resolve(input.value); setAppPrompt(null); }}>
            {appPrompt.multiline
              ? <textarea ref={(node) => { appPromptInputRef.current = node; }} name="promptText" rows={6} defaultValue={appPrompt.value} />
              : <input ref={(node) => { appPromptInputRef.current = node; }} name="promptText" defaultValue={appPrompt.value} />}
            <div className="app-prompt-actions">
              <button type="button" className="secondary-setting" onClick={() => { appPrompt.resolve(null); setAppPrompt(null); }}>取消</button>
              <button type="submit" className="primary-setting"><Check size={14} />确定</button>
            </div>
          </form>
        </div>
      </div>}
      {appConfirm && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { appConfirm.resolve(false); setAppConfirm(null); } }}>
        <div className="agent-ask-card app-confirm-card" role="dialog" aria-modal="true" aria-label={appConfirm.title}>
          <header><Trash2 size={16} /><strong>{appConfirm.title}</strong></header>
          <p>{appConfirm.text}</p>
          <div className="app-prompt-actions">
            <button type="button" className="secondary-setting" onClick={() => { appConfirm.resolve(false); setAppConfirm(null); }}>取消</button>
            <button type="button" className="danger primary-setting" onClick={() => { appConfirm.resolve(true); setAppConfirm(null); }}>{appConfirm.confirmLabel}</button>
          </div>
        </div>
      </div>}
      {memoryPreview && <div className="modal-backdrop agent-ask-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemoryPreview(null); }}>
        <div className="agent-ask-card memory-preview-card" role="dialog" aria-modal="true" aria-label="记忆全文">
          <header>
            <span className="memory-category-pill">{memoryPreview.category}</span>
            <strong>记忆全文</strong>
            <button className="icon-button relay-modal-close" title="关闭" onClick={() => setMemoryPreview(null)}><X size={16} /></button>
          </header>
          <div className="memory-preview-body">{memoryPreview.content}</div>
          <small>
            {memoryPreview.sourceThreadId ? `来源 ${memoryPreview.sourceThreadId.slice(0, 8)}` : "手动保存"} · 保存于 {new Date(memoryPreview.updatedAt ?? Date.now()).toLocaleString("zh-CN")}
            {memoryPreview.sourceThreadId && <button className="memory-preview-open" title="跳转到这条记忆来源的会话" onClick={() => { setMemoryPreview(null); void openThread(memoryPreview.sourceThreadId!); }}><MessageSquare size={11} />打开源会话</button>}
          </small>
        </div>
      </div>}
      {searchPreview && (
        <SearchPreviewModal
          target={searchPreview}
          onClose={() => setSearchPreview(null)}
          onOpenThread={(id) => { setSearchPreview(null); setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(id); }}
          onOpenSettings={(page) => { setSearchPreview(null); setMemoryCenterOpen(false); setSettingsPage(page as SettingsPage); }}
          onCopyThreadId={(id) => { void copyThreadReferenceId({ id }); }}
        />
      )}
      {/* 记忆中心：设置页「记忆」只做总览，条目浏览 / 常驻记忆编辑 / 存储切换都在这个大弹窗里完成 */}
      {memoryCenterOpen && <div className="modal-backdrop memory-center-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemoryCenterOpen(false); }}>
        <section className="memory-center-modal" role="dialog" aria-modal="true" aria-label="记忆中心">
          <header className="memory-center-head">
            <div className="memory-center-heading">
              <span className="memory-center-logo"><Brain size={18} /></span>
              <div><strong>记忆中心</strong><span>常驻记忆每轮对话自动注入；记忆条目在发消息时按需召回；存储决定条目保存在本地还是云端。</span></div>
            </div>
            <div className="memory-center-tabs" role="tablist" aria-label="记忆中心视图">
              <button role="tab" aria-selected={memoryCenterTab === "library"} className={`memory-center-tab ${memoryCenterTab === "library" ? "active" : ""}`} onClick={() => setMemoryCenterTab("library")}><Archive size={14} />记忆库</button>
              <button role="tab" aria-selected={memoryCenterTab === "search"} className={`memory-center-tab ${memoryCenterTab === "search" ? "active" : ""}`} onClick={() => setMemoryCenterTab("search")}><Search size={14} />全局搜索</button>
              <button role="tab" aria-selected={memoryCenterTab === "layers"} className={`memory-center-tab ${memoryCenterTab === "layers" ? "active" : ""}`} onClick={() => setMemoryCenterTab("layers")}><BookOpen size={14} />常驻记忆</button>
              <button role="tab" aria-selected={memoryCenterTab === "storage"} className={`memory-center-tab ${memoryCenterTab === "storage" ? "active" : ""}`} onClick={() => setMemoryCenterTab("storage")}><Cloud size={14} />存储与同步</button>
            </div>
            <button className="icon-button" title="关闭记忆中心" onClick={() => setMemoryCenterOpen(false)}><X size={18} /></button>
          </header>
          <div className="memory-center-body">
            <div className="memory-project-context">
              <div className="memory-project-context-copy"><FolderOpen size={14} /><div><strong>当前管理项目</strong><span>{memoryManagementWorkspace ? "项目背景、项目记忆、日志和条目都按这个项目管理" : "全部项目总览；选择具体项目后才能编辑项目背景或项目记忆"}</span></div></div>
              <div className={`memory-project-picker ${memoryProjectMenuOpen ? "open" : ""}`} ref={memoryProjectPickerRef}>
                <button type="button" className="memory-project-picker-button" aria-haspopup="listbox" aria-expanded={memoryProjectMenuOpen} onClick={() => setMemoryProjectMenuOpen((current) => !current)}>
                  <FolderOpen size={14} aria-hidden="true" />
                  <span className="memory-project-picker-current"><strong>{memoryManagementWorkspace ? basename(memoryManagementWorkspace) : "全部项目"}</strong><small>{memoryManagementWorkspace || "跨项目总览"}</small></span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {memoryProjectMenuOpen && <div className="memory-project-picker-menu" role="listbox" aria-label="选择记忆项目">
                  <button type="button" role="option" aria-selected={memoryProjectWorkspace === "__all__"} className={`memory-project-option ${memoryProjectWorkspace === "__all__" ? "selected" : ""}`} onClick={() => { setMemoryProjectWorkspace("__all__"); setMemoryLayerScope("user"); setMemoryProjectMenuOpen(false); }}>
                    <span className="memory-project-option-icon"><Layers3 size={14} /></span><span className="memory-project-option-copy"><strong>全部项目</strong><small>跨项目总览与全局记忆</small></span>{memoryProjectWorkspace === "__all__" && <Check size={14} />}
                  </button>
                  {memoryProjectOptions.map((cwd) => <button type="button" role="option" aria-selected={memoryProjectWorkspace === cwd} className={`memory-project-option ${memoryProjectWorkspace === cwd ? "selected" : ""}`} key={cwd} onClick={() => { setMemoryProjectWorkspace(cwd); setMemoryLayerScope("background"); setMemoryProjectMenuOpen(false); }}>
                    <span className="memory-project-option-icon"><FolderOpen size={14} /></span><span className="memory-project-option-copy"><strong>{basename(cwd)}</strong><small title={cwd}>{cwd}</small></span>{memoryProjectWorkspace === cwd && <Check size={14} />}
                  </button>)}
                  {!memoryProjectOptions.length && <div className="memory-project-option-empty">还没有发现项目，请先打开一个工作区</div>}
                </div>}
              </div>
            </div>
            {memoryCenterTab === "library" && <div className="memory-center-pane">
              <div className="memory-center-block">
                <div className="memory-center-block-head"><div><strong>手动保存</strong><span>把临时约定或结论固化成可召回的记忆；对话里让引擎「记住」的内容也会带来源会话出现在下方记忆库（本地自动捕获只沉淀到常驻记忆的每日日志）。</span></div></div>
                <div className="memory-editor">
                  <select value={memorySaveCategory} onChange={(event) => setMemorySaveCategory(event.target.value)}>
                    {MEMORY_CATEGORIES.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
                  </select>
                  <textarea value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder={`保存一条可复用的事实或约定（${memoryMode === "cloud" ? "云端" : "本地"}）`} />
                  <button className={`primary-setting ${memorySavedAt ? "memory-save-success" : ""}`} disabled={!memoryDraft.trim() || !memoryManagementWorkspace} title={memoryManagementWorkspace ? "保存到当前管理项目" : "先选择一个项目"} onClick={() => void saveMemoryRecord(memoryManagementWorkspace)}>{memorySavedAt ? <CircleCheck size={14} /> : <Check size={14} />}{memorySavedAt ? "已保存" : "保存记忆"}</button>
                </div>
              </div>
              <div className="memory-library">
                <div className="memory-library-head">
                  <div className="memory-library-title"><h3>记忆库</h3><p>按重要度 P0–P3 分层，点击条目可看全文；★ 置顶的核心记忆不会被自动清理。</p></div>
                  <div className="memory-toolbar">
                    <button className="secondary-setting" onClick={async () => { const scopeText = memoryProjectWorkspace === "__all__" ? "所有项目的本地记忆条目" : `项目「${basename(memoryProjectWorkspace)}」的项目记忆条目（全局记忆不会删除）`; const cloudText = memoryMode === "cloud" ? "云端 Gateway 数据不会被删除，需要在 Gateway 管理端清理。" : ""; if (await openAppConfirm("清空记忆", `${scopeText}将被永久删除。${cloudText}`, "确认清空")) void clearSelectedMemory(); }}><Trash2 size={14} />清空{memoryProjectWorkspace === "__all__" ? (memoryMode === "cloud" ? "本地缓存" : "记忆") : "项目记忆"}</button>
                    <span className="memory-count">{memoryVisibleRecords.length} 条 · {memoryMode === "cloud" ? "云端同步 / 本地缓存" : "本地"}</span>
                  </div>
                </div>
                <div className="memory-funnel-toolbar">
                  <span className="memory-funnel-toolbar-label">分类筛选</span>
                  <div className="memory-funnel-chips" role="tablist" aria-label="按分类筛选">
                    <button role="tab" aria-selected={memoryCategory === ""} className={`memory-funnel-chip ${memoryCategory === "" ? "active" : ""}`} onClick={() => setMemoryCategory("")}>全部</button>
                    {MEMORY_CATEGORIES.map((cat) => <button key={cat.name} role="tab" aria-selected={memoryCategory === cat.name} className={`memory-funnel-chip ${memoryCategory === cat.name ? "active" : ""}`} onClick={() => setMemoryCategory(memoryCategory === cat.name ? "" : cat.name)}>{cat.name}</button>)}
                  </div>
                </div>
                <MemoryFunnel
                  groups={memoryGroupsFiltered}
                  onPreview={(entry) => setMemoryPreview(entry)}
                  onTogglePin={togglePinned}
                  onDeleteOne={(id) => void deleteMemoryRecord(id)}
                  onDeleteGroup={(group) => void deleteMemoryGroup((entry) => (entry.sourceThreadId ?? "__manual") === group.key).then((count) => count > 0 && setMemoryStatus(`已从「${group.threadTitle}」删除 ${count} 条记忆`))}
                  onOpenThread={(threadId) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(threadId); }}
                />
              </div>
            </div>}
            {memoryCenterTab === "search" && (
              <GlobalSearchView
                threads={(memoryManagementWorkspace ? threads.filter((entry) => entry.cwd === memoryManagementWorkspace) : threads).map((entry) => ({ id: entry.id, title: entry.name, preview: entry.preview, updatedAt: entry.updatedAt, turnCount: entry.turns?.length }))}
                memories={memoryVisibleRecords.map((entry) => ({ id: entry.id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, createdAt: entry.updatedAt }))}
                tasks={(memoryManagementWorkspace ? scheduledTasks.filter((task) => task.workspace === memoryManagementWorkspace) : scheduledTasks).map((task) => ({ id: task.id, name: task.name, prompt: task.prompt, enabled: task.enabled, schedule: describeSchedule(task) }))}
                skills={localSkills.map((skill) => ({ name: skill.name, description: skill.description }))}
                onPreview={setSearchPreview}
                onOpenThread={(threadId) => { setMemoryCenterOpen(false); setSettingsOpen(false); void openThread(threadId); }}
                onOpenSettings={(page) => { setMemoryCenterOpen(false); setSettingsPage(page as SettingsPage); }}
              />
            )}
            {memoryCenterTab === "layers" && <div className="memory-center-pane">
                <MemoryLayersEditor
                  snapshot={memoryLayers}
                  scope={memoryLayerScope}
                  draft={memoryLayerDraft}
                  dirty={memoryLayerDirty}
                  distilling={memoryDistilling}
                  hasWorkspace={Boolean(memoryManagementWorkspace)}
                  savedAt={memoryLayerSavedAt}
                  onScope={setMemoryLayerScope}
                  onDraft={setMemoryLayerDraft}
                  onSave={() => void saveMemoryLayer()}
                  onDistill={() => void runMemoryDistill()}
                />
            </div>}
            {memoryCenterTab === "storage" && <div className="memory-center-pane">
              <div className="memory-center-block">
                  <div className="memory-center-block-head">
                  <div><strong>记忆保存在哪</strong><span>本地模式只保存在本机 memory.json；云端同步模式会通过 TencentDB Gateway 召回与保存，并保留本机缓存。</span></div>
                  <button className="secondary-setting" onClick={() => setMemoryConfigOpen(true)}><Settings2 size={13} />云端配置</button>
                </div>
                <div className="memory-mode-switch" role="tablist" aria-label="记忆来源">
                  <button role="tab" aria-selected={memoryMode === "local"} className={`memory-mode-card ${memoryMode === "local" ? "active" : ""}`} onClick={() => updateMemoryMode("local")}>
                    <div className="memory-mode-icon"><CloudOff size={15} /></div>
                    <div className="memory-mode-body"><strong>本地记忆</strong><span>仅保存在本机 memory.json</span></div>
                    <span className="memory-mode-tag">{memories.length} 条</span>
                  </button>
                  <button role="tab" aria-selected={memoryMode === "cloud"} className={`memory-mode-card ${memoryMode === "cloud" ? "active" : ""}`} onClick={() => updateMemoryMode("cloud")}>
                    <div className="memory-mode-icon"><Cloud size={15} /></div>
                    <div className="memory-mode-body"><strong>云端同步</strong><span>TencentDB Gateway，云端召回并保留本地缓存</span></div>
                    <span className="memory-mode-tag">{memoryGateway.endpoint ? "已配置" : "未配置"}</span>
                  </button>
                </div>
                <div className="workspace-memory-row">
                  <div className="workspace-memory-info">
                    <strong>工作区记忆</strong>
                    <span>在当前项目中复用长期上下文；新会话开始时生效。</span>
                  </div>
                  <label className="channel-enable"><input type="checkbox" checked={memoryProjectEnabled} disabled={!memoryManagementWorkspace} onChange={(event) => { const enabled = event.target.checked; setMemoryProjectEnabled(enabled); void window.codex.setWorkspaceMemoryEnabled({ workspace: memoryManagementWorkspace, enabled }).then(() => setMemoryStatus(enabled ? "该项目记忆已开启" : "该项目记忆已关闭：背景、项目记忆、日志不会注入或捕获")).catch((error: any) => setMemoryStatus(`保存项目记忆开关失败：${error.message}`)); }} /><span>{memoryManagementWorkspace ? (memoryProjectEnabled ? "已开启" : "已关闭") : "先选项目"}</span></label>
                </div>
              </div>
            </div>}
            {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
          </div>
        </section>
      </div>}
      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <div className="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
          <header><div><Settings2 size={18} /><strong>设置</strong><span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setSettingsOpen(false)}><X size={18} /></button></header>
          <div className="settings-layout">
            <nav className="settings-nav" aria-label="设置分类">
              {settingsNav.map((group) => (
                <div key={group.group} className="settings-group">
                  <div className="settings-group-label">{group.group}</div>
                  {group.items.map(([key, label, Icon]) => <button key={key} className={settingsPage === key ? "active" : ""} onClick={() => setSettingsPage(key)}><Icon size={15} />{label}</button>)}
                </div>
              ))}
            </nav>
            <div className="settings-content">
            {/* 骨架先行：弹窗框架先绘制一帧，分区内容延后挂载（详见 settingsContentReady 注释） */}
            {!settingsContentReady ? <div className="settings-boot" role="status"><Spinner /><span>正在载入…</span></div> : <>
            {resourceError && <div className="resource-error"><AlertTriangle size={14} /><span>{resourceError}</span><button className="secondary-setting" onClick={() => void refreshSettingsResources()}>重试</button></div>}
            {/* 二级入口页：自动化（浏览器/桌面/RPA）与智能体团队（子智能体/专家团）。
                点卡片进入真实页面；进入的是二级成员页时顶部提供「返回」。 */}
            {settingsPage === "automation" && (
              <section className="settings-section stack hub-page">
                <div className="settings-copy"><h2>自动化</h2><p>浏览器、桌面与 RPA 三类自动化能力的总入口。</p></div>
                <div className="hub-card-grid">
                  <button className="hub-card" onClick={() => setSettingsPage("browser")}>
                    <span className="hub-card-icon"><Globe2 size={20} /></span>
                    <strong>浏览器自动化</strong>
                    <p>内置浏览器面板与 playwright-cli / CloakBrowser 工具链；默认起始页设置在这里。</p>
                  </button>
                  <button className="hub-card" onClick={() => setSettingsPage("computer")}>
                    <span className="hub-card-icon"><ShieldCheck size={20} /></span>
                    <strong>桌面自动化</strong>
                    <p>审批与沙箱策略，nuphus MCP 桌面工具（截屏、键鼠、窗口、OCR）。</p>
                  </button>
                  <button className="hub-card" onClick={() => setSettingsPage("rpa")}>
                    <span className="hub-card-icon"><Workflow size={20} /></span>
                    <strong>RPA 自动化</strong>
                    <p>Codex 自主沉淀流程配方，下次一句话直接复现；任务清单自主维护。</p>
                  </button>
                </div>
              </section>
            )}
            {settingsPage === "agentteam" && (
              <section className="settings-section stack hub-page">
                <div className="settings-copy"><h2>智能体团队</h2><p>子智能体与专家团的总入口。</p></div>
                <div className="hub-card-grid">
                  <button className="hub-card" onClick={() => setSettingsPage("agents")}>
                    <span className="hub-card-icon"><Bot size={20} /></span>
                    <strong>子智能体</strong>
                    <p>自定义角色，注册为 subagent_invoke 函数，Codex 在对话中直接调用。</p>
                  </button>
                  <button className="hub-card" onClick={() => setSettingsPage("teams")}>
                    <span className="hub-card-icon"><Users size={20} /></span>
                    <strong>专家团</strong>
                    <p>主理人按 SOP 编排成员协作，独立会话产出，最终汇总交付。</p>
                  </button>
                </div>
              </section>
            )}
            {(settingsPage === "browser" || settingsPage === "computer" || settingsPage === "rpa" || settingsPage === "agents" || settingsPage === "teams") && (
              <button className="settings-back-row" onClick={() => setSettingsPage(settingsPage === "agents" || settingsPage === "teams" ? "agentteam" : "automation")}>
                <ArrowLeft size={14} />{settingsPage === "agents" || settingsPage === "teams" ? "返回智能体团队" : "返回自动化"}
              </button>
            )}
            {settingsPage === "user" && <UserCenterSection username={username} onUsernameChange={(name) => { setUsername(name); }} personality={personality} onPersonalityChange={(v) => changePersonality(v)} onNotice={(m) => setNotice(m)} onProfileChange={(p) => setUserAvatar(p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null)} onLogout={handleLogout} />}

            {settingsPage === "general" && <section className="settings-section stack general-page">
              <div className="settings-copy"><h2>控制台</h2><p>管理工作区、数据目录与应用行为。</p></div>

              {/* 全局审批权限：控制台一级入口。选择立即生效（当前会话马上推送引擎，
                  其余未手动改过权限的会话打开时跟随，新会话默认使用），无需重启。 */}
              <div className="settings-card">
                <div className="settings-card-head"><ShieldCheck size={15} /><strong>全局审批权限</strong><span className="settings-subhead-hint">选择立即生效，无需重启</span></div>
                <div className="settings-card-body">
                  <div className="perm-seg">
                    {[{ v: "never", t: "完全访问", d: "自动执行，减少确认次数" }, { v: "on-request", t: "变更前确认", d: "改文件前先问我" }, { v: "untrusted", t: "自动编辑", d: "自动编辑文件" }].map((opt) => (
                      <button key={opt.v} type="button" className={`perm-seg-btn ${globalPermApproval === opt.v ? "on" : ""}`} onClick={() => applyGlobalPermissionMode(opt.v)}>
                        <strong>{opt.t}</strong>
                        <small>{opt.d}</small>
                        {globalPermApproval === opt.v && <em>当前</em>}
                      </button>
                    ))}
                  </div>
                  <p className="settings-card-hint">所有未手动改过权限的会话与新会话都使用此档位；在对话里手动改过权限的对话框保留自己的选择，不跟随。重启后保持不变。</p>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-head"><FolderOpen size={15} /><strong>工作区与数据</strong></div>
                <div className="settings-card-body">
                  <div className="path-row">
                    <span className="path-row-label">当前工作区</span>
                    <span className="path-row-input"><span className="path-row-value" title={workspace || "未选择"}>{workspace || "未选择工作区"}</span>
                      <span className="path-row-actions">
                        <button className="secondary-setting" onClick={() => void chooseWorkspace()}><FolderOpen size={14} />更换目录</button>
                        <button className="icon-button" title="在文件管理器中打开" disabled={!workspace} onClick={() => { if (workspace) void window.codex.shellReveal(workspace); }}><FolderTree size={15} /></button>
                      </span>
                    </span>
                  </div>
                  <div className="path-row">
                    <span className="path-row-label">配置目录</span>
                    <span className="path-row-input"><span className="path-row-value" title={userDataPath || "读取中…"}>{userDataPath || "读取中…"}</span>
                      <span className="path-row-actions">
                        <button className="secondary-setting" title="复制路径" onClick={() => { void navigator.clipboard.writeText(userDataPath || ""); setNotice("配置目录已复制"); }}><Copy size={14} />复制</button>
                        <button className="icon-button" title="在文件管理器中打开" disabled={!userDataPath} onClick={() => { if (userDataPath) void window.codex.shellReveal(userDataPath); }}><FolderTree size={15} /></button>
                      </span>
                    </span>
                  </div>
                  <p className="settings-card-hint">模型、任务记录、记忆都保存在配置目录里。如果换了个启动方式后配置「消失」，多半是两个启动方式用了不同目录——把旧目录里的 custom-model.json 和 codex-home 拷过来即可恢复。</p>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-head"><Monitor size={15} /><strong>启动与行为</strong></div>
                <div className="settings-card-body settings-toggle-list">
                  <div className="settings-toggle-row">
                    <span className="settings-toggle-icon"><PanelRightOpen size={16} /></span>
                    <span className="settings-toggle-text"><strong>启动时打开右侧面板</strong><small>打开应用后自动显示上下文面板</small></span>
                    <ToggleSwitch checked={rightOpen} label="启动时打开右侧面板" onChange={(next) => { setRightOpen(next); localStorage.setItem("right-panel-open", String(next)); }} />
                  </div>
                  <div className="settings-toggle-row">
                    <span className="settings-toggle-icon"><Monitor size={16} /></span>
                    <span className="settings-toggle-text"><strong>桌面自动化</strong><small>{capabilityHint("desktop-automation") ?? "加载 nuphus 桌面工具（屏幕、窗口、键鼠、剪贴板、OCR）。关闭后 nuphus MCP 不注册、desktop-automation 技能停用，约 10K 工具 schema 不再进上下文，能减少 token 占用、加快回复"}</small></span>
                    <ToggleSwitch checked={desktopAuto} disabled={groupBusy === "desktop-automation"} label="桌面自动化" onChange={toggleDesktopAuto} />
                  </div>
                  <div className="settings-toggle-row">
                    <span className="settings-toggle-icon"><Globe2 size={16} /></span>
                    <span className="settings-toggle-text"><strong>浏览器自动化</strong><small>{capabilityHint("browser-automation") ?? "提供 playwright-cli / cloakbrowser 浏览器操作能力。关闭后移除浏览器调用说明与 browser_use feature、停用 browser-automation 技能，模型不再被引导使用浏览器工具，能减少上下文占用"}</small></span>
                    <ToggleSwitch checked={browserAuto} disabled={groupBusy === "browser-automation"} label="浏览器自动化" onChange={toggleBrowserAuto} />
                  </div>
                  <div className="settings-toggle-row">
                    <span className="settings-toggle-icon"><Code2 size={16} /></span>
                    <span className="settings-toggle-text"><strong>写代码模式（代码钩子）</strong><small>{capabilityHint("writing-code") ?? "开启时启用 ponytail 注入开关、ponytail 插件及其 6 个子技能（audit / debt / gain / help / review 等），钩子生效、注入精简工程规则；关闭后钩子静默跳过，回复更快。日常聊天建议关闭。默认开启。"}</small></span>
                    <ToggleSwitch checked={ponytailOn} disabled={groupBusy === "writing-code"} label="写代码模式（代码钩子）" onChange={(next) => void applyGroup("writing-code", next)} />
                  </div>
                  <p className="settings-card-hint">这两个是能力总闸：开关直接决定 Codex 引擎能不能用对应能力，并联动其下的 MCP、技能与插件（例如桌面自动化会一并启停 nuphus MCP 与 desktop-automation 技能）。在技能 / MCP / 插件页点关这些子项时会提示你回到这里操作，保证状态一致。</p>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-head"><Zap size={15} /><strong>显示与性能</strong></div>
                <div className="settings-card-body">
                  <div className="settings-toggle-row">
                    <span className="settings-toggle-icon"><MonitorUp size={16} /></span>
                    <span className="settings-toggle-text"><strong>硬件加速</strong><small>控制应用渲染走 GPU 还是 CPU 软件渲染。<br />· 自动：由 Chromium 判断（健康显卡自动硬件加速，弱核显/旧显卡默认软件渲染）<br />· 强制开启：忽略显卡黑名单走 GPU——低配机/集成显卡上界面卡顿时建议选这个<br />· 关闭：完全用 CPU 渲染（个别显卡与 GPU 通道冲突导致花屏/闪烁时用）<br />修改后需重启应用生效。</small></span>
                    <select className="accel-select" value={hardwareAccel} onChange={(event) => changeHardwareAccel(event.target.value as "auto" | "force" | "off")}>
                      <option value="auto">自动</option>
                      <option value="force">强制开启</option>
                      <option value="off">关闭</option>
                    </select>
                  </div>
                  {restartPending && <p className="settings-card-hint accel-restart-hint">⚡ 硬件加速设置已保存，重启应用后生效。</p>}
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-head"><Keyboard size={15} /><strong>键盘快捷键</strong></div>
                <div className="settings-card-body">
                  <div className="shortcut-preview">
                    {SHORTCUT_GROUPS.slice(0, 2).flatMap((group) => group.shortcuts).slice(0, 6).map((item) => (
                      <div className="shortcut-preview-row" key={item.keys.join("+")}><span>{item.desc}</span><span className="shortcut-keys">{item.keys.slice(0, 1).map((key, index) => <kbd key={index}>{key}</kbd>)}</span></div>
                    ))}
                  </div>
                  <button className="secondary-setting shortcut-manage-btn" onClick={() => { setShortcutsOpen(true); }}><Keyboard size={14} />查看全部快捷键</button>
                </div>
              </div>

              <div className="settings-card engine-update-card">
                <div className="settings-card-head"><RefreshCw size={15} /><strong>Codex 引擎更新</strong></div>
                <div className="settings-card-body">
                  <div className="engine-status-row">
                    <span className="engine-ver-chip" title={engineVersion}>{(engineVersion.match(/[\d][\d.]*/) || ["—"])[0]}</span>
                    <span className="engine-status-text">
                      {engineCheck.state === "idle" && "检查更新会访问 npm 仓库（默认国内镜像直连，无需代理）"}
                      {engineCheck.state === "checking" && "正在查询最新稳定版…"}
                      {engineCheck.state === "latest" && "已是最新版本"}
                      {engineCheck.state === "available" && `官方已发布新版 ${engineCheck.latest}`}
                      {engineCheck.state === "error" && `检查失败：${engineCheck.message}`}
                    </span>
                    <button className="secondary-setting engine-check-btn" disabled={engineCheck.state === "checking" || engineUpdating} onClick={() => void checkEngineUpdateNow()}>
                      {engineCheck.state === "checking" ? <Spinner /> : <Search size={14} />}{engineCheck.state === "checking" ? "检查中…" : "检查更新"}
                    </button>
                  </div>
                  {engineCheck.state === "available" && !engineUpdating && (
                    <div className="engine-update-strip">
                      <div className="engine-update-strip-copy">
                        <strong>更新到 {engineCheck.latest}</strong>
                        <small>自动备份旧引擎 · 失败自动回滚 · 完成后自动重启应用</small>
                      </div>
                      <button className="primary-setting engine-update-btn" onClick={() => void performEngineUpdateNow()}>
                        <RefreshCw size={14} />一键更新
                      </button>
                    </div>
                  )}
                  {engineUpdating && (
                    <div className="engine-update-strip running">
                      <div className="engine-update-progress">
                        <div className="engine-update-progress-bar">
                          <i style={{ width: `${Math.round((engineUpdatePercent ?? 0.06) * 100)}%` }} className={engineUpdatePercent == null ? "indeterminate" : ""} />
                        </div>
                        <span className="engine-update-busy">{engineUpdateStageText}·请勿关闭应用</span>
                      </div>
                    </div>
                  )}
                  {engineUpdateLog.length > 0 && (
                    <div className="engine-update-log">
                      {engineUpdateLog.map((line, index) => <p key={index}>{line}</p>)}
                    </div>
                  )}
                  {engineUpdateResult && !engineUpdateResult.ok && <p className="settings-card-hint engine-update-error">更新失败：{engineUpdateResult.message}（旧引擎已回滚，应用不受影响，可重试）</p>}
                  {relaunchCountdown != null && <p className="settings-card-hint engine-update-ok">✅ 引擎更新完成，{relaunchCountdown} 秒后自动重启应用生效…</p>}
                  <p className="settings-card-hint">下载默认跟随本地网络：优先国内镜像直连，检测到系统代理时自动走代理，无需手动配置。</p>
                </div>
              </div>
            </section>}
            {settingsPage === "devtools" && <section className="settings-section stack devtools-page">
              <div className="settings-copy"><h2>开发工具</h2><p>引擎原生基础运行时随应用内置；自动化工具与浏览器内核按需下载，安装后自动加入 Codex 环境（不改系统 PATH）。</p></div>
              {(() => {
                const autoIds = ["automation", "playwright-browsers", "cloak-browsers", "ponytail"];
                const groups = [
                  { key: "base", title: "基础运行时", hint: "随应用内置，离线可用", icon: <Wrench size={13} />, filter: (r: any) => r.builtIn },
                  { key: "auto", title: "自动化工具包", hint: "下载解压即用，安装后自动激活桌面/浏览器自动化", icon: <TerminalSquare size={13} />, filter: (r: any) => autoIds.includes(r.id) },
                  { key: "ondemand", title: "按需下载", hint: "联网下载安装", icon: <Download size={13} />, filter: (r: any) => !r.builtIn && r.kind !== "guide" && !autoIds.includes(r.id) },
                  { key: "system", title: "系统级安装", hint: "打开官网手动安装", icon: <Globe2 size={13} />, filter: (r: any) => r.kind === "guide" },
                ];
                return groups.map((g) => {
                  const items = devRuntimes.filter(g.filter);
                  if (!items.length) return null;
                  return <div className="devtools-group" key={g.key}>
                    <div className="settings-subhead">{g.icon}{g.title}<span className="settings-subhead-hint">{g.hint}</span></div>
                    <div className="runtime-list">
                      {items.map((runtime: any) => {
                        const busy = runtimeInstalling === runtime.id || runtime.installing;
                        const isDone = runtime.installed || runtime.installedBySystem;
                        const isGuide = runtime.kind === "guide";
                        return <div className={`runtime-row ${isDone ? "installed" : "missing"} ${busy ? "busy" : ""}`} key={runtime.id}>
                          <span className="runtime-icon">{busy ? <Spinner /> : isDone ? <CircleCheck size={16} /> : <TerminalSquare size={16} />}</span>
                          <span className="runtime-copy"><strong>{runtime.name}</strong><small>{runtime.description}</small>
                            {busy && runtimeProgress[runtime.id] ? <em className="runtime-progress">{runtimeProgress[runtime.id]}</em>
                              : !isDone && runtime.id === "automation" ? <em className="runtime-hint">解压即用 · 含 nuphus + playwright-cli + cloakbrowser</em> : null}
                          </span>
                          <span className="runtime-size">{runtime.size}</span>
                          {runtime.builtIn ? <span className="runtime-badge">内置</span>
                            : isDone ? <span className="runtime-badge installed">{runtime.installedBySystem ? "系统已装" : "已安装"}</span>
                              : isGuide
                                ? <button className="secondary-setting runtime-install" onClick={() => void installDevRuntime(runtime.id)}><ExternalLink size={13} />去官网安装</button>
                                : <button className="secondary-setting runtime-install" disabled={Boolean(runtimeInstalling)} onClick={() => void installDevRuntime(runtime.id)}>{busy ? <Spinner /> : <ArrowDown size={14} />}下载</button>}
                        </div>;
                      })}
                    </div>
                  </div>;
                });
              })()}
              {!devRuntimes.length && <div className="runtime-loading"><Spinner />正在读取开发工具状态…</div>}
              <details className="devtools-manifest">
                <summary><BookOpen size={13} />工具清单说明（Codex 引擎安装参考）<span className="settings-subhead-hint">点击展开 / 复制</span></summary>
                <div className="devtools-manifest-body">
                  <pre>{devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")}</pre>
                  <button className="secondary-setting" onClick={() => { void navigator.clipboard?.writeText(devRuntimes.map((r: any) => `# ${r.name}\n${r.description}\n${r.installed || r.builtIn ? "状态：已就绪" : "状态：未安装"}\n`).join("\n")); setNotice("工具清单已复制"); }}><Copy size={13} />复制清单</button>
                </div>
              </details>
              <p className="settings-card-hint">Node、Python（含 Tkinter、requests/httpx/flask/fastapi/playwright）、Git、PowerShell、ripgrep、uv、CMake、7-Zip、jq、Ninja 已内置随应用提供。桌面/浏览器自动化（nuphus + playwright-cli + cloakbrowser）与浏览器内核按需下载；Docker Desktop、OpenSSL 需系统级安装（点按钮打开官网）。安装后自动加入 Codex 环境（不修改系统 PATH 或注册表）。</p>
            </section>}
            {settingsPage === "browser" && <section className="settings-section stack">
              <div className="settings-copy"><h2>浏览器控制</h2><p>内置浏览器面板与自动化浏览器工具链。</p></div>
              <div className="settings-grid">
                <label className="wide"><span>默认起始页</span><div className="input-button"><input value={browserHome} onChange={(event) => setBrowserHome(event.target.value)} placeholder="https://" /><button className="secondary-setting" onClick={() => { localStorage.setItem("browser-home", browserHome.trim()); setBrowserDraft(browserHome.trim()); setNotice("浏览器默认页已保存"); }}><Check size={14} />保存</button></div></label>
              </div>
              <div className="settings-actions"><span>面板空态会使用默认起始页作为建议地址；右侧浏览器面板默认以 CloakBrowser 指纹模式打开（不再提供切换回内置视图的开关）。</span></div>
              <div className="settings-subhead"><Globe2 size={13} />浏览器自动化工具<span className="settings-subhead-hint">Codex 引擎可直接调用，PATH 与 NODE_PATH 已注入</span></div>
              <div className="tool-card-grid">
                {toolsStatus.filter((tool) => tool.scope === "browser").map((tool) => <ToolCard tool={tool} key={tool.id} />)}
                {!toolsStatus.length && <p className="muted">正在读取工具状态…</p>}
              </div>
              <p className="muted">普通网页用 <code>playwright-cli</code>（open → snapshot → click/type）；有反爬/验证码的站点用 CloakBrowser（<code>require("cloakbrowser")</code>，humanize + geoip）。引擎已内置这两条路径的使用说明。</p>
            </section>}
            {settingsPage === "appearance" && <section className="settings-section stack appearance-page">
              <div className="settings-copy"><h2>外观</h2><p>主题、字号与代码显示，即时生效并保存在本机。</p></div>
              <div className="settings-subhead"><Sun size={13} />主题<span className="settings-subhead-hint">点击预览卡片即时切换</span></div>
              <div className="theme-preview-grid" role="group" aria-label="主题">
                <button type="button" className={`theme-preview ${theme === "light" ? "active" : ""}`} aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
                  <span className="theme-preview-window tpw-light">
                    <span className="tpw-titlebar"><i /><i /><i /><b /></span>
                    <span className="tpw-body">
                      <span className="tpw-side"><i /><i /><i /></span>
                      <span className="tpw-main"><i /><i /><i className="short" /></span>
                    </span>
                  </span>
                  <span className="theme-preview-label"><Sun size={13} />白天{theme === "light" ? <em><Check size={11} /></em> : null}</span>
                </button>
                <button type="button" className={`theme-preview ${theme === "dark" ? "active" : ""}`} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
                  <span className="theme-preview-window tpw-dark">
                    <span className="tpw-titlebar"><i /><i /><i /><b /></span>
                    <span className="tpw-body">
                      <span className="tpw-side"><i /><i /><i /></span>
                      <span className="tpw-main"><i /><i /><i className="short" /></span>
                    </span>
                  </span>
                  <span className="theme-preview-label"><Moon size={13} />黑夜{theme === "dark" ? <em><Check size={11} /></em> : null}</span>
                </button>
              </div>
              <div className="settings-subhead"><ZoomIn size={13} />消息字号<span className="settings-subhead-hint">影响对话正文与过程内容</span></div>
              <div className="theme-switch three" role="group" aria-label="字号">
                <button type="button" className={uiFont === "compact" ? "active" : ""} onClick={() => { setUiFont("compact"); localStorage.setItem("ui-font", "compact"); }}><span className="fs-demo fs-demo-compact">紧凑</span></button>
                <button type="button" className={uiFont === "default" ? "active" : ""} onClick={() => { setUiFont("default"); localStorage.setItem("ui-font", "default"); }}><span className="fs-demo fs-demo-default">标准</span></button>
                <button type="button" className={uiFont === "large" ? "active" : ""} onClick={() => { setUiFont("large"); localStorage.setItem("ui-font", "large"); }}><span className="fs-demo fs-demo-large">大字</span></button>
              </div>
              <CodeAppearanceSection />
            </section>}
            {settingsPage === "personalization" && <PersonalizationPage personality={personality} onPersonalityChange={changePersonality} onNotice={setNotice} />}
            {settingsPage === "relay" && <RelayCenterPage busy={relayBusy} activeProvider={customModel?.provider} onActivate={relayActivate} onNotice={setNotice} onOpenModelSettings={() => { setSettingsPage("model"); }} />}
            {settingsPage === "openai" && <OpenaiSubscriptionPage activeProvider={customModel?.provider} onActivate={(models) => activateOfficialProvider(models)} onNotice={setNotice} onActiveChange={setOpenaiActiveAcct} />}
            {settingsPage === "model" && <section className="settings-model-layout">
              <div className="model-global-bar">
                <div className="model-global-item">
                  <span className="model-global-label"><Zap size={13} />自动压缩比例</span>
                  <select value={autoCompactRatio} onChange={(event) => { const v = Number(event.target.value); setAutoCompactRatio(v); void window.codex.saveAppSettings({ autoCompactRatio: v }); setNotice('自动压缩比例已设为 ' + Math.round(v * 100) + '% ，达到该用量时自动压缩上下文'); }}>
                    {[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
                  </select>
                  <small>上下文用量达到此比例时引擎自动压缩较早对话</small>
                </div>
              </div>
              <div className="provider-list">
                <div className="provider-list-head"><h2>模型供应商</h2></div>
                {(() => {
                  // PPtoken 赞助商卡常驻置顶：真实配置存在时用真实数据参与排序，否则显示未配置引导卡
                  const realPptoken = providersList.some((p) => p.provider === "pptoken");
                  const display = realPptoken
                    ? [...providersList].sort((a, b) => (a.provider === "pptoken" ? 0 : 1) - (b.provider === "pptoken" ? 0 : 1))
                    : [{ provider: "pptoken", name: "PPtoken", model: "", baseUrl: "https://api.pptoken.cc/v1", wireApi: "responses" as const, hasKey: false, models: [], enabled: true }, ...providersList];
                  return display.map((p) => {
                    const isPseudoPptoken = p.provider === "pptoken" && !realPptoken;
                    const pseudoOff = isPseudoPptoken && pptokenCardOff;
                    return (
                      <div
                        key={p.provider}
                        className={`provider-item ${p.provider === "pptoken" ? "sponsor" : ""} ${(p.enabled === false || pseudoOff) ? "disabled" : ""} ${p.provider === editingProvider ? "selected" : ""}`}
                        onClick={() => {
                          if (isPseudoPptoken) {
                            // 未配置的常驻赞助商卡：进表单预填 PPtoken 端点，填密钥保存即可用；启用态与卡片开关联动
                            setCustomDraft({ provider: "pptoken", name: "PPtoken", model: "", baseUrl: "https://api.pptoken.cc/v1", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: !pptokenCardOff });
                            setEditingProvider(null);
                            setEditingName(false);
                            return;
                          }
                          setEditingProvider(p.provider); setEditingName(false); setCustomDraft({ provider: p.provider, name: p.name, model: p.model, baseUrl: p.baseUrl, contextWindow: String(p.contextWindow ?? 128000), wireApi: p.wireApi ?? "responses", apiKey: "", models: p.models ?? (p.model ? [{ id: p.model }] : []), enabled: p.enabled ?? true });
                        }}
                      >
                        <span
                          className="provider-item-icon"
                          style={{ background: p.provider === "pptoken" ? "linear-gradient(135deg, #e64980, #9775fa)" : AVATAR_GRADIENTS[avatarToneOf(p.name)], color: "#fff" }}
                        >
                          {p.provider === "pptoken" ? <Rocket size={13} /> : <Store size={13} />}
                        </span>
                        <div className="provider-item-main">
                          <span className="provider-name-row">
                            <strong>{p.name}</strong>
                            {p.provider === "pptoken" && <b className="provider-sponsor-badge">官方推荐</b>}
                            {p.provider === "pptoken" && (
                              <button className="provider-visit-btn" title="打开 PPtoken 官网（注册领额度）" onClick={(event) => { event.stopPropagation(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>
                                <ExternalLink size={11} />
                              </button>
                            )}
                          </span>
                          <small>{isPseudoPptoken ? (pseudoOff ? "已停用" : "未配置密钥") : p.hasKey === false && p.provider === "pptoken" ? "未配置密钥" : `${uniqueModelCount(p.models)} 个模型`}</small>
                        </div>
                        <label
                          className={`provider-switch ${p.enabled === false ? "off" : ""}`}
                          title={isPseudoPptoken ? (pseudoOff ? "推荐卡已停用 · 点击恢复展示" : "停用 PPtoken 推荐卡展示") : (p.enabled !== false ? "已启用 · 点击禁用" : (customModel && customModel.provider !== p.provider ? `已有供应商「${customModel.name}」生效，一次只能启用一个——先停用它再启用这个` : "已禁用 · 点击启用"))}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input type="checkbox" checked={isPseudoPptoken ? !pseudoOff : p.enabled !== false} disabled={!isPseudoPptoken && p.enabled === false && customModel != null && customModel.provider !== p.provider} onChange={(event) => { if (isPseudoPptoken) setPptokenCardOff(!event.target.checked); else void setProviderEnabled(p.provider, event.target.checked); }} />
                          <span className="provider-switch-ui" />
                        </label>
                        {!isPseudoPptoken && <span className={`provider-dot ${p.provider === currentProvider ? "on" : ""}`} title={p.provider === currentProvider ? "当前生效供应商" : ""} />}
                      </div>
                    );
                  });
                })()}
                {/* 不打开编辑器也能测当前生效供应商：切换/保存后最常用的自检动作。
                    失败会弹带排查清单的中文提示，认证类错误保留供应商原文。 */}
                {customModel && <button className="add-provider-btn" title={`测试当前生效供应商：${customModel.name} · ${customModel.model}`} disabled={!!probingProvider} onClick={() => void probeActiveProvider()}>{probingProvider === "test" ? <Spinner /> : <RefreshCw size={13} />}测试当前供应商</button>}
                <button className="add-provider-btn" onClick={() => { providerAutoOpenRef.current = true; setCustomDraft({ provider: "custom" + (Date.now() % 1000), name: "自定义供应商", model: "", baseUrl: "", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: true }); setEditingProvider(null); setEditingName(false); }}><Plus size={13} />添加供应商</button>
              </div>
              <div className="provider-form">
                <div className="provider-detail-head">
                  {editingName ? (
                    <input className="provider-name-input" value={customDraft.name} autoFocus onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })} onBlur={() => setEditingName(false)} onKeyDown={(event) => { if (event.key === "Enter") setEditingName(false); }} placeholder="供应商名称" />
                  ) : <strong onClick={() => setEditingName(true)} title="点击重命名">{customDraft.name || "未命名供应商"}</strong>}
                  <button className="icon-button" title="重命名" onClick={() => setEditingName((v) => !v)}><PenLine size={13} /></button>
                  {(() => {
                    // 未配置的 PPtoken 推荐卡：表单头部启用态与左侧卡片开关同一数据源（pptokenCardOff），双向联动
                    const pseudoPptokenForm = customDraft.provider === "pptoken" && !providersList.some((p) => p.provider === "pptoken");
                    const effectiveEnabled = pseudoPptokenForm ? !pptokenCardOff : customDraft.enabled !== false;
                    return (
                      <>
                        {/* 启用/停用合并成一颗状态药丸：状态与动作一眼可读 */}
                        {pseudoPptokenForm
                          ? <button className={`provider-state-btn pill ${effectiveEnabled ? "on" : "off"}`} onClick={() => setPptokenCardOff(!pptokenCardOff)}><span className="provider-state-dot" />{effectiveEnabled ? "展示中 · 点击停用" : "已停用 · 点击展示"}</button>
                          : editingProvider && <button className={`provider-state-btn pill ${effectiveEnabled ? "on" : "off"}`} disabled={savingSettings || (customDraft.enabled === false && customModel != null && customModel.provider !== editingProvider)} title={(customDraft.enabled === false && customModel && customModel.provider !== editingProvider) ? `已有供应商「${customModel.name}」生效，请先停用它再启用` : undefined} onClick={() => void setProviderEnabled(editingProvider, customDraft.enabled === false)}><span className="provider-state-dot" />{effectiveEnabled ? "启用中 · 点击停用" : "已停用 · 点击启用"}</button>}
                      </>
                    );
                  })()}
                  <span className="provider-head-spacer" />
                  {/* 「设为当前」已移除：启用即生效（全局只生效一个），不需要二次确认按钮 */}
                  {editingProvider && <button className="icon-button" title="删除供应商" onClick={async () => { if (!(await openAppConfirm("删除供应商", `供应商「${customDraft.name}」将被删除，此操作无法撤销。`, "删除"))) return; void removeProvider({ provider: customDraft.provider, name: customDraft.name, model: customDraft.model, baseUrl: customDraft.baseUrl }); }}><Trash2 size={14} /></button>}
                </div>
                {customDraft.provider === "pptoken" && !providersList.some((p) => p.provider === "pptoken") && (
                  <p className="provider-form-hint">只需下方填入 API Key 即可使用；<a href="https://api.pptoken.cc/register?aff=X82JSNVC3W3S" onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>注册 PPtoken 领取体验额度 ↗</a></p>
                )}
                <p className="provider-id-line">供应商 ID：{customDraft.provider}</p>
                <label className="provider-field"><span>Base URL</span><input value={customDraft.baseUrl} onChange={(event) => setCustomDraft({ ...customDraft, baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
                <label className="provider-field"><span>API 格式</span><select value={customDraft.wireApi ?? "auto"} onChange={(event) => { const v = event.target.value; setCustomDraft({ ...customDraft, wireApi: v === "chat" ? "chat" : v === "responses" ? "responses" : "auto" }); }}><option value="auto">自动跟随上游（探测后自动确定）</option><option value="responses">Responses (/responses)</option><option value="chat">Chat Completions (/chat/completions)</option></select></label>
                <label className="provider-field"><span>API Key</span>
                  <span className="key-input">
                    <input type={showApiKey ? "text" : "password"} value={customDraft.apiKey} onChange={(event) => setCustomDraft({ ...customDraft, apiKey: event.target.value })} placeholder={customModel?.hasKey ? "已安全保存，留空则不修改" : "可留空用于本地服务"} />
                    <button type="button" className="key-toggle" title={showApiKey ? "隐藏" : "显示"} onClick={() => setShowApiKey((v) => !v)}>{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </span>
                </label>
                <div className="model-list-block">
                  <div className="model-list-head">
                    <span>模型列表</span>
                    <div className="model-list-head-actions">
                      <span className="model-list-hint">可多选生效</span>
                      <button className="icon-button" title="全选模型" disabled={!!savingSettings || !(customDraft.models ?? []).length} onClick={() => setCustomDraft((current) => ({ ...current, models: (current.models ?? []).map((model) => ({ ...model, enabled: true })) }))}><ListChecks size={13} /></button>
                      <button className="icon-button" title="取消全部生效" disabled={!!savingSettings || !(customDraft.models ?? []).length} onClick={() => setCustomDraft((current) => ({ ...current, models: (current.models ?? []).map((model) => ({ ...model, enabled: false })) }))}><X size={13} /></button>
                      <button className="icon-button" title="批量移除所有未勾选的模型（保存后生效）" disabled={!!savingSettings || !(customDraft.models ?? []).some((model) => model.enabled === false)} onClick={() => setCustomDraft((current) => ({ ...current, models: (current.models ?? []).filter((model) => model.enabled !== false), model: (current.models ?? []).some((model) => model.id === current.model && model.enabled !== false) ? current.model : ((current.models ?? []).find((model) => model.enabled !== false)?.id ?? "") }))}><Trash2 size={13} /></button>
                      <button className="icon-button" title="测试连接并拉取可用模型列表" disabled={!!probingProvider || !customDraft.baseUrl} onClick={() => void probeProvider("list")}>{probingProvider === "list" ? <Spinner /> : <RefreshCw size={13} />}</button>
                    </div>
                  </div>
                  {(customDraft.models ?? []).length > 0 && <div className="model-list">
                    {(() => {
                      const seen = new Set<string>();
                      const unique = (customDraft.models ?? []).filter((m) => {
                        if (seen.has(m.id)) return false;
                        seen.add(m.id);
                        return true;
                      });
                      return unique.map((m) => {
                      const live = customModel?.provider === customDraft.provider && customModel.model === m.id;
                      const enabled = m.enabled !== false;
                      return (
                        <div key={m.id} className={`model-row ${live ? "live" : ""} ${enabled ? "enabled" : "disabled"}`} title={enabled ? "已勾选，保存后生效" : "未勾选，保存后不参与模型列表"}>
                          <label className="model-check" title={enabled ? "取消生效" : "勾选后生效"} onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" checked={enabled} disabled={!!savingSettings} onChange={(event) => setCustomDraft((current) => ({ ...current, models: (current.models ?? []).map((model) => model.id === m.id ? { ...model, enabled: event.target.checked } : model) }))} />
                            <span className="model-check-ui" />
                          </label>
                          <em className="model-row-id">{m.id}</em>
                          {(m.inputTypes ?? []).some((t) => t === "image" || t === "video") && <b className="model-vision-badge" title="支持图片/视频输入（视觉模型）"><Eye size={10} />视觉</b>}
                          {m.contextWindow ? <b className="model-ctx-badge">{m.contextWindow >= 1000000 ? `${m.contextWindow / 1000000}M` : `${Math.round(m.contextWindow / 1000)}K`}</b> : null}
                          {live && <b className="model-live-badge">当前使用</b>}
                          <span className="model-row-actions">
                            {enabled !== (customModel?.models ?? []).find((x) => x.id === m.id)?.enabled && (
                              <button className="icon-button model-row-save" title="保存勾选状态（立即生效）" disabled={!!savingSettings} onClick={(event) => { event.stopPropagation(); const merged = { ...customDraft, models: (customDraft.models ?? []).map((x) => x.id === m.id ? { ...x, enabled } : x) }; setCustomDraft(merged); void saveCustomDraft(merged); }}><Check size={13} /></button>
                            )}
                            <button className="icon-button" title="测试该模型连通" disabled={switchingModel === m.id || !customDraft.baseUrl} onClick={(event) => { event.stopPropagation(); void probeOneModel(customDraft.provider, m.id); }}>{switchingModel === m.id ? <Spinner /> : <Zap size={13} />}</button>
                            <button className="icon-button" title="编辑模型" onClick={(event) => { event.stopPropagation(); openModelEditor(m); }}><PenLine size={13} /></button>
                            <button className="icon-button" title="从列表移除（保存后生效）" onClick={(event) => { event.stopPropagation(); setCustomDraft((current) => { const models = (current.models ?? []).filter((model) => model.id !== m.id); const model = current.model === m.id ? (models.find((x) => x.enabled !== false)?.id ?? models[0]?.id ?? "") : current.model; return { ...current, models, model }; }); }}><Trash2 size={13} /></button>
                          </span>
                        </div>
                      );
                      });
                    })()}
                  </div>}
                  <button className="add-model-btn" onClick={() => openModelEditor()}><Plus size={13} />添加模型</button>
                  {providerStatus && <p className={`model-probe-status ${providerStatus.startsWith("连接失败") || providerStatus.includes("连接失败") ? "bad" : "ok"}`}>{providerStatus}</p>}
                </div>
                <div className="settings-actions"><span>配置后可在聊天时选择使用。带 ⚡ 可测试模型连通。</span>
                  <button className="primary-setting" disabled={savingSettings || !customDraft.baseUrl} onClick={() => void (async () => {
                    // 用户要求：保存模型配置后重启整个应用（引擎 Key 全新注入，状态彻底归位）
                    if (!(await openAppConfirm("保存供应商", "保存后应用将自动重启使配置完全生效。\n是否继续？", "保存并重启应用"))) return;
                    try {
                      await saveCustomModel();
                      showToast("已保存", "应用即将重启以完全生效……");
                      setTimeout(() => { void window.codex.relaunchApp(); }, 800);
                    } catch (error: any) {
                      setNotice(`保存失败：${error.message}`);
                    }
                  })()}>{savingSettings ? <Spinner /> : <Check size={15} />}保存</button>
                </div>
              </div>
              {modelEditor && <div className="modal-backdrop model-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelEditor(null); }}>
                <div className="model-editor-modal">
                  <header><strong>{modelEditor.mode === "edit" ? "编辑模型配置" : "添加模型"}{editingProvider || targetProviderHint ? ` · ${customDraft.name || editingProvider || targetProviderHint}` : ""}</strong><button className="icon-button" onClick={() => setModelEditor(null)}><X size={15} /></button></header>
                  <label className="provider-field"><span>模型 ID</span><input list="provider-model-options" autoFocus value={modelEditor.draft.id} onChange={(event) => {
                    const id = event.target.value;
                    // 已知模型（GPT 系/主流国模）按内置规格自动回填全部推荐参数。
                    // 改名即重评估：只要参数字段没被手动改过（paramsDirty=false），就按新 ID 的规格整体重填——
                    // 第一次填错型号也能改回来；手动改过的字段绝不重置。
                    const spec = matchModelSpec(id);
                    if (spec && !modelEditor.paramsDirty) {
                      setModelEditor({ ...modelEditor, draft: { ...modelEditor.draft, id, contextWindow: String(spec.contextWindow), maxOutputTokens: spec.maxOutputTokens ? String(spec.maxOutputTokens) : "", efforts: [...spec.efforts], inputTypes: [...(spec.inputTypes ?? ["text"])], outputTypes: [...(spec.outputTypes ?? ["text"])] } });
                      return;
                    }
                    setModelEditor({ ...modelEditor, draft: { ...modelEditor.draft, id } });
                  } } placeholder="deepseek-v4-flash" /></label>
                  <datalist id="provider-model-options">{modelSuggestions.map((option) => <option key={option} value={option} />)}</datalist>
                  <label className="provider-field"><span>上下文窗口</span><input type="number" min="1024" step="1024" value={modelEditor.draft.contextWindow} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, contextWindow: event.target.value } })} placeholder="1000000" /></label>
                  <label className="provider-field"><span>最大输出 Token</span><input type="number" min="1" value={modelEditor.draft.maxOutputTokens} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, maxOutputTokens: event.target.value } })} placeholder="384000" /></label>
                  {(() => {
                    // 极端值预警（反馈 #14：上下文调到 1M 后一直不出回答）：
                    // 这两个值会原样传给供应商——超出供应商真实限额时请求会被拒或长挂。
                    // 有内置规格表的模型按官方规格精准判断（很多模型本来就支持 1M，超 256K 不该误报）；
                    // 规格表没收录的模型才退回 256K/128K 通用提醒。
                    const ctx = Number(modelEditor.draft.contextWindow);
                    const out = Number(modelEditor.draft.maxOutputTokens);
                    const spec = matchModelSpec(String(modelEditor.draft.id ?? ""));
                    const fmtCtx = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}K`);
                    const hints: string[] = [];
                    if (Number.isFinite(ctx) && ctx > 0) {
                      const known = spec?.contextWindow;
                      if (known && ctx > known) hints.push(`该模型官方上下文上限约 ${fmtCtx(known)}：当前填写 ${fmtCtx(ctx)} 超过规格，虚标会导致长任务请求被拒或无限重试`);
                      else if (!known && ctx > 262_144) hints.push("上下文窗口超过 256K：该模型不在内置规格表中，请确认供应商真实支持该上限，虚标会导致长任务请求被拒或无限重试");
                    }
                    if (Number.isFinite(out) && out > 0) {
                      const known = spec?.maxOutputTokens;
                      if (known && out > known) hints.push(`该模型官方最大输出约 ${fmtCtx(known)}：当前填写 ${fmtCtx(out)} 超过规格，按官方文档填写`);
                      else if (!known && out > 131_072) hints.push("最大输出超过 128K：多数供应商拒绝超过自身上限的 max_output_tokens，建议按官方文档填写");
                    }
                    if (!hints.length) return null;
                    return <div className="provider-field-hints">{hints.map((hint) => <p key={hint}>⚠️ {hint}</p>)}</div>;
                  })()}
                  <div className="type-chip-group"><span>输入类型</span>
                    <div className="type-chips">{(["text", "image", "video"] as const).map((t) => (
                      <label key={t} className={`type-chip ${modelEditor.draft.inputTypes.includes(t) ? "on" : ""}`}>
                        <input type="checkbox" checked={modelEditor.draft.inputTypes.includes(t)} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, inputTypes: event.target.checked ? [...modelEditor.draft.inputTypes, t] : modelEditor.draft.inputTypes.filter((x) => x !== t) } })} />
                        <span>{t === "text" ? "文本" : t === "image" ? "图片" : "视频"}</span>
                      </label>
                    ))}</div>
                  </div>
                  <div className="type-chip-group"><span>输出类型</span>
                    <div className="type-chips">{(["text", "image"] as const).map((t) => (
                      <label key={t} className={`type-chip ${modelEditor.draft.outputTypes.includes(t) ? "on" : ""}`}>
                        <input type="checkbox" checked={modelEditor.draft.outputTypes.includes(t)} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, outputTypes: event.target.checked ? [...modelEditor.draft.outputTypes, t] : modelEditor.draft.outputTypes.filter((x) => x !== t) } })} />
                        <span>{t === "text" ? "文本" : "图片"}</span>
                      </label>
                    ))}</div>
                  </div>
                  <div className="type-chip-group"><span>思考档位 <small>按模型 API 实际支持勾选；GPT 系可勾选 max/最高</small></span>
                    <div className="type-chips">{ALL_EFFORTS.map((t) => (
                      <label key={t} className={`type-chip ${modelEditor.draft.efforts.includes(t) ? "on" : ""}`}>
                        <input type="checkbox" checked={modelEditor.draft.efforts.includes(t)} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, efforts: event.target.checked ? [...modelEditor.draft.efforts, t] : modelEditor.draft.efforts.filter((x) => x !== t) } })} />
                        <span>{effortLabels[t] ?? t}</span>
                      </label>
                    ))}</div>
                    <small className="provider-field-hint">只勾选模型 API 真正支持的档位；思考等级菜单会按此显示。</small>
                  </div>
                  <footer><button className="secondary-setting" onClick={() => setModelEditor(null)}>取消</button><button className="primary-setting" disabled={!modelEditor.draft.id.trim()} onClick={() => void saveModelEditor()}><Check size={14} />保存</button></footer>
                </div>
              </div>}
            </section>}
{settingsPage === "memory" && <section className="settings-section stack memory-center">
              <div className="settings-copy channel-heading"><div><h2>记忆</h2><p>记忆分「常驻记忆」与「记忆条目」两部分：常驻记忆每轮对话自动注入；条目按需召回，按重要度分 P0–P3 管理。</p></div><label className="channel-enable"><input type="checkbox" checked={memoryEnabled} onChange={(event) => void setMemoryEnabled(event.target.checked)} /><span>{memoryEnabled ? "已启用" : "已停用"}</span></label></div>

              <div className="memory-overview">
                <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }} title="浏览记忆条目">
                  <span className="memory-overview-top"><span className="memory-overview-icon"><Archive size={16} /></span>
                  <span className="memory-overview-body"><strong>记忆条目</strong><small>按重要度与来源会话整理，可逐条查看/置顶/删除</small></span></span>
                  <span className="memory-overview-stat"><b>{memories.length}</b> 条 · {memoryGroups.length} 个会话 · {memoryGroups.reduce((s, g) => s + g.items.filter((it) => (it as any).pinned).length, 0)} 置顶</span>
                </button>
                <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("layers"); setMemoryCenterOpen(true); }} title="编辑常驻记忆">
                  <span className="memory-overview-top"><span className="memory-overview-icon"><BookOpen size={16} /></span>
                  <span className="memory-overview-body"><strong>常驻记忆</strong><small>用户档案 · 项目记忆 · 近期日志，每轮对话自动注入</small></span></span>
                  <span className="memory-overview-stat"><b>L0/L1/L2</b> 用户 {memoryLayers?.budget.user ?? 0} 字 · 背景 {memoryLayers?.budget.background ?? 0} 字 · 项目 {memoryLayers?.budget.project ?? 0} 字</span>
                </button>
                <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("storage"); setMemoryCenterOpen(true); }} title="选择记忆保存位置">
                  <span className="memory-overview-top"><span className="memory-overview-icon"><Cloud size={16} /></span>
                  <span className="memory-overview-body"><strong>存储与同步</strong><small>记忆保存在本地或云端；工作区记忆跨会话复用</small></span></span>
                  <span className="memory-overview-stat"><b>{memoryMode === "cloud" ? "云端同步" : "本地"}</b>{workspaceMemoryEnabled ? " · 工作区已开启" : ""}</span>
                </button>
                <button className="memory-overview-card" onClick={() => { setMemoryCenterTab("search"); setMemoryCenterOpen(true); }} title="跨会话检索历史内容">
                  <span className="memory-overview-top"><span className="memory-overview-icon"><Search size={16} /></span>
                  <span className="memory-overview-body"><strong>全局搜索</strong><small>检索会话、记忆、任务与技能，命中按会话分组、可预览全文</small></span></span>
                  <span className="memory-overview-stat"><b>{threads.length}</b> 会话 · {scheduledTasks.length} 任务 · {localSkills.length} 技能</span>
                </button>
              </div>

              <div className="memory-overview-actions">
                <button className="primary-setting" onClick={() => { setMemoryCenterTab("library"); setMemoryCenterOpen(true); }}><LayoutGrid size={15} />打开记忆中心</button>
                <span className="muted">浏览条目、编辑常驻记忆、切换存储都在记忆中心里完成，这里只做总览。</span>
              </div>
              {memoryStatus && <p className="settings-status">{memoryStatus}</p>}
              {memoryConfigOpen && <MemoryConfigModal gateway={memoryGateway} setGateway={setMemoryGateway} action={memoryGatewayAction} onClose={() => setMemoryConfigOpen(false)} onTest={() => void testMemoryGateway()} onSave={() => void saveMemoryGateway()} />}
            </section>}
            {settingsPage === "schedule" && <section className="settings-section stack">
              <div className="settings-copy channel-heading"><div><h2>自动化</h2><p>创建定时任务，或排队在闲时算力空闲时后台执行。</p></div><button className="primary-setting" onClick={() => { setScheduleDraft({ ...emptyScheduleDraft(workspace || ""), name: "", prompt: "" }); setAutoFormVisible(true); }}><Plus size={14} />新增定时任务</button></div>
              <div className="auto-card">
                {scheduledTasks.length === 0 ? (
                  <div className="auto-empty">
                    <p className="muted">还没有定时任务</p>
                    <div className="auto-empty-actions"><button className="primary-setting" onClick={() => setAutoFormVisible(true)}><Plus size={14} />添加任务</button></div>
                  </div>
                ) : (
                  <div className="auto-cards">
                    {scheduledTasks.map((task) => (
                      <div className={`auto-card-item ${task.enabled ? "" : "disabled"}`} key={task.id}>
                        <div className="auto-card-head">
                          <strong title={task.name}>{task.name}</strong>
                          <span className="auto-card-tag">{task.kind === "once" || task.scheduleType === "once" ? "一次性任务" : (task.kind === "interval" || task.kind === undefined && !task.rrule ? "循环任务" : "周期任务")}</span>
                          <label className="auto-switch" title={task.enabled ? "停用" : "启用"}><input type="checkbox" checked={task.enabled} onChange={() => void toggleSchedule(task)} /><i /></label>
                        </div>
                        <p className="auto-card-desc" title={task.prompt}>{task.prompt}</p>
                        <div className="auto-card-meta"><Clock3 size={13} /><span>运行计划</span><b>{describeSchedule(task)}</b></div>
                        <div className="auto-card-meta"><MessageSquare size={13} /><span>{basename(task.workspace)}</span></div>
                        <div className="auto-card-foot">
                          <span className="auto-card-next">下次 {new Date(task.nextRunAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          <div className="auto-card-actions">
                            <button className="icon-button" title="立即运行" disabled={!task.enabled} onClick={() => void runSchedule(task.id)}><Play size={13} /></button>
                            <button className="icon-button" title="编辑" onClick={() => editSchedule(task.id)}><PenLine size={13} /></button>
                            <button className="icon-button" title="删除" onClick={() => void deleteSchedule(task.id)}><Trash2 size={13} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="auto-awake"><Info size={14} /><span>Codex 运行会话时保持电脑唤醒。</span><input type="checkbox" checked={keepAwake} onChange={(event) => { const on = event.target.checked; setKeepAwake(on); localStorage.setItem("keep-awake", String(on)); void window.codex.setAwake(on); }} /></div>
              <div className="auto-templates"><h3>闲时任务模板</h3><div className="template-grid">
                {idleTemplates.map((tpl) => <button className="template-card" key={tpl.name} onClick={() => { setAutoFormVisible(true); setScheduleDraft({ ...emptyScheduleDraft(workspace || ""), name: tpl.name, prompt: tpl.prompt, effort: "high" }); }}><strong><ListFilter size={13} />{tpl.name}</strong><p>{tpl.desc}</p><small>最早可用时段</small></button>)}
              </div></div>
              <div className="auto-templates"><h3>定时任务模板</h3><div className="template-grid">
                {cronTemplates.map((tpl) => <button className="template-card" key={tpl.name} onClick={() => { void window.codex.saveScheduledTask({ name: tpl.name, prompt: tpl.desc, workspace: workspace || "", intervalMinutes: tpl.intervalMinutes, enabled: true, kind: tpl.intervalMinutes === 1440 ? "daily" : "weekly", timeOfDay: tpl.intervalMinutes === 1440 ? "09:00" : "16:00", weekdays: tpl.intervalMinutes === 1440 ? undefined : [5] }).then((saved: any) => { setScheduledTasks((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]); setNotice("定时任务已创建：" + tpl.name); }).catch((error: any) => setNotice("创建失败：" + error.message)); }}><strong>{tpl.icon}{tpl.name}</strong><p>{tpl.desc}</p><small>{tpl.time}</small></button>)}
              </div></div>
              
            </section>}
            {settingsPage === "rpa" && <section className="settings-section stack">
              <div className="settings-copy channel-heading"><div><h2>RPA 自动化</h2><p>Codex 引擎自主跑通一条流程后，会自动把步骤沉淀为配方；下次让 Codex 直接复现即可。</p></div></div>
              <div className="auto-card">
                {rpaRecipes.length === 0 ? (
                  <div className="auto-empty"><p className="muted">还没有 RPA 配方。让 Codex 自主跑通一条流程后，它会自动把步骤沉淀成配方，无需手动创建。</p></div>
                ) : (
                  <div className="auto-cards">
                    {rpaRecipes.map((recipe) => (
                      <div className="auto-card-item" key={recipe.id}>
                        <div className="auto-card-head">
                          <strong title={recipe.name}>{recipe.name}</strong>
                          <span className="auto-card-tag">{recipe.kind === "browser" ? "浏览器" : recipe.kind === "desktop" ? "桌面" : "混合"}</span>
                          {rpaRunning === recipe.id && <span className="subagent-badge"><Bot size={11} />执行中</span>}
                          {recipe.lastStatus === "ok" && <span className="rpa-status ok">上次成功</span>}
                          {recipe.lastStatus === "fail" && <span className="rpa-status fail" title={recipe.lastError ?? ""}>上次失败</span>}
                        </div>
                        {recipe.desc && <p className="auto-card-desc" title={recipe.desc}>{recipe.desc}</p>}
                        {recipe.steps?.length > 0 && <ol className="rpa-steps">{recipe.steps.map((step: string, index: number) => <li key={index}>{step}</li>)}</ol>}
                        <div className="auto-card-foot">
                          <span className="auto-card-next">{recipe.workspace ? basename(recipe.workspace) : "全局"} · 已存 {recipe.runCount ?? 0} 次运行</span>
                          <div className="auto-card-actions">
                            <button className="icon-button" title="在当前会话执行" disabled={rpaRunning !== null} onClick={() => { if (!thread) { setNotice("请先打开或新建一个会话再执行配方"); return; } setRpaRunning(recipe.id); void window.codex.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: `请执行 RPA 配方「${recipe.name}」：\n${recipe.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`, text_elements: [] }], model: selectedModel?.model ?? modelName(modelId), sandboxPolicy: sandboxPolicy(sandbox, thread.cwd ?? workspace ?? "") }).catch((error: any) => setNotice("执行失败：" + error.message)).finally(() => setRpaRunning(null)); }}><Play size={13} /></button>
                            <button className="icon-button danger" title="删除" onClick={async () => { if (!(await openAppConfirm("删除配方", `配方「${recipe.name}」将被删除，此操作无法撤销。`, "删除"))) return; void window.codex.deleteRpaRecipe(recipe.id).then(() => setRpaRecipes((current) => current.filter((entry) => entry.id !== recipe.id))).catch((error: any) => setNotice("删除失败：" + error.message)); }}><Trash2 size={13} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="auto-templates"><h3>任务清单 <span className="muted" style={{ fontWeight: 400 }}>（Codex 通过 task_add / task_update 自主维护）</span></h3>
                <div className="rpa-task-panel">
                  <ul className="rpa-task-list">
                    {taskList.length === 0 && <li className="muted">清单为空。让 Codex 跑通流程时自主安排待办，无需手动添加。</li>}
                    {taskList.map((task) => (
                      <li key={task.id} className={task.status}>
                        <label className="auto-switch" title={task.status === "done" ? "标记待办" : "标记完成"}><input type="checkbox" checked={task.status === "done"} onChange={() => { const next = task.status === "done" ? "todo" : "done"; void window.codex.updateTask({ id: task.id, patch: { status: next } }).then((updated: any) => setTaskList((current) => current.map((entry) => entry.id === updated.id ? updated : entry))).catch(() => undefined); }} /><i /></label>
                        <span className="rpa-task-text">{task.text}</span>
                        <span className={`rpa-task-priority ${task.priority}`}>{task.priority === "high" ? "高" : task.priority === "low" ? "低" : "中"}</span>
                        <button className="icon-button" title="删除" onClick={() => { void window.codex.deleteTask(task.id).then(() => setTaskList((current) => current.filter((entry) => entry.id !== task.id))).catch(() => undefined); }}><Trash2 size={13} /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>}
            {settingsPage === "plugins" && <BuiltinPluginsSection onNotice={(m) => setNotice(m)} />}
            {settingsPage === "plugins" && (() => {
              const all = settingsResources.plugins as any[];
              const installed = all.filter((plugin) => plugin.installed);
              // 市场卡片「已安装」判定：引擎插件 id 形如 name@marketplace，取 @ 前与市场 slug 比对
              const installedMarketPluginSlugs = new Set(installed.map((plugin) => String(plugin.id ?? plugin.name ?? "").split("@")[0]));
              const enabledCount = installed.filter((plugin) => plugin.enabled !== false).length;
              const disabledCount = installed.length - enabledCount;
              const keyword = pluginSearch.trim().toLowerCase();
              const visible = all.filter((plugin) => {
                if (pluginInstalledOnly && !plugin.installed) return false;
                if (!keyword) return true;
                return `${pluginDisplayName(plugin)} ${pluginDescription(plugin)} ${plugin.marketplaceName ?? ""} ${plugin.name ?? ""}`.toLowerCase().includes(keyword);
              });
              // 只有已安装的插件可以勾选：没装的谈不上启用/停用
              const selectableIds = visible.filter((plugin) => plugin.installed).map((plugin) => String(plugin.id ?? ""));
              // 筛选变化后，之前勾的条目可能已不可见，取交集避免计数错乱
              const checkedIds = pluginChecked.filter((id) => selectableIds.includes(id));
              const checkedPlugins = all.filter((plugin) => checkedIds.includes(String(plugin.id ?? "")));
              const batchTargets = {
                enable: checkedPlugins.filter((plugin) => plugin.enabled === false),
                disable: checkedPlugins.filter((plugin) => plugin.enabled !== false),
              };
              const togglePluginChecked = (id: string) => setPluginChecked((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
              return <section className="settings-section stack plugin-center">
                <div className="settings-copy channel-heading"><div><h2>插件</h2><p>上方卡片来自 Codex Plugin Marketplace（codex-marketplace.com），一键安装写入本地插件目录，无需 ChatGPT 登录；下方为已安装插件管理，停用后 Codex 不再加载该插件提供的指令、技能与钩子。</p></div><div className="settings-heading-actions"><button className="secondary-setting" title="打开 Codex Plugin Marketplace 在线市场" onClick={() => void window.codex.openExternal("https://www.codex-marketplace.com/plugins")}><ArrowUpRight size={14} />在线市场</button><button className="icon-button" title="刷新插件" onClick={() => void refreshSettingsResources()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

                <div className="plugin-market-block">
                  <div className="plugin-market-title">插件市场<small>来自 Codex Plugin Marketplace · 一键安装无需登录</small></div>
                  <div className="resource-toolbar">
                    <div className="skill-tabs">{pluginMarketCategoryTabs.map(([label, value]) => <button key={value} className={pluginMarketCategory === value ? "active" : ""} onClick={() => { setPluginMarketCategory(value); setPluginMarketPage(1); }}>{label}</button>)}</div>
                    <SearchField value={pluginMarketSearch} onChange={(next) => { setPluginMarketSearch(next); setPluginMarketPage(1); }} placeholder="搜索插件名称、简介或作者" />
                    <button className="icon-button" title="刷新插件市场" onClick={() => void refreshMarketPlugins(pluginMarketCategory, pluginMarketSearch, pluginMarketPage)}>{pluginMarketLoading ? <Spinner /> : <RefreshCw size={14} />}</button>
                  </div>
                  {pluginMarketItems.length > 0 ? <div className="skill-card-grid">
                    {pluginMarketItems.map((plugin) => {
                      const installedMarket = installedMarketPluginSlugs.has(plugin.slug);
                      const busy = installingMarketPlugin === plugin.slug;
                      return <article className={`skill-card ${installedMarket ? "installed" : ""}`} key={plugin.slug} onClick={() => setMarketPreview({
                        kind: "plugin",
                        title: plugin.displayName,
                        subtitle: `${zhCategory(plugin.category)} · codex-marketplace.com`,
                        icon: plugin.logo,
                        iconChar: plugin.displayName,
                        description: CODEX_MARKET_ZH[plugin.slug] ?? plugin.description,
                        meta: [zhCategory(plugin.category), ...(plugin.githubStars > 0 ? [`★ ${plugin.githubStars}`] : [])],
                        installed: Boolean(installedMarket),
                        installLabel: "一键安装",
                        onInstall: installedMarket ? undefined : () => void installMarketPlugin(plugin),
                        externalUrl: plugin.repository,
                        externalLabel: "查看来源",
                        note2: installedMarket ? undefined : "下载插件目录到本地并注册进引擎，无需 ChatGPT 登录",
                      })}>
                        <div className="skill-card-head">
                          <MarketLogo url={plugin.logo} label={plugin.displayName} size={30} />
                          <button className="skill-add" title={installedMarket ? "已安装" : "一键安装到本地插件目录"} disabled={Boolean(installingMarketPlugin) || installedMarket} onClick={(event) => { event.stopPropagation(); if (!installedMarket) void installMarketPlugin(plugin); }}>{installedMarket ? <Check size={14} /> : busy ? <Spinner /> : <Plus size={14} />}</button>
                        </div>
                        <strong title={plugin.displayName}>{plugin.displayName}</strong>
                        <p>{CODEX_MARKET_ZH[plugin.slug] ?? plugin.description}</p>
                        <footer><span>{zhCategory(plugin.category)}</span>{plugin.githubStars > 0 && <span title="GitHub Stars">★ {plugin.githubStars}</span>}<a href={plugin.repository} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(plugin.repository); }}>查看来源</a></footer>
                      </article>;
                    })}
                  </div> : <p className="muted">{pluginMarketLoading ? "正在加载插件市场…" : "没有匹配的插件，换个关键词试试。"}</p>}
                  <div className="skill-market-pagination"><span>共 {pluginMarketTotal} 个插件 · 第 {pluginMarketPage} / {Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} 页</span><div><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage <= 1} onClick={() => setPluginMarketPage((page) => Math.max(1, page - 1))}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={pluginMarketLoading || pluginMarketPage >= Math.max(1, Math.ceil(pluginMarketTotal / pluginMarketPageSize))} onClick={() => setPluginMarketPage((page) => page + 1)}>下一页<ArrowRight size={14} /></button></div></div>
                </div>

                <div className="plugin-stats">
                  <div className="plugin-stat"><span>市场插件</span><strong>{all.length}</strong></div>
                  <div className="plugin-stat"><span>已安装</span><strong>{installed.length}</strong></div>
                  <div className="plugin-stat"><span>启用中</span><strong className="stat-ok">{enabledCount}</strong></div>
                  <div className="plugin-stat"><span>已停用</span><strong className="stat-off">{disabledCount}</strong></div>
                </div>

                <div className="resource-toolbar">
                  <SegmentedTabs
                    value={pluginInstalledOnly ? "installed" : "all"}
                    onChange={(next) => setPluginInstalledOnly(next === "installed")}
                    options={[{ value: "all", label: "全部", count: all.length }, { value: "installed", label: "已安装", count: installed.length }]}
                  />
                  <SearchField value={pluginSearch} onChange={setPluginSearch} placeholder="搜索插件名称、描述或来源市场" />
                </div>
                <div className="resource-toolbar secondary">
                  <SelectAllToggle total={selectableIds.length} selected={checkedIds.length} unit="个插件" onSelectAll={() => setPluginChecked(selectableIds)} onClear={() => setPluginChecked([])} />
                  <BatchActions
                    hint={checkedIds.length ? `选中里：${batchTargets.disable.length} 个启用中 · ${batchTargets.enable.length} 个已停用` : "勾选插件后可批量启用或停用"}
                    actions={[
                      { label: batchTargets.enable.length ? `启用所选 (${batchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !batchTargets.enable.length, busy: pluginBatchBusy === "enable", onClick: () => void batchSetPluginEnabled(batchTargets.enable, true), title: batchTargets.enable.length ? `启用选中的 ${batchTargets.enable.length} 个已停用插件` : "没有勾选已停用的插件" },
                      { label: batchTargets.disable.length ? `停用所选 (${batchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !batchTargets.disable.length, busy: pluginBatchBusy === "disable", onClick: () => void batchSetPluginEnabled(batchTargets.disable, false), title: batchTargets.disable.length ? `停用选中的 ${batchTargets.disable.length} 个启用中插件` : "没有勾选启用中的插件" },
                    ]}
                  />
                </div>

                <div className="plugin-card-grid">
                  {visible.map((plugin: any) => {
                    const key = plugin.id ?? plugin.name ?? Math.random();
                    const busy = pluginBusy === String(plugin.id ?? plugin.name ?? key);
                    const isInstalled = Boolean(plugin.installed);
                    const isEnabled = isInstalled && plugin.enabled !== false;
                    const displayName = pluginDisplayName(plugin);
                    const initial = displayName.replace(/^@/, "").charAt(0).toUpperCase();
                    const capabilities: string[] = plugin.interface?.capabilities ?? [];
                    const checked = checkedIds.includes(String(plugin.id ?? ""));
                    return <article className={`plugin-card ${isInstalled ? "installed" : ""} ${isInstalled && !isEnabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`} key={key}>
                      <div className="plugin-card-head">
                        <CheckCard checked={checked} disabled={!isInstalled} label={`选择 ${displayName}`} title={!isInstalled ? "未安装的插件无法勾选" : checked ? `取消选择 ${displayName}` : `勾选 ${displayName}`} onChange={() => togglePluginChecked(String(plugin.id ?? ""))} />
                        <span className={`plugin-avatar tone-${avatarToneOf(displayName)}`}>{initial}</span>
                        <div className="plugin-card-title"><strong title={displayName}>{displayName}</strong><small>{plugin.marketplaceName ? `来自 ${plugin.marketplaceName}` : "本地市场"}{plugin.interface?.developerName ? ` · ${plugin.interface.developerName}` : ""}</small></div>
                        {!isInstalled && <span className="plugin-state off">未安装</span>}
                        <ToggleSwitch
                          checked={isEnabled}
                          disabled={!isInstalled || busy !== false}
                          label={`${displayName} 启用开关`}
                          title={!isInstalled ? "安装后才能启用" : isEnabled ? "停用插件" : "启用插件"}
                          onChange={(next) => void setPluginEnabled(plugin, next)}
                        />
                      </div>
                      <p className="plugin-desc">{pluginDescription(plugin)}</p>
                      {capabilities.length > 0 && <div className="plugin-tags">{capabilities.slice(0, 3).map((capability) => <span className="plugin-tag" key={capability}>{capability}</span>)}</div>}
                      <div className="plugin-card-foot">
                        <span className="plugin-source"><Store size={11} />{plugin.localVersion ? `v${plugin.localVersion}` : plugin.interface?.category ?? "plugin"}</span>
                        <button className={isInstalled ? "secondary-setting plugin-action danger" : "primary-setting plugin-action"} disabled={busy} onClick={() => void changePlugin(plugin)}>
                          {busy ? <Spinner /> : isInstalled ? <><Trash2 size={13} />卸载</> : <><Plus size={13} />安装</>}
                        </button>
                      </div>
                    </article>;
                  })}
                  {!visible.length && <div className="plugin-empty"><Store size={26} /><strong>{all.length ? "没有匹配的插件" : "还没有发现插件"}</strong><p>{all.length ? "换个关键词，或清除「已安装」筛选。" : "在 Codex 配置里添加 marketplace 后，插件会出现在这里。"}</p></div>}
                </div>
              </section>;
            })()}
            {settingsPage === "skills" && <section className="settings-section stack skill-center">
              <div className="settings-copy channel-heading"><div><h2>技能中心</h2><p>技能清单来自腾讯 SkillHub 市场（skillhub.cn），一键安装自动写入 <code>{userDataPath ? `${userDataPath}\\codex-home\\skills` : "Codex 技能目录"}</code>，更新来源清单并重启引擎确认可用。</p></div><div className="settings-heading-actions"><button className={skillsManageOnly ? "active-manage" : "secondary-setting"} onClick={() => setSkillsManageOnly(!skillsManageOnly)}><LayoutGrid size={14} />{skillsManageOnly ? "返回市场浏览" : `我的技能 ${installedTotalCount}`}</button><button className="secondary-setting" onClick={() => void importSkill()}><Paperclip size={14} />从本地添加技能</button><button className="secondary-setting" title="打开腾讯 SkillHub 技能市场" onClick={() => void window.codex.openExternal("https://skillhub.tencent.com/")}><ArrowUpRight size={14} />SkillHub 市场</button><button className="icon-button" title="刷新技能市场" onClick={() => void refreshMarketSkills(skillHubCategory, skillHubSearch, marketPage)}>{marketLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
              <div className="resource-toolbar">
                {!skillsManageOnly && <div className="skill-tabs">{skillHubCategories.map((category) => <button key={category} className={skillHubCategory === category ? "active" : ""} onClick={() => { setSkillHubCategory(category); setMarketPage(1); setSkillsManageOnly(false); }}>{category}</button>)}</div>}
                <SearchField
                  value={skillsManageOnly ? skillManageSearch : skillHubSearch}
                  onChange={(next) => { if (skillsManageOnly) setSkillManageSearch(next); else { setSkillHubSearch(next); setMarketPage(1); } }}
                  placeholder={skillsManageOnly ? "搜索已安装技能的名称或描述" : "搜索 SkillHub 技能"}
                />
              </div>
              {!skillsManageOnly && <div className="resource-toolbar secondary skill-filter-row">
                <div className="skill-tabs">{skillHubCategoryTabs.map(([label, value]) => <button key={label} className={skillHubFilterCategory === value ? "active" : ""} onClick={() => { setSkillHubFilterCategory(value); setMarketPage(1); }}>{label}</button>)}</div>
                {marketSkills.length > 0 && <span className="skill-filter-count">当前榜单 {marketSkills.length} 个技能 · 分类 <b>{skillHubFilterCategory ? skillHubCategoryName(skillHubFilterCategory) : "全部"}</b></span>}
              </div>}
              {skillsManageOnly ? (() => {
                // 技能规范化名：剥掉插件限定前缀（引擎对插件技能返回 `ponytail:ponytail-audit`，
                // 本地目录同名技能是 `ponytail-audit`）——不归一化会让同一个技能重复出现在两组。
                const normSkillName = (name: string) => { const n = String(name ?? "").toLowerCase(); const i = n.lastIndexOf(":"); return i >= 0 ? n.slice(i + 1) : n; };
                // 同技能装两遍（市场一次 + 本地导入一次）会产生两个目录、同名 → 只保留市场来源那条，
                // 避免同一技能同时出现在「市场安装」与「本地导入」两张卡。
                const dedupedLocal = (() => {
                  const byName = new Map<string, LocalSkillEntry>();
                  for (const entry of localSkills) {
                    const key = normSkillName(entry.name);
                    const existing = byName.get(key);
                    const isMarket = entry.source === "cocoloop" || entry.source === "skillhub";
                    if (!existing) { byName.set(key, entry); continue; }
                    const existingIsMarket = existing.source === "cocoloop" || existing.source === "skillhub";
                    if (isMarket && !existingIsMarket) byName.set(key, entry);
                  }
                  return [...byName.values()];
                })();
                const localNames = new Set(dedupedLocal.map((entry) => normSkillName(entry.name)));
                const localByPath = new Set(dedupedLocal.map((entry) => entry.path));
                const builtinSkills = settingsResources.skills.filter((entry: any) => !localByPath.has(entry.path) && !localNames.has(normSkillName(entry.name ?? "")));
                const keyword = skillManageSearch.trim().toLowerCase();
                const match = (skill: { name: string; description: string }) => !keyword || `${skill.name} ${skill.description}`.toLowerCase().includes(keyword);
                const marketInstalled = dedupedLocal.filter((entry) => (entry.source === "cocoloop" || entry.source === "skillhub") && match(entry));
                const localInstalled = dedupedLocal.filter((entry) => entry.source !== "cocoloop" && entry.source !== "skillhub" && match(entry));
                const shownBuiltin = builtinSkills.filter((skill: any) => match({ name: skill.name, description: skill.description ?? "" }));
                // 批量只处理本机可移除的技能，内置技能由引擎提供、不支持停用
                const manageable = [...marketInstalled, ...localInstalled];
                const selectableFolders = manageable.map((skill) => skill.folder ?? skill.name);
                // 筛选变化后取交集，避免已不可见的勾选项仍计入
                const checkedFolders = skillChecked.filter((folder) => selectableFolders.includes(folder));
                const checkedSkills = manageable.filter((skill) => checkedFolders.includes(skill.folder ?? skill.name));
                const offList = checkedSkills.filter((skill) => skill.enabled === false).map((skill) => skill.folder ?? skill.name);
                const onList = checkedSkills.filter((skill) => skill.enabled !== false).map((skill) => skill.folder ?? skill.name);
                const toggleSkillChecked = (folder: string) => setSkillChecked((current) => current.includes(folder) ? current.filter((entry) => entry !== folder) : [...current, folder]);
                const renderCard = (skill: { name: string; description: string; descriptionZh?: string; path?: string; source?: "cocoloop" | "skillhub" | "local"; folder?: string; enabled?: boolean; allowedTools?: string[]; category?: string; icon?: string }, sourceTag: "builtin" | "market" | "local") => {
                  const removable = sourceTag !== "builtin";
                  const folder = removable ? skill.folder ?? skill.name : null;
                  const sourceLabel = sourceTag === "builtin" ? "内置" : sourceTag === "market" ? "市场安装" : "本地导入";
                  const enabled = skill.enabled !== false;
                  const skillKey = folder ?? skill.name;
                  const checked = removable && checkedFolders.includes(skillKey);
                  const allowedTools = (skill.allowedTools ?? []).filter(Boolean);
                  // 卡片描述：中文注释优先（注释表 / 安装时存下的市场中文简介），没有中文才退回原文
                  const zhNote = skillZhNote(skill);
                  const cardDescription = zhNote !== "已安装技能" ? zhNote : (skill.description || "已发现技能");
                  return <article className={`skill-card-compact source-${sourceTag} ${removable && !enabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`} key={`${sourceTag}-${skill.name}`}>
                    <div className="skill-card-compact-head">
                      <div className="skill-card-head-left">
                        <CheckCard checked={checked} disabled={!removable} label={`选择 ${skill.name}`} title={!removable ? "内置技能不可勾选" : checked ? `取消选择 ${skill.name}` : `勾选 ${skill.name}`} onChange={() => toggleSkillChecked(skillKey)} />
                        <SkillAvatar skill={skill} size={14} />
                        <span className={`skill-source-tag tag-${sourceTag}`}>{sourceLabel}</span>
                      </div>
                      <ToggleSwitch
                        checked={enabled}
                        disabled={!removable}
                        label={`${skill.name} 启用开关`}
                        title={!removable ? "内置技能由 Codex 引擎提供，不能停用" : enabled ? "停用技能（引擎将不再发现它）" : "启用技能"}
                        onChange={() => void toggleSkillEnabled({ ...(skill as LocalSkillEntry), name: skill.name, folder: folder ?? skill.name, enabled })}
                      />
                    </div>
                    <strong>{skill.name}{removable && !enabled && <em className="skill-disabled-label">已停用</em>}</strong>
                    <p>{cardDescription}</p>
                    {allowedTools.length ? <div className="skill-card-allowed-tools" title="SKILL.md 声明的工具白名单（allowed-tools，展示用）">{allowedTools.slice(0, 5).map((tool) => <code key={tool}>{tool}</code>)}{allowedTools.length > 5 ? <code className="skill-card-tools-more">+{allowedTools.length - 5}</code> : null}</div> : null}
                    <div className="skill-card-compact-foot">
                      {skill.path && <span className="skill-card-path" title={skill.path}>{skill.path.replace(/^.*[\\/]/, "")}</span>}
                      <div className="skill-card-compact-tools">
                        <button className="icon-button" title="引用到对话" onClick={() => { setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, { name: skill.name, description: skill.description }]); setSettingsOpen(false); }}><Quote size={13} /></button>
                        {removable && folder && <button className="icon-button" title="卸载技能" onClick={() => void removeLocalSkill({ folder, name: skill.name, description: skill.description })}><Trash2 size={13} /></button>}
                      </div>
                    </div>
                  </article>;
                };
                return <div className="skill-installed-view">
                  <div className="resource-toolbar secondary">
                    <SelectAllToggle total={selectableFolders.length} selected={checkedFolders.length} unit="个技能" onSelectAll={() => setSkillChecked(selectableFolders)} onClear={() => setSkillChecked([])} />
                    <div className="skill-installed-summary">共 {installedTotalCount} 项 · 内置 {builtinSkills.length} · 市场 {localSkills.filter((entry) => entry.source === "cocoloop" || entry.source === "skillhub").length} · 本地 {localSkills.filter((entry) => entry.source !== "cocoloop" && entry.source !== "skillhub").length} · 停用 {localSkills.filter((entry) => entry.enabled === false).length}</div>
                    <BatchActions
                      hint={checkedFolders.length ? `选中里：${onList.length} 个启用中 · ${offList.length} 个已停用` : "勾选技能后可批量启用或停用"}
                      actions={[
                        { label: offList.length ? `启用所选 (${offList.length})` : "启用所选", icon: <Play size={13} />, disabled: !offList.length, busy: skillBatchBusy === "enable", onClick: () => void batchSetSkillEnabled(offList, true), title: offList.length ? `启用选中的 ${offList.length} 个已停用技能` : "没有勾选已停用的技能" },
                        { label: onList.length ? `停用所选 (${onList.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !onList.length, busy: skillBatchBusy === "disable", onClick: () => void batchSetSkillEnabled(onList, false), title: onList.length ? `停用选中的 ${onList.length} 个启用中技能` : "没有勾选启用中的技能" },
                      ]}
                    />
                  </div>
                  {shownBuiltin.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-builtin" />Codex 内置技能<small>由 Codex app-server 自带，不支持停用</small></header><div className="skill-card-grid compact">{shownBuiltin.map((skill: any) => renderCard({ name: skill.name, description: skill.description ?? "由 Codex 引擎内置提供", path: skill.path }, "builtin"))}</div></section>}
                  {marketInstalled.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-market" />市场安装<small>从 SkillHub / CocoLoop 市场一键安装到 Codex 技能目录</small></header><div className="skill-card-grid compact">{marketInstalled.map((skill) => renderCard(skill, "market"))}</div></section>}
                  {localInstalled.length > 0 && <section className="skill-installed-group"><header><span className="skill-group-dot tag-local" />本地导入<small>通过 SKILL.md 添加到本机，不会随 Codex 更新被覆盖</small></header><div className="skill-card-grid compact">{localInstalled.map((skill) => renderCard(skill, "local"))}</div></section>}
                  {!shownBuiltin.length && !marketInstalled.length && !localInstalled.length && <p className="muted">{keyword ? "没有匹配的已安装技能，换个关键词试试。" : "还没有已安装技能。可通过“市场浏览”安装，或“从本地添加技能”导入 SKILL.md。"}</p>}
                </div>;
              })() : <div className="skill-card-grid">{marketSkills.slice((marketPage - 1) * marketPageSize, marketPage * marketPageSize).filter((skill) => (!skillHubFilterCategory || skill.category === skillHubFilterCategory) && (!skillHubSearch || `${skill.name} ${skill.description}`.toLowerCase().includes(skillHubSearch.toLowerCase()))).map((skill) => { const installed = localSkills.some((entry) => entry.marketId === skill.id); return <article className={`skill-card ${installed ? "installed" : ""}`} key={skill.name} onClick={() => setMarketPreview({
                        kind: "skill",
                        title: skill.name,
                        subtitle: `${skillHubCategoryName(skill.category)}${skill.subCategory ? ` · ${skill.subCategory}` : ""} · SkillHub 技能市场`,
                        icon: skill.icon,
                        iconChar: skill.name,
                        description: skill.description,
                        meta: [skillHubCategoryName(skill.category), ...(skill.subCategory ? [skill.subCategory] : [])],
                        installed,
                        installLabel: installed ? "在对话中使用" : "一键安装",
                        onInstall: () => { if (installed) { setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, skill]); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); } else void installMarketSkill(skill); },
                        externalUrl: "https://skillhub.tencent.com/",
                        externalLabel: "SkillHub 查看",
                        note2: installed ? undefined : "安装到 Codex 技能目录，对话中可直接引用",
                      })}><div className="skill-card-head"><SkillAvatar skill={skill} /><button className="skill-add" title={installed ? "在对话中使用已安装技能" : "一键安装到 Codex 技能目录"} disabled={Boolean(installingMarketSkill)} onClick={(event) => { event.stopPropagation(); if (installed) { setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, skill]); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); } else void installMarketSkill(skill); }}>{installed ? <Check size={14} /> : <Plus size={14} />}</button></div><strong>{skill.name}</strong><p>{skill.description}</p><footer><span title={skill.category}>{skillHubCategoryName(skill.category)}{skill.subCategory ? ` · ${skill.subCategory}` : ""}</span><a href="https://skillhub.tencent.com/" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void window.codex.openExternal("https://skillhub.tencent.com/"); }}>SkillHub 查看</a></footer></article>; })}</div>}
            </section>}
            {settingsPage === "skills" && !skillsManageOnly && <div className="skill-market-pagination"><span>共 {marketTotal} 个技能 · 第 {marketPage} / {Math.max(1, Math.ceil(marketTotal / marketPageSize))} 页</span><div><button className="secondary-setting" disabled={marketLoading || marketPage <= 1} onClick={() => setMarketPage((page) => Math.max(1, page - 1))}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={marketLoading || marketPage >= Math.max(1, Math.ceil(marketTotal / marketPageSize))} onClick={() => setMarketPage((page) => page + 1)}>下一页<ArrowRight size={14} /></button></div></div>}
            {settingsPage === "commands" && (() => {
              // 技能命令：已启用技能即 WorkBuddy 语义里的 slash-command 包
              const skillCommands = settingsResources.skills.filter((skill: any) => skill.enabled !== false);
              const customVisible = customCommands.filter((entry) => !commandSearch || `${entry.name} ${entry.description} ${entry.argumentHint}`.toLowerCase().includes(commandSearch.toLowerCase()));
              const builtinVisible = builtinCommandCatalog.filter((cmd) => !commandSearch || `${cmd.name} ${cmd.description} ${cmd.hint ?? ""}`.toLowerCase().includes(commandSearch.toLowerCase()));
              const skillVisible = skillCommands.filter((skill: any) => !commandSearch || `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(commandSearch.toLowerCase()));
              const builtinCategories = ["会话管理", "上下文与状态", "模型与权限", "审查与代码", "信息查询", "运行控制"];
              const totalCount = builtinCommandCatalog.length + customCommands.length + skillCommands.length;
              const filterTabs: { key: "all" | "custom" | "builtin" | "skill"; label: string; count: number }[] = [
                { key: "all", label: "全部", count: totalCount },
                { key: "custom", label: "自定义", count: customCommands.length },
                { key: "builtin", label: "内置", count: builtinCommandCatalog.length },
                { key: "skill", label: "技能", count: skillCommands.length },
              ];
              const showAll = commandFilter === "all";
              const copyCommand = async (text: string) => {
                try { await navigator.clipboard.writeText(text); setNotice(`已复制 ${text}`); } catch { setNotice("复制失败"); }
              };
              const openNewCommand = () => setCommandEditor({ mode: "new", name: "", source: workspace ? "project" : "global", description: "", argumentHint: "", allowedTools: "", model: "", body: "" });
              const openEditCommand = (entry: CustomCommandEntry) => setCommandEditor({ mode: "edit", name: entry.name, source: entry.source, description: entry.description, argumentHint: entry.argumentHint, allowedTools: entry.allowedTools, model: entry.model, body: entry.body, prevFilePath: entry.filePath });
              return <section className="settings-section stack command-center">
                <div className="settings-copy channel-heading"><div><h2>命令</h2><p>复用常用操作与自定义工作流。输入框输入 <code>/</code> 会弹出命令补全，点击下方命令可直接填入；自定义命令以 <code>commands/*.md</code> 保存，支持参数与文件引用。</p></div><div className="settings-heading-actions"><button className="secondary-setting" onClick={openNewCommand}><Plus size={14} />新建命令</button><button className="icon-button" title="刷新命令" onClick={() => void refreshCommands()}>{commandBusy ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
                <div className="command-toolbar">
                  <label className="skill-search command-search"><Search size={14} /><input value={commandSearch} onChange={(event) => setCommandSearch(event.target.value)} placeholder="搜索命令名称或描述…" /></label>
                  <div className="command-stats"><span>内置 <b>{builtinCommandCatalog.length}</b></span><span>自定义 <b>{customCommands.length}</b></span><span>技能 <b>{skillCommands.length}</b></span></div>
                </div>
                <div className="skill-tabs command-tabs">{filterTabs.map((tab) => <button key={tab.key} className={commandFilter === tab.key ? "active" : ""} onClick={() => setCommandFilter(tab.key)}>{tab.label} <small>{tab.count}</small></button>)}</div>
                {commandFilter === "all" || commandFilter === "custom" ? (customVisible.length ? <section className="command-group"><header><span className="command-group-dot custom" />自定义命令<small>{customVisible.length} 个 · 个人全局与项目级 .md 模板</small></header><div className="command-grid">{customVisible.map((entry) => (
                  <article className={`command-card custom`} key={entry.filePath}>
                    <div className="command-card-top"><code className="command-slash">/{entry.name}</code><span className={`command-source-tag ${entry.source}`}>{entry.source === "global" ? "个人全局" : "项目级"}</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${entry.name}`)}><Copy size={12} /></button><button className="icon-button" title="编辑" onClick={() => openEditCommand(entry)}><PenLine size={12} /></button><button className="icon-button danger" title="删除" onClick={() => setCommandDelete(entry)}><Trash2 size={12} /></button></div></div>
                    <p className="command-desc">{entry.description || "（无描述）"}</p>
                    <div className="command-chips">{entry.argumentHint ? <span className="command-chip hint"><Type size={11} />{entry.argumentHint}</span> : null}{entry.allowedTools ? <span className="command-chip tools" title={entry.allowedTools}><Shield size={11} />{entry.allowedTools}</span> : null}{entry.model ? <span className="command-chip model"><Bot size={11} />{entry.model}</span> : null}</div>
                    <button className="command-use" onClick={() => useCommand(entry.name, "custom")}><Play size={12} />使用</button>
                  </article>
                ))}</div></section> : <p className="muted command-empty">{commandSearch ? "没有匹配的自定义命令，换个关键词试试。" : "还没有自定义命令。点击「新建命令」创建你的第一个工作流，例如 /git:commit、/review-pr。"}</p>) : null}
                {showAll || commandFilter === "builtin" ? builtinVisible.length ? builtinCategories.map((category) => {
                  const categoryCommands = builtinVisible.filter((cmd) => cmd.category === category);
                  if (!categoryCommands.length) return null;
                  return <section className="command-group" key={category}><header><span className="command-group-dot builtin" />{category}<small>{categoryCommands.length} 个内置命令</small></header><div className="command-grid">{categoryCommands.map((cmd) => (
                    <article className="command-card builtin" key={cmd.name}>
                      <div className="command-card-top"><code className="command-slash">/{cmd.name}</code><span className="command-source-tag builtin">内置</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${cmd.name}`)}><Copy size={12} /></button></div></div>
                      <p className="command-desc">{cmd.description}</p>
                      {cmd.hint ? <div className="command-chips"><span className="command-chip hint"><Type size={11} />{cmd.hint}</span></div> : null}
                      <button className="command-use" onClick={() => useCommand(cmd.name, "builtin")}><Play size={12} />使用</button>
                    </article>
                  ))}</div></section>;
                }) : <p className="muted command-empty">{commandSearch ? "没有匹配的内置命令，换个关键词试试。" : "内置命令为空。"} </p> : null}
                {showAll || commandFilter === "skill" ? skillVisible.length ? <section className="command-group"><header><span className="command-group-dot skill" />技能命令<small>{skillVisible.length} 个已启用技能 · 技能即 WorkBuddy 语义下的 slash-command 包</small></header><div className="command-grid">{skillVisible.map((skill: any) => (
                  <article className="command-card skill" key={skill.name}>
                    <div className="command-card-top"><code className="command-slash">/{skill.name}</code><span className="command-source-tag skill">技能</span><div className="command-card-actions"><button className="icon-button" title="复制命令" onClick={() => void copyCommand(`/${skill.name}`)}><Copy size={12} /></button></div></div>
                    <p className="command-desc">{skill.description || "已启用的技能命令"}</p>
                    <button className="command-use" onClick={() => useCommand(skill.name, "skill", skill)}><Quote size={12} />引用技能</button>
                  </article>
                ))}</div></section> : <p className="muted command-empty">{commandSearch ? "没有匹配的技能命令。" : "还没有可用的技能命令。到「技能」页安装或启用技能后，这里会列出它们的斜杠命令。"}</p> : null}
                {commandEditor && <CommandEditorModal draft={commandEditor} saving={commandBusyKey === "save"} onChange={setCommandEditor} onClose={() => setCommandEditor(null)} onSave={() => void persistCommand()} />}
                {commandDelete && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandDelete(null); }}><section className="connector-setup-modal command-delete-modal" role="dialog" aria-modal="true" aria-label="删除命令"><header><div className="connector-setup-title"><span><AlertTriangle size={17} /></span><div><strong>删除命令 /{commandDelete.name}</strong><p>将删除文件 <code>{commandDelete.filePath}</code>，删除后无法恢复。</p></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setCommandDelete(null)}><X size={16} /></button></header><footer><button className="secondary-setting" onClick={() => setCommandDelete(null)}>取消</button><button className="danger-button" disabled={commandBusyKey === "delete"} onClick={() => void confirmDeleteCommand()}>{commandBusyKey === "delete" ? <Spinner /> : <Trash2 size={14} />}确认删除</button></footer></section></div>, document.body)}
              </section>;
            })()}
            {settingsPage === "hooks" && (() => {
              const hooks = settingsResources.hooks as any[];
              const untrusted = hooks.filter((hook: any) => hook.trustStatus && hook.trustStatus !== "trusted");
              const enabledCount = hooks.filter((hook: any) => hook.enabled !== false).length;
              // 按来源分组：插件钩子归到插件名下（便于联动），其余算自定义钩子
              const groups: { id: string; label: string; pluginId?: string; hooks: any[]; skillCount: number; pluginEnabled?: boolean }[] = [];
              const byPlugin = new Map<string, any[]>();
              const userHooks: any[] = [];
              for (const hook of hooks) {
                const pid = hook.pluginId ? String(hook.pluginId) : "";
                if (pid) {
                  if (!byPlugin.has(pid)) byPlugin.set(pid, []);
                  byPlugin.get(pid)!.push(hook);
                } else userHooks.push(hook);
              }
              // 分组必须以「已安装的插件」为准，不能只靠 hooks/list：
              // 插件一旦停用，它提供的钩子会整组从 hooks/list 里消失，
              // 只按钩子建组的话分组会一起消失，用户就再也找不到开关把插件开回来了。
              const installedPlugins = (settingsResources.plugins as any[]).filter((plugin) => plugin.installed);
              const seenPlugins = new Set<string>();
              for (const plugin of installedPlugins) {
                const pluginId = String(plugin.id ?? "");
                if (!pluginId) continue;
                seenPlugins.add(pluginId);
                groups.push({
                  id: pluginId,
                  label: pluginDisplayName(plugin),
                  pluginId,
                  hooks: byPlugin.get(pluginId) ?? [],
                  skillCount: localSkills.filter((entry) => entry.pluginId === pluginId).length,
                  pluginEnabled: plugin.enabled !== false,
                });
              }
              // 插件已卸载、但钩子还残留在配置里的情况也要给个出口
              for (const [pluginId, list] of byPlugin) {
                if (seenPlugins.has(pluginId)) continue;
                groups.push({ id: pluginId, label: pluginId, pluginId, hooks: list, skillCount: localSkills.filter((entry) => entry.pluginId === pluginId).length, pluginEnabled: true });
              }
              if (userHooks.length) groups.push({ id: "user", label: "自定义钩子", hooks: userHooks, skillCount: 0 });
              // 插件组的开关状态由插件本身决定（钩子列表可能为空），自定义组则由钩子决定
              const groupEnabled = (group: typeof groups[number]) => group.pluginId ? group.pluginEnabled !== false : group.hooks.some((hook: any) => hook.enabled !== false);
              return <section className="settings-section stack hook-center">
                <div className="settings-copy channel-heading"><div><h2>钩子</h2><p>钩子的启停会<b>联动所属插件与它提供的技能</b>。另外 Codex <b>不会执行未信任的钩子</b>——新装后必须点一次「信任」，否则装了等于没装。</p></div><div className="settings-heading-actions">{untrusted.length > 0 && <button className="primary-setting" disabled={hookTrusting} onClick={() => void trustAllHooks()}>{hookTrusting ? <Spinner /> : <ShieldCheck size={14} />}信任全部 {untrusted.length}</button>}<button className="icon-button" title="刷新钩子" onClick={() => void refreshSettingsResources()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

                <div className="hook-stats">
                  <div className="hook-stat"><span>钩子总数</span><strong>{hooks.length}</strong></div>
                  <div className="hook-stat"><span>启用中</span><strong className="stat-ok">{enabledCount}</strong></div>
                  <div className="hook-stat"><span>已停用</span><strong className="stat-off">{hooks.length - enabledCount}</strong></div>
                  <div className="hook-stat"><span>未信任</span><strong className={untrusted.length ? "stat-warn" : "stat-ok"}>{untrusted.length}</strong></div>
                  <div className="hook-stat"><span>来源</span><strong>{groups.length}</strong></div>
                </div>

                {groups.map((group) => {
                  const groupOn = groupEnabled(group);
                  const groupBusy = group.pluginId ? linkedBusy === group.pluginId : false;
                  return <section className={`hook-group ${groupOn ? "" : "is-off"}`} key={group.id}>
                    <header className="hook-group-head">
                      <div className="hook-group-title">
                        <strong>{group.label}</strong>
                        <span className="hook-group-meta">
                          {group.hooks.length} 个钩子
                          {group.skillCount > 0 && <> · {group.skillCount} 个技能</>}
                          {group.pluginId && <> · <code>{group.id}</code></>}
                        </span>
                      </div>
                      {group.pluginId ? <ToggleSwitch
                        checked={groupOn}
                        disabled={groupBusy}
                        label={`${group.label} 联动开关`}
                        title={groupOn ? `停用「${group.label}」：插件、${group.hooks.length} 个钩子与 ${group.skillCount} 个技能一起停用` : `启用「${group.label}」：插件、${group.hooks.length} 个钩子与 ${group.skillCount} 个技能一起启用`}
                        onChange={(next) => void setLinkedEnabled(group.id, next, group.label)}
                      /> : <span className="hook-group-tag">用户自定义</span>}
                    </header>
                    <div className="hook-list">
                  {group.hooks.map((hook: any, index: number) => {
                    const trusted = hook.trustStatus === "trusted";
                    const on = hook.enabled !== false;
                    const key = hook.key ?? index;
                    const busy = hookBusy === String(hook.key ?? "");
                    return <article className={`hook-card ${trusted ? "trusted" : "untrusted"} ${on ? "" : "is-disabled"}`} key={key}>
                      <div className="hook-card-head">
                        <span className="hook-event">{hook.eventName ?? hook.event ?? "hook"}</span>
                        <span className={`hook-trust ${trusted ? "on" : "off"}`}>{hook.trustStatus ?? "unknown"}</span>
                        <ToggleSwitch
                          checked={on}
                          disabled={busy}
                          label={`${hook.eventName ?? "钩子"} 启用开关`}
                          title={on ? "停用这条钩子" : "启用这条钩子"}
                          onChange={(next) => void setHookEnabled(hook, next)}
                        />
                      </div>
                      <code className="hook-command" title={hook.command}>{hook.command ?? hook.scriptPath ?? "—"}</code>
                      <div className="hook-card-foot">
                        <span className="hook-source" title={hook.sourcePath}>{hook.matcher ? <>匹配 <code>{hook.matcher}</code> · </> : null}{hook.timeoutSec ? <>{hook.timeoutSec}s · </> : null}{hook.sourcePath ? String(hook.sourcePath).replace(/^.*[\\/]/, "") : (hook.source ?? "user")}</span>
                        {!trusted && <button className="secondary-setting hook-trust-button" disabled={hookTrusting} onClick={() => void trustAllHooks()}><ShieldCheck size={12} />信任</button>}
                      </div>
                    </article>;
                  })}
                      {!group.hooks.length && <p className="hook-group-empty">{group.pluginId ? (groupOn ? "这个插件没有提供钩子。" : "插件已停用，它的钩子没有加载。打开上方开关即可恢复。") : "没有钩子。"}</p>}
                    </div>
                  </section>;
                })}
                {!hooks.length && <div className="hook-empty"><Wrench size={26} /><strong>还没有注册钩子</strong><p>钩子来自 <code>$CODEX_HOME/hooks.json</code> 或已安装的插件（例如 ponytail）。</p></div>}
              </section>;
            })()}
            {settingsPage === "agents" && <section className="settings-section stack subagent-center">
              <div className="settings-copy channel-heading"><div><h2>子智能体</h2><p>用户自定义角色；Codex 可以通过 <code>subagent_invoke</code> 真正调用它们完成子任务。</p></div><div className="settings-heading-actions"><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />新建子智能体</button><button className="icon-button" title="刷新子智能体" onClick={() => void refreshSubAgents()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

              <div className="subagent-banner"><Sparkles size={16} /><div><strong>让 Codex 真正会叫子智能体干活</strong><p>每个子智能体保存后，会被注册为 <code>subagent_invoke(name, query)</code> 函数；Codex 在主对话中可以直接调用，返回结构化结果。</p></div></div>

              <div className="subagent-grid">{subAgents.map((agent) => <article className={`subagent-card ${agent.enabled ? "enabled" : "disabled"}`} key={agent.id}>
                <div className="subagent-card-head"><span className="subagent-avatar"><Bot size={16} /></span><label className="channel-enable" title={agent.enabled ? "停用" : "启用"}><input type="checkbox" checked={agent.enabled} onChange={() => void toggleSubAgentEnabled(agent)} /><span>{agent.enabled ? "已启用" : "已停用"}</span></label></div>
                <strong className="subagent-name">{agent.name}</strong>
                <p className="subagent-desc">{agent.description || "暂无描述"}</p>
                <div className="subagent-meta">
                  <span title="推理强度"><Sparkles size={11} />{effortLabels[agent.effort] ?? agent.effort}</span>
                  <span title="模型"><Code2 size={11} />{agent.inheritModel ? "跟随主对话" : (agent.model || "未指定")}</span>
                  <span title="沙箱"><ShieldCheck size={11} />{agent.inheritSandbox ? "跟随主对话" : (agent.sandbox ?? "未指定")}</span>
                </div>
                <div className="subagent-meta">
                  <span title="审批策略"><Check size={11} />{agent.inheritApproval ? "跟随主对话" : (agent.approvalPolicy ?? "未指定")}</span>
                  <span title="工具名"><Bot size={11} />subagent_invoke</span>
                </div>
                <div className="subagent-card-actions"><button className="secondary-setting" onClick={() => openEditSubAgent(agent)}><PenLine size={12} />编辑</button><button className="icon-button" title="删除" onClick={() => void deleteSubAgent(agent.id)}><Trash2 size={13} /></button></div>
              </article>)}{!subAgents.length && <div className="subagent-empty"><Bot size={28} /><strong>还没有子智能体</strong><p>点击「新建子智能体」即可创建；它会跟随当前会话配置（模型、推理强度、沙箱、审批），并被 Codex 通过 dynamicTools 调用。</p><button className="primary-setting" onClick={openNewSubAgent}><Plus size={14} />创建第一个子智能体</button></div>}</div>

              {subAgentEditorOpen && subAgentDraft && <SubAgentEditorModal draft={subAgentDraft} onChange={setSubAgentDraft} onClose={() => { setSubAgentEditorOpen(false); setSubAgentDraft(null); }} onSave={(draft) => void saveSubAgent(draft)} />}
            </section>}
            {settingsPage === "teams" && <section className="settings-section stack expert-team-center">
              <div className="settings-copy channel-heading"><div><h2>专家团</h2><p>复刻 WorkBuddy 团队协作：主理人编排，成员按 SOP 分阶段独立产出，最终汇总交付。</p></div><div className="settings-heading-actions"><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />新建专家团</button><button className="secondary-setting" onClick={() => void resetExpertTeams()}><RotateCcw size={13} />恢复内置</button><button className="icon-button" title="刷新专家团" onClick={() => void refreshExpertTeams()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>

              <div className="subagent-banner"><Users size={16} /><div><strong>让 Codex 真正会带团队协作</strong><p>发起会话后，主理人（lead）会在独立会话中通过 <code>team_member_invoke(memberId, query)</code> 按 SOP 调度成员，成员独立产出后回传，主理人最终汇总交付。</p></div></div>

              <div className="expert-team-grid-list">{expertTeams.map((team) => <article className={`subagent-card ${team.enabled ? "enabled" : "disabled"}`} key={team.teamId}>
                <div className="subagent-card-head"><span className="subagent-avatar"><Users size={16} /></span><label className="channel-enable" title={team.enabled ? "停用" : "启用"}><input type="checkbox" checked={team.enabled} onChange={() => void toggleExpertTeamEnabled(team)} /><span>{team.enabled ? "已启用" : "已停用"}</span></label></div>
                <strong className="subagent-name">{team.profession.zh || team.displayName.zh}</strong>
                <p className="subagent-desc">{team.description.zh || "暂无描述"}</p>
                <div className="subagent-meta">
                  <span title="行业分类"><Briefcase size={11} />{categoryLabel(team.category)}</span>
                  <span title="成员数"><Users size={11} />主理人 + {team.members.length} 成员</span>
                  {team.tags.slice(0, 3).map((tag, index) => <span className="expert-team-tag" key={index} title="标签"><Tag size={11} />{tag.zh}</span>)}
                </div>
                <div className="subagent-meta"><span title="SOP"><Workflow size={11} />{team.sop ? "已配置 SOP" : "未配置 SOP"}</span></div>
                <div className="expert-team-member-chips" title="点击角色可进入单独会话">
                  {[team.lead, ...team.members].map((member) => (
                    <button key={member.id} className={`expert-team-member-chip${member.id === team.lead.id ? " is-lead" : ""}${expertTeamMemberRunning?.teamId === team.teamId && expertTeamMemberRunning.memberName === member.id ? " is-working" : ""}`}
                      title={`${expertRoleLabel(member, member.id === team.lead.id)}${member.description ? `：${member.description}` : ""}`}
                      disabled={expertTeamMemberDirect === `${team.teamId}:${member.id}`}
                      onClick={() => void startMemberDirectSession(team, member)}>
                      <span className="expert-team-member-chip-avatar" aria-hidden="true" style={member.id === team.lead.id ? undefined : { background: AVATAR_GRADIENTS[avatarToneOf(member.id || member.name)] }}>{expertRoleLabel(member, member.id === team.lead.id).slice(0, 1)}</span>
                      <span className="expert-team-member-chip-name">{expertRoleLabel(member, member.id === team.lead.id)}</span>
                      {expertTeamMemberDirect === `${team.teamId}:${member.id}` ? <Spinner /> : null}
                      {expertTeamMemberRunning?.teamId === team.teamId && expertTeamMemberRunning.memberName === member.id ? <span className="expert-member-working-dot" title="该成员正在执行子任务" /> : null}
                    </button>
                  ))}
                </div>
                <div className="expert-team-cwd" title={teamCwdMap[team.teamId] ?? workspace ?? "未选择项目"}>
                  <FolderOpen size={12} />
                  <span className="expert-team-cwd-path">{teamCwdMap[team.teamId] ?? workspace ?? "选择项目地址"}</span>
                  <button className="expert-team-cwd-pick" title="选择该项目专家团的工作目录" onClick={() => void chooseTeamCwd(team.teamId)}><FolderOpen size={11} />{teamCwdMap[team.teamId] ? "更换" : "选择项目"}</button>
                  {teamCwdMap[team.teamId] && <button className="icon-button expert-team-cwd-clear" title="清除，回退到全局工作区" onClick={() => clearTeamCwd(team.teamId)}><X size={11} /></button>}
                </div>
                <div className="expert-team-quickprompts">{team.quickPrompts.slice(0, 3).map((prompt, index) => <button key={index} className="expert-team-quick" title={prompt.zh} onClick={() => void startTeamSession(team, prompt.zh)}><MessageSquarePlus size={11} />{prompt.zh}</button>)}</div>
                <div className="subagent-card-actions">
                  <button className="primary-setting" disabled={expertTeamRunning === team.teamId} onClick={() => void startTeamSession(team, "")}><Rocket size={13} />{expertTeamRunning === team.teamId ? "创建中…" : "发起会话"}</button>
                  <button className="secondary-setting" onClick={() => openEditExpertTeam(team)}><PenLine size={12} />编辑</button>
                  <button className="icon-button" title="删除" onClick={() => void deleteExpertTeam(team.teamId)}><Trash2 size={13} /></button>
                </div>
              </article>)}{!expertTeams.length && <div className="subagent-empty"><Users size={28} /><strong>还没有专家团</strong><p>点击「新建专家团」创建，或「恢复内置」加载软件开发/交易分析示例团；发起会话后主理人会按 SOP 调度成员协作。</p><button className="primary-setting" onClick={openNewExpertTeam}><Plus size={14} />创建第一个专家团</button></div>}</div>

              {expertTeamEditorOpen && expertTeamDraft && <ExpertTeamEditorModal draft={expertTeamDraft} onChange={setExpertTeamDraft} onClose={() => { setExpertTeamEditorOpen(false); setExpertTeamDraft(null); }} onSave={(draft) => void saveExpertTeam(draft)} />}
            </section>}
            {settingsPage === "mcp" && (() => {
              const visibleConnectors = connectors.filter((connector) => (!connectorsManageOnly || settingsResources.mcp.some((server: any) => server.name === connector.id)) && (!connectorSearch || `${connector.name} ${connector.id} ${connector.command ?? ""} ${connector.url ?? ""}`.includes(connectorSearch)));
              const selectableConnectorIds = visibleConnectors.map((connector) => connector.id);
              // 勾选集合取交集：筛选变化后已不可见的勾选项不计入批量
              const checkedConnectorIds = connectorChecked.filter((id) => selectableConnectorIds.includes(id));
              const checkedConnectors = connectors.filter((connector) => checkedConnectorIds.includes(connector.id));
              const connectorBatchTargets = {
                enable: checkedConnectors.filter((connector) => connector.enabled === false),
                disable: checkedConnectors.filter((connector) => connector.enabled !== false),
              };
              const toggleConnectorChecked = (id: string) => setConnectorChecked((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
              // —— app-server MCP 状态：卡片自带开关与批量勾选 ——
              // 名字集合不能只取 app-server 的回报：服务器一旦停用就不出现在回报里，
              // 卡片会跟着消失，用户再也找不到开关把它开回来（和钩子分组消失是同一个坑）。
              // 所以以「已知服务器」为准：内置 nuphus + 连接器 + 覆盖表 + 引擎回报。
              const mcpRows = Array.from(new Set([
                "nuphus",
                ...connectors.map((entry) => entry.id),
                ...Object.keys(mcpOverrides),
                ...settingsResources.mcp.map((server: any) => String(server.name ?? "")),
              ])).filter(Boolean).map((name) => {
                const server: any = settingsResources.mcp.find((entry: any) => String(entry.name ?? "") === name);
                const connector = connectors.find((entry) => entry.id === name);
                const runtime = server?.runtimeStatus?.type ?? server?.runtimeStatus ?? "";
                const tools = server ? (Array.isArray(server.tools) ? server.tools : Object.keys(server.tools ?? {})) : [];
                return {
                  name,
                  reported: Boolean(server),
                  runtime: String(runtime || (server?.authStatus ?? "")),
                  toolNames: tools.map((tool: any) => String(typeof tool === "string" ? tool : tool?.name ?? "")),
                  auth: String(server?.authStatus ?? ""),
                  enabled: connector ? connector.enabled !== false : mcpOverrides[name] !== false,
                  managed: Boolean(connector),
                };
              }).filter((row) => !mcpServerSearch || `${row.name} ${row.runtime} ${row.toolNames.join(" ")}`.toLowerCase().includes(mcpServerSearch.toLowerCase()));
              const selectableMcpIds = mcpRows.map((row) => row.name);
              const checkedMcpIds = mcpServerChecked.filter((id) => selectableMcpIds.includes(id));
              const mcpBatchTargets = {
                enable: mcpRows.filter((row) => checkedMcpIds.includes(row.name) && !row.enabled),
                disable: mcpRows.filter((row) => checkedMcpIds.includes(row.name) && row.enabled),
              };
              const toggleMcpChecked = (id: string) => setMcpServerChecked((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
              return (
              <section className="settings-section stack connector-center">
              <div className="settings-copy channel-heading"><div><h2>MCP</h2><p>上方卡片来自 SkillHub MCP 工具广场（skillhub.cn/mcp），点卡片看详情、带接入模板的可一键写入连接器；下方为已接入管理：保存后写入 Codex 配置、加密保存密钥并重启引擎，支持批量启用/停用。“可用”以 app-server 返回的运行/认证状态为准。</p></div><div className="settings-heading-actions"><button className="secondary-setting" onClick={() => { setConnectorSecret(""); setConnectorDraft({ name: "", transport: "stdio", command: "", args: [], url: "", headers: {}, env: {}, secrets: {} }); setConnectorEditorOpen(true); }}><Plus size={14} />添加 MCP</button><button className="secondary-setting" title="打开 SkillHub MCP 工具广场" onClick={() => void window.codex.openExternal("https://skillhub.cn/mcp")}><ArrowUpRight size={14} />SkillHub MCP 广场</button><button className="secondary-setting" title="打开 AIbase MCP 广场找服务" onClick={() => void window.codex.openExternal("https://mcp.aibase.com/zh/explore")}><ArrowUpRight size={14} />AIbase 广场</button><button className="icon-button" title="刷新 MCP 状态" onClick={() => void refreshSettingsResources()}>{resourceLoading ? <Spinner /> : <RefreshCw size={14} />}</button></div></div>
                <div className="plugin-market-block">
                  <div className="plugin-market-title">MCP 市场<small>SkillHub MCP 工具广场 · 27 个服务 · 带模板一键接入 / 其余直达官网</small></div>
                  <div className="resource-toolbar">
                    <div className="skill-tabs">{SKILLHUB_MCP_CATEGORIES.map((category) => <button key={category} className={mcpMarketCategory === category ? "active" : ""} onClick={() => { setMcpMarketCategory(category); setMcpMarketSearch(""); }}>{category}</button>)}</div>
                    <SearchField value={mcpMarketSearch} onChange={setMcpMarketSearch} placeholder="搜索 MCP 服务名称或简介" />
                  </div>
                  <div className="skill-card-grid">
                    {SKILLHUB_MCP_CATALOG.filter((entry) => (mcpMarketCategory === "全部" || entry.category === mcpMarketCategory) && (!mcpMarketSearch || `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(mcpMarketSearch.toLowerCase()))).map((entry) => {
                      const installed = connectors.some((connector) => connector.name === entry.id);
                      return <article className={`skill-card ${installed ? "installed" : ""}`} key={entry.id} onClick={() => setMarketPreview({
                        kind: "mcp",
                        title: entry.name,
                        subtitle: `${entry.category} · SkillHub MCP 工具广场`,
                        iconChar: entry.name,
                        description: entry.description,
                        meta: [entry.category, ...(entry.config ? [entry.config.transport === "stdio" ? "stdio 本地进程" : "HTTP 远程服务"] : [])],
                        installed,
                        installLabel: entry.config ? "一键接入" : "查看接入配置",
                        onInstall: entry.config ? () => installMcpServer(entry) : undefined,
                        externalUrl: skillhubMcpDetailUrl(entry.id),
                        note: entry.configNote,
                        note2: entry.config ? "密钥可留空稍后在连接器编辑中补充；保存后引擎重启并验证 MCP 状态" : "该服务暂无内置模板，打开官网复制接入配置",
                      })}>
                        <div className="skill-card-head">
                          <MarketLogo label={entry.name} size={30} />
                          <button className="skill-add" title={installed ? "已接入连接器" : entry.config ? "一键接入（写入连接器配置）" : "打开 SkillHub 查看接入配置"} disabled={installed} onClick={(event) => { event.stopPropagation(); if (installed) return; if (entry.config) installMcpServer(entry); else void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); }}>{installed ? <Check size={14} /> : entry.config ? <Plus size={14} /> : <ArrowUpRight size={14} />}</button>
                        </div>
                        <strong title={entry.name}>{entry.name}</strong>
                        <p>{entry.description}</p>
                        <footer><span>{entry.category}</span><span>{installed ? "已接入" : entry.config ? "可一键接入" : "官网看配置"}</span><a href={skillhubMcpDetailUrl(entry.id)} onClick={(event) => { event.preventDefault(); void window.codex.openExternal(skillhubMcpDetailUrl(entry.id)); }}>详情</a></footer>
                      </article>;
                    })}
                  </div>
                </div>
              <div className="settings-subhead connector-template-heading"><Zap size={13} />一键接入模板<span className="settings-subhead-hint">官方/社区 MCP 真实配置 · 填入你的凭据即可</span></div>
              <div className="connector-template-grid">{connectorTemplates.map((template) => { const entry = connectors.find((connector) => connector.id === template.id); const installed = Boolean(entry); const oauthConnected = entry?.oauth?.status === "connected"; return <article className={`connector-template-card ${installed ? "installed" : ""} ${oauthConnected ? "oauth" : ""}`} key={template.id}><div className="connector-template-top"><span className="connector-card-icon"><Zap size={15} /></span><small>{template.vendor}</small>{oauthConnected ? <span className="connector-template-badge oauth-badge"><KeyRound size={11} />已授权</span> : installed ? <span className="connector-template-badge">已配置</span> : null}</div><strong>{template.name}</strong><p>{template.summary}</p>{oauthConnected && entry.oauth?.accountHint ? <small className="connector-oauth-hint">{entry.oauth.accountHint}</small> : null}<button className={installed ? "secondary-setting" : "primary-setting"} onClick={() => { setConnectorTemplateValues({}); setConnectorTemplateModal(template); setConnectorOAuth(null); }}><RefreshCw size={13} />{installed ? "重新配置" : "配置连接"}</button></article>; })}</div>
              {connectorTemplateModal && <ConnectorTemplateModal template={connectorTemplateModal} values={connectorTemplateValues} saving={connectorTemplateSaving} oauth={connectorOAuth} onChange={setConnectorTemplateValues} onClose={() => { setConnectorTemplateModal(null); setConnectorTemplateValues({}); setConnectorOAuth(null); }} onSave={() => void saveConnectorFromTemplate(connectorTemplateModal)} onOAuth={() => void startConnectorOAuth()} />}
              <div className="skill-center-toolbar"><div className="skill-tabs"><button className={!connectorsManageOnly ? "active" : ""} onClick={() => setConnectorsManageOnly(false)}>全部配置</button><button className={connectorsManageOnly ? "active" : ""} onClick={() => setConnectorsManageOnly(true)}>已验证 {settingsResources.mcp.filter((server: any) => connectors.some((connector) => connector.id === server.name)).length}</button></div><label className="skill-search"><Search size={14} /><input value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} placeholder="搜索 MCP 连接器" /></label></div>
              <div className="resource-toolbar secondary">
                <SelectAllToggle total={selectableConnectorIds.length} selected={checkedConnectorIds.length} unit="个连接器" onSelectAll={() => setConnectorChecked(selectableConnectorIds)} onClear={() => setConnectorChecked([])} />
                <BatchActions
                  hint={checkedConnectorIds.length ? `选中里：${connectorBatchTargets.disable.length} 个启用中 · ${connectorBatchTargets.enable.length} 个已停用` : "勾选连接器后可批量启用或停用"}
                  actions={[
                    { label: connectorBatchTargets.enable.length ? `启用所选 (${connectorBatchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !connectorBatchTargets.enable.length, busy: connectorBatchBusy === "enable", onClick: () => void batchSetConnectorsEnabled(connectorBatchTargets.enable.map((connector) => connector.id), true), title: connectorBatchTargets.enable.length ? `启用选中的 ${connectorBatchTargets.enable.length} 个已停用连接器` : "没有勾选已停用的连接器" },
                    { label: connectorBatchTargets.disable.length ? `停用所选 (${connectorBatchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !connectorBatchTargets.disable.length, busy: connectorBatchBusy === "disable", onClick: () => void batchSetConnectorsEnabled(connectorBatchTargets.disable.map((connector) => connector.id), false), title: connectorBatchTargets.disable.length ? `停用选中的 ${connectorBatchTargets.disable.length} 个启用中连接器` : "没有勾选启用中的连接器" },
                  ]}
                />
              </div>
              <div className="connector-card-grid">{visibleConnectors.map((connector) => {
                const status = settingsResources.mcp.find((server: any) => server.name === connector.id);
                const detail = status?.runtimeStatus?.type ?? status?.runtimeStatus ?? status?.authStatus;
                const isEnabled = connector.enabled !== false;
                const checked = checkedConnectorIds.includes(connector.id);
                const busy = connectorStatusBusy === connector.id;
                return <article className={`connector-card ${status && isEnabled ? "connected" : ""} ${isEnabled ? "" : "is-disabled"} ${checked ? "is-checked" : ""}`} key={connector.id}>
                  <div className="connector-card-head">
                    <CheckCard checked={checked} label={`选择 ${connector.name}`} title={checked ? `取消选择 ${connector.name}` : `勾选 ${connector.name}，纳入批量操作`} onChange={() => toggleConnectorChecked(connector.id)} />
                    <div className="connector-card-icon"><Link2 size={16} /></div>
                    <div className="connector-card-title"><strong title={connector.name}>{connector.name}</strong><small>{connector.transport === "stdio" ? "本地命令 · stdio" : "远程服务 · HTTP MCP"}{connector.hasSecrets ? " · 已加密密钥" : ""}</small></div>
                    {isEnabled ? <span className="plugin-state on">启用中</span> : <span className="plugin-state off">已停用</span>}
                    <ToggleSwitch checked={isEnabled} disabled={busy} label={`${connector.name} 启用开关`} title={isEnabled ? "停用后引擎不再加载该 MCP，配置保留" : "启用该 MCP 连接器"} onChange={(next) => void setConnectorEnabled(connector, next)} />
                  </div>
                  <p className="connector-card-detail">{connector.transport === "stdio" ? `${connector.command} ${(connector.args ?? []).join(" ")}` : connector.url}</p>
                  <div className="connector-card-foot">
                    <small>{!isEnabled ? "已停用 · 引擎不会加载，配置与密钥保留" : status ? `引擎状态：${detail || "已发现"}` : "已写入配置，等待引擎状态返回"}</small>
                    <button className="icon-button" title="移除连接器" onClick={() => void removeConnector(connector.id)}><Trash2 size={14} /></button>
                  </div>
                </article>;
              })}{!connectors.length && <p className="muted">尚未配置连接器。请从服务提供方获取真实 MCP 启动命令或 HTTP MCP 地址后添加。</p>}</div>
              {connectorEditorOpen && <ConnectorSetupModal draft={connectorDraft} secret={connectorSecret} saving={connectorSaving} onDraftChange={setConnectorDraft} onSecretChange={setConnectorSecret} onClose={() => setConnectorEditorOpen(false)} onSave={(draft) => void saveConnector(draft)} />}
              {false && <div className="schedule-editor connector-editor connector-legacy-editor"><input value={connectorDraft.name} onChange={(event) => setConnectorDraft({ ...connectorDraft, name: event.target.value })} placeholder="连接器名称，例如 GitHub MCP" /><div className="schedule-kind" role="group"><button type="button" className={connectorDraft.transport === "stdio" ? "active" : ""} onClick={() => setConnectorDraft({ ...connectorDraft, transport: "stdio" })}>本地 stdio</button><button type="button" className={connectorDraft.transport === "streamable_http" ? "active" : ""} onClick={() => setConnectorDraft({ ...connectorDraft, transport: "streamable_http" })}>HTTP MCP</button></div>{connectorDraft.transport === "stdio" ? <><input value={connectorDraft.command ?? ""} onChange={(event) => setConnectorDraft({ ...connectorDraft, command: event.target.value })} placeholder="启动命令，例如 npx" /><input value={(connectorDraft.args ?? []).join(" ")} onChange={(event) => setConnectorDraft({ ...connectorDraft, args: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [] })} placeholder="参数，空格分隔，例如 -y @modelcontextprotocol/server-github" /></> : <input value={connectorDraft.url ?? ""} onChange={(event) => setConnectorDraft({ ...connectorDraft, url: event.target.value })} placeholder="https://service.example.com/mcp" />}<input value={connectorSecret} type="password" onChange={(event) => setConnectorSecret(event.target.value)} placeholder="可选：访问令牌（保存时使用 MCP_TOKEN 加密存储）" /><div className="settings-actions"><button className="secondary-setting" onClick={() => setConnectorEditorOpen(false)}>取消</button><button className="primary-setting" disabled={connectorSaving || !connectorDraft.name || (connectorDraft.transport === "stdio" ? !connectorDraft.command : !connectorDraft.url)} onClick={() => { const secrets: Record<string, string> = connectorSecret ? { MCP_TOKEN: connectorSecret } : {}; const draft: ConnectorDraft = { ...connectorDraft, secrets }; setConnectorDraft(draft); void saveConnector(draft); }}>{connectorSaving ? <Spinner /> : <Check size={14} />}保存并验证</button></div></div>}
              <div className="settings-subhead"><Wifi size={13} />app-server MCP 状态<span className="settings-subhead-hint">引擎真实加载的服务器 · 可单卡或批量启停</span></div>
              <div className="skill-center-toolbar"><label className="skill-search"><Search size={14} /><input value={mcpServerSearch} onChange={(event) => setMcpServerSearch(event.target.value)} placeholder="搜索 MCP 服务或工具名" /></label></div>
              <div className="resource-toolbar secondary">
                <SelectAllToggle total={selectableMcpIds.length} selected={checkedMcpIds.length} unit="个 MCP 服务" onSelectAll={() => setMcpServerChecked(selectableMcpIds)} onClear={() => setMcpServerChecked([])} />
                <BatchActions
                  hint={checkedMcpIds.length ? `选中里：${mcpBatchTargets.disable.length} 个启用中 · ${mcpBatchTargets.enable.length} 个已停用` : "勾选 MCP 服务后可批量启用或停用"}
                  actions={[
                    { label: mcpBatchTargets.enable.length ? `启用所选 (${mcpBatchTargets.enable.length})` : "启用所选", icon: <Play size={13} />, disabled: !mcpBatchTargets.enable.length, busy: mcpServerBatchBusy === "enable", onClick: () => void batchSetMcpServersEnabled(mcpBatchTargets.enable.map((row) => row.name), true), title: mcpBatchTargets.enable.length ? `启用选中的 ${mcpBatchTargets.enable.length} 个已停用 MCP 服务` : "没有勾选已停用的 MCP 服务" },
                    { label: mcpBatchTargets.disable.length ? `停用所选 (${mcpBatchTargets.disable.length})` : "停用所选", icon: <CircleStop size={13} />, tone: "danger", disabled: !mcpBatchTargets.disable.length, busy: mcpServerBatchBusy === "disable", onClick: () => void batchSetMcpServersEnabled(mcpBatchTargets.disable.map((row) => row.name), false), title: mcpBatchTargets.disable.length ? `停用选中的 ${mcpBatchTargets.disable.length} 个启用中 MCP 服务` : "没有勾选启用中的 MCP 服务" },
                  ]}
                />
              </div>
              <div className="mcp-server-grid">{mcpRows.map((row) => {
                const busy = mcpServerStatusBusy === row.name;
                const checked = checkedMcpIds.includes(row.name);
                const live = row.enabled && (row.runtime === "live" || row.runtime === "ready" || row.runtime === "running" || row.runtime === "connected");
                const failed = row.enabled && (row.runtime === "error" || row.runtime === "failed" || row.runtime === "disconnected");
                return <article className={`mcp-server-card ${live ? "live" : ""} ${failed ? "failed" : ""} ${row.enabled ? "" : "is-disabled"} ${checked ? "is-checked" : ""}`} key={row.name}>
                  <div className="mcp-server-head">
                    <CheckCard checked={checked} label={`选择 ${row.name}`} title={checked ? `取消选择 ${row.name}` : `勾选 ${row.name}，纳入批量操作`} onChange={() => toggleMcpChecked(row.name)} />
                    <div className="mcp-server-icon"><Wrench size={15} /></div>
                    <div className="mcp-server-title">
                      <strong title={row.name}>{row.name}</strong>
                      <small>{row.managed ? "本应用管理的连接器" : "引擎直管服务器"}{row.auth ? ` · 认证 ${row.auth}` : ""}</small>
                    </div>
                    <span className={`mcp-server-state ${row.enabled ? (live ? "on" : failed ? "bad" : "idle") : "off"}`}>
                      {!row.enabled ? "已停用" : live ? "运行中" : failed ? "启动失败" : row.reported ? (row.runtime || "已发现") : "等待回报"}
                    </span>
                    <ToggleSwitch checked={row.enabled} disabled={busy} label={`${row.name} 启用开关`} title={row.enabled ? `停用后引擎不再加载 ${row.name}，配置保留` : `启用 ${row.name}`} onChange={(next) => void setMcpServerEnabled(row.name, next)} />
                  </div>
                  <div className="mcp-server-body">
                    <span className="mcp-server-metric" title="该服务器暴露的工具数量"><Wrench size={11} />{row.toolNames.length} 个工具</span>
                    <span className="mcp-server-metric" title="app-server 回报的运行状态">状态 {row.reported ? (row.runtime || "已发现") : "未加载"}</span>
                    {row.auth ? <span className="mcp-server-metric" title="认证方式">认证 {row.auth}</span> : null}
                  </div>
                  {row.toolNames.length ? <div className="mcp-server-tools">{
                    row.toolNames.slice(0, 10).map((tool: string) => {
                      const perm = mcpToolPermissions[row.name]?.[tool];
                      return (
                        <button
                          key={tool}
                          className={`mcp-tool-chip${perm ? ` perm-${perm}` : ""}`}
                          title={`${perm ? `当前权限：${perm === "deny" ? "拒绝" : perm === "ask" ? "询问" : "放行"}。` : "未设权限规则。"}点击循环：放行 → 询问 → 拒绝 → 清除`}
                          onClick={() => { const next = perm === undefined || perm === "allow" ? "ask" : perm === "ask" ? "deny" : null; void setMcpToolPermission(row.name, tool, next); }}
                        >
                          <code>{tool}</code>{perm ? <em>{perm === "deny" ? "拒" : perm === "ask" ? "问" : "放"}</em> : null}
                        </button>
                      );
                    })
                  }{row.toolNames.length > 10 ? <code className="mcp-server-tools-more">+{row.toolNames.length - 10}</code> : null}</div> : null}
                  <div className="mcp-server-foot"><small>{row.enabled ? (row.reported ? "已写入引擎配置，改动后引擎会自动重启" : "已写入引擎配置，等待 app-server 回报状态") : "已停用 · 引擎不会加载，配置保留"}</small></div>
                </article>;
              })}{!mcpRows.length && <div className="mcp-server-empty"><Wifi size={26} /><strong>app-server 还没有发现 MCP 服务</strong><p>在上面添加连接器并保存，引擎重启后这里会出现真实运行状态；内置桌面自动化 MCP 也会列在这里。</p></div>}</div>
              </section>
              ); })()}
            {settingsPage === "ssh" && <section className="settings-section stack ssh-page">
              <div className="settings-copy channel-heading">
                <div>
                  <h2>SSH 服务器</h2>
                  <p>集中管理远程主机：保存连接与凭据，分组打标签，配置跳板机与登录后命令；可逐台或批量启用/停用、测试连通性、直接开终端或下发一次性命令。凭据仅保存在本机配置目录（ssh-servers.json）。</p>
                </div>
                <div className="settings-heading-actions">
                  <button className="primary-setting" onClick={() => { setSshEditorTest(null); setSshDraft(emptySshDraft()); }}><Plus size={14} />新建连接</button>
                </div>
              </div>
              <div className="ssh-toolbar">
                <SearchField value={sshQuery} onChange={setSshQuery} placeholder="搜索名称 / 主机 / 标签 / 备注" width={240} />
                <SegmentedTabs
                  value={sshFilter}
                  onChange={(value) => setSshFilter(value as "all" | "on" | "off" | "star")}
                  options={[
                    { value: "all", label: "全部", count: sshServers.length },
                    { value: "on", label: "已启用", count: sshServers.filter((server) => server.enabled).length },
                    { value: "off", label: "已停用", count: sshServers.filter((server) => !server.enabled).length },
                    { value: "star", label: "收藏", count: sshServers.filter((server) => server.favorite).length },
                  ]}
                />
                <span className="ssh-toolbar-spacer" />
                <button className="secondary-setting" title="导出为 JSON（不含密码与私钥）" disabled={!sshServers.length} onClick={() => void exportSshEntries(false)}><Download size={14} />导出</button>
                <button className="secondary-setting" title="从 JSON 文件导入连接" disabled={sshBatchBusy} onClick={() => void importSshEntries()}><Upload size={14} />导入</button>
              </div>
              {sshServers.length > 0 && <div className="ssh-bulk-bar">
                <SelectAllToggle
                  total={sshVisible.length}
                  selected={sshChecked.filter((id) => sshVisible.some((server) => server.id === id)).length}
                  unit="台"
                  onSelectAll={() => setSshChecked(sshVisible.map((server) => server.id))}
                  onClear={() => setSshChecked([])}
                />
                <BatchActions
                  hint={sshChecked.length ? `已选 ${sshChecked.length} 台` : "勾选卡片后可批量操作"}
                  actions={[
                    { label: "批量启用", icon: <Play size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void toggleSshBatch(true) },
                    { label: "批量停用", icon: <PowerOff size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void toggleSshBatch(false) },
                    { label: "测试连通", icon: <Wifi size={13} />, disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void testSshBatch() },
                    { label: "导出所选", icon: <Download size={13} />, disabled: !sshChecked.length, title: "含凭据导出，便于迁移到另一台机器", onClick: () => void exportSshEntries(true) },
                    { label: "删除", icon: <Trash2 size={13} />, tone: "danger", disabled: !sshChecked.length, busy: sshBatchBusy, onClick: () => void removeSshEntries(sshChecked) },
                  ]}
                />
              </div>}
              <div className="ssh-server-list">
                {sshVisible.map((server) => {
                  const busy = sshBusyId === server.id || sshTestingId === server.id;
                  const checked = sshCheckedSet.has(server.id);
                  const info = server.lastServerInfo;
                  const lastTest = server.lastTestAt ? new Date(server.lastTestAt).toLocaleString() : "";
                  const systemLabel = [info?.os, info?.uname].filter(Boolean).join(" · ");
                  return <article className={`ssh-server-card ${server.enabled ? "" : "is-off"} ${checked ? "is-checked" : ""}`} key={server.id}>
                    <div className="ssh-server-head">
                      <CheckCard checked={checked} label={`选择 ${server.name}`} title={checked ? `取消选择 ${server.name}` : `勾选 ${server.name}，纳入批量操作`} onChange={() => sshToggleChecked(server.id)} />
                      <span className={`ssh-status-dot ${server.lastTestOk === undefined ? "unknown" : server.lastTestOk ? "ok" : "fail"} ${sshTestingId === server.id ? "testing" : ""}`} title={server.lastTestOk === undefined ? "未测试" : server.lastTestOk ? "最近一次测试连通" : "最近一次测试失败"} />
                      <div className="ssh-server-title">
                        <strong>{server.name}</strong>
                        <small><code>{server.username}@{server.host}{server.port !== 22 ? `:${server.port}` : ""}</code></small>
                      </div>
                      {server.group ? <span className="ssh-tag ssh-tag-group">{server.group}</span> : null}
                      {(server.tags ?? []).slice(0, 3).map((tag) => <span className="ssh-tag" key={tag}>{tag}</span>)}
                      <button className={`ssh-star ${server.favorite ? "on" : ""}`} title={server.favorite ? "取消收藏" : "收藏到顶部筛选"} onClick={() => void toggleSshFavorite(server)}><Star size={13} /></button>
                      <span className={`ssh-auth-badge ${server.authType}`}><KeyRound size={12} />{server.authType === "password" ? "密码" : "私钥"}</span>
                      <ToggleSwitch checked={server.enabled} disabled={busy} label={`${server.name} 启用开关`} title={server.enabled ? "停用后不参与自动连接，配置保留" : "启用这台服务器"} onChange={(next) => void toggleSshEntry(server, next)} />
                    </div>
                    <div className="ssh-server-meta">
                      {lastTest
                        ? <span className={`ssh-test-result ${server.lastTestOk ? "ok" : "fail"}`}>
                            {server.lastTestOk
                              ? `连通 · ${server.lastTestLatencyMs ?? "?"}ms · ${lastTest}`
                              : `失败 · ${server.lastTestError || "未知错误"} · ${lastTest}`}
                          </span>
                        : <span className="ssh-test-result">尚未测试</span>}
                      {server.lastTestOk && systemLabel ? <span title={`${info?.hostname ? `主机名 ${info.hostname}` : ""}${info?.uptime ? ` · 已运行 ${info.uptime}` : ""}`}>{systemLabel}</span> : null}
                      {server.lastFingerprint ? <span className="ssh-fingerprint" title={`主机密钥指纹 ${server.lastFingerprint}`}>指纹 {server.lastFingerprint.replace(/^SHA256:/, "").slice(0, 12)}…</span> : null}
                      {server.jumpHost?.host ? <span className="ssh-tag ssh-tag-jump">跳板机 {server.jumpHost.host}</span> : null}
                      {server.remotePath ? <span>初始目录 {server.remotePath}</span> : null}
                      {server.notes ? <span className="ssh-notes" title={server.notes}>{server.notes}</span> : null}
                    </div>
                    <div className="ssh-server-actions">
                      <button className="secondary-setting" disabled={busy} onClick={() => setSshTerminal(server)}><TerminalSquare size={14} />打开终端</button>
                      <button className="secondary-setting" disabled={busy} onClick={() => void testSshEntry(server)}>{sshTestingId === server.id ? <Spinner /> : <Wifi size={14} />}测试连接</button>
                      <button className="secondary-setting" disabled={busy} onClick={() => setSshExecTarget(server)}><Play size={14} />运行命令</button>
                      <span className="ssh-actions-spacer" />
                      <button className="secondary-setting" disabled={busy} onClick={() => { setSshEditorTest(null); setSshDraft({ ...server }); }}><PenLine size={14} />编辑</button>
                      <button className="secondary-setting" disabled={busy} onClick={() => void duplicateSshEntry(server)}><Copy size={14} />复制</button>
                      <button className="secondary-setting ssh-delete" disabled={busy} onClick={() => void removeSshEntries([server.id])}><Trash2 size={14} />删除</button>
                    </div>
                  </article>;
                })}
                {!sshServers.length && <div className="ssh-server-empty">
                  <Server size={28} />
                  <strong>还没有 SSH 服务器</strong>
                  <p>新建连接并填入主机、用户名与认证方式，保存后即可启用/停用、测试连通性，或直接打开终端与下发命令。</p>
                  {/* 顶部工具栏的「+ 新建连接」是主入口；空状态这里只给提示文字，避免两个新建按钮让用户疑惑 */}
                </div>}
                {sshServers.length > 0 && !sshVisible.length && <div className="ssh-server-empty ssh-empty-filter">
                  <Search size={24} />
                  <strong>没有匹配的连接</strong>
                  <p>换个关键字，或把筛选切换回「全部」。</p>
                </div>}
              </div>
            </section>}
            {sshDraft && createPortal(
              <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSshDraft(null); }}>
                <section className="connector-setup-modal ssh-editor-modal" role="dialog" aria-modal="true" aria-label={sshDraft.id ? "编辑 SSH 连接" : "新建 SSH 连接"}>
                  <header>
                    <div className="connector-setup-title">
                      <span><Server size={17} /></span>
                      <div><strong>{sshDraft.id ? `编辑「${sshDraft.name}」` : "新建 SSH 连接"}</strong><p>填好基本信息与认证方式即可保存；左下角「测试连接」可以在保存前先验证是否连得上。</p></div>
                    </div>
                    <button className="icon-button relay-modal-close" title="关闭" onClick={() => setSshDraft(null)}><X size={16} /></button>
                  </header>
                  <div className="connector-form ssh-form">
                    <div className="ssh-form-section">
                      <h4>基本信息</h4>
                      <div className="settings-grid two">
                        <label><span>连接名称 <em>必填</em></span><input autoFocus value={sshDraft.name} onChange={(event) => setSshDraft({ ...sshDraft, name: event.target.value })} placeholder="例如：公司测试机 / GPU 服务器" /></label>
                        <label><span>分组 <small>可选，用于归类</small></span><input value={sshDraft.group ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, group: event.target.value })} placeholder="例如：生产 / 测试 / 客户 A" /></label>
                      </div>
                      <div className="settings-grid three">
                        <label><span>主机地址 <em>必填</em></span><input value={sshDraft.host} onChange={(event) => setSshDraft({ ...sshDraft, host: event.target.value })} placeholder="192.168.1.100 或 ssh.example.com" /></label>
                        <label><span>端口</span><input type="number" min={1} max={65535} value={sshDraft.port} onChange={(event) => setSshDraft({ ...sshDraft, port: Number(event.target.value) || 22 })} /></label>
                        <label><span>用户名 <em>必填</em></span><input value={sshDraft.username} onChange={(event) => setSshDraft({ ...sshDraft, username: event.target.value })} placeholder="root / ubuntu" /></label>
                      </div>
                    </div>

                    <div className="ssh-form-section">
                      <h4>认证方式</h4>
                      <div className="ssh-auth-switch">
                        <button className={`ssh-auth-option ${sshDraft.authType === "password" ? "on" : ""}`} onClick={() => setSshDraft({ ...sshDraft, authType: "password" })}><KeyRound size={13} />密码认证</button>
                        <button className={`ssh-auth-option ${sshDraft.authType === "key" ? "on" : ""}`} onClick={() => setSshDraft({ ...sshDraft, authType: "key" })}><KeyRound size={13} />私钥认证</button>
                      </div>
                      {sshDraft.authType === "password"
                        ? <label><span>登录密码</span><input type="password" value={sshDraft.password ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, password: event.target.value })} placeholder="登录密码" /></label>
                        : <>
                            <label><span>私钥内容 <small>粘贴 OpenSSH / PEM 私钥，与下方路径二选一</small></span><textarea rows={4} value={sshDraft.privateKey ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, privateKey: event.target.value })} placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."} /></label>
                            <div className="ssh-key-row">
                              <label className="ssh-key-path"><span>私钥文件路径 <small>例如 C:\Users\you\.ssh\id_ed25519</small></span><input value={sshDraft.keyPath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, keyPath: event.target.value })} placeholder="留空则仅使用上方私钥内容" /></label>
                              <button className="secondary-setting ssh-key-browse" title="从磁盘选择私钥文件" onClick={() => void window.codex.chooseSshKey(sshDraft.keyPath || undefined).then((file: string | null) => { if (file) setSshDraft((current) => (current ? { ...current, keyPath: file } : current)); })}><FolderOpen size={14} />浏览…</button>
                            </div>
                            <label><span>私钥口令 <small>私钥设置了 passphrase 时填写</small></span><input type="password" value={sshDraft.passphrase ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, passphrase: event.target.value })} placeholder="可选" /></label>
                          </>}
                    </div>

                    <div className="ssh-form-section">
                      <h4>会话与网络</h4>
                      <div className="settings-grid three">
                        <label><span>初始工作目录 <small>连接后自动 cd</small></span><input value={sshDraft.remotePath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, remotePath: event.target.value })} placeholder="/root 或 /home/ubuntu/project" /></label>
                        <label><span>连接超时（秒）</span><input type="number" min={1} max={120} value={sshDraft.connectTimeout ?? 10} onChange={(event) => setSshDraft({ ...sshDraft, connectTimeout: Number(event.target.value) || 10 })} /></label>
                        <label><span>心跳间隔（秒） <small>0 = 关闭</small></span><input type="number" min={0} max={600} value={sshDraft.keepaliveInterval ?? 30} onChange={(event) => setSshDraft({ ...sshDraft, keepaliveInterval: Number(event.target.value) || 0 })} /></label>
                      </div>
                      <div className="settings-grid two">
                        <label><span>登录后自动执行 <small>开终端时自动运行</small></span><input value={sshDraft.startupCommand ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, startupCommand: event.target.value })} placeholder="例如：tmux a 或 export PATH=$PATH:/opt/bin" /></label>
                        <label><span>终端类型</span><input value={sshDraft.termType ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, termType: event.target.value })} placeholder="xterm-256color" /></label>
                      </div>
                    </div>

                    <div className="ssh-form-section">
                      <h4>跳板机（ProxyJump）</h4>
                      <label className="ssh-inline-check">
                        <input type="checkbox" checked={Boolean(sshDraft.jumpHost?.host)} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: event.target.checked ? (sshDraft.jumpHost ?? emptySshJump()) : { ...emptySshJump(), host: "" } })} />
                        <span>通过跳板机中继连接目标主机</span>
                      </label>
                      {Boolean(sshDraft.jumpHost?.host) && <>
                        <div className="settings-grid three">
                          <label><span>跳板机地址</span><input value={sshDraft.jumpHost?.host ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), host: event.target.value } })} placeholder="bastion.example.com" /></label>
                          <label><span>端口</span><input type="number" min={1} max={65535} value={sshDraft.jumpHost?.port ?? 22} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), port: Number(event.target.value) || 22 } })} /></label>
                          <label><span>用户名</span><input value={sshDraft.jumpHost?.username ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), username: event.target.value } })} placeholder="跳板机登录用户" /></label>
                        </div>
                        <div className="settings-grid two">
                          <label><span>跳板机认证</span>
                            <select value={sshDraft.jumpHost?.authType ?? "password"} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), authType: event.target.value as "password" | "key" } })}>
                              <option value="password">密码认证</option>
                              <option value="key">私钥认证</option>
                            </select>
                          </label>
                          {(sshDraft.jumpHost?.authType ?? "password") === "password"
                            ? <label><span>跳板机密码</span><input type="password" value={sshDraft.jumpHost?.password ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), password: event.target.value } })} placeholder="跳板机登录密码" /></label>
                            : <div className="ssh-key-row">
                                <label className="ssh-key-path"><span>跳板机私钥路径</span><input value={sshDraft.jumpHost?.keyPath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), keyPath: event.target.value } })} placeholder="本地私钥文件路径" /></label>
                                <button className="secondary-setting ssh-key-browse" onClick={() => void window.codex.chooseSshKey(sshDraft.jumpHost?.keyPath || undefined).then((file: string | null) => { if (file) setSshDraft((current) => current ? { ...current, jumpHost: { ...(current.jumpHost ?? emptySshJump()), keyPath: file } } : current); })}><FolderOpen size={14} />浏览…</button>
                              </div>}
                        </div>
                      </>}
                    </div>

                    <div className="ssh-form-section">
                      <h4>标签与备注</h4>
                      <div className="settings-grid two">
                        <label><span>标签 <small>英文逗号分隔</small></span><input value={(sshDraft.tags ?? []).join(", ")} onChange={(event) => setSshDraft({ ...sshDraft, tags: event.target.value.split(",").map((tag) => tag.trim()) })} placeholder="gpu, 内网, 客户A" /></label>
                        <label className="ssh-inline-check ssh-inline-check-top">
                          <input type="checkbox" checked={sshDraft.enabled} onChange={(event) => setSshDraft({ ...sshDraft, enabled: event.target.checked })} />
                          <span>保存后立即启用这台服务器</span>
                        </label>
                      </div>
                      <label><span>备注</span><textarea rows={2} value={sshDraft.notes ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, notes: event.target.value })} placeholder="用途、负责人、注意事项…" /></label>
                    </div>

                    {sshEditorTest && <div className={`ssh-editor-test ${sshEditorTest.ok ? "ok" : "fail"}`}>
                      {sshEditorTest.ok ? <CircleCheck size={14} /> : <X size={14} />}
                      <span>{sshEditorTest.message}</span>
                    </div>}
                    <div className="connector-example"><Info size={14} /><span>凭据明文保存在本机配置目录，不会上传；连接仅由本机发起。停用只是不参与自动连接，配置会完整保留。</span></div>
                  </div>
                  <footer>
                    <button className="secondary-setting" disabled={!sshDraftValid(sshDraft)} onClick={() => void testSshDraft()}>{sshTestingId === "draft" ? <Spinner /> : <Wifi size={14} />}测试连接</button>
                    <span className="ssh-footer-spacer" />
                    <button className="secondary-setting" onClick={() => setSshDraft(null)}>取消</button>
                    <button className="primary-setting" disabled={!sshDraftValid(sshDraft) || sshSaving} onClick={() => void saveSshEntry()}>{sshSaving ? <Spinner /> : <CircleCheck size={15} />}保存</button>
                  </footer>
                </section>
              </div>,
              document.body,
            )}
            {sshTerminal && createPortal(<SshTerminalModal server={sshTerminal} onClose={() => setSshTerminal(null)} />, document.body)}
            {sshExecTarget && createPortal(<SshExecModal server={sshExecTarget} onClose={() => setSshExecTarget(null)} />, document.body)}
            {settingsPage === "usage" && <UsagePanel
              stats={stats}
              currentInput={usage?.inputTokens ?? usage?.input_tokens ?? 0}
              currentOutput={usage?.outputTokens ?? usage?.output_tokens ?? 0}
              contextWindow={tokenUsage?.modelContextWindow ?? 0}
              onReset={() => { resetUsageStats(); setUsageStats(readUsageStats()); setNotice("使用统计已清空"); }}
            />}
            {settingsPage === "backup" && <section className="settings-section stack backup-page">
              <div className="settings-copy"><h2>会话备份</h2><p>Markdown 用于阅读和交给其他 AI；JSON 用于完整迁移与恢复。</p></div>
              <div className="backup-grid">
                <article className="backup-card backup-card--current">
                  <div className="backup-card-head"><span><MessageSquare size={16} /></span><div><strong>当前会话</strong><small>{thread ? cleanThreadDisplayTitle(thread.name, { preview: thread.preview }) : "尚未打开会话"}</small></div></div>
                  <p>导出正在查看的这一条会话。默认使用通用 Markdown 格式。</p>
                  <div className="backup-card-actions">
                    <button className="primary-setting" disabled={backupBusy !== "" || !thread} onClick={() => { if (thread) void exportThreadsMarkdown([thread.id]); }}>{backupBusy === "export-md" ? <Spinner /> : <FileText size={14} />}导出 Markdown</button>
                    <button className="secondary-setting" disabled={backupBusy !== "" || !thread} onClick={() => { if (thread) void exportThreadsBackup([thread.id]); }}><Archive size={14} />完整 JSON</button>
                  </div>
                </article>
                <article className="backup-card">
                  <div className="backup-card-head"><span><MessageSquare size={16} /></span><div><strong>全部会话</strong><small>{threads.length} 条未归档会话</small></div></div>
                  <p>一次导出当前列表里的全部会话，适合存档或迁移到另一台电脑。</p>
                  <div className="backup-card-actions">
                    <button className="primary-setting" disabled={backupBusy !== "" || !threads.length} onClick={() => void exportThreadsMarkdown()}>{backupBusy === "export-md" ? <Spinner /> : <FileText size={14} />}导出 Markdown</button>
                    <button className="secondary-setting" disabled={backupBusy !== "" || !threads.length} onClick={() => void exportThreadsBackup()}>{backupBusy === "export" ? <Spinner /> : <Archive size={14} />}完整 JSON</button>
                  </div>
                </article>
                <article className="backup-card">
                  <div className="backup-card-head"><span><Upload size={16} /></span><div><strong>导入与恢复</strong><small>不会覆盖同 ID 的已有会话</small></div></div>
                  <p>JSON 恢复完整记录；Markdown 会创建一条可继续提问的新会话。</p>
                  <div className="backup-card-actions">
                    <button className="secondary-setting" disabled={backupBusy !== ""} onClick={() => void importThreadsBackup()}>{backupBusy === "import" ? <Spinner /> : <Upload size={14} />}导入 JSON</button>
                    <button className="secondary-setting" disabled={backupBusy !== ""} onClick={() => void importConversationMarkdown()}>{backupBusy === "import-md" ? <Spinner /> : <FileUp size={14} />}导入 Markdown</button>
                  </div>
                </article>
              </div>
              <div className="backup-footnote"><Info size={14} /><span><strong>JSON</strong> 保留工具调用和引擎原始记录；<strong>Markdown</strong> 自动移除系统注入，适合阅读、分享和带入其他 AI。</span></div>
            </section>}
            {settingsPage === "archive" && <ArchivePage
              onNotice={setNotice}
              onOpenThread={(id) => { setSettingsOpen(false); void openThread(id); }}
              onConfirm={openAppConfirm}
              onThreadRestored={(id) => {
                setSettingsOpen(false);
                // 先刷新列表再打开：恢复的会话此刻还不在 threads 里，直接 openThread 时
                // resume 失败的兜底（threads.find）会找不到条目 → 空白会话
                void (async () => {
                  await refreshThreads().catch(() => undefined);
                  await openThread(id);
                })();
              }}
            />}
            {settingsPage === "storage" && <StorageSection
              onNotice={setNotice}
              openAppConfirm={openAppConfirm}
              onClearMemoryCache={() => { threadCacheRef.current.clear(); void refreshThreads().catch(() => undefined); }}
            />}
            {settingsPage === "computer" && <section className="settings-section stack">
              <div className="settings-copy"><h2>电脑控制</h2><p>审批与沙箱决定 Codex 能对这台电脑做什么；完全访问会关闭审批询问。</p></div>
              <div className="settings-grid three">
                <label><span>审批</span><select value={approvalPolicy} disabled={sandbox === "danger-full-access"} onChange={(event) => changeApproval(event.target.value)}><option value="on-request">按需询问</option><option value="untrusted">仅可信命令</option><option value="never">从不询问</option></select></label>
                <label><span>沙箱</span><select value={sandbox} onChange={(event) => changeSandbox(event.target.value)}><option value="workspace-write">工作区可写</option><option value="read-only">只读</option><option value="danger-full-access">完全访问</option></select></label>
                <label><span>风格</span><select value={personality} onChange={(event) => changePersonality(event.target.value)}><option value="pragmatic">务实</option><option value="friendly">友好</option><option value="none">默认</option></select></label>
              </div>
              <div className="settings-actions"><span>任务运行中可随时在输入框上方快捷切换。权限调低不会削弱引擎能力：越界操作会走审批卡，批准后继续执行。</span></div>
              <div className="settings-subhead"><Monitor size={13} />桌面自动化工具<span className="settings-subhead-hint">已注册为 Codex MCP 服务器，38 个桌面/浏览器工具</span></div>
              <div className="tool-card-grid">
                {toolsStatus.filter((tool) => tool.scope === "computer").map((tool) => <ToolCard tool={tool} key={tool.id} />)}
                {!toolsStatus.length && <p className="muted">正在读取工具状态…</p>}
              </div>
              <p className="muted">引擎通过 <code>nuphus</code> MCP 工具直接操作真实屏幕：截屏看界面、激活窗口、移动鼠标、敲键盘、读写剪贴板、本地 OCR，以及通过 CDP 驱动 Chrome。危险操作带有确认标注。</p>
            </section>}
            </>}
            </div>
          </div>
        </div>
      </div>}
      {shortcutsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}><div className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="键盘快捷键"><header><div><Keyboard size={17} /><strong>键盘快捷键</strong><span className="esc-hint" title="按 ESC 关闭弹窗">ESC</span></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setShortcutsOpen(false)}><X size={17} /></button></header><div className="shortcuts-body">{SHORTCUT_GROUPS.map((group) => <section className="shortcuts-group" key={group.group}><h3>{group.group}</h3>{group.shortcuts.map((item) => <div className="shortcuts-row" key={item.keys.join("+")}><span className="shortcut-desc">{item.desc}</span><span className="shortcut-keys">{item.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span></div>)}</section>)}<footer><span className="muted">部分快捷键在输入框聚焦时优先用于文本编辑。</span></footer></div></div></div>}
      {marketPreview && <MarketPreviewModal state={marketPreview} onClose={() => setMarketPreview(null)} />}
      {skillInstall && <SkillInstallModal state={skillInstall} onClose={() => setSkillInstall(null)} onUse={() => { const skill = { name: skillInstall.skill.name, description: skillInstall.skill.description }; setSelectedSkills((current) => current.some((entry) => entry.name === skill.name) ? current : [...current, skill]); setSkillInstall(null); setSettingsOpen(false); setNotice(`已引用技能：${skill.name}`); }} />}
      {skillRemove && <SkillRemoveModal state={skillRemove} onClose={() => setSkillRemove(null)} />}
      {pluginInstall && <PluginInstallModal state={pluginInstall} onClose={() => setPluginInstall(null)} />}
      {filePreview && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilePreview(null); }}>
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
      </div>}
    </div>
  );
}
