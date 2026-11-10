import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { app } from "electron";
// 飞书机器人网关：官方 @larksuiteoapi/node-sdk WebSocket 长连接（免公网 IP/免回调域名）。
// 用户在 open.feishu.cn 建「企业自建应用」→ 开启机器人能力 + im:message 权限 →
// 拿 App ID / App Secret 填入即连；群里 @机器人 或私聊发消息都会推到本进程。
// 凭据持久化 userData/feishu-account.json，重启自动恢复长连接。
import lark from "@larksuiteoapi/node-sdk";
import { guardedFetch } from "./net-guard";

/** 凭据落点：**惰性**取 userData ——
 *  ⛔ 模块顶层求值会早于 main.ts 的 `app.setPath("userData")` ⇒ 拿到默认目录（路径静默漂移）。
 *  ⛔ 也不许写死 `AppData\Roaming\<应用名>`：mac 是 `~/Library/Application Support/`，
 *     且 PPcode 的 userData 目录名与本仓不同 ⇒ 写死会读写到**另一个应用**的数据。
 *  （11-04 审查：本文件原来是顶层 const + 写死路径 ⇒ 自定义目录 / mac / PPcode 的「重启自动恢复」全废）
 *  `CODEX_HARNESS_USER_DATA` 是测试开关（隔离 profile 用），优先级最高。 */
function stateFile(): string {
  const dir = process.env.CODEX_HARNESS_USER_DATA || app.getPath("userData");
  return path.join(dir, "feishu-account.json");
}

