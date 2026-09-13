// Bot Channel 配对门卫（09-13）：机器人聊天的**首次使用**必须过两道关——
//   ① 在聊天里发送电脑端显示的 6 位授权码（用户原话：「通过消息发送配对」）；
//   ② 电脑端在应用里点「允许」。
// 背景：此前 5 个渠道入口（微信/Telegram/飞书/钉钉/QQ）都是「未绑定聊天自动开
// danger-full-access 会话并直接执行消息」——任何人加到机器人就能指挥一台全权限 agent。
// 纯逻辑 + 可注入持久化，预检【4g】直接跑真实现断言（含反证）。

export type BotPairRequest = {
  rid: string;
  channel: string;
  chatId: string;
  name: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
};

export type BotPairDecision =
  | { action: "allow" }
  | { action: "guide"; message: string }
  | { action: "wait"; rid: string; message: string };

export const PAIR_CODE_TTL = 5 * 60_000;
export const PAIR_MAX_WRONG = 5;
export const PAIR_COOLDOWN = 10 * 60_000;
export const PAIR_REQUEST_TTL = 2 * 60_000;

export const GUIDE_MESSAGE =
  "首次使用需要配对：请在电脑端的 Codex Harness「手机远控」面板查看 6 位配对码，把它直接发给我（5 分钟内有效）。配对通过后即可正常使用。";

export class BotPairingService {
  /** 待审批 rid → 请求 */
  private requests = new Map<string, BotPairRequest>();
  /** 已批准聊天 "channel:chatId" → 记录（持久化） */
  private approved = new Map<string, { channel: string; chatId: string; name: string; approvedAt: number }>();
  /** 连续输错计数与冷却（挡往机器人狂发数字暴力试码） */
  private wrongStreak = 0;
  private cooldownUntil = 0;

  constructor(
    /** 6 位授权码来源（与「手机远控」同一个码：电脑端只显示一个数字） */
    private readonly codeProvider: () => string,
    /** 电脑端审批事件转发 */
    private readonly notify: (request: BotPairRequest) => void,
    /** 持久化写入（approved 表）；不传则不持久化 */
    private readonly persist?: (approved: Record<string, unknown>) => void,
  ) {}

  /** 从持久化数据恢复已批准表（构造后立刻调用一次） */
  restoreApproved(data: Record<string, any>) {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value && typeof value.name === "string") {
        this.approved.set(key, { channel: value.channel ?? key.split(":")[0], chatId: value.chatId ?? key.split(":").slice(1).join(":"), name: value.name, approvedAt: Number(value.approvedAt ?? 0) });
      }
    }
  }

  /** 当前 6 位授权码（由 codeProvider 提供，通常转发 RemoteControlService.pairingCode()） */
  code() {
    return this.codeProvider();
  }

  /** 渠道消息入口：**每个渠道的 submit 前都必须调**。返回 allow 才可以把消息交给引擎。 */
  onChannelMessage(channel: string, chatId: string, name: string, text: string): BotPairDecision {
    const key = `${channel}:${chatId}`;
    if (this.approved.has(key)) return { action: "allow" };
    const digits = String(text ?? "").replace(/\D/g, "");
    // 聊天里发的内容带「配对」字样或就是一串 6 位数字 → 当作配对尝试
    const looksLikePairing = /配对|授权/.test(text ?? "") || /^\s*\d{6}\s*$/.test(text ?? "");
    if (!looksLikePairing) {
      return { action: "guide", message: GUIDE_MESSAGE };
    }
    if (Date.now() < this.cooldownUntil) {
      const left = Math.ceil((this.cooldownUntil - Date.now()) / 60_000);
      return { action: "guide", message: `配对码错误次数过多，已临时锁定（约 ${left} 分钟后重试）。` };
    }
    const expected = this.codeProvider();
    if (digits.length !== 6 || digits !== expected) {
      this.wrongStreak += 1;
      if (this.wrongStreak >= PAIR_MAX_WRONG) {
        this.wrongStreak = 0;
        this.cooldownUntil = Date.now() + PAIR_COOLDOWN;
        return { action: "guide", message: `配对码连续错误 ${PAIR_MAX_WRONG} 次，已锁定 ${PAIR_COOLDOWN / 60_000} 分钟。请核对电脑端显示的配对码后再试。` };
      }
      return { action: "guide", message: `配对码不对（还剩 ${PAIR_MAX_WRONG - this.wrongStreak} 次机会）。请在电脑端「手机远控」面板核对 6 位数字后重新发送。` };
    }
    this.wrongStreak = 0;
    // 码正确 → 挂起，等电脑端批准
    for (const [, req] of this.requests) {
      if (req.channel === channel && req.chatId === chatId && req.status === "pending") req.status = "expired";
    }
    const rid = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const request: BotPairRequest = { rid, channel, chatId, name: name || `${channel} 聊天`, status: "pending", createdAt: Date.now() };
    this.requests.set(rid, request);
    this.notify(request);
    return { action: "wait", rid, message: "配对码正确，等待电脑端批准…（在电脑端「手机远控」面板点「允许」后，再发一次你的消息即可）" };
  }

  /** 电脑端批准：该聊天写入已批准表（持久化） */
  approve(rid: string): boolean {
    const req = this.requests.get(rid);
    if (!req || req.status !== "pending") return false;
    req.status = "approved";
    this.approved.set(`${req.channel}:${req.chatId}`, { channel: req.channel, chatId: req.chatId, name: req.name, approvedAt: Date.now() });
    this.persistApproved();
    return true;
  }

  /** 电脑端拒绝 */
  deny(rid: string): boolean {
    const req = this.requests.get(rid);
    if (!req || req.status !== "pending") return false;
    req.status = "denied";
    return true;
  }

  /** 撤销已批准聊天（下次重走配对） */
  revoke(channel: string, chatId: string): boolean {
    const gone = this.approved.delete(`${channel}:${chatId}`);
    if (gone) this.persistApproved();
    return gone;
  }

  /** 手机端/渲染层轮询审批结果（rid 由消息发起方持有） */
  requestStatus(rid: string): string {
    const req = this.requests.get(rid);
    if (!req) return "expired";
    if (req.status === "pending" && Date.now() - req.createdAt > PAIR_REQUEST_TTL) req.status = "expired";
    return req.status;
  }

  state() {
    for (const [, req] of this.requests) {
      if (req.status === "pending" && Date.now() - req.createdAt > PAIR_REQUEST_TTL) req.status = "expired";
    }
    return {
      code: this.codeProvider(),
      pending: [...this.requests.values()].filter((r) => r.status === "pending").map((r) => ({ rid: r.rid, channel: r.channel, chatId: r.chatId, name: r.name, createdAt: r.createdAt })),
      approved: [...this.approved.entries()].map(([key, info]) => ({ key, channel: info.channel, chatId: info.chatId, name: info.name, approvedAt: info.approvedAt })),
    };
  }

  /** 已批准？(内部/测试用；渠道走 onChannelMessage) */
  isApproved(channel: string, chatId: string) {
    return this.approved.has(`${channel}:${chatId}`);
  }

  private persistApproved() {
    const data: Record<string, unknown> = {};
    for (const [key, info] of this.approved) data[key] = info;
    this.persist?.(data);
  }
}
