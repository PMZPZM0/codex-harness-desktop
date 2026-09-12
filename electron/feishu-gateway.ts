import path from "node:path";
import os from "node:os";
import fs from "node:fs";
// 飞书机器人网关：官方 @larksuiteoapi/node-sdk WebSocket 长连接（免公网 IP/免回调域名）。
// 用户在 open.feishu.cn 建「企业自建应用」→ 开启机器人能力 + im:message 权限 →
// 拿 App ID / App Secret 填入即连；群里 @机器人 或私聊发消息都会推到本进程。
// 凭据持久化 userData/feishu-account.json，重启自动恢复长连接。
import lark from "@larksuiteoapi/node-sdk";

const STATE_FILE = path.join(
  process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"),
  "feishu-account.json",
);

export type FeishuEvents = {
  onMessage: (message: { from: string; chatId: string; text: string; replyHint: string }) => void;
  /** 飞书语音消息：上层负责下载后 ASR，避免网关耦合语音模型。 */
  onAudio?: (message: { from: string; chatId: string; messageId: string; fileKey: string; replyHint: string }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

export class FeishuGateway {
  private client: any = null;
  private ws: any = null;
  private appId = "";
  private appSecret = "";
  private botName = "";
  private running = false;
  private events: FeishuEvents;

  constructor(events: FeishuEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  /** 校验凭据并建立长连接 */
  async connect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string }> {
    const id = appId.trim();
    const secret = appSecret.trim();
    if (!id || !secret) throw new Error("App ID / App Secret 不能为空（open.feishu.cn → 开发者后台 → 凭证与基础信息）");
    // 先用 auth/v3/app_access_token/internal 校验凭据有效性（官方接口，快且无副作用）
    const probe = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: id, app_secret: secret }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()) as any;
    if (probe.code !== 0) throw new Error(`凭据无效（code ${probe.code}）：${probe.msg ?? ""}。请检查 App ID/Secret，并确认应用已发布可用版本`);
    this.appId = id;
    this.appSecret = secret;
    this.running = true;
    // 长连接客户端：WebSocket 模式，事件分发走 eventDispatcher
    this.client = new lark.Client({ appId: id, appSecret: secret, domain: lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn });
    const dispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const msg = data?.message ?? {};
          const chatId = String(msg.chat_id ?? "");
          const from = String(data?.sender?.sender_id?.open_id ?? "飞书用户");
          let text = "";
          if (msg.message_type === "text") {
            text = String(JSON.parse(msg.content ?? "{}")?.text ?? "").trim();
          } else if (msg.message_type === "post") {
            // 富文本：拼纯文本兜底
            try {
              const post = JSON.parse(msg.content ?? "{}")?.post;
              const zh = post?.zh_cn ?? Object.values(post ?? {})[0] as any;
              text = (zh?.content ?? []).flat?.(9).map((node: any) => node?.text ?? node?.content ?? "").join("") ?? "";
            } catch { text = ""; }
          } else if (msg.message_type === "audio") {
            // 语音消息：交给上层下载 + ASR 转写（转写完按普通文本走管线）
            try {
              const fileKey = String(JSON.parse(msg.content ?? "{}")?.fileKey ?? "");
              if (fileKey && chatId) {
                this.events.onAudio?.({ from, chatId, messageId: String(msg.message_id ?? ""), fileKey, replyHint: chatId });
              }
            } catch (error: any) { this.log("error", `语音消息解析异常：${error?.message ?? error}`); }
            return;
          }
          if (!text || !chatId) return;
          // @机器人 的文本会带 @_user_1 占位，去掉
          text = text.replace(/@_user_\d+/g, "").trim();
          if (!text) return;
          this.events.onMessage({ from, chatId, text, replyHint: chatId });
        } catch (error: any) {
          this.log("error", `飞书消息处理异常：${error?.message ?? error}`);
        }
      },
    });
    this.ws = new lark.WSClient({ appId: id, appSecret: secret, domain: lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn });
    await this.ws.start({ eventDispatcher: dispatcher });
    // 拿机器人名字做展示（失败不阻塞连接）
    try {
      const me = await this.client.bot.info.get();
      this.botName = String(me?.data?.bot?.app_name ?? "");
    } catch { this.botName = ""; }
    try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify({ appId: id, appSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", `飞书机器人${this.botName ? `「${this.botName}」` : ""}已连接（长连接模式）`);
    return { ok: true, name: this.botName || "飞书机器人" };
  }

  /** 下载语音消息的音频文件到临时目录。飞书语音是 opus 编码（.ogg），上层负责用
   *  ffmpeg 归一成 16k 单声道 wav 再喂 ASR——网关只管取到原始字节。 */
  async downloadAudio(messageId: string, fileKey: string): Promise<string> {
    if (!this.client) throw new Error("飞书网关未连接");
    const result: any = await this.client.im.messageResources.get({
      path: { message_id: messageId },
      params: { file_key: fileKey, type: "file" },
    });
    let data: Buffer | null = null;
    if (Buffer.isBuffer(result)) data = result;
    else if (result?.data instanceof ArrayBuffer) data = Buffer.from(result.data);
    else if (Buffer.isBuffer(result?.data)) data = result.data;
    else if (typeof result?.arrayBuffer === "function") data = Buffer.from(await result.arrayBuffer());
    else if (result) data = Buffer.from(result);
    if (!data?.length) throw new Error("语音文件下载为空（检查应用是否有 im:message.resource 权限）");
    const file = path.join(os.tmpdir(), `feishu-voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.ogg`);
    await fs.promises.writeFile(file, data);
    return file;
  }

  /** 回复消息：reply 参数给 received_message_id（群内回复）/ 否则 chatId 直发 */
  async sendMessage(chatId: string, text: string, receivedMessageId?: string): Promise<void> {
    if (!this.client) throw new Error("飞书机器人未连接");
    const content = JSON.stringify({ text: text.slice(0, 4000) });
    if (receivedMessageId) {
      await this.client.im.message.reply({ path: { message_id: receivedMessageId }, data: { content, msg_type: "text" } });
      return;
    }
    await this.client.im.message.create({ data: { receive_id: chatId, content, msg_type: "text" }, params: { receive_id_type: "chat_id" } });
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (raw.appId && raw.appSecret) {
        await this.connect(String(raw.appId), String(raw.appSecret));
        return true;
      }
    } catch (error: any) {
      this.log("error", `飞书自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  hasSession() { return Boolean(this.ws); }
  botDisplayName() { return this.botName; }

  logout() {
    this.running = false;
    try { this.ws?.close?.(); } catch { /* 忽略 */ }
    this.ws = null;
    this.client = null;
    this.botName = "";
    try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* 忽略 */ }
    this.log("info", "飞书登录态已清除，可重新绑定");
  }
}
