/**
 * im-gateways（09-21 架构改造：从 electron/main.ts 组合根按域拆出，纯搬迁）
 *
 * 搬出符号：微信/Telegram/飞书/钉钉/QQ/企微 Webhook 六个渠道网关的实例与流式 sink、
 *          渠道级追加预算（WEIXIN/TELEGRAM/FEISHU/DINGTALK/QQ_STREAM_BUDGET）、
 *          「对方正在输入…」控制、机器人会话绑定（weixin/telegram/channelBot 三张表 + 落盘读写）、
 *          渠道日志（channelLog / persistChannelLog / channelThreadChat）、QQ 被动回复上下文、
 *          渠道音频转写（transcodeToWav16k / resolveFfmpegPath / handleChannelAudioMessage）。
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释 + 末尾 export 清单 + 末尾的 setWeixinGateway 访问器）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * ⛔ weixinGateway 是 `let` 且由 main 的 bindBoot 注入赋值 ⇒ 必须经 setWeixinGateway 访问器写
 *    （ESM 里 import 进来的绑定不可赋值，TS2632）。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { app } from "electron";
import { plainTextForChannel } from "../channel-text";
import { DingtalkGateway } from "../dingtalk-gateway";
import { FeishuGateway } from "../feishu-gateway";
import { QqGateway } from "../qq-gateway";
import { TelegramGateway } from "../telegram-gateway";
import { WecomWebhookGateway } from "../wecom-webhook-gateway";
import { WeixinGateway } from "../weixin-gateway";
import { toolsRoot } from "../toolchain";
import { type BotStreamBudget, BotStreamSession, type BotStreamSink } from "../bot-stream";
import { handleChannelMessage, handleTelegramMessage } from "./im-inbound";
import { sendToWindow } from "./window-bus";
import { appSourceRoot, channelLogs } from "../runtime-refs";
import { channelBot, voiceService } from "../main";
// ── 微信机器人：收消息 → Codex → 回复发回微信 ───────────────────
let weixinGateway: WeixinGateway | null = null;
const weixinBindings = new Map<string, string>(); // 微信用户 → Codex 线程

// ── 频道机器人流式回复（bot-stream）──────────────────────────
// threadId → 流式会话；turn/started 建，最终回复由会话发出（含流式关闭时的整段发送）
const botStreamSessions = new Map<string, BotStreamSession>();

// 渠道级追加预算（理由见 bot-stream.ts 的 BotStreamBudget 注释）：
//  · 微信：iLink 每 24h 每个「用户消息」最多 10 条独立消息 ⇒ 追加 5 条 + 收尾 1 条 = 6，留 4 条余量；
//    间隔 3s、攒够 40 字才发下一条（避免碎片气泡刷屏）。过程可见性主要靠「对方正在输入…」（不占配额）。
//  · Telegram：无配额限制（editMessageText 只改同一条），沿用原节流。
const WEIXIN_STREAM_BUDGET: BotStreamBudget = { maxFlushes: 5, flushIntervalMs: 3000, minChars: 40 };
const TELEGRAM_STREAM_BUDGET: BotStreamBudget = { maxFlushes: 40, flushIntervalMs: 1600, minChars: 0 };
//  飞书：可发多条、限速宽松（单应用每分钟量级很高）⇒ 追加 4 条 + 收尾 1 条。
//  钉钉：群 webhook **只能发新消息（无编辑）**，且限 20 条/分钟 ⇒ 追加 3 条、间隔 ≥5s，保守留余量。
//  QQ：被动回复（msg_id）官方上限 5 次 ⇒ 追加 3 条 + 收尾 1 条 = 4 次，留 1 次余量。
const FEISHU_STREAM_BUDGET: BotStreamBudget = { maxFlushes: 4, flushIntervalMs: 4000, minChars: 60 };
const DINGTALK_STREAM_BUDGET: BotStreamBudget = { maxFlushes: 3, flushIntervalMs: 5000, minChars: 60 };
const QQ_STREAM_BUDGET: BotStreamBudget = { maxFlushes: 3, flushIntervalMs: 3000, minChars: 80 };

function weixinStreamSink(from: string): BotStreamSink {
  // 09-18 修正：此前**整体撤掉了微信流式**，依据是 09-12 的结论「iLink 的 context_token 实测一次一发」。
  // 复核协议资料后确认那个结论是**误判**：同一 context_token 可复用（当时"第二条发不出去"的真因是
  // 请求体字段不全，服务端静默丢弃）。真正的硬约束是**配额**（每用户消息 24h 内 10 条独立消息）——
  // 所以这里恢复追加语义，但靠 WEIXIN_STREAM_BUDGET 把条数压到 6 条以内，并保留失败降级：
  // append 连续失败 2 次即停用追加，收尾那次（state=2）把完整正文补发，正文永不丢。
  // ⛔ 微信是**纯文本通道**（09-18 用户：「为啥不能跟汇总一样的格式同步过来」）：iLink 不渲染
  // Markdown，桌面端的表格/标题/粗体原样发过去就是一堆竖线。发前统一走 plainTextForChannel
  // 转成手机可读排版。流式分片可能切在半行中间 → 先攒到**完整行**再转换发送（转换是逐行的，
  // 分片安全）；carry 里的残留由收尾（finalizeAppend）补上，正文不丢。
  // 同一转换也用于 Telegram 与飞书/钉钉/QQ（它们同是纯文本消息，见各发送点）。
  let carry = "";
  const sendChunk = (text: string, opts: { clientId?: string; state?: number }) =>
    weixinGateway!.sendText(from, plainTextForChannel(text), opts);
  return {
    append: (delta, clientId) => {
      carry += delta;
      const cut = carry.lastIndexOf("\n");
      if (cut < 0) return Promise.resolve(); // 还没有完整行：继续攒
      const sendable = carry.slice(0, cut + 1);
      carry = carry.slice(cut + 1);
      return sendChunk(sendable, { clientId, state: 1 });
    },
    finalizeAppend: (tail, clientId) => {
      const rest = carry + tail;
      carry = "";
      return weixinGateway!.sendText(from, plainTextForChannel(rest) || "（已完成）", { clientId, state: 2 });
    },
    send: (full) => weixinGateway!.sendText(from, plainTextForChannel(full)),
  };
}

/** 「对方正在输入…」按 threadId 挂停止函数（回合结束/重开时调用） */
const weixinTypingStops = new Map<string, () => void>();
function startWeixinTyping(threadId: string, from: string) {
  stopWeixinTyping(threadId);
  if (!weixinGateway) return;
  try { weixinTypingStops.set(threadId, weixinGateway.beginTyping(from)); } catch { /* 尽力而为，失败不影响回复 */ }
}
function stopWeixinTyping(threadId: string) {
  const stop = weixinTypingStops.get(threadId);
  if (!stop) return;
  weixinTypingStops.delete(threadId);
  try { stop(); } catch { /* 忽略 */ }
}

