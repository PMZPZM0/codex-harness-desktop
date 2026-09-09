// 频道机器人流式回复：把引擎回合的思考/工具/正文按时间顺序实时推送回聊天渠道。
// 两种传输语义（由 sink 决定）：
//   append（微信 iLink）：message_state=1 向同一气泡增量追加，state=2 收尾；
//     state=1 连续失败自动停用追加（降级收集），收尾时把未发出去的尾部整段补发。
//   replace（Telegram）：sendMessage 建气泡 + editMessageText 节流整段改写。
// 流式关闭时退化为旧行为：turn/completed 后一次性发送最终正文。
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";

export type BotStreamSettings = { enabled: boolean; thinking: boolean; tools: boolean };
export const BOT_STREAM_DEFAULTS: BotStreamSettings = { enabled: true, thinking: true, tools: true };

export async function readBotStreamSettings(file: string): Promise<BotStreamSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    return normalizeBotStreamSettings(raw);
  } catch { return { ...BOT_STREAM_DEFAULTS }; }
}

/** 回合启动时同步读（turn/started 处理在同步事件回调里，不能 await） */
export function readBotStreamSettingsSync(file: string): BotStreamSettings {
  try { return normalizeBotStreamSettings(JSON.parse(readFileSync(file, "utf8"))); } catch { return { ...BOT_STREAM_DEFAULTS }; }
}

function normalizeBotStreamSettings(raw: any): BotStreamSettings {
  return { enabled: raw?.enabled !== false, thinking: raw?.thinking !== false, tools: raw?.tools !== false };
}

export function writeBotStreamSettings(file: string, settings: BotStreamSettings) {
  return fs.writeFile(file, JSON.stringify({
    enabled: Boolean(settings.enabled),
    thinking: Boolean(settings.thinking),
    tools: Boolean(settings.tools),
  }, null, 2), "utf8");
}

export type BotStreamSink = {
  /** append 语义：向当前气泡增量发送新文本（state=1）；连续失败会被置空停用 */
  append?: (delta: string, clientId: string) => Promise<void>;
  /** append 语义：发送收尾增量并结束气泡（state=2） */
  finalizeAppend?: (tail: string, clientId: string) => Promise<void>;
  /** replace 语义：整段改写预览气泡；返回 false 表示本轮未生效（下轮重试） */
  replace?: (fullText: string) => Promise<boolean>;
  /** replace 语义：最终整段落定（超长分片） */
  finalizeReplace?: (fullText: string) => Promise<void>;
  /** 非流式：整段一次性发送 */
  send: (fullText: string) => Promise<void>;
};

const APPEND_FLUSH_INTERVAL_MS = 1500;
const APPEND_MAX_FLUSHES = 40; // 上限防刷屏（极端情况协议把每次追加当独立气泡）
const REPLACE_EDIT_INTERVAL_MS = 1600;
const REPLACE_PREVIEW_CAP = 3800; // Telegram 编辑预览上限（最终消息另有 4096 分片）
const COMMAND_OUTPUT_CAP = 400;   // 单条命令输出最多同步 400 字符

export class BotStreamSession {
  private composed = "";        // 按时间顺序累积的完整文本（思考/工具/正文）
  private flushedLen = 0;       // append 语义：已推送的字符数
  private lastFlushAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushBusy = false;
  private flushes = 0;
  private appendFailures = 0;
  private pendingReplace: Promise<void> = Promise.resolve();
  private replaceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplaceAt = 0;
  private lastReplaceText = "";
  private replaceStarted = false;
  private inThinking = false;
  private inCommand = false;
  private commandChars = 0;
  private reasoningSeen = new Set<string>();
  private bodyByItem = new Map<string, number>();
  private bodyLen = 0;
  private finished = false;
  readonly clientId = `codex-harness-${randomUUID()}`;

  constructor(private readonly sink: BotStreamSink, private readonly settings: BotStreamSettings) {}

