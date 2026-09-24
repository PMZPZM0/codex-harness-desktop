/**
 * AppViewRemoteApproval —— AppView 的 JSX 第 4 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { copyTextToClipboard } from "../../../lib/clipboard";
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
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewRemoteApproval({ app }: { app: HarnessAppApi }) {
  const {
    loadPairStates,
    mobileRemoteOpen,
    pairApproved,
    pairCode,
    pairPending,
    remoteQr,
    remoteUrl,
    setBotManagerOpen,
    setMobileRemoteOpen,
    setPairCode,
    setPairPending,
    setRemoteQr,
  } = app;
  return (
    mobileRemoteOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileRemoteOpen(false); }}>
            <div className="remote-panel2" role="dialog" aria-label="移动端远程控制">
              <header><div className="remote-head-left"><Smartphone size={19} /><div><strong>移动端远程控制</strong><small>扫码或在手机上打开链接，即可远程控制当前工作区。</small></div></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setMobileRemoteOpen(false)}><X size={17} /></button></header>
              <div className="remote-columns">
                {/* 左右两个显式纵向栈：左 = 配对码/审批/已批准/Bot，右 = 扫码。此前是自动流网格，
                    配对码卡会被拉高去对齐右列的二维码（下半截全空）、右下格整个空着 = 大片空白 */}
                <div className="remote-side">
                {/* 6 位配对码：手机扫码后要输它，之后还要在下面这张卡里点「允许」 */}
                <div className="remote-pair-card">
                  <div className="remote-pair-head"><KeyRound size={15} /><strong>首次连接需要配对码</strong>
                    <button className="remote-mini-btn" title="换一个配对码" onClick={() => void window.codex.remotePairRotate().then((r) => setPairCode(r.code)).catch(() => undefined)}><RefreshCw size={13} />刷新</button>
                  </div>
                  <div className="remote-pair-code" data-pair-code>{pairCode ? pairCode.replace(/(\d{3})(\d{3})/, "$1 $2") : "······"}</div>
                  <small>手机扫码后输入这 6 位数字，再回到这里点「允许」。配对码 5 分钟内有效，错 10 次自动作废。</small>
                </div>
                {pairPending.length > 0 && (
                  <div className="remote-approve-card" data-pair-pending>
                    <div className="remote-approve-head"><ShieldCheck size={15} /><strong>有 {pairPending.length} 台手机等待批准</strong></div>
                    {pairPending.map((request) => (
                      <div className="remote-approve-row" key={request.rid} data-pair-row={request.rid}>
                        <div className="remote-approve-info"><strong>{request.name}</strong><small>请求连接这台电脑的工作区</small></div>
                        <div className="remote-approve-actions">
                          <button className="remote-allow-btn" onClick={() => { const done = request.rid.startsWith("bp-") ? window.codex.botApprove(request.rid) : window.codex.remoteApprove(request.rid); void done.then(() => { setPairPending((c) => c.filter((r) => r.rid !== request.rid)); void loadPairStates(); }).catch(() => undefined); }}>允许</button>
                          <button className="remote-deny-btn" onClick={() => { const done = request.rid.startsWith("bp-") ? window.codex.botDeny(request.rid) : window.codex.remoteDeny(request.rid); void done.then(() => setPairPending((c) => c.filter((r) => r.rid !== request.rid))).catch(() => undefined); }}>拒绝</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {pairApproved.length > 0 && (
                  <div className="remote-approved-card">
                    <div className="remote-approve-head"><Smartphone size={15} /><strong>已批准的设备（{pairApproved.length}）</strong></div>
                    {pairApproved.map((device) => (
                      <div className="remote-approved-row" key={device.deviceId}>
                        <span>{device.name}</span>
                        {/* Bot Channel 批准的设备（source=bot，deviceId 形如 wechat:xxx）要走 botRevoke，
                            remoteRevoke 对它无效 —— 之前点「移除」没反应就是这里没分流 */}
                        <button className="remote-mini-btn" title="撤销，下次重新配对" onClick={() => { const done = device.source === "bot" ? window.codex.botRevoke(device.deviceId) : window.codex.remoteRevoke(device.deviceId); void done.then(() => void loadPairStates()).catch(() => undefined); }}>移除</button>
                      </div>
                    ))}
                  </div>
                )}
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
                <div className="remote-side remote-side-qr">
                <div className="remote-col">
                  <div className="remote-col-title"><Smartphone size={15} /><strong>手机扫码连接</strong></div>
                  <p className="remote-col-desc">用手机<b>相机</b>扫一扫（若扫码识别成文本，请选「打开链接」）。{remoteUrl?.startsWith("https") ? "手机无需与电脑同一 Wi-Fi。" : "手机需与电脑同一 Wi-Fi。"}</p>
                  <div className="remote-conn-card">
                    <div className="remote-conn-left"><div className="remote-conn-title"><strong>等待手机连接</strong><span className="remote-ready"><span className="remote-ready-dot" />已就绪</span></div><small>用手机扫码，或在手机上打开链接。</small></div>
                    <button className="remote-stop-btn" title="停止服务" onClick={async () => { await window.codex.remoteStop(); setMobileRemoteOpen(false); }}><Link2 size={13} />停止</button>
                  </div>
                  <div className="remote-scan-row"><span>无法扫码？可以在手机上打开链接。</span>
                    <button className="remote-mini-btn" title="刷新二维码" onClick={() => void window.codex.remoteQrcode().then((svg) => setRemoteQr(svg))}><RefreshCw size={13} />刷新二维码</button>
                    <button className="remote-mini-btn" title="复制链接" onClick={() => { if (remoteUrl) void copyTextToClipboard(remoteUrl); }}><Copy size={13} />复制链接</button>
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
                </div>
              </div>
            </div>
          </div>
  );
}
