// 微信机器人网关：腾讯官方 iLink bot API（https://ilinkai.weixin.qq.com）纯 HTTP 实现。
// 协议流程（与 openclaw-weixin 一致）：
//   1. POST ilink/bot/get_bot_qrcode        → { qrcode, qrcode_img_content }（微信扫码的码）
//   2. GET  ilink/bot/get_qrcode_status      → wait/scaned/need_verifycode/confirmed → { bot_token, ilink_bot_id, baseurl }
//   3. POST ilink/bot/getupdates（35s 长轮询）→ { msgs: [{ from_user_id, item_list, context_token }], get_updates_buf }
//   4. POST ilink/bot/sendmessage            → 文本回复（需要 context_token，来自最近一条入站消息）
// 凭据落盘 userData/weixin-accounts/，重启免扫码。
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ILINK_BASE = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID = "bot";
const ILINK_CLIENT_VERSION = "1";
const CHANNEL_VERSION = "1.0.0";
const QR_POLL_TIMEOUT_MS = 35_000;
const UPDATES_POLL_TIMEOUT_MS = 35_000;

export type WeixinInbound = { from: string; text: string; contextToken: string };
export type WeixinEvents = {
  onMessage: (message: WeixinInbound) => void;
  log?: (level: "info" | "error", message: string) => void;
};

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: "CodexHarness-Desktop" };
}

function randomUin() {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(4).readUInt32BE(0).toString();
}

function headers(token?: string) {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "AuthorizationType": "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_CLIENT_VERSION,
  };
  if (token?.trim()) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

async function post(baseUrl: string, endpoint: string, body: any, token?: string, timeoutMs = 15_000) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`iLink ${endpoint} HTTP ${response.status}`);
  return JSON.parse(text);
}

export class WeixinGateway {
  private events: WeixinEvents;
  private token = "";
  private baseUrl = ILINK_BASE;
  private updatesBuf = "";
  private contextTokens = new Map<string, string>();
  private running = false;
  private stateDir: string;

  constructor(stateDir: string, events: WeixinEvents) {
    this.stateDir = stateDir;
    this.events = events;
  }

  private log(level: "info" | "error", message: string) {
    this.events.log?.(level, message);
  }

  // ── 扫码登录 ────────────────────────────────────────────────

  /** 发起扫码登录：返回微信要扫的二维码图片（base64 data URL 或 qrcode 内容） */
  async startLogin(): Promise<{ qrcodeImg: string; qrcode: string }> {
    const response = await post(ILINK_BASE, "ilink/bot/get_bot_qrcode?bot_type=3", { local_token_list: await this.localTokens() });
    if (!response.qrcode) throw new Error("获取微信登录二维码失败");
    this.loginSession = { qrcode: response.qrcode, startedAt: Date.now() };
    this.log("info", "微信登录二维码已获取，等待扫码");
    return { qrcodeImg: response.qrcode_img_content ?? response.qrcode, qrcode: response.qrcode };
  }
  private loginSession?: { qrcode: string; startedAt: number; pendingVerifyCode?: string };

