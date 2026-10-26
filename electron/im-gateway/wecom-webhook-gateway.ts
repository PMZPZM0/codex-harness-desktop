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
    const res = await fetch(clean, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**Codex Harness** 已接入本群（${new Date().toLocaleString("zh-CN")}）\n自动化任务结果与通知将推送到这里。` } }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json()) as any;
    if (res.errcode !== 0) throw new Error(`Webhook 无效：${res.errmsg ?? JSON.stringify(res).slice(0, 120)}`);
    this.webhookUrl = clean;
    try { fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true }); fs.writeFileSync(stateFilePath(), JSON.stringify({ webhookUrl: clean }, null, 2), "utf8"); } catch { /* 持久化失败不阻塞 */ }
    this.log("info", "企业微信群机器人 Webhook 已接入");
    return { ok: true, name: "企业微信群" };
  }

  /** 推送文本/markdown 到群；自动化任务结果通知走这里 */
  async sendMarkdown(content: string): Promise<void> {
    if (!this.webhookUrl) throw new Error("企微 Webhook 未连接");
    // markdown 上限 4096 字节，超长截断（webhook 无分片消息，截断加省略标记）
    const safe = content.length > 3800 ? content.slice(0, 3800) + "\n\n…（内容过长已截断）" : content;
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content: safe } }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()) as any;
    if (res.errcode !== 0) throw new Error(`企微推送失败：${res.errmsg ?? ""}`);
  }

  async resume(): Promise<boolean> {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
      if (raw.webhookUrl && /^https:\/\/qyapi\.weixin\.qq\.com/i.test(String(raw.webhookUrl))) {
        this.webhookUrl = String(raw.webhookUrl);
        return true;
      }
    } catch { /* 未配置 */ }
    return false;
  }

  hasSession() { return Boolean(this.webhookUrl); }

  logout() {
    this.webhookUrl = "";
    try { fs.rmSync(stateFilePath(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "企微 Webhook 已解除绑定");
  }
}
