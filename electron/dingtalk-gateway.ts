import path from "node:path";
import os from "node:os";
import fs from "node:fs";
// 钉钉机器人网关：官方 dingtalk-stream SDK（WebSocket 长连接，免公网 IP/免回调域名）。
// 用户在 open-dev.dingtalk.com 建「企业内部应用」→ 添加「机器人」能力、消息接收模式选
// 「Stream 模式」→ 拿 Client ID (AppKey) / Client Secret (AppSecret) 填入即连。
// 群里 @机器人 发消息 → 收到 text → 走标准 thread 管线 → 回复经 sessionWebhook 回发。
// 凭据持久化 userData/dingtalk-account.json，重启自动恢复。
import DingTalkStream from "dingtalk-stream";

const STATE_FILE = path.join(
  process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"),
  "dingtalk-account.json",
);

export type DingtalkEvents = {
  onMessage: (message: { from: string; chatId: string; text: string; replyHint: string }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

type SessionRecord = { webhook: string; chatId: string; from: string; at: number };

export class DingtalkGateway {
  private client: any = null;
  private clientId = "";
  private clientSecret = "";
  private running = false;
  private events: DingtalkEvents;
  // sessionWebhook 是钉钉回复通道：每条消息回调自带（有效期 ~2h），按 conversationId 缓存最近一条
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
    const probe = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appKey: id, appSecret: secret }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()) as any;
    if (!probe.accessToken) throw new Error(`凭据无效：${probe.message ?? JSON.stringify(probe).slice(0, 120)}。请检查 Client ID/Secret，并确认应用已开通「机器人」能力且消息接收模式为「Stream 模式」`);
    this.clientId = id;
    this.clientSecret = secret;
    this.running = true;
    this.client = new DingTalkStream.DWClient({ clientId: id, clientSecret: secret });
    this.client.registerCallbackListener("/v1.0/im/bot/messages/get", async (message: any) => {
      try {
        const body = typeof message?.data === "string" ? JSON.parse(message.data) : (message?.data ?? {});
        const text = String(body?.text?.content ?? "").replace(/@\S+\s*/g, "").trim(); // 去掉 @机器人 占位
        const chatId = String(body?.conversationId ?? "");
        const from = String(body?.senderNick ?? body?.senderStaffId ?? "钉钉用户");
        const webhook = String(body?.sessionWebhook ?? "");
        if (!text || !chatId) return { code: 200 };
        if (webhook) this.sessions.set(chatId, { webhook, chatId, from, at: Date.now() });
        this.events.onMessage({ from, chatId, text, replyHint: chatId });
      } catch (error: any) {
        this.log("error", `钉钉消息处理异常：${error?.message ?? error}`);
      }
      return { code: 200 };
    });
    await this.client.connect();
    try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify({ clientId: id, clientSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", "钉钉机器人已连接（Stream 模式）");
    return { ok: true, name: "钉钉机器人" };
  }

  /** 回复：优先用该会话缓存的 sessionWebhook（官方推荐、免 token）；过期则报错让用户重发一条 */
  async sendMessage(chatId: string, text: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session || Date.now() - session.at > 90 * 60_000) throw new Error("回复通道已过期：请先在钉钉群里重新 @机器人 发一条消息");
    const safe = text.length > 3800 ? text.slice(0, 3800) + "\n\n…（内容过长已截断）" : text;
    const res = await fetch(session.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: safe } }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()) as any;
    if (res.errcode !== 0) throw new Error(`钉钉发送失败：${res.errmsg ?? ""}`);
    this.sessions.set(chatId, { ...session, at: Date.now() }); // webhook 刚用过，刷新时效
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (raw.clientId && raw.clientSecret) {
        await this.connect(String(raw.clientId), String(raw.clientSecret));
        return true;
      }
    } catch (error: any) {
      this.log("error", `钉钉自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  hasSession() { return Boolean(this.client); }

  logout() {
    this.running = false;
    try { this.client?.disconnect?.(); } catch { /* 忽略 */ }
    this.client = null;
    this.sessions.clear();
    try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* 忽略 */ }
    this.log("info", "钉钉登录态已清除，可重新绑定");
  }
}