/** 飞书 / 钉钉 / QQ 的追加式流式 sink（09-18 用户：「接上流式（按各渠道限制做）」）。
 *  三家都**不能编辑已发消息**（飞书 SDK 未暴露 message 更新、钉钉 webhook 只发新消息、
 *  QQ 被动回复只能逐条发），所以走与微信同款的「少量多次」追加语义：
 *  append = 发一条进度消息，finalizeAppend = 发收尾（完整正文尾部）；预算按各家频控设（见上）。
 *  转换与微信一致：发送前统一过 plainTextForChannel（这三家也是纯文本消息类型）。 */
function feishuStreamSink(chatId: string): BotStreamSink {
  return {
    append: (delta) => feishuGateway.sendMessage(chatId, plainTextForChannel(delta)),
    finalizeAppend: (tail) => feishuGateway.sendMessage(chatId, plainTextForChannel(tail) || "（已完成）"),
    send: (full) => feishuGateway.sendMessage(chatId, plainTextForChannel(full)),
  };
}
function dingtalkStreamSink(chatId: string): BotStreamSink {
  return {
    append: (delta) => dingtalkGateway.sendMessage(chatId, plainTextForChannel(delta)),
    finalizeAppend: (tail) => dingtalkGateway.sendMessage(chatId, plainTextForChannel(tail) || "（已完成）"),
    send: (full) => dingtalkGateway.sendMessage(chatId, plainTextForChannel(full)),
  };
}
function qqStreamSink(chatId: string): BotStreamSink {
  // ctx 逐条现取：QQ 的被动回复凭据随每条入站消息刷新（msg_id 5 分钟内有效），
  // 闭包捕获旧 ctx 会在长任务里过期 —— 取不到就直接抛，交给 bot-stream 的降级逻辑。
  const send = (text: string) => {
    const ctx = qqReplyContexts.get(chatId);
    if (!ctx) throw new Error("缺少被动回复上下文（msg_id 已过期），请重新 @机器人");
    return qqGateway.sendMessage(chatId, plainTextForChannel(text), ctx);
  };
  return {
    append: (delta) => send(delta),
    finalizeAppend: (tail) => send(tail || "（已完成）"),
    send: (full) => send(full),
  };
}

