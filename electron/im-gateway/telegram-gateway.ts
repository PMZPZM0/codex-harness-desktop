import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

/** 凭据落点：**惰性**取 userData ——
 *  ⛔ 模块顶层求值会早于 main.ts 的 `app.setPath("userData")` ⇒ 拿到默认目录（路径静默漂移）。
 *  ⛔ 也不许写死 `AppData\Roaming\<应用名>`：mac 是 `~/Library/Application Support/`，
 *     且 PPcode 的 userData 目录名与本仓不同 ⇒ 写死会读写到**另一个应用**的数据。
 *  `CODEX_HARNESS_USER_DATA` 是测试开关（隔离 profile 用），优先级最高。 */
function stateFile() {
  const dir = process.env.CODEX_HARNESS_USER_DATA || app.getPath("userData");
  return path.join(dir, "telegram-account.json");
}
// Telegram 机器人网关：官方 Bot API 长轮询（getUpdates）/ sendMessage。
// 凭据：@BotFather 创建机器人拿 Bot Token，填入即可；重启自动恢复。
const API = "https://api.telegram.org";
const POLL_TIMEOUT_MS = 30_000;

export type TelegramEvents = {
  onMessage: (message: { from: string; chatId: number; text: string }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

export class TelegramGateway {
  private token = "";
  private offset = 0;
  private running = false;
  /** 最近一次 getUpdates 成功的时间戳：hasSession 用它判「链路真的活着」 */
  private lastPollOkAt = 0;
  private events: TelegramEvents;

  constructor(events: TelegramEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  /** 一次 Bot API 调用。
   *  ⛔ 不许裸 `.then(r => r.json())`：代理/网关回 HTML 时抛的是英文 SyntaxError，
   *     会被 telegram-ipc 原样贴给用户（QQ 那边同款缺陷 11-04 已修，这里补齐）。
   *  官方口径：响应体 `ok` 为 true 才算成功，失败看 `description`。 */
  private async api(method: string, body?: Record<string, unknown>): Promise<any> {
    const url = `${API}/bot${this.token}/${method}`;
    const response = body
      ? await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
      : await fetch(url, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS + 10_000) });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch {
      throw new Error(`Telegram 接口 ${method} 返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 80).replace(/\s+/g, " ") || "空响应"}——多半是被代理/网关拦了`);
    }
    if (!response.ok || data.ok !== true) {
      throw new Error(`Telegram 接口 ${method} 失败（HTTP ${response.status}）：${data?.description ?? JSON.stringify(data).slice(0, 120)}`);
    }
    return data;
  }

  /** 校验 token 并启动长轮询 */
  async connect(token: string) {
    const clean = token.trim();
    if (!/^\d+:[\w-]{20,}$/.test(clean)) throw new Error("Telegram Bot Token 格式不对（应为 123456:ABC-xxx，从 @BotFather 获取）");
    const saved = this.token;
    this.token = clean;
    let me: any;
    try {
      me = await this.api("getMe");
    } finally {
      if (!me) this.token = saved; // 校验没过就恢复原 token，别让 hasSession 因为一次失败而说谎
    }
    if (!me.result?.username) throw new Error(`Token 无效：${me.description ?? "getMe 未返回机器人身份"}`);
    this.running = true;
    this.lastPollOkAt = Date.now();
    this.log("info", `Telegram 机器人 @${me.result.username} 已连接`);
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify({ token: clean, username: me.result.username }, null, 2)); } catch { /* 持久化失败不阻塞 */ }
    void this.pollLoop();
    return { username: me.result.username as string };
  }

  private async pollLoop() {
    while (this.running) {
      try {
        const data = await this.api(`getUpdates?timeout=${POLL_TIMEOUT_MS / 1000}&offset=${this.offset}`);
        this.lastPollOkAt = Date.now();
        for (const update of data.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const message = update.message;
          const text = message?.text?.trim();
          const chatId = message?.chat?.id;
          const from = message?.from?.username ?? message?.from?.first_name ?? String(chatId ?? "");
          if (text && chatId) { this.events.onMessage({ from, chatId, text }); continue; }
          // 非文本消息（语音条/图片/贴纸等）：明确告知不支持，不再静默丢弃（微信同款事故教训）
          if (chatId && message && !text) {
            const kind = message.voice || message.video_note ? "语音条" : message.photo ? "图片" : "非文本消息";
            this.sendText(chatId, `暂不支持${kind}。请用 Telegram 的语音转文字，或直接打字发送～`).catch(() => { /* 尽力而为 */ });
          }
        }
      } catch (error: any) {
        if (!this.running) break;
        // ⛔ 失败必须歇一拍再试：旧写法一异常就立刻回到 while 顶端 ⇒ 断网/token 被撤时 CPU 空转刷 API
        if (error?.name !== "AbortError") this.log("error", `Telegram 轮询异常：${error?.message ?? error}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async sendText(chatId: number, text: string) {
    // Telegram 上限 4096，超长分片
    for (let index = 0; index < text.length; index += 4000) {
      await this.api("sendMessage", { chat_id: chatId, text: text.slice(index, index + 4000) });
    }
  }

  /** 流式：发预览气泡，返回 message_id（失败返回 null，由调用方下轮重试） */
  async streamBegin(chatId: number, text: string): Promise<number | null> {
    try {
      const data = await this.api("sendMessage", { chat_id: chatId, text: text.slice(0, 4000) });
      return data.result?.message_id ?? null;
    } catch (error: any) {
      this.log("error", `Telegram 流式起头失败（chat ${chatId}）：${error?.message ?? error}`);
      return null;
    }
  }

  /** 流式：整段改写气泡；"message is not modified" 视为成功 */
  async streamEdit(chatId: number, messageId: number, text: string): Promise<boolean> {
    try {
      await this.api("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000) });
      return true;
    } catch (error: any) {
      // 内容没改动时官方就回 "message is not modified" —— 这是成功，不是失败
      if (/not modified/i.test(String(error?.message ?? error))) return true;
      this.log("error", `Telegram 流式改写失败（chat ${chatId} msg ${messageId}）：${error?.message ?? error}`);
      return false;
    }
  }

  /** 重启恢复：有持久化 token 自动重连 */
  async resume() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
      if (raw.token) return await this.connect(raw.token);
    } catch { /* 未配置 */ }
    return false;
  }

  stop() { this.running = false; }
  /** ⛔ 不是「有 token 就算连上」：token 被撤 / 另一个实例在同 token 轮询（409）/ stop() 之后，
   *  旧写法照样让机器人列表亮绿点，用户以为连着（QQ 同族缺陷，11-04 已修，这里补齐）。
   *  判据 = 在跑 **且** 最近一次 getUpdates 真成功过（90s 内；长轮询单轮 30s，留三倍余量）。 */
  hasSession() { return Boolean(this.token) && this.running && Date.now() - this.lastPollOkAt < 90_000; }

  /** 退出登录：停轮询、清内存与持久化 token（删除机器人/重新绑定场景） */
  logout() {
    this.stop();
    this.token = "";
    this.offset = 0;
    this.lastPollOkAt = 0;
    try { fs.rmSync(stateFile(), { force: true }); } catch { /* 忽略 */ }
    this.log("info", "Telegram 登录态已清除，可重新绑定");
  }
}
