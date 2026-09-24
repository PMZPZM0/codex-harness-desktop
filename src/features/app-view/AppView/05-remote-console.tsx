/**
 * AppViewRemoteConsole —— AppView 的 JSX 第 5 段（09-22 从 AppView.tsx 分出，纯搬迁）。
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
import { BotBindCard } from "../../bot";
import { RequestCard, ToolCard, VoiceSettingsBridge, admitThreadRuntimeRef, ago, appendDelta, appendIndexedDelta, applyThreadEvent, approvalMenuOptions, armSendAnimationClaim, botChannelName, botOnlineOf, builtinCommandCatalog, categoryLabel, clampRruleNum, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, cronTemplates, deltaMethods, describeRrule, describeSchedule, displayPath, fmtImportTime, formatTimestamp, greetingForHour, groupThreadsByTime, hydrateTurnUserMessage, idleTemplates, imageExts, isActivityItem, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, localFormatDurationMs, locateMatchEl, markBufferedAgentReveal, markBufferedTurnReveal, matchSkillCatalog, mergeItem, mergeLongerStreams, mergeTurn, modelBadges, modelName, normSkillName, noticeTone, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, revealStepFor, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, settingsNav, shortSkillName, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, slashCommands, stableItem, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, toFileUrl, uniqueModelCount, usageCounterSnapshot, writeThreadRuntimeMirror } from "../helpers";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewRemoteConsole({ app }: { app: HarnessAppApi }) {
  const {
    activeBotId,
    botBindings,
    botChannelPick,
    botManagerOpen,
    botStream,
    bots,
    channelOnline,
    loadPairStates,
    pairCode,
    pairPending,
    setActiveBotId,
    setBotBinding,
    setBotChannelPick,
    setBotManagerOpen,
    setBotsPersist,
    setChannelOnline,
    setPairCode,
    setPairPending,
    showToast,
    threads,
    updateBotStream,
  } = app;
  return (
    botManagerOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBotManagerOpen(false); }}>
            <div className="bot-manager" role="dialog" aria-label="机器人">
              <header><div className="bot-head-left"><Link2 size={17} /><strong>机器人</strong><small>把外部聊天工具和 Webhook 接入为你的聊天机器人。</small></div><button className="icon-button relay-modal-close" title="关闭" onClick={() => setBotManagerOpen(false)}><X size={17} /></button></header>
              {/* 09-13：首次连接的 6 位配对码与待审批请求直接在这里展示——
                  否则用户得叉掉面板回「手机远控」看码，来回跳（用户反馈「不方便」） */}
              <div className="bot-pair-banner">
                <div className="bot-pair-main">
                  <span className="bot-pair-label">首次连接配对码</span>
                  <strong className="bot-pair-code" data-pair-code>{pairCode ? pairCode.replace(/(\d{3})(\d{3})/, "$1 $2") : "······"}</strong>
                  <button className="remote-mini-btn" title="换一个配对码" onClick={() => void window.codex.remotePairRotate().then((r) => setPairCode(r.code)).catch(() => undefined)}><RefreshCw size={12} />刷新</button>
                </div>
                <small className="bot-pair-hint">机器人首次对话时，在聊天里发这个 6 位码（5 分钟内有效）；收到「等待批准」后回到这里点允许。</small>
                {pairPending.length > 0 && (
                  <div className="bot-pair-pending">
                    {pairPending.map((request) => (
                      <div className="remote-approve-row" key={request.rid} data-pair-row={request.rid}>
                        <div className="remote-approve-info"><strong>{request.name}</strong><small>等待电脑端批准</small></div>
                        <div className="remote-approve-actions">
                          <button className="remote-allow-btn" onClick={() => { const done = request.rid.startsWith("bp-") ? window.codex.botApprove(request.rid) : window.codex.remoteApprove(request.rid); void done.then(() => { setPairPending((c) => c.filter((r) => r.rid !== request.rid)); void loadPairStates(); }).catch(() => undefined); }}>允许</button>
                          <button className="remote-deny-btn" onClick={() => { const done = request.rid.startsWith("bp-") ? window.codex.botDeny(request.rid) : window.codex.remoteDeny(request.rid); void done.then(() => setPairPending((c) => c.filter((r) => r.rid !== request.rid))).catch(() => undefined); }}>拒绝</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bot-columns">
                <div className="bot-side">
                  <button className="bot-new-btn" onClick={() => { const id = crypto.randomUUID(); setBotsPersist((cur) => { const next = [...cur, { id, name: "新机器人", channel: "", enabled: false }]; return next; }); setActiveBotId(id); setBotChannelPick(null); showToast("机器人已创建", "选择渠道并扫码绑定后即可使用"); }}><Plus size={14} />新建机器人</button>
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
                      <label className="bot-switch"><input type="checkbox" checked={activeBot.enabled} onChange={() => setBotsPersist((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, enabled: !b.enabled } : b); return next; })} /><span /></label>
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
                        <button key={key} className={"bot-channel-opt " + (botChannelPick === key ? "picked" : "")} onClick={() => { setBotChannelPick(key); setBotsPersist((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, channel: key } : b); return next; }); }}>
                          <strong>{name}{region ? <span className="bot-region">{region}</span> : null}</strong>
                          <small>{desc}</small>
                        </button>
                      ))}
                    </div>
                    {botChannelPick && <BotBindCard bot={activeBot} onBound={(deviceName) => { setBotsPersist((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, enabled: true } : b); return next; }); void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined); showToast("机器人已连接", `${activeBot.name} 已通过 ${deviceName} 连接`); }} />}
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
                      <select className="bot-select" value={(activeBot as any).granularity ?? "standard"} onChange={(event) => setBotsPersist((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, granularity: event.target.value } : b); return next; })}>
                        <option value="standard">标准回复</option>
                        <option value="concise">简洁回复</option>
                        <option value="verbose">详细回复</option>
                      </select>
                    </div>
                    <div className="bot-detail-row">
                      <div><strong>流式回复</strong><small>开启后机器人边生成边推送正文（微信逐段追加 / Telegram 实时改写），不用干等完整回复。微信受平台限制：单条消息触发的推送条数有限，长任务期间会以「对方正在输入…」提示进度。</small></div>
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
                      <select className="bot-select" value={(activeBot as any).scope ?? "all"} onChange={(event) => setBotsPersist((cur) => { const next = cur.map((b) => b.id === activeBot.id ? { ...b, scope: event.target.value } : b); return next; })}>
                        <option value="all">所有工作区</option>
                        <option value="current">仅当前工作区</option>
                      </select>
                    </div>
                    <div className="bot-delete-row"><div><strong>删除机器人</strong><small>移除这个机器人，并断开其渠道连接（微信/Telegram 需重新扫码绑定）。</small></div><button className="bot-delete-btn" onClick={async () => {
                      // 删除必须同步断开渠道会话：网关凭据（微信 token/Telegram token）是主进程全局的，
                      // 只删 UI 记录的话同渠道新建会被判定「已连接」直接复用旧会话，扫码入口都不出现
                      // ⚠️ 清凭据不可逆（微信要重新扫码），必须二次确认——此前无确认，误点一下登录态就没了
                      if (!window.confirm(`删除机器人「${activeBot.name}」？\n\n将同时断开${botChannelName(activeBot.channel) || "渠道"}连接并清除登录凭据（微信/Telegram 需重新扫码），机器人卡片不会自动恢复。`)) return;
                      try {
                        if (activeBot.channel === "wechat") await window.codex.weixinLogout();
                        if (activeBot.channel === "telegram") await window.codex.telegramLogout();
                        void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined);
                      } catch { /* 断开失败不阻塞删除 */ }
                      setBotsPersist((cur) => { const next = cur.filter((b) => b.id !== activeBot.id); return next; }); setActiveBotId(null); showToast("机器人已删除", "渠道连接已断开，可随时重新新建并绑定");
                    }}><Trash2 size={13} />删除机器人</button></div>
                  </>); })()}
                </div>
              </div>
            </div>
          </div>
  );
}
