import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

/** 凭据落点：**惰性**取 userData ——
 *  ⛔ 模块顶层求值会早于 main.ts 的 `app.setPath("userData")` ⇒ 拿到默认目录（路径静默漂移）。
 *  ⛔ 也不许写死 `AppData\Roaming\<应用名>`：mac 是 `~/Library/Application Support/`，
 *     且 PPcode 的 userData 目录名与本仓不同 ⇒ 写死会读写到**另一个应用**的数据。
 *  `CODEX_HARNESS_USER_DATA` 是测试开关（隔离 profile 用），优先级最高。 */
function stateFilePath() {
  const dir = process.env.CODEX_HARNESS_USER_DATA || app.getPath("userData");
  return path.join(dir, "dingtalk-account.json");
}
// 钉钉机器人网关：官方 dingtalk-stream SDK（WebSocket 长连接，免公网 IP/免回调域名）。
// 用户在 open-dev.dingtalk.com 建「企业内部应用」→ 添加「机器人」能力、消息接收模式选
// 「Stream 模式」→ 拿 Client ID (AppKey) / Client Secret (AppSecret) 填入即连。
// 群里 @机器人 发消息 → 收到 text → 走标准 thread 管线 → 回复经 sessionWebhook 回发。
// 凭据持久化 userData/dingtalk-account.json，重启自动恢复。
import DingTalkStream from "dingtalk-stream";
import { guardedFetch } from "../net-guard";


