import path from "node:path";
import os from "node:os";
import fs from "node:fs";
// Telegram 机器人网关：官方 Bot API 长轮询（getUpdates）/ sendMessage。
// 凭据：@BotFather 创建机器人拿 Bot Token，填入即可；重启自动恢复。
const API = "https://api.telegram.org";
const stateFile = path.join(process.env.CODEX_HARNESS_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "Codex Harness Desktop"), "telegram-account.json");
const POLL_TIMEOUT_MS = 30_000;

export type TelegramEvents = {
  onMessage: (message: { from: string; chatId: number; text: string }) => void;
  log?: (level: "info" | "error", message: string) => void;
};

export class TelegramGateway {
  private token = "";
  private offset = 0;
  private running = false;
  private events: TelegramEvents;

  constructor(events: TelegramEvents) {
    this.events = events;
  }

  private log(level: "info" | "error", message: string) { this.events.log?.(level, message); }

  /** 校验 token 并启动长轮询 */
  async connect(token: string) {
    const clean = token.trim();
    if (!/^\d+:[\w-]{20,}$/.test(clean)) throw new Error("Telegram Bot Token 格式不对（应为 123456:ABC-xxx，从 @BotFather 获取）");
    const me = await fetch(`${API}/bot${clean}/getMe`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
    if (!me.ok) throw new Error(`Token 无效：${me.description ?? "getMe 失败"}`);
    this.token = clean;
    this.running = true;
    this.log("info", `Telegram 机器人 @${me.result.username} 已连接`);
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ token: clean, username: me.result.username }, null, 2)); } catch { /* 持久化失败不阻塞 */ }
    void this.pollLoop();
    return { username: me.result.username as string };
  }

  private async pollLoop() {
    while (this.running) {
      try {
        const res = await fetch(`${API}/bot${this.token}/getUpdates?timeout=${POLL_TIMEOUT_MS / 1000}&offset=${this.offset}`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS + 10_000) });
        const data = await res.json();
        if (!data.ok) { this.log("error", `getUpdates 失败：${data.description ?? ""}`); await new Promise((r) => setTimeout(r, 3000)); continue; }
        for (const update of data.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const text = update.message?.text?.trim();
          const chatId = update.message?.chat?.id;
          const from = update.message?.from?.username ?? update.message?.from?.first_name ?? String(chatId ?? "");
          if (text && chatId) this.events.onMessage({ from, chatId, text });
        }
      } catch (error: any) {
        if (!this.running) break;
        if (error.name !== "AbortError") this.log("error", `Telegram 轮询异常：${error.message}`);
      }
    }
  }

  async sendText(chatId: number, text: string) {
    // Telegram 上限 4096，超长分片
    for (let index = 0; index < text.length; index += 4000) {
      const res = await fetch(`${API}/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(index, index + 4000) }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(`Telegram 发送失败：${data.description ?? ""}`);
    }
  }

  /** 流式：发预览气泡，返回 message_id（失败返回 null，由调用方下轮重试） */
  async streamBegin(chatId: number, text: string): Promise<number | null> {
    try {
      const res = await fetch(`${API}/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      return data.ok ? (data.result?.message_id ?? null) : null;
    } catch { return null; }
  }

  /** 流式：整段改写气泡；"message is not modified" 视为成功 */
  async streamEdit(chatId: number, messageId: number, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${API}/bot${this.token}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (data.ok) return true;
      return /not modified/i.test(String(data.description ?? ""));
    } catch { return false; }
  }

  /** 重启恢复：有持久化 token 自动重连 */
  async resume() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (raw.token) return await this.connect(raw.token);
    } catch { /* 未配置 */ }
    return false;
  }

  stop() { this.running = false; }
  hasSession() { return Boolean(this.token); }

  /** 退出登录：停轮询、清内存与持久化 token（删除机器人/重新绑定场景） */
  logout() {
    this.stop();
    this.token = "";
    this.offset = 0;
    try { fs.rmSync(stateFile, { force: true }); } catch { /* 忽略 */ }
    this.log("info", "Telegram 登录态已清除，可重新绑定");
  }
}
