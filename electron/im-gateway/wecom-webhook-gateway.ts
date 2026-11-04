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
  return path.join(dir, "wecom-webhook.json");
}
// 企业微信群机器人 Webhook 网关（推送/通知型）：
// 群里「添加机器人」拿 Webhook URL，粘贴即用。官方协议：POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
// 能力边界：只能向该群推送消息（markdown/text），不支持收消息/对话——企微群机器人无回调通道（腾讯限制）。
// 凭据持久化 userData/wecom-webhook.json，重启自动恢复可用性校验。

export type WecomWebhookEvents = {
  log?: (level: "info" | "error", message: string) => void;
};

export class WecomWebhookGateway {
  private webhookUrl = "";
  /** 最近一次推送被企微接受的时间：webhook 是「一次性推送通道」，没有长连接可查，
   *  所以「已接入」只能凭**真的发出去过**或**刚校验通过**来说（11-04 审查：旧写法只看 URL
   *  正则过就报已接入 ⇒ key 被撤也常亮绿点） */
  private lastGoodAt = 0;
  private events: WecomWebhookEvents;

  constructor(events: WecomWebhookEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  /** 校验 URL 格式 + 发一条测试消息验证 webhook 有效性 */
  async connect(webhookUrl: string): Promise<{ ok: boolean; name?: string }> {
    const clean = webhookUrl.trim();
    if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[0-9a-f-]{36}$/i.test(clean)) {
      throw new Error("Webhook URL 格式不对（应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx，在企微群里「添加机器人」获取）");
    }
    // 用官方「模板卡片」太重，发一条 markdown 测试消息；webhook 无「查询」接口，发成功即有效
    const res = await this.post(clean, { msgtype: "markdown", markdown: { content: `**Codex Harness** 已接入本群（${new Date().toLocaleString("zh-CN")}）\n自动化任务结果与通知将推送到这里。` } });
    if (res.errcode !== 0) throw new Error(`Webhook 无效：${res.errmsg ?? JSON.stringify(res).slice(0, 120)}`);
    this.webhookUrl = clean;
    this.lastGoodAt = Date.now();
    try { fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true }); fs.writeFileSync(stateFilePath(), JSON.stringify({ webhookUrl: clean }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", "企业微信群机器人 Webhook 已接入（测试消息已送达）");
    return { ok: true, name: "企业微信群" };
  }

  /** 一次 webhook POST：⛔ 不许裸 `.then(r => r.json())` —— 代理返回 HTML 时抛的是英文
   *  SyntaxError，会被原样贴给用户（11-04 审查，与 QQ/钉钉同族缺陷） */
  private async post(url: string, payload: Record<string, unknown>): Promise<any> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { errcode: response.status, errmsg: `响应不是 JSON（HTTP ${response.status}）：${text.slice(0, 80).replace(/\s+/g, " ") || "空响应"}` };
    }
  }

  /** 按 **UTF-8 字节数**截断（企微 markdown 上限 4096 字节）。
   *  ⛔ 旧写法按字符数算 3800 —— 中文一个字 3 字节，1500 字的答复就 ~4500 字节，
   *  必被拒（errcode 40058），用户看到「推送失败」且原因不明（11-04 审查抓出）。 */
  private clipByBytes(content: string, maxBytes: number): string {
    if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
    const suffix = "\n\n…（内容过长已截断）";
    const budget = maxBytes - Buffer.byteLength(suffix, "utf8");
    let cut = content;
    while (Buffer.byteLength(cut, "utf8") > budget) cut = cut.slice(0, Math.max(0, Math.floor(cut.length * 0.9)));
    return `${cut}${suffix}`;
  }

  /** 推送文本/markdown 到群；自动化任务结果通知走这里 */
  async sendMarkdown(content: string): Promise<void> {
    if (!this.webhookUrl) throw new Error("企微 Webhook 未连接");
    const safe = this.clipByBytes(content, 4096);
    const res = await this.post(this.webhookUrl, { msgtype: "markdown", markdown: { content: safe } });
    if (res.errcode !== 0) {
      throw new Error(`企微推送失败（errcode ${res.errcode}）：${res.errmsg ?? "无描述"}（20 条/分钟超限会被限流；markdown 上限 4096 字节）`);
    }
    this.lastGoodAt = Date.now();
    this.log("info", `企微已推送 ${safe.length} 字到群`);
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
      if (raw.webhookUrl && /^https:\/\/qyapi\.weixin\.qq\.com/i.test(String(raw.webhookUrl))) {
        this.webhookUrl = String(raw.webhookUrl);
        this.lastGoodAt = 0; // 重启后还没真发过，别拿上一轮的送达当证据
        return true;
      }
    } catch { /* 未配置 */ }
    return false;
  }

  /** 「已接入」= URL 在 **且** 本次进程里真的推送成功过（webhook 没有长连接可探活，
   *  只看 URL 会把「key 已被撤」显示成正常接入 —— 11-04 审查） */
  hasSession() { return Boolean(this.webhookUrl) && this.lastGoodAt > 0; }

  logout() {
    this.webhookUrl = "";
    this.lastGoodAt = 0;
    try { fs.rmSync(stateFilePath(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "企微 Webhook 已解除绑定");
  }
}