function telegramStreamSink(chatId: number): BotStreamSink {
  // 与微信同理（09-18 用户问「其他渠道是不是一样」）：Telegram 这里**没有 parse_mode**，
  // Markdown 也是原样显示（`**粗体**`、`| 表格 |`），且 Telegram 本身不渲染表格 →
  // 同样先过 plainTextForChannel，三个发送点全带。
  let messageId: number | null = null;
  return {
    replace: async (full) => {
      const text = plainTextForChannel(full);
      if (messageId == null) {
        messageId = await telegramGateway.streamBegin(chatId, text.slice(0, 3800));
        return messageId != null;
      }
      return telegramGateway.streamEdit(chatId, messageId, text.slice(0, 3800));
    },
    finalizeReplace: async (full) => {
      const text = plainTextForChannel(full);
      if (messageId != null) {
        const head = text.slice(0, 4000);
        const ok = await telegramGateway.streamEdit(chatId, messageId, head).catch(() => false);
        if (!ok) await telegramGateway.sendText(chatId, head).catch(() => undefined);
        const rest = text.slice(4000);
        if (rest) await telegramGateway.sendText(chatId, rest).catch(() => undefined);
      } else if (text) await telegramGateway.sendText(chatId, text).catch(() => undefined);
    },
    send: (full) => telegramGateway.sendText(chatId, plainTextForChannel(full)),
  };
}

/** 某会话该用哪套流式方案：Telegram 用 replace 语义；微信 iLink 用 append + 严格预算。
 *  返回 null = 该会话不是渠道会话（渲染层自己的会话，不需要回推）。 */
function botStreamPlanFor(threadId: string): { sink: BotStreamSink; budget: BotStreamBudget; typingFrom?: string } | null {
  const tgChat = telegramBindings.get(threadId);
  if (tgChat != null) return { sink: telegramStreamSink(tgChat), budget: TELEGRAM_STREAM_BUDGET };
  for (const [user, bound] of weixinBindings) {
    if (bound !== threadId) continue;
    // ⛔ 键前缀区分渠道：飞书/钉钉/QQ 也用同一张绑定表（fs:/dd:/qq:），不加这个过滤
    //    它们会被微信分支截胡 → 用微信网关去发飞书消息（09-18 加三渠道流式时差点踩）。
    if (/^(tg|fs|dd|qq|wecom):/.test(user)) continue;
    return { sink: weixinStreamSink(user), budget: WEIXIN_STREAM_BUDGET, typingFrom: user };
  }
  // 飞书 / 钉钉 / QQ（09-18 用户：接上流式，按各渠道限制做）：绑定表按渠道存 threadId，
  // 聊天 ID 在回合发起时记进 channelThreadChat（回复凭据随之刷新）。
  for (const channel of ["feishu", "dingtalk", "qq"] as const) {
    if (channelBotBindings[channel]?.threadId !== threadId) continue;
    const chatId = channelThreadChat.get(threadId);
    if (!chatId) continue;
    if (channel === "feishu") return { sink: feishuStreamSink(chatId), budget: FEISHU_STREAM_BUDGET };
    if (channel === "dingtalk") return { sink: dingtalkStreamSink(chatId), budget: DINGTALK_STREAM_BUDGET };
    if (qqReplyContexts.has(chatId)) return { sink: qqStreamSink(chatId), budget: QQ_STREAM_BUDGET };
  }
  return null;
}

