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
import { useEffect, useRef, useState } from "react";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";
import { refreshWithReceipt } from "../../../lib/refresh-receipt.mjs";
import { ToggleSwitch } from "../../../components/SettingsWidgets";

/** 远控审批与配对弹窗：显示中转隧道状态与配对码（码 5 分钟轮换，弹窗要跟着换）。 */
export function AppViewRemoteApproval({ app }: { app: HarnessAppApi }) {
  /* 中转状态（10-29）：装完即用的内置隧道是否在线 —— 只看二维码猜不出「为什么连不上」 */
  const [relay, setRelay] = useState<{ state: string; id: string; error: string } | null>(null);
  /* 配对码 5 分钟过期会被后台自动轮换：弹窗里必须跟着换（码 + 二维码一起），
     否则用户照着旧码输，永远得到「配对码错误或已过期」（用户实测）。 */
  const lastPairCode = useRef("");
  /* 「禁止新设备配对」（11-14 用户令）：默认关；开启后新手机 / 新 Bot 聊天一律拒绝，
     已批准设备仍可凭设备秘密自动重连。状态真相源在主进程（remote-pairing-lock.json）。 */
  const [pairLocked, setPairLocked] = useState(false);
  /* 切换请求在途：主进程每次切换都会「作废在途请求 + 轮换配对码」，
     连点两下会让两次响应互相覆盖（UI 与主进程状态相反）并白白多轮换一次码。 */
  const [pairLockBusy, setPairLockBusy] = useState(false);
  useEffect(() => {
    if (!app.mobileRemoteOpen) return;
    let alive = true;
    const pullCode = async () => {
      try {
        const state: any = await window.codex.remotePairState();
        if (!alive) return;
        setPairLocked(Boolean(state?.locked));
        const next = String(state?.code ?? "");
        if (!next || next === lastPairCode.current) return;
        lastPairCode.current = next;
        setPairCode(next);
        const svg = await window.codex.remoteQrcode();
        if (alive) setRemoteQr(svg);
      } catch { /* 引擎未就绪：下一轮再试 */ }
    };
    void pullCode();
    const codeTimer = window.setInterval(() => { void pullCode(); }, 10_000);
    return () => { alive = false; window.clearInterval(codeTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.mobileRemoteOpen]);
  useEffect(() => {
    if (!app.mobileRemoteOpen) return;
    let alive = true;
    const pull = () => {
      void window.codex.remoteStatus()
        .then((status: any) => { if (alive) setRelay(status?.relay ?? null); })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [app.mobileRemoteOpen]);
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
    setNotice,
  } = app;

  /* 刷新配对码 / 二维码（10-16 刷新回执）：原来配对码那条是 `.catch(() => undefined)` —— 失败静默；
     二维码那条连 catch 都没有（失败 = 未处理的 rejection，界面上二维码纹丝不动，用户以为点了没用）。 */
  const rotatePairCode = async () => {
    try { setPairCode((await window.codex.remotePairRotate()).code); return ""; }
    catch (error: any) { return String(error?.message ?? error); }
  };
  /* 切换「禁止新设备配对」：先乐观置位，失败回滚并给回执；
     开启时主进程会作废在途请求并轮换配对码（旧码截图立即失效），这里同步刷新。 */
  const togglePairLock = async (next: boolean) => {
    if (pairLockBusy) return;
    setPairLockBusy(true);
    setPairLocked(next);
    try {
      const result = await window.codex.remoteSetPairingLock(next);
      const locked = Boolean(result?.locked);
      /* persisted=false ⇒ 只在本次运行有效（磁盘不可写）。⛔ 不许把「没记住」说成「已关闭」。 */
      const persisted = (result as { persisted?: boolean })?.persisted !== false;
      setPairLocked(locked);
      const base = locked
        ? "已关闭新设备配对：未批准的手机与新的 Bot 聊天都将被拒绝；已批准设备不受影响"
        : "已恢复新设备配对：配对码已更新，请把新的 6 位数字交给要连接的手机";
      setNotice(persisted ? base : `${base}（写入磁盘失败：只在本次运行有效，重启后会回到原状态）`);
      if (locked) setPairPending([]);
      void loadPairStates();
      const fresh = await window.codex.remotePairState().catch(() => null);
      if (fresh?.code) { lastPairCode.current = String(fresh.code); setPairCode(String(fresh.code)); }
    } catch (error) {
      setPairLocked(!next);
      setNotice(`切换「禁止新设备配对」失败：${String((error as Error)?.message ?? error)}`);
    } finally {
      setPairLockBusy(false);
    }
  };

  const refreshQrcode = async () => {
    try {
      /* 10-29：二维码里带连接码 —— 先换一个新码再出图，否则 5 分钟后扫到的是过期码 */
      const fresh = (await window.codex.remotePairRotate()).code;
      setPairCode(fresh);
      setRemoteQr(await window.codex.remoteQrcode());
      return "";
    } catch (error: any) { return String(error?.message ?? error); }
  };
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
                    <button className="remote-mini-btn" title="换一个配对码" onClick={() => void refreshWithReceipt(setNotice, "刷新配对码", rotatePairCode)}><RefreshCw size={13} />刷新</button>
                  </div>
                  <div className={"remote-pair-code" + (pairLocked ? " locked" : "")} data-pair-code>{pairCode ? pairCode.replace(/(\d{3})(\d{3})/, "$1 $2") : "······"}</div>
                  <small>{pairLocked
                    ? "已关闭新设备配对 —— 未批准的手机无法连接。先关闭下方开关，才能配对新的手机。"
                    : "手机扫码后输入这 6 位数字，再回到这里点「允许」。配对码 5 分钟内有效，错 10 次自动作废。"}</small>
                </div>
                {/* 11-14 用户令：配对好手机后可一键关闭「其他手机再配对」。默认关，按需开。 */}
                <div className="remote-lock-card" data-pair-locked={pairLocked ? "true" : "false"}>
                  <div className="remote-lock-head">
                    <Lock size={15} />
                    <strong>禁止新设备配对</strong>
                    <span className="remote-lock-switch">
                      <ToggleSwitch checked={pairLocked} disabled={pairLockBusy} label="禁止新设备配对" onChange={(next) => void togglePairLock(next)} />
                    </span>
                  </div>
                  <small>{pairLocked
                    ? "已关闭：未批准的手机会被拒绝，新的 Bot 聊天也无法配对；已批准设备不受影响。手机丢了/想换机时，先关掉它再配对。"
                    : "开启后，只有已批准的设备能连接；新手机需要先在这里关闭开关才能配对。"}</small>
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
                    {[["微信", "", "从微信会话打开这个工作区。"], ["飞书", "中国", "在飞书群里 @机器人 打开这个工作区。"]].map(([name, region, desc]) => (
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
                  {/* 把「本窗口的连接码 + 地址」显示在二维码上方：两台电脑/两个应用各有各的码，
                      用户在两个窗口之间看码时很容易抄错（实测 144877 就是不存在的旧码） */}
                  <div className="remote-pair-code-line">
                    <span>连接码</span>
                    <strong className="remote-pair-code-value" data-pair-code-value>{pairCode ? pairCode.replace(/(\d{3})(\d{3})/, "$1 $2") : "······"}</strong>
                    <small>{(() => { try { return remoteUrl ? "本窗口：" + new URL(remoteUrl).host : ""; } catch { return ""; } })()}</small>
                  </div>
                  <div className="remote-conn-card">
                    <div className="remote-conn-left"><div className="remote-conn-title"><strong>{pairLocked ? "已关闭新设备配对" : "等待手机连接"}</strong><span className={"remote-ready" + (pairLocked ? " locked" : "")}><span className="remote-ready-dot" />{pairLocked ? "已锁定" : "已就绪"}</span></div><small>{pairLocked ? "已批准设备仍可自动连接；新设备需先关闭锁定。" : "用手机扫码，或在手机上打开链接。"}</small></div>
                    <button className="remote-stop-btn" title="停止服务" onClick={async () => { await window.codex.remoteStop(); setMobileRemoteOpen(false); }}><Link2 size={13} />停止</button>
                  </div>
                  <div className="remote-scan-row"><span>无法扫码？可以在手机上打开链接。</span>
                    <button className="remote-mini-btn" title="刷新二维码" onClick={() => void refreshWithReceipt(setNotice, "刷新二维码", refreshQrcode)}><RefreshCw size={13} />刷新二维码</button>
                    {/* 10-07 审计补漏：这是全仓唯一一个**完全静默**的复制点
                        （其余复制点要么走 FeedbackIconButton 两段反馈、要么有 setNotice 回执）。
                        ⛔ 没有链接时也要说话，否则点了没反应无从判断是"没复制"还是"没链接"。 */}
                    <button className="remote-mini-btn" title="复制链接" onClick={() => {
                      if (!remoteUrl) { setNotice("还没有可复制的链接（服务未启动）"); return; }
                      void copyTextToClipboard(remoteUrl)
                        .then(() => setNotice("远程控制链接已复制"))
                        .catch((error: any) => setNotice(`复制失败：${String(error?.message ?? error)}`));
                    }}><Copy size={13} />复制链接</button>
                  </div>
                  <p className="remote-relay-line">配对码 30 分钟内有效，过期自动换新（二维码同步更新）</p>
                  <p className={"remote-relay-line" + (relay?.state === "online" ? " online" : "")} data-relay-state={relay?.state ?? "unknown"}>
                    {relay?.state === "online" ? "中转在线 · 设备 " + relay.id : relay?.state === "connecting" ? "中转连接中…" : "中转离线" + (relay?.error ? "：" + relay.error : "")}
                  </p>
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
