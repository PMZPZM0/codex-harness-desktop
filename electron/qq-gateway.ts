// QQ 机器人网关：QQ 开放平台（q.qq.com）官方协议轻实现。
// 用户在 q.qq.com 创建机器人（需实名）拿 AppID + AppSecret → 填入即连。
// 协议（2026 官方文档 https://bot.q.qq.com/wiki/develop/api-v2/，统一地址 https://api.bot.qq.com）：
//   1) AppID+Secret → POST /app/getAppAccessToken 拿 access_token
//      ⛔ token 接口在 api.bot.qq.com / bots.qq.com —— api.sgroup.qq.com 上是 404「不支持的调用」，
//        实测（2026-11）：旧地址 POST 404 {code:40011002}，这正是「QQ 连不上」的第一层根因。
//      实测（2026-11）请求体字段是**小写 appId**：传 appID 会得到 {code:100007,"appid invalid"}，
//      传 appId 才走到业务校验（{code:10004,"机器人不存在"}）。
//   2) GET /gateway 拿 wss 地址 → 长连接收事件（鉴权 op2 / 心跳 op1 / 恢复 op6）
//      HTTP 头与 op2 的 token 都是 `QQBot {access_token}`（文档「API 调用指南」+「WebSocket 方式」）。
//   3) 群聊 @机器人 GROUP_AT_MESSAGE_CREATE / 单聊 C2C_MESSAGE_CREATE —— 两者同属
//      GROUP_AND_C2C_EVENT(1<<25)。⛔ intents 不许夹带无权限位：文档明示「intent 无权限 ⇒ 4014 且
//      不可重试 IDENTIFY」，多一个位就连不上（旧代码的 1<<12 是 DIRECT_MESSAGE 频道私信，与群/单聊无关）。
//   4) 回复：POST /v2/groups/{group_openid}/messages、POST /v2/users/{user_openid}/messages
//      （msg_id 被动回复，5 分钟内有效；需开放平台开通「发送消息」权限）
// 仅依赖 node 原生 ws 不内置——用官方 ws 包（Electron 主进程可用）。
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import WebSocket from "ws";

const API = "https://api.bot.qq.com";
/** msg_id 判重窗口：官方「相同 msg_id 可能重复推送」，十分钟内见过就算同一条 */
const QQ_DEDUP_WINDOW_MS = 10 * 60_000;

/** 账号落盘路径：⛔ 跟随 userData（用户可自定义配置目录），不能写死默认 AppData ——
 *  否则自定义目录用户的「重启自动恢复」永远读不到账号（读的是另一个目录）。 */
function stateFile(): string {
  try { return path.join(app.getPath("userData"), "qq-account.json"); } catch { /* app 未就绪（测试/工具态）走环境变量兜底 */ }
  return path.join(
    process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"),
    "qq-account.json",
  );
}