// ── 频道机器人会话绑定（持久化）────────────────────────────────
// 渠道级绑定：机器人后续消息固定在选定会话中继续（UI 可选老会话/解绑重开）。
// 存 userData/bot-bindings.json；查找优先级：渠道绑定 > per-user 内存绑定。
// 新会话自动写入渠道绑定——顺带修了重启丢绑定（原内存绑定重启即丢，每次重启都开新会话）。
type BotChannelBinding = { threadId: string; title: string; updatedAt: number };
// ⛔ 这两个路径不能写成模块顶层 const（09-22 code review 抓出）：本模块在 main.ts 的 **import 期**求值，
//    而 `app.setPath("userData", …)` 是 main.ts 的**模块体语句**（编译产物里 require 在前、setPath 在后）
//    ⇒ 顶层求值拿到默认 userData `%APPDATA%\<package.json name>`，而应用真正用的是 setPath 之后的
//    `%APPDATA%\Codex Harness Desktop` ⇒ 机器人绑定 / bots.json 会写进另一个目录。
//    惰性求值（与 electron/personalization.ts 的既有约定一致）。
function botBindingsFile(): string {
  return path.join(app.getPath("userData"), "bot-bindings.json");
}
// 渠道键：wechat / telegram 为历史双键；feishu / dingtalk / qq 为 09-09 新增真实网关渠道
const channelBotBindings: Record<string, BotChannelBinding | null> = { wechat: null, telegram: null, feishu: null, dingtalk: null, qq: null };
let botBindingsLoaded = false;

async function loadBotBindings() {
  if (botBindingsLoaded) return;
  botBindingsLoaded = true;
  try {
    const raw = JSON.parse(await fs.readFile(botBindingsFile(), "utf8"));
    for (const key of Object.keys(channelBotBindings)) {
      const b = raw?.[key];
      if (b?.threadId) channelBotBindings[key] = { threadId: String(b.threadId), title: String(b.title ?? ""), updatedAt: Number(b.updatedAt ?? 0) };
    }
  } catch { /* 无绑定文件 */ }
}

async function writeBotBindings() {
  try { await fs.writeFile(botBindingsFile(), JSON.stringify({ ...channelBotBindings }, null, 2), "utf8"); } catch { /* 忽略 */ }
}


// ── 机器人档案持久化（09-13）：此前机器人列表只存渲染层 localStorage —— 清缓存/换实例
// 就整单丢失（用户实丢过一次，配对/绑定记录都在 userData 而档案没了）。迁到 userData/bots.json，
// 与 botBindings / bot-pairing 同层。localStorage 旧数据由渲染层启动时上交迁移（见 App.tsx）。
function botsFile(): string {
  return path.join(app.getPath("userData"), "bots.json");
}



// ── 微信机器人 IPC ───────────────────────────────────────────
// 取消扫码：停止前端轮询由渲染层 clearInterval 完成；网关若有 cancelLogin 则一并调用（回到未连接态）
// 各渠道真实连接状态（机器人列表圆点用）

const telegramGateway = new TelegramGateway({
  onMessage: (message) => void handleTelegramMessage(message),
  log: (level, message) => {
    channelLogs.push({ at: Date.now(), level, message });
    sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
  },
});
const telegramBindings = new Map<string, number>();

// ── 新增渠道（飞书/钉钉/QQ/企微Webhook）：统一走 handleChannelMessage 管线 ──
function channelLog(level: "info" | "error", message: string) {
  channelLogs.push({ at: Date.now(), level, message });
  persistChannelLog(level, message);
  sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
}