export type DingtalkEvents = {
  onMessage: (message: { from: string; chatId: string; text: string; replyHint: string }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

type SessionRecord = { webhook: string; chatId: string; from: string; /** 官方给的硬到期时间（ms epoch），0 = 未知 */ expiresAt: number };

export class DingtalkGateway {
  private client: any = null;
  private clientId = "";
  private clientSecret = "";
  private running = false;
  /** 已处理过的 msgId → 时间。钉钉**没收到 ACK 就会重推**（11-04 审查：旧写法只在回调里
   *  `return {code:200}`，而 SDK 的 onCallback 只 emit、不代发回执 ⇒ 同一条消息反复跑回合）。 */
  private seenMsgIds = new Map<string, number>();
  private events: DingtalkEvents;
  // sessionWebhook 是钉钉回复通道：每条消息回调自带（**临时**地址，官方在消息体里给
  // sessionWebhookExpiredTime），按 conversationId 缓存最近一条
  private sessions = new Map<string, SessionRecord>();

  constructor(events: DingtalkEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  async connect(clientId: string, clientSecret: string): Promise<{ ok: boolean; name?: string }> {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) throw new Error("Client ID / Client Secret 不能为空（open-dev.dingtalk.com → 应用信息 → 凭证）");
    // 先拿企业 access_token 校验凭据（官方接口 /v1.0/oauth2/accessToken）
    const probeResponse = await guardedFetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appKey: id, appSecret: secret }),
      signal: AbortSignal.timeout(10_000),
    }, { timeoutMs: 10_000 });
    const probe = (await probeResponse.json().catch(() => ({}))) as any;
    if (!probeResponse.ok || !probe.accessToken) {
      throw new Error(`凭据无效（HTTP ${probeResponse.status}）：${probe.message ?? JSON.stringify(probe).slice(0, 120)}。请检查 Client ID/Secret，并确认应用已开通「机器人」能力且消息接收模式为「Stream 模式」`);
    }
    this.clientId = id;
    this.clientSecret = secret;
    this.running = true;
    // ⛔ 先摘掉上一条：自动恢复 / 手动重连 / 重新绑定各开一条的话，同一条消息会被派发多次
    this.detachClient();
    this.client = new DingTalkStream.DWClient({ clientId: id, clientSecret: secret });
    this.client.registerCallbackListener("/v1.0/im/bot/messages/get", async (message: any) => {
      // ACK 必须**显式**回：SDK 的 onCallback 只 emit 给监听器，不会替我们发回执。
      // 不回执 ⇒ 钉钉按重试策略反复推同一条 ⇒ 同一个问题跑好几个回合、回好几遍。
      const messageId = String(message?.headers?.messageId ?? "");
      const ack = () => { try { this.client?.socketCallBackResponse?.(messageId, { status: "SUCCESS" }); } catch { /* 回执失败不影响处理 */ } };
      ack();
      try {
        const body = typeof message?.data === "string" ? JSON.parse(message.data) : (message?.data ?? {});
        const chatId = String(body?.conversationId ?? "");
        const from = String(body?.senderNick ?? body?.senderStaffId ?? "钉钉用户");
        const webhook = String(body?.sessionWebhook ?? "");
        // 官方硬到期时间（毫秒 epoch）：旧写法不看它，自己拍了个 90 分钟还在每次发送后刷新，
        // 等于这道闸形同虚设（长回合后 webhook 早过期，回复整段丢）
        const expiresAt = Number(body?.sessionWebhookExpiredTime ?? 0);
        const msgId = String(body?.msgId ?? "");
        if (msgId && this.isDuplicate(msgId)) {
          this.log("info", `钉钉消息 ${msgId.slice(0, 12)}… 是重推（没收到 ACK 时官方会重试）⇒ 只处理一次`);
          return { code: 200 };
        }
        const text = String(body?.text?.content ?? "").replace(/@\S+\s*/g, "").trim(); // 去掉 @机器人 占位
        if (!chatId) {
          this.log("error", `钉钉事件取不到 conversationId（收到的字段：${Object.keys(body).join("/") || "空"}）⇒ 无法回复`);
          return { code: 200 };
        }
        if (!text) {
          // 富文本/图片/文件这类 body.text 为空：以前直接静默 return ⇒「发了没反应」
          this.log("info", `钉钉收到 ${String(body?.msgtype ?? "未知")} 类型消息，没有可用文本 ⇒ 不回复（请改发文字）`);
          return { code: 200 };
        }
        if (webhook) {
          if (this.sessions.size > 200) {
            // 会话表只增不删会把历史 webhook 一直攒着（11-04 审查：无清理）
            const oldest = this.sessions.keys().next().value;
            if (oldest) this.sessions.delete(oldest);
          }
          this.sessions.set(chatId, { webhook, chatId, from, expiresAt });
        }
        this.log("info", `收到 钉钉消息（聊天 ${chatId.slice(0, 8)}…，${text.length} 字）`);
        this.events.onMessage({ from, chatId, text, replyHint: chatId });
      } catch (error: any) {
        this.log("error", `钉钉消息处理异常：${error?.message ?? error}`);
      }
      return { code: 200 };
    });
    await this.client.connect();
    // ⛔ SDK 的 connect() **永不 reject**：失败时它只 printDebug + scheduleReconnect 后 return。
    //   旧写法 await 完就记「已连接」并返回 ok:true ⇒ Secret 错 / 没开机器人能力 / 断网时
    //   UI 显示已连接但一条消息都收不到（11-04 审查）。这里等它真的 connected 才算成功。
    const connected = await this.waitForConnected(8_000);
    if (!connected) {
      this.log("error", "钉钉凭据有效，但 Stream 长连接 8s 内没建立（SDK 会在后台自动重试；请确认应用已开通「机器人」能力、消息接收模式为 Stream，且本机网络可达）");
      throw new Error("钉钉长连接未建立：凭据没问题，但连不上服务端（详见机器人日志）");
    }
    try { fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true }); fs.writeFileSync(stateFilePath(), JSON.stringify({ clientId: id, clientSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", "钉钉机器人已连接（Stream 模式）");
    return { ok: true, name: "钉钉机器人" };
  }

  /** 轮询 SDK 的 connected / registered 标志（connect() 自己不说成败） */
  private async waitForConnected(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.client?.connected && this.client?.registered) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return Boolean(this.client?.connected && this.client?.registered);
  }

  /** 摘掉上一条 client（重连 / 重新绑定 / 解绑共用） */
  private detachClient(): void {
    if (this.client) {
      try { this.client.disconnect?.(); } catch { /* 忽略 */ }
      this.client = null;
    }
  }

  /** 同 msgId 十分钟内见过就算重推 */
  private isDuplicate(msgId: string): boolean {
    const now = Date.now();
    if (this.seenMsgIds.size > 400) {
      for (const [id, at] of this.seenMsgIds) if (now - at > 10 * 60_000) this.seenMsgIds.delete(id);
    }
    if (this.seenMsgIds.has(msgId)) {
      this.seenMsgIds.set(msgId, now);
      return true;
    }
    this.seenMsgIds.set(msgId, now);
    return false;
  }

  /** 回复：优先用该会话缓存的 sessionWebhook（官方推荐、免 token）；过期则报错让用户重发一条 */
  async sendMessage(chatId: string, text: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) throw new Error("回复通道缺失：请先在钉钉群里重新 @机器人 发一条消息");
    // 时效以**官方给的 sessionWebhookExpiredTime** 为准；拿不到时才退回保守的 90 分钟。
    // ⛔ 不许在发送成功后刷新 at/expiresAt —— 旧写法这么干把这道闸变成摆设（11-04 审查）
    const expired = session.expiresAt ? Date.now() >= session.expiresAt : false;
    if (expired) throw new Error("回复通道已过期（钉钉 sessionWebhook 是临时的）：请在钉钉群里重新 @机器人 发一条消息");
    const safe = text.length > 3800 ? text.slice(0, 3800) + "\n\n…（内容过长已截断）" : text;
    const response = await guardedFetch(session.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: safe } }),
      signal: AbortSignal.timeout(15_000),
    }, { timeoutMs: 15_000 });
    // ⛔ 不看 HTTP 状态的裸 `.then(r => r.json())`：代理/网关回 HTML 时抛的是英文 SyntaxError，
    //   而且钉钉限流（20 条/分）时回的是 4xx —— 都会被吞成「钉钉发送失败：」这种空白原因
    const bodyText = await response.text();
    let res: any;
    try { res = JSON.parse(bodyText); } catch {
      throw new Error(`钉钉发送失败（HTTP ${response.status}，响应不是 JSON）：${bodyText.slice(0, 80).replace(/\s+/g, " ") || "空响应"}`);
    }
    const errcode = Number(res?.errcode ?? (response.ok ? 0 : res?.code ?? -1));
    if (!response.ok || errcode !== 0) {
      throw new Error(`钉钉发送失败（HTTP ${response.status}，errcode ${errcode}）：${res?.errmsg ?? res?.message ?? bodyText.slice(0, 120)}（20 条/分钟超限会被限流约 10 分钟）`);
    }
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
      if (raw.clientId && raw.clientSecret) {
        await this.connect(String(raw.clientId), String(raw.clientSecret));
        return true;
      }
    } catch (error: any) {
      if (error?.code === "ENOENT") return false; // 没绑过钉钉：不是错误，别每次启动刷 channel-log
      this.log("error", `钉钉自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  /** 「已连接」= SDK 真的连上并注册成功。⛔ 不是「client 对象存在」——旧写法会让 UI 绿点常亮
   *  而一条消息都收不到（11-04 审查，与 QQ/飞书同族缺陷） */
  hasSession() { return Boolean(this.client?.connected && this.client?.registered); }

  logout() {
    this.running = false;
    this.detachClient();
    this.sessions.clear();
    this.seenMsgIds.clear();
    try { fs.rmSync(stateFilePath(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "钉钉登录态已清除，可重新绑定");
  }
}