  handle(method: string, params: any) {
    if (this.finished) return;
    const p = params ?? {};
    switch (method) {
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        if (!this.settings.thinking) return;
        if (p.itemId) this.reasoningSeen.add(String(p.itemId));
        this.openThinking();
        this.compose(String(p.delta ?? ""));
        break;
      }
      case "item/agentMessage/delta": {
        this.closeThinking();
        const delta = String(p.delta ?? "");
        if (!delta) return;
        const id = String(p.itemId ?? "");
        this.bodyByItem.set(id, (this.bodyByItem.get(id) ?? 0) + delta.length);
        this.bodyLen += delta.length;
        this.compose(delta);
        break;
      }
      case "item/started": {
        const item = p.item ?? {};
        if (this.inCommand && item.type !== "commandExecution") { this.inCommand = false; this.compose("\n"); }
        if (!this.settings.tools) return;
        if (item.type === "reasoning" || item.type === "agentMessage" || item.type === "userMessage") return;
        this.closeThinking();
        if (item.type === "commandExecution") {
          this.inCommand = true;
          this.commandChars = 0;
          this.compose(`\n🔧 执行：${String(item.command ?? "").slice(0, 200)}\n`);
        } else if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
          this.compose(`\n🔧 工具：${String(item.tool ?? item.server ?? "mcp").slice(0, 120)}\n`);
        } else if (item.type === "fileChange") {
          this.compose(`\n🔧 修改文件：${String(item.path ?? item.relPath ?? "").slice(0, 160)}\n`);
        } else if (item.type === "webSearch") {
          this.compose(`\n🔧 搜索：${String(item.query ?? "").slice(0, 160)}\n`);
        }
        break;
      }
      case "item/commandExecution/outputDelta": {
        if (!this.settings.tools || !this.inCommand) return;
        if (this.commandChars >= COMMAND_OUTPUT_CAP) return;
        const chunk = String(p.delta ?? "").slice(0, COMMAND_OUTPUT_CAP - this.commandChars);
        if (!chunk) return;
        this.commandChars += chunk.length;
        this.compose(chunk);
        break;
      }
      case "item/completed": {
        const item = p.item ?? {};
        // 思考只发 summary 快照、没有 delta 的模型：完成时补发摘要
        if (item.type === "reasoning" && this.settings.thinking && item.id && !this.reasoningSeen.has(String(item.id))) {
          const summary = (item.summary ?? []).map((s: any) => s?.text ?? "").join("\n").trim();
          if (summary) { this.openThinking(); this.compose(summary); this.closeThinking(); }
        }
        if (item.type === "commandExecution" && this.inCommand) {
          this.inCommand = false;
          this.compose(item.exitCode != null && item.exitCode !== 0 ? `\n（退出码 ${item.exitCode}）\n` : "\n");
        }
        // 权威快照兜底：delta 漏收时补齐正文缺失尾部
        if (item.type === "agentMessage" && typeof item.text === "string") {
          const id = String(item.id ?? "");
          const sent = this.bodyByItem.get(id) ?? 0;
          if (item.text.length > sent) {
            const missing = item.text.slice(sent);
            this.bodyByItem.set(id, item.text.length);
            this.bodyLen += missing.length;
            this.compose(missing);
          }
        }
        break;
      }
      case "turn/completed": {
        this.finished = true;
        void this.finish(p).catch(() => undefined);
        break;
      }
    }
  }

  private openThinking() {
    if (!this.inThinking) { this.inThinking = true; this.compose("\n💭 思考\n"); }
  }
  private closeThinking() {
    if (this.inThinking) { this.inThinking = false; this.compose("\n"); }
  }

  private compose(text: string) {
    if (!text) return;
    this.composed += text;
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.settings.enabled) return;
    if (this.sink.append) {
      if (this.flushTimer) return;
      const wait = Math.max(0, APPEND_FLUSH_INTERVAL_MS - (Date.now() - this.lastFlushAt));
      this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flushAppend(); }, wait);
    } else if (this.sink.replace) {
      if (this.replaceTimer) return;
      const wait = Math.max(0, REPLACE_EDIT_INTERVAL_MS - (Date.now() - this.lastReplaceAt));
      this.replaceTimer = setTimeout(() => { this.replaceTimer = null; void this.doReplace(); }, wait);
    }
  }

  private async flushAppend() {
    if (this.finished || this.flushBusy || !this.sink.append) return;
    const pending = this.composed.slice(this.flushedLen);
    if (!pending.trim() || this.flushes >= APPEND_MAX_FLUSHES) return;
    this.flushBusy = true;
    try {
      await this.sink.append(pending, this.clientId);
      this.flushedLen = this.composed.length;
      this.flushes += 1;
      this.lastFlushAt = Date.now();
    } catch {
      // state=1 追加不被协议支持等：连续失败 2 次停用追加，未发内容收尾时整段补发
      this.appendFailures += 1;
      if (this.appendFailures >= 2) this.sink.append = undefined;
    } finally {
      this.flushBusy = false;
    }
  }

  private async doReplace() {
    if (this.finished || !this.sink.replace) return;
    const full = this.composed;
    if (!full.trim() || full === this.lastReplaceText) return;
    this.lastReplaceAt = Date.now();
    const sink = this.sink;
    this.pendingReplace = this.pendingReplace
      .then(async () => {
        const ok = await sink.replace!(full).catch(() => false);
        if (ok) { this.lastReplaceText = full; this.replaceStarted = true; }
      })
      .catch(() => undefined);
  }

  private async finish(params: any) {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.replaceTimer) { clearTimeout(this.replaceTimer); this.replaceTimer = null; }
    const items = params?.turn?.items ?? [];
    const finalText = [...items].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
    const errorText = params?.turn?.error?.message ? `⚠️ Codex 处理失败：${params.turn.error.message}` : "";
    const text = String(finalText || errorText).trim();
    try {
      if (!this.settings.enabled) {
        if (text) await this.sink.send(text);
        return;
      }
      if (this.sink.finalizeAppend && (this.flushedLen > 0 || this.composed.trim())) {
        // 补齐权威正文与已流入文本的差额（item/completed 已兜底，这里再保险）
        if (finalText && finalText.length > this.bodyLen) this.compose(finalText.slice(this.bodyLen));
        await this.flushAppend();
        const tail = this.composed.slice(this.flushedLen);
        await this.sink.finalizeAppend(tail.trim() ? tail : "（已完成）", this.clientId);
        return;
      }
      if (this.sink.replace) {
        const full = (finalText || this.composed || errorText).trim();
        if (!full) return;
        await this.pendingReplace;
        if (this.replaceStarted) await this.sink.finalizeReplace?.(full);
        else await this.sink.send(full);
        return;
      }
      if (text) await this.sink.send(text);
    } catch { /* 回复失败不影响主流程 */ }
  }
}