/** 渠道网关日志统一落盘（1MB 轮转 .old）：token 失效/发送失败这类事故只存在内存和 UI
 *  事件里时，窗口没开就丢——「消息没同步」类问题排查全靠它（09-12 微信事故教训）。 */
function persistChannelLog(level: "info" | "error", message: string) {
  try {
    const logFile = path.join(app.getPath("userData"), "channel-logs", "gateway.log");
    if (!existsSync(logFile) || statSync(logFile).size > 1024 * 1024) {
      mkdirSync(path.dirname(logFile), { recursive: true });
      if (existsSync(logFile)) renameSync(logFile, logFile.replace(/\.log$/, ".old"));
    }
    appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${message}\n`, "utf8");
  } catch { /* 日志落盘失败不影响主流程 */ }
}

const feishuGateway = new FeishuGateway({
  onMessage: (message) => void handleChannelMessage("feishu", message.from, message.chatId, message.text),
  // 语音消息：下载原始 opus → ffmpeg 归一 16k wav → ASR 转写 → 按普通文本走会话管线
  onAudio: (message) => void handleChannelAudioMessage(message),
  log: channelLog,
});

/** ffmpeg 可执行文件：随包按需安装（开发工具页），装过就在 tools/ffmpeg 下；都没装则期望 PATH 里有。
 *  ⛔ mac 适配（09-17 审计）：darwin 侧 install-runtimes 把 ffmpeg/ffprobe 放在 `tools/ffmpeg/bin/`，
 *  文件名**不带 .exe**（evermeet 单文件构建）；旧实现只找 `ffmpeg.exe` ⇒ mac 上永远回落到裸名 "ffmpeg"，
 *  而 GUI 启动的进程 PATH 里通常没有它 ⇒ 渠道语音消息（飞书 opus 转 16k wav）在 mac 上必失败。 */
function resolveFfmpegPath(): string {
  const rel = process.platform === "win32" ? ["ffmpeg", "ffmpeg.exe"] : ["ffmpeg", "bin", "ffmpeg"];
  const candidates = [
    path.join(process.resourcesPath ?? "", "tools", ...rel),
    path.join(appSourceRoot(), "resources", "tools", ...rel),
    path.join(appSourceRoot(), "tools", ...rel),
    // 内置工具目录里的 ffmpeg 直接可用（不论它是随包还是开发工具页装的）
    ...(toolsRoot() ? [path.join(toolsRoot(), ...rel)] : []),
  ];
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate; } catch { /* 忽略路径异常，继续下一个 */ }
  }
  return "ffmpeg";
}

/** 把渠道语音（飞书 opus / 其它）归一成 16k 单声道 PCM wav，供 sherpa ASR 直接吃。 */
async function transcodeToWav16k(inputPath: string): Promise<string> {
  const outPath = inputPath.replace(/\.[^.]+$/, "") + "-16k.wav";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}：${stderr.slice(-200)}`))));
    child.on("error", (error) => reject(new Error(`ffmpeg 不可用（请在开发工具页下载 FFmpeg）：${error.message}`)));
  });
  return outPath;
}