/** 飞书文本消息上限（超出必须留「已截断」标记，⛔ 不许静默砍尾 —— 钉钉/企微都有标记，这里漏了） */
const FEISHU_TEXT_MAX = 4000;

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
  /** 已处理过的 message_id → 时间。飞书是**至少一次**投递（超时按 15s/5min/1h/6h 最多重推 4 次），
   *  不去重就是同一个问题跑两遍回合、回两遍（11-04 审查对照 QQ 的同族缺陷补齐）。 */
  private seenMessageIds = new Map<string, number>();
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
    const probeResponse = await guardedFetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: id, app_secret: secret }),
      signal: AbortSignal.timeout(10_000),
    }, { timeoutMs: 10_000 });
    const probe = (await probeResponse.json().catch(() => ({}))) as any;
    if (!probeResponse.ok || probe.code !== 0) {
      throw new Error(`凭据无效（HTTP ${probeResponse.status}，code ${probe.code ?? "无"}）：${probe.msg ?? JSON.stringify(probe).slice(0, 120)}。请检查 App ID/Secret，并确认应用已发布可用版本`);
    }
    this.appId = id;
    this.appSecret = secret;
    this.running = true;
    // ⛔ 先摘掉上一条长连接：自动恢复 / 手动重连 / 重新绑定各开一条的话，同一条事件会被派发多次
    this.detachClient();
    // 长连接客户端：WebSocket 模式，事件分发走 eventDispatcher
    this.client = new lark.Client({ appId: id, appSecret: secret, domain: lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn });
    const dispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          const msg = data?.message ?? {};
          const chatId = String(msg.chat_id ?? "");
          const messageId = String(msg.message_id ?? "");
          const from = String(data?.sender?.sender_id?.open_id ?? "飞书用户");
          // 至少一次投递：同 message_id 十分钟内见过就算重推（语音分支同样要判，否则转写两遍）
          if (messageId && this.isDuplicate(messageId)) {
            this.log("info", `飞书事件 ${messageId.slice(0, 12)}… 是重推 ⇒ 只处理一次`);
            return;
          }
          let text = "";
          if (msg.message_type === "text") {
            text = String(JSON.parse(msg.content ?? "{}")?.text ?? "").trim();
          } else if (msg.message_type === "post") {
            // 富文本：拼纯文本兜底
            try {
              const post = JSON.parse(msg.content ?? "{}")?.post;
              const zh = post?.zh_cn ?? Object.values(post ?? {})[0] as any;
              text = (zh?.content ?? []).flat?.(9).map((node: any) => node?.text ?? node?.content ?? "").join("") ?? "";
            } catch (error: any) {
              // 解析失败**不许**再报「没有可用文本」——那等于把我们的 bug 说成用户发了空消息
              this.log("error", `飞书富文本解析失败：${error?.message ?? error}`);
              return;
            }
          } else if (msg.message_type === "audio") {
            // 语音消息：交给上层下载 + ASR 转写（转写完按普通文本走管线）。
            // ⛔ 官方 content 里的字段是 **file_key**（下划线）——旧写法读 `fileKey` 恒为空
            //   ⇒ 发语音永远没反应、整条 onAudio 链是死代码、且一行日志都不留（11-04 审查抓出）。
            //   两种写法都认，兼容为上。
            let parsed: any = {};
            try { parsed = JSON.parse(msg.content ?? "{}"); } catch (error: any) { this.log("error", `飞书语音 content 解析失败：${error?.message ?? error}`); return; }
            const fileKey = String(parsed?.file_key ?? parsed?.fileKey ?? "");
            if (!fileKey || !chatId) {
              this.log("error", `飞书语音消息取不到 file_key 或 chat_id（content 字段：${Object.keys(parsed ?? {}).join("/") || "空"}）⇒ 无法转写`);
              return;
            }
            this.log("info", `收到 飞书语音消息（聊天 ${chatId.slice(0, 8)}…）⇒ 转写后按文本处理`);
            this.events.onAudio?.({ from, chatId, messageId, fileKey, replyHint: chatId });
            return;
          } else {
            // 其它类型（图片/文件/卡片…）：不再静默丢弃，明确说明为什么不理
            this.log("info", `飞书收到 ${msg.message_type ?? "未知"} 类型消息，当前只处理文本/富文本/语音 ⇒ 不回复`);
            return;
          }
          // ⛔ 两种「不理」的原因必须分开写：合并成一条日志会把真因盖掉（QQ 11-04 就是这么被误导的）
          if (!chatId) {
            this.log("error", `飞书事件取不到 chat_id（收到的字段：${Object.keys(msg).join("/") || "空"}）⇒ 无法回复`);
            return;
          }
          // @机器人 的文本会带 @_user_1 占位，去掉
          text = text.replace(/@_user_\d+/g, "").trim();
          if (!text) {
            this.log("info", "飞书消息没有可用文本（纯 @机器人 或空正文）⇒ 不回复");
            return;
          }
          this.log("info", `收到 飞书消息（聊天 ${chatId.slice(0, 8)}…，${text.length} 字）`);
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
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify({ appId: id, appSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    // 措辞如实：SDK 连不上时 start() 也不会 reject ⇒ 这里只报「已启动」，
    // 「到底活着没有」由 hasSession() 读 getConnectionStatus（⛔ 别写「已连接」骗人）
    this.log("info", `飞书机器人${this.botName ? `「${this.botName}」` : ""}长连接已启动（凭据校验通过）`);
    return { ok: true, name: this.botName || "飞书机器人" };
  }

  /** 摘掉上一条长连接与客户端（重连 / 重新绑定 / 解绑共用） */
  private detachClient(): void {
    if (this.ws) {
      try { this.ws.close?.(); } catch { /* 忽略 */ }
      this.ws = null;
    }
    this.client = null;
  }

  /** 同 message_id 十分钟内见过就算重推（飞书超时按 15s/5min/1h/6h 最多重推 4 次） */
  private isDuplicate(messageId: string): boolean {
    const now = Date.now();
    if (this.seenMessageIds.size > 400) {
      for (const [id, at] of this.seenMessageIds) if (now - at > 10 * 60_000) this.seenMessageIds.delete(id);
    }
    if (this.seenMessageIds.has(messageId)) {
      this.seenMessageIds.set(messageId, now);
      return true;
    }
    this.seenMessageIds.set(messageId, now);
    return false;
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
    // ⛔ 兜底不许直接 `Buffer.from(对象)`：SDK 业务错误返回的是普通对象，Buffer.from 会抛英文
    //    TypeError（"The first argument must be of type string or an instance of Buffer…"），
    //    下面那句中文提示永远到不了用户眼前（11-04 审查抓出）
    else if (result && typeof result === "object" && "code" in result) {
      throw new Error(`语音下载失败（code ${result.code}）：${result.msg ?? ""}（检查应用是否有 im:message.resource 权限）`);
    } else if (ArrayBuffer.isView(result)) data = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
    if (!data?.length) throw new Error("语音文件下载为空（检查应用是否有 im:message.resource 权限）");
    const file = path.join(os.tmpdir(), `feishu-voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.ogg`);
    await fs.promises.writeFile(file, data);
    return file;
  }

  /** 回复消息：reply 参数给 received_message_id（群内回复）/ 否则 chatId 直发 */
  async sendMessage(chatId: string, text: string, receivedMessageId?: string): Promise<void> {
    if (!this.client) throw new Error("飞书机器人未连接");
    const clipped = text.length > FEISHU_TEXT_MAX ? `${text.slice(0, FEISHU_TEXT_MAX)}\n\n…（内容过长已截断）` : text;
    const content = JSON.stringify({ text: clipped });
    // ⛔ SDK 的生成方法**不会因业务错误抛异常**：响应拦截器只 `return resp.data`，没权限/超长/
    //   群不存在都是 HTTP 200 + code≠0。旧写法只 await 不看返回值 ⇒ 失败被当成功，上层还写一行
    //   「回复已发送」假日志（11-04 审查抓出；同仓 channel-bot.ts 的老路径
    //   `!response.ok || result.code !== 0` 才是正确写法）。
    const sent: any = receivedMessageId
      ? await this.client.im.message.reply({ path: { message_id: receivedMessageId }, data: { content, msg_type: "text" } })
      : await this.client.im.message.create({ data: { receive_id: chatId, content, msg_type: "text" }, params: { receive_id_type: "chat_id" } });
    const code = Number(sent?.code ?? 0);
    if (code !== 0) {
      throw new Error(`飞书发送失败（code ${code}）：${sent?.msg ?? JSON.stringify(sent).slice(0, 120)}（无权限请在 open.feishu.cn 申请 im:message 并发布可用版本）`);
    }
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
      if (raw.appId && raw.appSecret) {
        await this.connect(String(raw.appId), String(raw.appSecret));
        return true;
      }
    } catch (error: any) {
      if (error?.code === "ENOENT") return false; // 没绑过飞书：不是错误，别每次启动刷一行 channel-log
      this.log("error", `飞书自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  /** 「已连接」= SDK 报告长连接真处于 connected（state: connected / connecting / reconnecting /
   *  failed）。⛔ 不许用「WSClient 对象存在」糊弄 UI：start() 连不上也不 reject，旧写法会出现
   *  「绿点亮着、消息一条都不收」（QQ 11-03 同款事故，11-04 审查补齐）。 */
  hasSession(): boolean {
    if (!this.running || !this.ws) return false;
    try {
      const state = this.ws.getConnectionStatus?.()?.state;
      if (state) return state === "connected";
    } catch { /* 老版本 SDK 没这个方法 ⇒ 退回宽松判据（至少仍在「已启动」语义内） */ }
    return Boolean(this.ws);
  }
  botDisplayName() { return this.botName; }

  logout() {
    this.running = false;
    this.detachClient();
    this.botName = "";
    this.seenMessageIds.clear();
    try { fs.rmSync(stateFile(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "飞书登录态已清除，可重新绑定");
  }
}
