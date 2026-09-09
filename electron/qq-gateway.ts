import path from "node:path";
import os from "node:os";
import fs from "node:fs";
// QQ 机器人网关：QQ 开放平台（q.qq.com）官方协议轻实现。
// 用户在 q.qq.com 创建机器人（需实名）拿 AppID + AppSecret → 填入即连。
// 协议：GET /openapi/auth/get_wps_token？不对——官方链路是：
//   1) AppID+Secret → POST /app/getAppAccessToken 拿 access_token（qq bot api）
//   2) GET /gateway 拿 WebSocket 地址 → WSS 长连接收事件（含鉴权 op2/心跳 op1/恢复 op6）
//   3) 群聊 @机器人 事件 GROUP_AT_MESSAGE_CREATE / 单聊 C2C_MESSAGE_CREATE
//   4) 回复：POST /v2/groups/{group_openid}/messages（msg_id 被动回复，需开放平台开通权限）
// 仅依赖 node 原生 ws 不内置——用官方 ws 包（Electron 主进程可用）。
import WebSocket from "ws";

const API = "https://api.sgroup.qq.com";
const STATE_FILE = path.join(
  process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"),
  "qq-account.json",
);

export type QqEvents = {
  onMessage: (message: { from: string; chatId: string; text: string; msgId: string; scene: "group" | "c2c" }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

export class QqGateway {
  private appId = "";
  private appSecret = "";
  private accessToken = "";
  private tokenExpireAt = 0;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeq: number | null = null;
  private running = false;
  private events: QqEvents;

  constructor(events: QqEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  private async fetchToken(): Promise<void> {
    const res = await fetch(`${API}/app/getAppAccessToken`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()) as any;
    if (!res.access_token) throw new Error(`获取 access_token 失败：${res.message ?? JSON.stringify(res).slice(0, 120)}。请检查 AppID/AppSecret（q.qq.com → 开发设置）`);
    this.accessToken = res.access_token;
    this.tokenExpireAt = Date.now() + (Number(res.expires_in ?? 7200) - 300) * 1000;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.accessToken || Date.now() > this.tokenExpireAt) await this.fetchToken();
    return { Authorization: `QQBot ${this.accessToken}`, "content-type": "application/json" };
  }

  async connect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string }> {
    const id = appId.trim();
    const secret = appSecret.trim();
    if (!id || !secret) throw new Error("AppID / AppSecret 不能为空（q.qq.com → 开发设置）");
    this.appId = id;
    this.appSecret = secret;
    this.running = true;
    await this.fetchToken(); // 凭据校验
    const gw = await fetch(`${API}/gateway`, { headers: await this.authHeaders(), signal: AbortSignal.timeout(10_000) }).then((r) => r.json()) as any;
    if (!gw.url) throw new Error(`获取网关地址失败：${JSON.stringify(gw).slice(0, 120)}`);
    this.openSocket(String(gw.url));
    try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify({ appId: id, appSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", `QQ 机器人（AppID ${id.slice(0, 8)}…）已连接`);
    return { ok: true, name: "QQ 机器人" };
  }

  private openSocket(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (raw: WebSocket.RawData) => {
      const packet = JSON.parse(String(raw)) as any;
      this.lastSeq = packet.s ?? this.lastSeq;
      switch (packet.op) {
        case 10: { // Hello
          const interval = packet.d?.heartbeat_interval ?? 30_000;
          this.identify(interval);
          break;
        }
        case 0: // Dispatch
          if (packet.t === "GROUP_AT_MESSAGE_CREATE") this.handleDispatch(packet.d, "group");
          else if (packet.t === "C2C_MESSAGE_CREATE") this.handleDispatch(packet.d, "c2c");
          break;
        case 7: // Reconnect
          this.resumeSocket();
          break;
        case 11: // Heartbeat ACK
          break;
      }
    });
    this.ws.on("close", () => {
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
      if (this.running) setTimeout(() => this.resumeSocket(), 5000); // 断线 5s 重连
    });
    this.ws.on("error", (error: Error) => this.log("error", `QQ WebSocket 异常：${error.message}`));
  }

  private identify(intervalMs: number) {
    this.ws?.send(JSON.stringify({
      op: 2,
      d: { token: `QQBot ${this.accessToken}`, intents: (1 << 25) | (1 << 12), shard: [0, 1] }, // 1<<25 群聊@、1<<12 单聊
    }));
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.lastSeq }));
    }, Math.max(5_000, intervalMs - 3_000));
  }

  private resumeSocket() {
    if (!this.running) return;
    // 简化处理：断线重连走全量重连（重新拿 gateway + identify）；官方 op6 Resume 优化后续可加
    void (async () => {
      try {
        const gw = await fetch(`${API}/gateway`, { headers: await this.authHeaders(), signal: AbortSignal.timeout(10_000) }).then((r) => r.json()) as any;
        if (gw.url) this.openSocket(String(gw.url));
      } catch (error: any) {
        this.log("error", `QQ 重连失败：${error?.message ?? error}`);
      }
    })();
  }

  private handleDispatch(d: any, scene: "group" | "c2c") {
    try {
      const text = String(d?.content ?? "").replace(/@\S+\s*/g, "").trim();
      const chatId = String(d?.group_openid ?? d?.user_openid ?? "");
      const from = String(d?.author?.member_openid ?? d?.author?.user_openid ?? "QQ 用户");
      const msgId = String(d?.id ?? "");
      if (!text || !chatId) return;
      this.events.onMessage({ from, chatId, text, msgId, scene });
    } catch (error: any) {
      this.log("error", `QQ 消息处理异常：${error?.message ?? error}`);
    }
  }

  /** 回复：群聊 /v2/groups/{group_openid}/messages；单聊 /v2/users/{user_openid}/messages；msg_type 0=文本；必须带 msg_id（被动回复，5 分钟内有效） */
  async sendMessage(chatId: string, text: string, opts: { msgId: string; scene: "group" | "c2c" }): Promise<void> {
    const safe = text.length > 1800 ? text.slice(0, 1800) + "\n\n…（内容过长已截断）" : text;
    const path = opts.scene === "group" ? `/v2/groups/${encodeURIComponent(chatId)}/messages` : `/v2/users/${encodeURIComponent(chatId)}/messages`;
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({ content: safe, msg_type: 0, msg_id: opts.msgId }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()) as any;
    // 官方偶发 code 11253「消息频率超限」等，直接抛给调用方记录
    if (res.retcode !== 0 && res.code !== 0) throw new Error(`QQ 发送失败：${res.message ?? res.msg ?? JSON.stringify(res).slice(0, 120)}（若提示无权限，请在 q.qq.com 申请「发送消息」权限并上线机器人）`);
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (raw.appId && raw.appSecret) {
        await this.connect(String(raw.appId), String(raw.appSecret));
        return true;
      }
    } catch (error: any) {
      this.log("error", `QQ 自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  hasSession() { return Boolean(this.ws); }

  logout() {
    this.running = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    try { this.ws?.close(); } catch { /* 忽略 */ }
    this.ws = null;
    this.accessToken = "";
    try { fs.rmSync(STATE_FILE, { force: true }); } catch { /* 忽略 */ }
    this.log("info", "QQ 登录态已清除，可重新绑定");
  }
}