export type QqEvents = {
  onMessage: (message: { from: string; chatId: string; text: string; msgId: string; scene: "group" | "c2c" }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

/** 断开码 → 用户能听懂的一句话（原文照文档「WebSocket 错误码」表，⛔ 别自己编含义）。
 *  表里只列了 4001/4002/4006/4007/4008/4009/4010/4011/4012/4013/4014/4900~4915 —— 没有 4004/4005。 */
const CLOSE_HINTS: Record<number, string> = {
  4008: "发送过快、触发频控",
  4012: "无效的 version",
  4013: "无效的 intent",
  4014: "intent 无权限（q.qq.com 未申请对应事件权限）",
  4914: "机器人已下架，只允许连沙箱环境",
  4915: "机器人已被封禁，请申请解封",
};

export class QqGateway {
  private appId = "";
  private appSecret = "";
  private accessToken = "";
  private tokenExpireAt = 0;
  private ws: WebSocket | null = null;
  /** WebSocket 真正 open 且未断开才算「已连接」（⛔ hasSession 不再用「对象存在」糊弄 UI） */
  private socketReady = false;
  /** 收到 READY 才算鉴权过（文档：只有登录成功后后台才下发事件），connect 用它决定成败 */
  private sessionReady = false;
  /** 最近一次服务端关闭码（connect 等待期间用来给出现场原因） */
  private lastCloseCode = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 本次 session 的最新事件序号：文档规定 op1 心跳的 d 就是它，首次连接为 null。
   *  ⛔ 重连走全量 Identify（新 session）时必须归零——带上上一条连接的旧序号服务端判 seq 错误（4007）。 */
  private lastSeq: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  /** 已处理过的 msg_id → 最近一次收到的时间（官方是至少一次投递，同一条会重推） */
  private seenMsgIds = new Map<string, number>();
  private running = false;
  private events: QqEvents;

  constructor(events: QqEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  /** 一次 OpenAPI 调用。判成败的口径来自文档「API 调用指南」：
   * 成功 ⇒ 响应体直接是业务数据（**没有** err_code / code 字段）；失败 ⇒ 带 err_code。
   * ⛔ 不许用 `retcode !== 0 && code !== 0` 这类「缺字段就算失败」的旧写法——
   *   那样每条成功的回复都会被当异常报「QQ 发送失败」（实测成功响应形如 {id,timestamp}）。
   * ⛔ 也不许裸 `.then(r => r.json())`：代理/网关返回 HTML 时抛的是英文 SyntaxError，用户看不懂。 */
  private async request(method: "GET" | "POST", apiPath: string, body?: Record<string, unknown>, token?: string): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", Accept: "application/json" };
    if (token) headers.Authorization = `QQBot ${token}`;
    const response = await fetch(`${API}${apiPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as any;
    const errCode = Number(json?.err_code ?? json?.code ?? json?.retcode ?? 0);
    if (!response.ok || !Number.isFinite(errCode) || errCode !== 0) {
      throw new Error(`QQ 接口 ${apiPath} 失败（HTTP ${response.status}，err_code ${json?.err_code ?? json?.code ?? "无"}）：${json?.message ?? JSON.stringify(json).slice(0, 120)}`);
    }
    return json;
  }

  private async fetchToken(): Promise<void> {
    let res: any;
    try {
      res = await this.request("POST", "/app/getAppAccessToken", { appId: this.appId, clientSecret: this.appSecret });
    } catch (error: any) {
      throw new Error(`${error?.message ?? error}。请检查 AppID/AppSecret（q.qq.com → 开发设置），并确认机器人未在 IP 白名单里排除本机`);
    }
    if (!res.access_token) throw new Error(`获取 access_token 成功但响应里没有它：${JSON.stringify(res).slice(0, 120)}`);
    this.accessToken = String(res.access_token);
    this.tokenExpireAt = Date.now() + (Number(res.expires_in ?? 7200) - 300) * 1000;
  }

  /** 取可用的 access_token（临期自动续期）；文档口径：HTTP 头与 op2 token 都是 `QQBot {token}` */
  private async ensureToken(): Promise<string> {
    if (!this.accessToken || Date.now() > this.tokenExpireAt) await this.fetchToken();
    return this.accessToken;
  }

  async connect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string }> {
    const id = appId.trim();
    const secret = appSecret.trim();
    if (!id || !secret) throw new Error("AppID / AppSecret 不能为空（q.qq.com → 开发设置）");
    this.appId = id;
    this.appSecret = secret;
    this.running = true;
    await this.fetchToken(); // 凭据校验
    const gw = await this.request("GET", "/gateway", undefined, await this.ensureToken());
    if (!gw.url) throw new Error(`获取网关地址失败：${JSON.stringify(gw).slice(0, 120)}`);
    this.detachSocket(); // ⛔ 重复连接（手动重连/扫码后旧 socket 还在）会开两条 WS、消息双份
    this.openSocket(String(gw.url));
    this.log("info", `QQ 机器人（AppID ${id.slice(0, 8)}…）凭据校验通过，正在建立长连接`);
    // 等 READY 才算连上：socket open 只说明链路通，鉴权/意图不过服务端随后就会关掉。
    // ⛔ 「先返回成功、状态页再变未连接」是这个板块最难自查的形态（用户看到的是「连不上但没说为什么」）
    await this.waitSessionReady(12_000);
    // 落盘放在连通之后：凭据有问题就不该让下次启动继续自动恢复它（只会刷一屏同样的失败）
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify({ appId: id, appSecret: secret }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", `QQ 机器人（AppID ${id.slice(0, 8)}…）已连接`);
    return { ok: true, name: "QQ 机器人" };
  }

  /** 等鉴权后的 READY 事件；带官方关闭码给出可执行的原因（文档「WebSocket 错误码」表） */
  private async waitSessionReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.sessionReady) return;
      if (this.lastCloseCode) {
        const code = this.lastCloseCode; // ⛔ 先取出来：detachSocket 会把它归零，之后拼消息就成 code 0 了
        const hint = CLOSE_HINTS[code];
        this.running = false;
        this.detachSocket();
        throw new Error(`QQ 长连接被服务端关闭${hint ? `：${hint}` : "（鉴权或事件权限未通过）"}（code ${code}）`);
      }
      if (Date.now() >= deadline) {
        // ⛔ 超时不拆连接：READY 迟迟没来更可能是网络慢，拆掉反而把一条会成功的长连接掐了；
        //    保留后台重试，同时如实回报「未就绪」（状态页随后变绿是可信的，因为 hasSession 看真实 socket）
        throw new Error(`QQ 长连接 ${Math.round(timeoutMs / 1000)}s 内未就绪（没收到 READY，仍在后台重试；机器人未上线/权限未开通也会这样）`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** 摘掉旧 socket（清心跳/重连定时器 + 摘监听再关，防止 close 触发重连把旧连接拉回来） */
  private detachSocket(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.close(); } catch { /* 忽略 */ }
      this.ws = null;
    }
    this.socketReady = false;
    this.sessionReady = false;
    this.lastCloseCode = 0;
    this.lastSeq = null; // 新 session 的序号从头开始（⛔ 旧 seq 会让心跳被判 seq 错误 4007）
  }

  private openSocket(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("open", () => { this.socketReady = true; });
    this.ws.on("message", (raw: WebSocket.RawData) => {
      let packet: any;
      try {
        packet = JSON.parse(String(raw));
      } catch {
        // ⛔ 必须兜住：监听器里抛异常 = 主进程未捕获异常（一帧非 JSON 数据就能让应用崩）
        this.log("error", "QQ 长连接收到无法解析的帧，已忽略");
        return;
      }
      this.lastSeq = packet.s ?? this.lastSeq;
      switch (packet.op) {
        case 10: { // Hello
          const interval = packet.d?.heartbeat_interval ?? 45_000;
          this.identify(interval);
          break;
        }
        case 0: { // Dispatch
          // 文档：只有鉴权成功后后台才下发事件 ⇒ 任何 dispatch（READY / RESUMED / 消息）都证明会话可用，
          // ⛔ 判据不绑死 READY 这一个事件名（协议侧改名或分版本时，状态页会假报「未连接」）
          this.sessionReady = true;
          if (packet.t === "READY") this.log("info", "QQ 长连接已就绪（READY），开始接收事件");
          else if (packet.t === "GROUP_AT_MESSAGE_CREATE") this.handleDispatch(packet.d, "group");
          else if (packet.t === "C2C_MESSAGE_CREATE") this.handleDispatch(packet.d, "c2c");
          break;
        }
        case 7: // Reconnect
          this.scheduleReconnect(1_000);
          break;
        case 9: // Invalid Session（鉴权失败/会话失效）：不处理就会「看着连着、实际收不到」
          this.log("error", "QQ 会话被判定无效（op9）：检查 AppID/AppSecret 与机器人是否已上线，5s 后重连");
          this.scheduleReconnect(5_000);
          break;
        case 11: // Heartbeat ACK
          break;
      }
    });
    this.ws.on("close", (code: number, reason: WebSocket.RawData) => {
      this.socketReady = false;
      this.sessionReady = false;
      this.lastCloseCode = code; // connect 等待期间用它给出现场原因（⛔ 别在归零之后才读它）
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
      if (!this.running) return;
      // 官方错误码表（文档「WebSocket 方式」）：4914 已下架 / 4915 已封禁 ⇒ 明确「不可重试」，
      // 继续重连只会每 5s 撞一次且日志刷满；其余按文档「其他错误请重新发起 identify」重连。
      if (code === 4914 || code === 4915) {
        this.running = false;
        this.log("error", `QQ 机器人${code === 4914 ? "已下架（只允许连沙箱环境）" : "已被封禁"}，停止重连：请到 q.qq.com 处理后再绑定`);
        return;
      }
      this.log("error", `QQ 长连接断开（code ${code}${String(reason ?? "") ? `：${String(reason)}` : ""}），5s 后重连`);
      this.scheduleReconnect(5_000);
    });
    this.ws.on("error", (error: Error) => this.log("error", `QQ WebSocket 异常：${error.message}`));
  }

  private identify(intervalMs: number) {
    this.ws?.send(JSON.stringify({
      op: 2,
      // intents 只订 GROUP_AND_C2C_EVENT(1<<25)：群聊@与单聊两个事件都在它下面。
      // ⛔ 多订一个无权限的位（旧代码的 1<<12 = DIRECT_MESSAGE 频道私信）服务端直接判 4014 且不许重试
      //    ——表现就是「token 拿到了却永远连不上」。文档：intent 无权限 ⇒ 关闭连接，不可重试 IDENTIFY。
      d: { token: `QQBot ${this.accessToken}`, intents: 1 << 25, shard: [0, 1] },
    }));
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.lastSeq }));
    }, Math.max(5_000, intervalMs - 3_000));
  }

  /** 重连只允许一条在飞：close/op7/op9 可能同帧叠发，各开一条就会超「最大连接数」（4008 发送过快） */
  private scheduleReconnect(delayMs: number) {
    if (!this.running || this.reconnectTimer || this.reconnecting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.resumeSocket();
    }, delayMs);
  }

  private async resumeSocket(): Promise<void> {
    if (!this.running || this.reconnecting) return;
    this.reconnecting = true;
    // ⛔ 先摘旧 socket：不摘的话它的 close 监听还会再排一次重连 ⇒ 长连接越重越多、消息成倍重复，
    //   并且超过官方最大连接数后被 4008 踢，表现为「连一会儿就断」
    this.detachSocket();
    try {
      const gw = await this.request("GET", "/gateway", undefined, await this.ensureToken());
      // ⛔ 期间可能已 logout（running 归 false）：不能再开 socket，否则退出后长连接又活过来
      if (gw.url && this.running) this.openSocket(String(gw.url));
    } catch (error: any) {
      this.log("error", `QQ 重连失败：${error?.message ?? error}`);
      this.scheduleReconnect(15_000); // 拿网关地址失败也要再来一轮，但不能密集重试
    } finally {
      this.reconnecting = false;
    }
  }

  private handleDispatch(d: any, scene: "group" | "c2c") {
    try {
      // @ 有两种写法：群聊事件里是 `@机器人名`，也有 `<@!openid>` 形式（群聊事件的 content
      // 官方说「已去除@机器人前缀」，但引用/卡片场景仍可能带，剥干净更稳）。
      // ⛔ 只剥前一种时，纯 @ 消息会残留一个 `<` 当正文进模型（守卫 ⑤ 实测抓到的）
      const text = String(d?.content ?? "").replace(/<@![^>]*>/g, " ").replace(/@\S+/g, " ").trim();
      // ⛔ 官方事件体（autogen/event/c2c_message_create）里**没有顶层 user_openid**，
      //   单聊的对方标识只在 `author.user_openid`（文档原话：User.user_openid「单聊场景使用」）。
      //   只读顶层时 chatId 恒空 ⇒ 每条私聊都被丢掉，用户看到的就是「机器人在线、发了没反应」
      //   （11-04 实测真因）。群聊才有顶层 group_openid。
      const chatId = String(d?.group_openid ?? d?.user_openid ?? d?.author?.user_openid ?? "");
      const from = String(d?.author?.member_openid ?? d?.author?.user_openid ?? "QQ 用户");
      const msgId = String(d?.id ?? "");
      const kind = scene === "group" ? "群聊@" : "单聊";
      if (!chatId) {
        this.log("error", `QQ ${kind} 事件取不到会话标识（收到的字段：${Object.keys(d ?? {}).join("/") || "空"}）⇒ 无法回复`);
        return;
      }
      // 官方：「为确保消息可达，相同 msg_id 可能重复推送」⇒ 不去重就是同一条消息跑两遍、回复两遍
      if (msgId && this.isDuplicate(msgId)) {
        this.log("info", `QQ ${kind} 消息 ${msgId.slice(0, 8)}… 是重复推送 ⇒ 只处理一次`);
        return;
      }
      // 只有 @机器人 / 纯图片 / 卡片消息会走到这里（官方事件照样推、content 里没有文字）
      // ⇒ 必须说明为什么不理，否则又是一次「发了没反应、日志一个字没有」
      if (!text) {
        this.log("info", `QQ ${kind} 事件没有可用文本（纯 @、图片或卡片；message_type=${d?.message_type ?? "无"}）⇒ 不回复`);
        return;
      }
      // ⛔ 事件到达必须留一行（id 打码）：用户报「发消息没反应」时，这一行决定往哪查——
      //   有它就是应用侧的问题（配对/发送权限/模型），没有它就是平台侧（事件权限、机器人未上线、群里没 @）
      this.log("info", `收到 QQ ${scene === "group" ? "群聊@消息" : "单聊消息"}（聊天 ${chatId.slice(0, 8)}…，${text.length} 字）`);
      this.events.onMessage({ from, chatId, text, msgId, scene });
    } catch (error: any) {
      this.log("error", `QQ 消息处理异常：${error?.message ?? error}`);
    }
  }

  /** msg_id 十分钟内见过就算重复（官方至少一次投递）。⚠️ 已知天花板：文档建议再结合
   *  message_scene.ext 的 msg_idx 判重，这里只按 msg_id —— 同一条消息被改内容重发的场景不覆盖。 */
  private isDuplicate(msgId: string): boolean {
    const now = Date.now();
    if (this.seenMsgIds.size > 400) {
      for (const [id, at] of this.seenMsgIds) if (now - at > QQ_DEDUP_WINDOW_MS) this.seenMsgIds.delete(id);
    }
    if (this.seenMsgIds.has(msgId)) {
      this.seenMsgIds.set(msgId, now);
      return true;
    }
    this.seenMsgIds.set(msgId, now);
    return false;
  }

  /** 回复：群聊 /v2/groups/{group_openid}/messages；单聊 /v2/users/{user_openid}/messages；msg_type 0=文本；必须带 msg_id（被动回复，5 分钟内有效） */
  async sendMessage(chatId: string, text: string, opts: { msgId: string; scene: "group" | "c2c" }): Promise<void> {
    const safe = text.length > 1800 ? text.slice(0, 1800) + "\n\n…（内容过长已截断）" : text;
    const apiPath = opts.scene === "group" ? `/v2/groups/${encodeURIComponent(chatId)}/messages` : `/v2/users/${encodeURIComponent(chatId)}/messages`;
    try {
      await this.request("POST", apiPath, { content: safe, msg_type: 0, msg_id: opts.msgId }, await this.ensureToken());
    } catch (error: any) {
      // 官方偶发 11253「消息频率超限」/ 40034005「msg_id 已过期」等，抛给调用方记录（附带权限指引）
      throw new Error(`${error?.message ?? error}（若提示无权限，请在 q.qq.com 申请「发送消息」权限并上线机器人；若提示 msg_id 过期，请重新 @机器人）`);
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
      if (error?.code === "ENOENT") return false; // 没绑过 QQ：不是错误，别刷 channel-log
      this.log("error", `QQ 自动恢复失败：${error?.message ?? error}`);
    }
    return false;
  }

  /** 「已连接」= 鉴权过并收到过事件（⛔ 不是 socket 存在、也不是 socket open：
   *  没通过 identify 的长连接收不到任何消息，报「已连接」就是「看着连着、实际收不到」） */
  hasSession() { return this.socketReady && this.sessionReady; }

  logout() {
    this.running = false;
    this.detachSocket();
    this.accessToken = "";
    this.tokenExpireAt = 0;
    this.seenMsgIds.clear();
    try { fs.rmSync(stateFile(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "QQ 登录态已清除，可重新绑定");
  }
}
