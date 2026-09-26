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
import { app } from "electron";
import { botStreamSessions, channelBotBindings, channelLog, channelThreadChat, dingtalkGateway, feishuGateway, loadBotBindings, qqGateway, qqReplyContexts, telegramBindings, telegramGateway, weixinBindings, weixinGateway, writeBotBindings } from "../features/im-gateways";
import { readChannelBot } from "../main/04-connector-config";
import { readCustomModel } from "../main/01-model-catalog";
import { server } from "../runtime-refs";
import { botPairing } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
export async function handleWeixinMessage(message: { from: string; text: string; contextToken: string }) {
  if (!weixinGateway) return;
  // 配对门卫（09-13）：未批准的聊天只有发对 6 位授权码才放行，其余消息只收到配对引导
  const gate = botPairing.onChannelMessage("wechat", message.from, `微信 ${message.from}`, message.text);
  if (gate.action !== "allow") { await weixinGateway.sendText(message.from, gate.message).catch(() => undefined); return; }
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
        ...(model.provider === "openai-official" ? {} : { modelProvider: model.provider }),
      }) as any;
      threadId = started.thread.id;
      // 新会话自动写入渠道级绑定：重启后继续该会话（原内存绑定重启即丢，每次重启都开新会话）
      channelBotBindings.wechat = { threadId, title: `微信机器人会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set(message.from, threadId); // per-user 缓存：流式回复按 threadId 反查发送目标用
    // 微信回复需要 context_token。最终回复优先由 bot-stream 流式会话发出（含思考/工具同步、
    // 流式关闭时的整段发送）；会话未建成功（绑定竞态等）时这里兜底发最终正文。
    const from = message.from;
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      if (botStreamSessions.has(threadId)) return;
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) weixinGateway?.sendText(from, finalText.trim()).catch((error) => console.warn("微信回信失败:", error.message));
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text: `[微信用户] ${message.text}`, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    console.warn("微信消息处理失败:", error.message);
    weixinGateway.sendText(message.from, `处理失败：${error.message}`).catch(() => undefined);
  }
}
export async function handleTelegramMessage(message: { from: string; chatId: number; text: string }) {
  // 配对门卫（09-13）：同微信
  const gate = botPairing.onChannelMessage("telegram", String(message.chatId), `Telegram ${message.from}`, message.text);
  if (gate.action !== "allow") { await telegramGateway.sendText(message.chatId, gate.message).catch(() => undefined); return; }
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
      const started = await server.request("thread/start", { model: model.model, cwd: (botConfig?.workspace || app.getPath("home")), approvalPolicy: "never", sandbox: "danger-full-access", ...(model.provider === "openai-official" ? {} : { modelProvider: model.provider }) }) as any;
      threadId = started.thread.id;
      weixinBindings.set("tg:" + message.from, threadId);
      channelBotBindings.telegram = { threadId, title: `Telegram 会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set("tg:" + message.from, threadId); // per-user 缓存：流式回复按 threadId 反查发送目标用
    const chatId = message.chatId;
    telegramBindings.set(threadId, chatId); // bot-stream 会话按 threadId 反查渠道
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      if (botStreamSessions.has(threadId)) return; // 流式会话负责最终回复
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) telegramGateway.sendText(chatId, finalText.trim()).catch(() => undefined);
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text: message.text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    telegramGateway.sendText(message.chatId, `处理失败：${error.message}`).catch(() => undefined);
  }
}
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
    }
  };
  // 配对门卫（09-13）：未批准的聊天先发 6 位授权码配对（等电脑端允许），其余消息只收到配对引导
  const gate = botPairing.onChannelMessage(channel, chatId, `${channel} ${from}`, text);
  if (gate.action !== "allow") { await reply(gate.message); return; }
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
      const started = await server.request("thread/start", { model: model.model, cwd: (botConfig?.workspace || app.getPath("home")), approvalPolicy: "never", sandbox: "danger-full-access", ...(model.provider === "openai-official" ? {} : { modelProvider: model.provider }) }) as any;
      threadId = started.thread.id;
      weixinBindings.set(prefix + from, threadId);
      channelBotBindings[channel] = { threadId, title: `${channel} 会话 ${new Date().toLocaleDateString("zh-CN")}`, updatedAt: Date.now() };
      await writeBotBindings();
    }
    weixinBindings.set(prefix + from, threadId);
    // 流式回复目标登记（09-18）：飞书/钉钉/QQ 的 sink 需要 chatId 才能发进度消息
    channelThreadChat.set(threadId, chatId);
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      if (botStreamSessions.has(threadId)) return;
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) void reply(finalText.trim());
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    void reply(`处理失败：${error.message}`);
  }
}
