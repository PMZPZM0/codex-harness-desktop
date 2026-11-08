/**
 * im-inbound（09-21 架构改造：从 electron/main.ts 组合根按符号拆出，纯搬迁）
 *
 * 搬出符号：handleChannelMessage / handleWeixinMessage / handleTelegramMessage
 *
 * 代码与原地逐字一致（仅顶部 import + 文件头注释）。
 * 跨域符号经 `import … from "../main"` 取用 —— **活绑定**（TS→CJS 编译成 `main_1.X` 属性访问）。
 * 会被重新赋值的符号经 `mutableState` 访问器读写（ESM 里 import 的绑定不可赋值）。
 */
import { plainTextForChannel } from "../channel-text";
import { HARNESS_PROVIDER_ID } from "../provider-id";
import { app } from "electron";
import { botStreamSessions, channelBotBindings, channelLog, channelThreadChat, dingtalkGateway, feishuGateway, loadBotBindings, qqGateway, qqReplyContexts, rotateChannelThreadOnOverflow, telegramBindings, telegramGateway, weixinBindings, weixinGateway, weixinThreadChat, writeBotBindings } from "../features/im-gateways";
import { describeTurnError } from "../turn-error-text";
import { readChannelBot } from "../main/04-connector-config";
import { readCustomModel } from "../main/01-model-catalog";
import { server } from "../runtime-refs";
import { botPairing } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
import { isTurnEndMethod } from "../turn-end";

/** 渠道回合的权限口径（11-05）：机器人可以绑定**已有桌面会话**，而那个会话可能建在
 *  workspace-write / read-only 沙箱下 —— 只按线程继承的话，QQ/微信发过去的指令能聊不能做
 *  （用户原话「微信可以控制，QQ 控制不了」，差别就在绑的是哪个会话）。
 *  turn/start 支持逐回合覆盖 sandboxPolicy / approvalPolicy（引擎 0.166 schema 实测），
 *  渠道是「手机遥控电脑」的入口，这里统一给全权限；谁能用由配对门卫把关。 */
const CHANNEL_TURN_OVERRIDE = { approvalPolicy: "never" as const, sandboxPolicy: { type: "dangerFullAccess" as const } };

/** 渠道入站共用的「回合结束」兜底代理：流式会话缺席时把最终正文投给用户。
 *  ⛔ 四类结束事件都要摘除并投递 —— 只认 turn/completed 时，被中断 / 失败的回合
 *  这个监听器**永远挂着**（泄漏）且渠道用户收不到任何下文（用户反馈截图正是它）。
 *  非正常结束时要**说明**：半截文本不标注会被当成完整回复。
 *  返回 dispose：`turn/start` 抛错时调用方必须摘掉它，否则下一次该会话在**桌面端**跑完，
 *  答复会被推给渠道用户（11-04 审查抓出的内容外泄路径）。 */
/** 渠道会话上下文超限 ⇒ 解除该渠道绑定（下一条消息自动开新会话）。
 *  ⛔ 只在确认是「超限」时动手：别把普通错误也当成换会话的理由（丢上下文）。 */
function maybeRotateOnOverflow(threadId: string, raw: unknown): void {
  const msg = typeof raw === "string" ? raw : String((raw as { message?: unknown } | null)?.message ?? "");
  if (!msg || !threadId) return;
  try {
    if (describeTurnError(msg).title === "内容超出模型上限") rotateChannelThreadOnOverflow(threadId);
  } catch { /* 文案归一出错不影响主流程 */ }
}

function onTurnDone(threadId: string, send: (text: string) => void): () => void {
  let armed = true;
  const dispose = () => {
    if (!armed) return;
    armed = false;
    server.off("event", proxy);
  };
  const proxy = (event: any) => {
    if (event.kind !== "notification" || !isTurnEndMethod(event.method) || event.params?.threadId !== threadId) return;
    maybeRotateOnOverflow(threadId, event.params?.turn?.error?.message);
    dispose();
    if (botStreamSessions.has(threadId)) return; // 流式会话负责最终回复
    const ok = event.method === "turn/completed";
    const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
    const text = ok ? finalText.trim() : (finalText.trim()
      ? `${finalText.trim()}\n\n⚠️ 这个回合没有正常跑完，以上是已产生的部分内容。`
      : `⚠️ Codex 的回合没有正常跑完，没有产出内容。`);
    if (text.trim()) send(text);
  };
  server.on("event", proxy);
  // TTL 兜底：结束事件形态不对时代理不会自己摘 ⇒ 30 分钟后强制失效（宁可少投一次，
  // 也不能让「桌面端的答复被推给渠道」这种串台长期存在）
  const ttl = setTimeout(dispose, 30 * 60_000);
  ttl.unref?.();
  return dispose;
}