  /** 轮询一次扫码状态；confirmed 时返回凭据并自动开始收消息 */
  async pollLogin(): Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean; error?: string }> {
    if (!this.loginSession) return { status: "expired" };
    if (Date.now() - this.loginSession.startedAt > 5 * 60_000) { this.loginSession = undefined; return { status: "expired" }; }
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(this.loginSession.qrcode)}`;
    if (this.loginSession.pendingVerifyCode) endpoint += `&verify_code=${encodeURIComponent(this.loginSession.pendingVerifyCode)}`;
    let response: any;
    try {
      const res = await fetch(`${ILINK_BASE}/${endpoint}`, { headers: headers(), signal: AbortSignal.timeout(QR_POLL_TIMEOUT_MS) });
      response = JSON.parse(await res.text());
    } catch { return { status: "wait" }; }
    switch (response.status) {
      case "scaned":
        this.loginSession.pendingVerifyCode = undefined;
        return { status: "scaned" };
      case "need_verifycode":
        return { status: "need_verifycode", verifyCodeRequired: true };
      case "expired":
        this.loginSession = undefined;
        return { status: "expired" };
      case "scaned_but_redirect":
        if (response.redirect_host) this.baseUrl = `https://${response.redirect_host}`;
        return { status: "scaned" };
      case "confirmed": {
        if (!response.ilink_bot_id || !response.bot_token) return { status: "wait" };
        this.token = response.bot_token;
        // openclaw-weixin 的 baseurl 已含协议前缀（https://ilinkai.weixin.qq.com），不能重复拼接
        const rawBase = String(response.baseurl ?? "");
        this.baseUrl = rawBase.startsWith("http") ? rawBase : rawBase ? `https://${rawBase}` : ILINK_BASE;
        await this.saveAccount({ token: this.token, botId: response.ilink_bot_id, userId: response.ilink_user_id ?? "", baseUrl: this.baseUrl });
        this.loginSession = undefined;
        this.lastUserId = String(response.ilink_user_id ?? "");
        this.log("info", "微信登录成功，开始收消息");
        void this.startPolling();
        // 连接成功后主动打招呼（确认对端可见，也让用户知道通道已通）
        this.sendGreeting();
        return { status: "confirmed", connected: true };
      }
      default:
        return { status: "wait" };
    }
  }

  // ── 收消息（长轮询循环）─────────────────────────────────────

  private async startPolling() {
    if (this.running) return;
    this.running = true;
    while (this.running && this.token) {
      try {
        const response = await post(this.baseUrl, "ilink/bot/getupdates", { get_updates_buf: this.updatesBuf, base_info: baseInfo() }, this.token, UPDATES_POLL_TIMEOUT_MS);
        if (response.ret !== undefined && response.ret !== 0) {
          this.log("error", `getupdates 失败 ret=${response.ret} ${response.errmsg ?? ""}`);
          if (response.ret === -14 || /token/i.test(response.errmsg ?? "")) { this.log("error", "登录态失效，请重新扫码"); this.stop(); break; }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (response.get_updates_buf) this.updatesBuf = response.get_updates_buf;
        for (const msg of response.msgs ?? []) this.dispatchInbound(msg);
      } catch (error: any) {
        if (!this.running) break;
        if (error.name !== "AbortError" && !/timeout/i.test(error.message)) this.log("error", `getupdates 异常：${error.message}`);
      }
    }
  }

  private dispatchInbound(msg: any) {
    const from = String(msg.from_user_id ?? "");
    if (!from || msg.message_type === 2 /* BOT 自身 */) return;
    const text = (msg.item_list ?? []).filter((item: any) => item.type === 1 && item.text_item?.text).map((item: any) => item.text_item.text).join("\n").trim();
    if (!text) return;
    if (msg.context_token) this.contextTokens.set(from, msg.context_token);
    this.events.onMessage({ from, text, contextToken: msg.context_token ?? this.contextTokens.get(from) ?? "" });
  }

  // ── 发消息 ────────────────────────────────────────────────

  /**
   * 发消息。opts.state：2=FINISH（默认，独立完整消息）；1=向同一 client_id 气泡增量追加（流式）。
   * 流式场景传同一个 clientId 让 iLink 把多次 state=1 追加到同一气泡，最后一次 state=2 收尾。
   */
  private lastUserId = "";

  /** 连接成功后主动打招呼（best-effort：对端 id 缺失或发送失败都静默，不阻塞登录流程） */
  private sendGreeting() {
    const userId = this.lastUserId.trim();
    if (!userId) return;
    const greeting = [
      "你好，我是 Codex Harness 的桌面助手机器人 🤖",
      "连接成功！之后在这里发消息我随时接活：写代码、查资料、排查问题、操作电脑上的应用都可以。",
      "想让我给自己开发插件、修改应用功能，直接说就行～",
    ].join("\n");
    setTimeout(() => { this.sendText(userId, greeting).catch(() => { /* 尽力而为 */ }); }, 1500);
  }

  async sendText(to: string, text: string, opts?: { clientId?: string; state?: number }) {
    if (!text) return;
    const contextToken = this.contextTokens.get(to) ?? "";
    if (!contextToken) this.log("error", `缺少 ${to} 的 context_token（对方近期未发过消息），发送可能失败`);
    const body = {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: opts?.clientId ?? `codex-harness-${randomUUID()}`,
        message_type: 2, // BOT
        message_state: opts?.state ?? 2, // 1=追加（流式增量） 2=FINISH
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken || undefined,
      },
      base_info: baseInfo(),
    };
    const response = await post(this.baseUrl, "ilink/bot/sendmessage", body, this.token);
    if (response.ret && response.ret !== 0) throw new Error(`微信发送失败 ret=${response.ret} ${response.errmsg ?? ""}`);
  }

  // ── 持久化 ────────────────────────────────────────────────

  private accountFile() { return path.join(this.stateDir, "weixin-account.json"); }

  private async saveAccount(account: { token: string; botId: string; userId: string; baseUrl: string }) {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(this.accountFile(), JSON.stringify({ ...account, updatesBuf: this.updatesBuf }, null, 2), "utf8");
  }

  /** 重启恢复：有持久化凭据则免扫码直接续跑 */
  async resume() {
    try {
      const raw = JSON.parse(await fs.readFile(this.accountFile(), "utf8"));
      if (raw.token) {
        this.token = raw.token;
        // 兼容早期持久化的双重前缀坏数据
        const savedBase = String(raw.baseUrl ?? "").replace(/^(https?:\/\/)+/, "https://");
        this.baseUrl = savedBase || ILINK_BASE;
        this.updatesBuf = raw.updatesBuf ?? "";
        this.log("info", "微信登录态已恢复，继续收消息");
        void this.startPolling();
        return true;
      }
    } catch { /* 未登录过 */ }
    return false;
  }

  stop() {
    this.running = false;
  }

  /** 退出登录：停轮询、清内存与持久化凭据（删除机器人/重新绑定场景）——
   *  只删 UI 记录不清这里的话，同渠道新建会被判定「已连接」直接复用旧会话，扫码入口都不出现 */
  async logout() {
    this.stop();
    this.token = "";
    this.updatesBuf = "";
    this.contextTokens.clear();
    this.loginSession = undefined;
    try { await fs.rm(this.accountFile(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "微信登录态已清除，可重新扫码绑定");
  }

  /** 是否已有可用登录态（token 存在） */
  hasSession() { return Boolean(this.token); }

  private async localTokens(): Promise<string[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.accountFile(), "utf8"));
      return raw.token ? [raw.token] : [];
    } catch { return []; }
  }
}