/** 渠道语音消息管线：转写成功后与普通文本消息走同一条路（会话绑定/回复机制全部复用）。 */
async function handleChannelAudioMessage(message: { from: string; chatId: string; messageId: string; fileKey: string; replyHint: string }) {
  try {
    await feishuGateway.sendMessage(message.chatId, "🎤 收到语音，正在转写…");
    const rawPath = await feishuGateway.downloadAudio(message.messageId, message.fileKey);
    let wavPath = "";
    try {
      wavPath = await transcodeToWav16k(rawPath);
    } catch (error: any) {
      await feishuGateway.sendMessage(message.chatId, `⚠️ ${error.message}`);
      return;
    } finally {
      await fs.rm(rawPath, { force: true }).catch(() => undefined);
    }
    const result = await voiceService.transcribeAudioFile(wavPath);
    await fs.rm(wavPath, { force: true }).catch(() => undefined);
    if (!result.ok) {
      await feishuGateway.sendMessage(message.chatId, `⚠️ 语音转写失败：${result.error ?? ""}`);
      return;
    }
    const text = String(result.text ?? "").trim();
    if (!text) {
      await feishuGateway.sendMessage(message.chatId, "⚠️ 语音转写结果为空，请靠近麦克风再说一遍");
      return;
    }
    await handleChannelMessage("feishu", message.from, message.chatId, text);
  } catch (error: any) {
    await feishuGateway.sendMessage(message.chatId, `⚠️ 语音处理失败：${error?.message ?? error}`).catch(() => undefined);
  }
}
const dingtalkGateway = new DingtalkGateway({
  onMessage: (message) => void handleChannelMessage("dingtalk", message.from, message.chatId, message.text),
  log: channelLog,
});
const qqGateway = new QqGateway({
  onMessage: (message) => { recordQqContext(message.from, message.chatId, message.msgId, message.scene); void handleChannelMessage("qq", message.from, message.chatId, message.text); },
  log: channelLog,
});
const wecomWebhookGateway = new WecomWebhookGateway({ log: channelLog });
// 飞书/钉钉/QQ 的流式回复目标：threadId → chatId（回合发起时记录，见 handleChannelMessage）
const channelThreadChat = new Map<string, string>();
// QQ 回复需要 msgId + scene（被动回复机制），与 chatId 一起缓存
const qqReplyContexts = new Map<string, { msgId: string; scene: "group" | "c2c" }>();

/** 飞书/钉钉/QQ 通用消息管线（与微信/Telegram 同语义）：绑定会话 > per-user 绑定 > 新建 */
const qqLastMsgId = new Map<string, string>();
const qqLastScene = new Map<string, "group" | "c2c">();
// QQ 被动回复上下文：gateway onMessage 包装层先记录（msgId/scene 5 分钟有效）
function recordQqContext(from: string, chatId: string, msgId: string, scene: "group" | "c2c") {
  qqLastMsgId.set(from, msgId);
  qqLastScene.set(from, scene);
  qqReplyContexts.set(chatId, { msgId, scene });
}

// QQ 官方扫码连接：桌面出二维码 → 手机 QQ（开放平台管理者账号）扫码确认 → 官方回传凭据 → 复用 qqGateway.connect
// 注意：扫码授权会重置该机器人的 AppSecret（腾讯规则），UI 文案已提示
// 飞书官方扫码连接（Device Authorization Flow，复刻 ZCode）：扫码 → 飞书自动建应用并授权 → 凭据回传 → 复用 feishuGateway.connect

// ponytail 技能包开关（写代码模式）：off 时钩子静默跳过，full 时注入精简工程规则
export { WEIXIN_STREAM_BUDGET, TELEGRAM_STREAM_BUDGET, FEISHU_STREAM_BUDGET, DINGTALK_STREAM_BUDGET, QQ_STREAM_BUDGET, weixinStreamSink, weixinTypingStops, startWeixinTyping, stopWeixinTyping, feishuStreamSink, dingtalkStreamSink, qqStreamSink, telegramStreamSink, botStreamSessions, botStreamPlanFor, weixinBindings, telegramBindings, botBindingsFile, botBindingsLoaded, loadBotBindings, writeBotBindings, botsFile, channelBotBindings, channelLog, persistChannelLog, channelThreadChat, qqReplyContexts, qqLastMsgId, qqLastScene, recordQqContext, handleChannelAudioMessage, transcodeToWav16k, resolveFfmpegPath, weixinGateway, telegramGateway, feishuGateway, dingtalkGateway, qqGateway, wecomWebhookGateway };
export type { BotChannelBinding };

/** ⛔ weixinGateway 的唯一写入口：main.ts 的 bindBoot 注入 + 退出清理都会用到；
 *  它是 `let`，跨文件不可直接赋值（TS2632），故经访问器暴露。 */
export function setWeixinGateway(g: WeixinGateway | null): void { weixinGateway = g; }