/** 处理一条微信入站消息：四步各留一行日志（收到 / 配对门卫 / 建回合 / 回信），打包版 stdout 不可见时靠它定位卡在哪一步。 */
export async function handleWeixinMessage(message: { from: string; text: string; contextToken: string }) {
  if (!weixinGateway) return;
  // ⛔ 四步各留一行（与 QQ/飞书/钉钉同一口径，11-04 补齐）：旧写法全程只有 console.warn，
  //   打包版 stdout 不可见 ⇒ 用户报「微信发了没反应」时，「事件没到 / 卡在配对 / 回合没跑完 /
  //   回信失败」四种情况在日志里完全一样。
  channelLog("info", `wechat 收到消息（聊天 ${String(message.from).slice(0, 8)}…，${message.text.length} 字）`);
  // 配对门卫（09-13）：未批准的聊天只有发对 6 位授权码才放行，其余消息只收到配对引导
  const gate = botPairing.onChannelMessage("wechat", message.from, `微信 ${message.from}`, message.text);
  if (gate.action !== "allow") {
    channelLog("info", `wechat 配对判定 = ${gate.action}（未批准 ⇒ 只回引导，不进会话）`);
    await weixinGateway.sendText(message.from, gate.message).catch((error: any) => channelLog("error", `wechat 引导语发送失败：${error?.message ?? error}`));
    return;
  }
  let stopTurnWatch: (() => void) | null = null;
  try {
    const model = await readCustomModel();
    if (!model) { await weixinGateway.sendText(message.from, "请先在应用里配置模型再使用微信机器人。"); return; }
    // 会话解析优先级：渠道级绑定（UI 可选老会话/持久化）> per-user 内存绑定；都没有才开新会话
    await loadBotBindings();
    let threadId = (channelBotBindings.wechat?.threadId ?? "") || weixinBindings.get(message.from) || "";
    if (threadId) {
      let resumed = false;
      // 瞬态失败重试一次再放弃：绑定被静默重置的表现是「选了老会话又被弹回新会话」
      for (let attempt = 0; attempt < 2 && !resumed; attempt++) {
        try {
          await server.request("thread/resume", { threadId, excludeTurns: false });
          resumed = true;
        } catch {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
          threadId = "";
          weixinBindings.delete(message.from);
          if (channelBotBindings.wechat?.threadId) { channelBotBindings.wechat = null; await writeBotBindings(); }
        }
      }
    }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      ensureProjectAgentsMd(botConfig?.workspace || app.getPath("home"));
      const started = await server.request("thread/start", {
        model: model.model,
        cwd: (botConfig?.workspace || app.getPath("home")),
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ...(model.provider === "openai-official" ? {} : { modelProvider: HARNESS_PROVIDER_ID }),
      }) as any;
      threadId = started.thread.id;
      // 新会话自动写入渠道级绑定：重启后继续该会话（原内存绑定重启即丢，每次重启都开新会话）
      channelBotBindings.wechat = { threadId, title: `微信机器人会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set(message.from, threadId); // per-user 缓存：流式回复按 threadId 反查发送目标用
    // ⛔ 同时记「这条线程是谁发起的」：渠道级绑定让所有微信用户共用同一 thread 时，
    //    botStreamPlanFor 只按 weixinBindings 反查会拿到**别人的** from ⇒ 甲的问题回给乙
    //    （11-04 审查抓出的串台）。回合发起处记的那条才是权威。
    weixinThreadChat.set(threadId, message.from);
    // 微信回复需要 context_token。最终回复优先由 bot-stream 流式会话发出（含思考/工具同步、
    // 流式关闭时的整段发送）；会话未建成功（绑定竞态等）时这里兜底发最终正文。
    const from = message.from;
    stopTurnWatch = onTurnDone(threadId, (text) => weixinGateway?.sendText(from, text).catch((error: any) => channelLog("error", `wechat 回信失败：${error?.message ?? error}`)));
    channelLog("info", `wechat 已交给会话 ${String(threadId).slice(0, 8)}…（回合开始）`);
    await server.request("turn/start", { threadId, ...CHANNEL_TURN_OVERRIDE, input: [{ type: "text", text: `[微信用户] ${message.text}`, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    // ⛔ 起回合失败必须把结束监听摘掉：留着它，下次这一会话在**桌面端**跑完，
    //    答复会被推到微信那个人的聊天框里（内容外泄，11-04 审查）
    stopTurnWatch?.();
    channelLog("error", `wechat 处理失败：${error?.message ?? error}`);
    weixinGateway.sendText(message.from, `处理失败：${error.message}`).catch(() => undefined);
  }
}
/** 处理一条 Telegram 入站消息：与微信同口径的四步日志 + 配对门卫。 */
export async function handleTelegramMessage(message: { from: string; chatId: number; text: string }) {
  // 四步日志（与微信/QQ 同口径，11-04 补齐）：旧写法全程零 channelLog，失败只把错误发回聊天
  channelLog("info", `telegram 收到消息（聊天 ${String(message.chatId).slice(0, 8)}…，${message.text.length} 字）`);
  // 配对门卫（09-13）：同微信
  const gate = botPairing.onChannelMessage("telegram", String(message.chatId), `Telegram ${message.from}`, message.text);
  if (gate.action !== "allow") {
    channelLog("info", `telegram 配对判定 = ${gate.action}（未批准 ⇒ 只回引导，不进会话）`);
    await telegramGateway.sendText(message.chatId, gate.message).catch((error: any) => channelLog("error", `telegram 引导语发送失败：${error?.message ?? error}`));
    return;
  }
  let stopTurnWatch: (() => void) | null = null;
  try {
    const model = await readCustomModel();
    if (!model) { await telegramGateway.sendText(message.chatId, "请先在应用里配置模型。"); return; }
    let threadId = weixinBindings.get("tg:" + message.from) ?? "";
    // 会话解析优先级：渠道级绑定（UI 可选老会话/持久化）> per-user 内存绑定（与微信一致）
    await loadBotBindings();
    threadId = (channelBotBindings.telegram?.threadId ?? "") || threadId;
    if (threadId) {
      let resumed = false;
      for (let attempt = 0; attempt < 2 && !resumed; attempt++) {
        try {
          await server.request("thread/resume", { threadId, excludeTurns: false });
          resumed = true;
        } catch {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
          threadId = "";
          weixinBindings.delete("tg:" + message.from);
          if (channelBotBindings.telegram?.threadId) { channelBotBindings.telegram = null; await writeBotBindings(); }
        }
      }
    }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      const started = await server.request("thread/start", { model: model.model, cwd: (botConfig?.workspace || app.getPath("home")), approvalPolicy: "never", sandbox: "danger-full-access", ...(model.provider === "openai-official" ? {} : { modelProvider: HARNESS_PROVIDER_ID }) }) as any;
      threadId = started.thread.id;
      weixinBindings.set("tg:" + message.from, threadId);
      channelBotBindings.telegram = { threadId, title: `Telegram 会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set("tg:" + message.from, threadId); // per-user 缓存：流式回复按 threadId 反查发送目标用
    const chatId = message.chatId;
    telegramBindings.set(threadId, chatId); // bot-stream 会话按 threadId 反查渠道
    stopTurnWatch = onTurnDone(threadId, (text) => telegramGateway.sendText(chatId, text).catch((error: any) => channelLog("error", `telegram 回信失败：${error?.message ?? error}`)));
    channelLog("info", `telegram 已交给会话 ${String(threadId).slice(0, 8)}…（回合开始）`);
    await server.request("turn/start", { threadId, ...CHANNEL_TURN_OVERRIDE, input: [{ type: "text", text: message.text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    stopTurnWatch?.(); // ⛔ 起回合失败必须摘掉结束监听（否则下次该会话在桌面端跑完，答复被推到 Telegram）
    channelLog("error", `telegram 处理失败：${error?.message ?? error}`);
    telegramGateway.sendText(message.chatId, `处理失败：${error.message}`).catch(() => undefined);
  }
}
/** 处理飞书/钉钉/QQ 的入站消息：按渠道取网关、统一纯文本排版后回信（三个渠道共用一套流程）。 */
export async function handleChannelMessage(channel: "feishu" | "dingtalk" | "qq", from: string, chatId: string, text: string) {
  const prefix = { feishu: "fs:", dingtalk: "dd:", qq: "qq:" }[channel];
  const gateway = { feishu: feishuGateway, dingtalk: dingtalkGateway, qq: qqGateway }[channel];
  const reply = async (content: string) => {
    try {
      // 纯文本排版统一（09-18）：飞书 msg_type=text / 钉钉 msgtype=text / QQ msg_type=0
      // 都是纯文本消息，Markdown 表格与粗体原样过去不可读——与微信同一套转换。
      const text = plainTextForChannel(content);
      if (channel === "qq") {
        const ctx = qqReplyContexts.get(chatId);
        if (!ctx) throw new Error("缺少被动回复上下文（msg_id 5 分钟内有效），请重新 @机器人");
        await qqGateway.sendMessage(chatId, text, ctx);
      } else if (channel === "feishu") {
        await feishuGateway.sendMessage(chatId, text);
      } else {
        await dingtalkGateway.sendMessage(chatId, text);
      }
    } catch (error: any) {
      channelLog("error", `${channel} 回复失败：${error?.message ?? error}`);
      return;
    }
    // ⛔ 成功也要留一行：用户报「发消息没反应」时，「有没有走到发送这一步」是唯一能分清
    //   「平台没推事件」与「我们回不去（发送权限 / msg_id 过期）」的证据（11-04 实测就是靠这条定性）
    channelLog("info", `${channel} 回复已发送（${content.length} 字）`);
  };
  // 入站先记一行（配对判定之前）：没有这行 = 事件根本没到应用，问题在平台侧权限/上线/@
  channelLog("info", `${channel} 收到消息（聊天 ${String(chatId).slice(0, 8)}…，${text.length} 字）`);
  // 配对门卫（09-13）：未批准的聊天先发 6 位授权码配对（等电脑端允许），其余消息只收到配对引导
  const gate = botPairing.onChannelMessage(channel, chatId, `${channel} ${from}`, text);
  if (gate.action !== "allow") {
    channelLog("info", `${channel} 配对判定 = ${gate.action}（未批准 ⇒ 只回引导，不进会话）`);
    await reply(gate.message);
    return;
  }
  let stopTurnWatch: (() => void) | null = null;
  try {
    const model = await readCustomModel();
    if (!model) { await reply("请先在应用里配置模型。"); return; }
    let threadId = weixinBindings.get(prefix + from) ?? "";
    await loadBotBindings();
    threadId = (channelBotBindings[channel]?.threadId ?? "") || threadId;
    if (threadId) {
      let resumed = false;
      for (let attempt = 0; attempt < 2 && !resumed; attempt++) {
        try {
          await server.request("thread/resume", { threadId, excludeTurns: false });
          resumed = true;
        } catch {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
          threadId = "";
          weixinBindings.delete(prefix + from);
          if (channelBotBindings[channel]?.threadId) { channelBotBindings[channel] = null; await writeBotBindings(); }
        }
      }
    }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      const started = await server.request("thread/start", { model: model.model, cwd: (botConfig?.workspace || app.getPath("home")), approvalPolicy: "never", sandbox: "danger-full-access", ...(model.provider === "openai-official" ? {} : { modelProvider: HARNESS_PROVIDER_ID }) }) as any;
      threadId = started.thread.id;
      weixinBindings.set(prefix + from, threadId);
      channelBotBindings[channel] = { threadId, title: `${channel} 会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set(prefix + from, threadId);
    // 流式回复目标登记（09-18）：飞书/钉钉/QQ 的 sink 需要 chatId 才能发进度消息
    channelThreadChat.set(threadId, chatId);
    // 「进会话了但没有回复」与「没进会话」是两种毛病 ⇒ 交接这一步必须有行可查
    channelLog("info", `${channel} 已交给会话 ${String(threadId).slice(0, 8)}…（回合开始）`);
    stopTurnWatch = onTurnDone(threadId, (text) => void reply(text));
    await server.request("turn/start", { threadId, ...CHANNEL_TURN_OVERRIDE, input: [{ type: "text", text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    // ⛔ 起回合失败必须摘掉结束监听：留着它，下次这一会话在**桌面端**跑完，答复会被推给渠道
    //    （11-04 审查抓出的内容外泄路径；QQ 那次「回合没跑完监听永远挂着」是同族问题）
    stopTurnWatch?.();
    void reply(`处理失败：${error.message}`);
  }
}
