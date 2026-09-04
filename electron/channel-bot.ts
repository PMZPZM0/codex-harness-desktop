import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import type { CodexEvent, CodexServer } from "./codex-server";

export type ChannelBotConfig = {
  enabled: boolean;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  workspace: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
};

type ModelConfig = { provider: string; name: string; model: string; baseUrl: string };
type Binding = { threadId: string; chatId: string; updatedAt: number };
type Bindings = Record<string, Binding>;

export function larkSignature(timestamp: string, nonce: string, verificationToken: string, body: string) {
  return createHash("sha1").update(timestamp + nonce + verificationToken + body).digest("hex");
}

export function verifyLarkSignature(timestamp: string, nonce: string, verificationToken: string, body: string, signature: string) {
  const expected = Buffer.from(larkSignature(timestamp, nonce, verificationToken, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function decryptLarkPayload(encryptKey: string, encrypted: string) {
  const payload = Buffer.from(encrypted, "base64");
  const key = createHash("sha256").update(encryptKey).digest();
  const decipher = createDecipheriv("aes-256-cbc", key, payload.subarray(0, 16));
  return Buffer.concat([decipher.update(payload.subarray(16)), decipher.final()]).toString("utf8");
}

export class ChannelBotService {
  private http?: Server;
  private config?: ChannelBotConfig;
  private bindings: Bindings = {};
  private busyThreads = new Set<string>();
  private turnMessages = new Map<string, string>();
  private seenMessages = new Set<string>();
  private tenantToken?: { value: string; expiresAt: number };

  constructor(
    private readonly server: CodexServer,
    private readonly bindingsFile: string,
    private readonly getModel: () => Promise<ModelConfig | null>,
    private readonly log: (level: "info" | "error", message: string) => void,
  ) {}

  async configure(config: ChannelBotConfig | null) {
    await this.stop();
    this.config = config ?? undefined;
    this.tenantToken = undefined;
    if (!config?.enabled) return;
    if (!config.workspace || !config.appId || !config.appSecret || !config.verificationToken) {
      throw new Error("启用飞书机器人前需填写工作区、App ID、App Secret 和 Verification Token");
    }
    this.bindings = await this.readBindings();
    this.http = createServer((request, response) => void this.handleHttp(request, response));
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.http!.once("error", onError);
        this.http!.listen(config.port, config.host, () => {
          this.http!.off("error", onError);
          resolve();
        });
      });
    } catch (error) {
      this.http = undefined;
      throw error;
    }
    this.log("info", `飞书回调已监听 ${this.endpoint()}`);
  }

  async stop() {
    if (!this.http) return;
    const current = this.http;
    this.http = undefined;
    if (!current.listening) return;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }

  status() {
    return { running: Boolean(this.http?.listening), endpoint: this.endpoint(), bindings: Object.keys(this.bindings).length };
  }

  async test(config: ChannelBotConfig) {
    const startedAt = Date.now();
    await this.getTenantToken(config, true);
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  handleCodexEvent(event: CodexEvent) {
    if (event.kind !== "notification") return;
    const params = event.params as any;
    if (event.method === "turn/started") {
      this.busyThreads.add(params.threadId);
    } else if (event.method === "item/agentMessage/delta") {
      this.turnMessages.set(params.turnId, (this.turnMessages.get(params.turnId) ?? "") + (params.delta ?? ""));
    } else if (event.method === "item/completed" && params.item?.type === "agentMessage") {
      this.turnMessages.set(params.turnId, params.item.text ?? this.turnMessages.get(params.turnId) ?? "");
    } else if (event.method === "turn/completed") {
      this.busyThreads.delete(params.threadId);
      void this.finishTurn(params).catch((error) => this.log("error", `飞书回复失败：${error.message}`));
    }
  }

  private endpoint() {
    if (!this.config) return "";
    const host = this.config.host === "0.0.0.0" ? "127.0.0.1" : this.config.host;
    return `http://${host}:${this.config.port}/bot/feishu`;
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse) {
    try {
      if (request.method === "GET" && request.url === "/bot/health") return this.json(response, 200, this.status());
      if (request.method !== "POST" || request.url !== "/bot/feishu") return this.json(response, 404, { code: 404 });
      const config = this.config;
      if (!config) return this.json(response, 503, { code: 503 });
      const raw = await this.readBody(request);
      const signature = String(request.headers["x-lark-signature"] ?? "");
      const timestamp = String(request.headers["x-lark-request-timestamp"] ?? "");
      const nonce = String(request.headers["x-lark-request-nonce"] ?? "");
      if (signature) {
        if (!timestamp || !nonce || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("飞书回调时间戳无效");
        if (!verifyLarkSignature(timestamp, nonce, config.verificationToken, raw, signature)) throw new Error("飞书回调签名无效");
      }
      const outer = JSON.parse(raw);
      const payload = outer.encrypt ? JSON.parse(decryptLarkPayload(config.encryptKey, outer.encrypt)) : outer;
      const token = payload.header?.token ?? payload.token;
      if (!token || !this.safeEqual(String(token), config.verificationToken)) throw new Error("飞书 Verification Token 无效");
      if (payload.type === "url_verification") return this.json(response, 200, { challenge: payload.challenge });
      this.json(response, 200, { code: 0 });
      if (payload.header?.event_type === "im.message.receive_v1") void this.receiveMessage(payload).catch((error) => this.log("error", `飞书消息处理失败：${error.message}`));
    } catch (error: any) {
      this.log("error", error.message);
      if (!response.headersSent) this.json(response, 401, { code: 401, msg: error.message });
    }
  }

  private async receiveMessage(payload: any) {
    const message = payload.event?.message;
    if (!message?.message_id || this.seenMessages.has(message.message_id)) return;
    this.seenMessages.add(message.message_id);
    if (this.seenMessages.size > 500) this.seenMessages.delete(this.seenMessages.values().next().value!);
    if (message.message_type !== "text" || payload.event?.sender?.sender_type !== "user") {
      this.log("info", `已忽略非文本飞书消息 ${message.message_id}`);
      return;
    }
    const parsed = JSON.parse(message.content || "{}");
    let text = String(parsed.text ?? "").trim();
    for (const mention of message.mentions ?? []) text = text.replaceAll(mention.key, "").trim();
    if (!text) return;
    const chatId = String(message.chat_id);
    const key = `feishu:${chatId}`;
    const sender = payload.event?.sender?.sender_id?.open_id ?? "unknown";
    await this.submit(key, chatId, sender, text);
  }

  private async submit(key: string, chatId: string, sender: string, text: string) {
    const config = this.config!;
    const model = await this.getModel();
    if (!model) throw new Error("尚未配置自定义模型");
    let thread: any;
    const binding = this.bindings[key];
    if (binding) {
      try {
        thread = (await this.server.request("thread/resume", { threadId: binding.threadId, excludeTurns: false }) as any).thread;
      } catch {
        delete this.bindings[key];
      }
    }
    if (!thread) {
      const started = await this.server.request("thread/start", {
        model: model.model,
        cwd: config.workspace,
        approvalPolicy: "never",
        sandbox: config.sandbox,
        personality: "pragmatic",
        modelProvider: model.provider,
        config: { model_provider: model.provider, model_providers: { [model.provider]: { name: model.name, base_url: model.baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false } } },
      }) as any;
      thread = started.thread;
      this.bindings[key] = { threadId: thread.id, chatId, updatedAt: Date.now() };
      await this.writeBindings();
      this.log("info", `飞书会话已绑定任务 ${thread.id}`);
    }
    const input = [{ type: "text", text: `[飞书用户 ${sender}]\n${text}`, text_elements: [] }];
    const isBusy = this.busyThreads.has(thread.id) || thread.turns?.some((turn: any) => turn.status === "inProgress");
    if (isBusy) {
      await this.server.request("thread/queue/add", { threadId: thread.id, input, clientUserMessageId: messageId() });
      this.log("info", "飞书消息已加入 Codex 队列");
    } else {
      await this.server.request("turn/start", { threadId: thread.id, input, model: model.model, effort: "ultra", personality: "pragmatic" });
      this.log("info", "飞书消息已提交给 Codex");
    }
  }

  private async finishTurn(params: any) {
    const route = Object.values(this.bindings).find((binding) => binding.threadId === params.threadId);
    const final = [...(params.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text
      ?? this.turnMessages.get(params.turn?.id)
      ?? (params.turn?.error?.message ? `Codex 处理失败：${params.turn.error.message}` : "");
    this.turnMessages.delete(params.turn?.id);
    if (!route || !this.config) return;
    try {
      if (final.trim()) await this.sendFeishu(this.config, route.chatId, final.trim());
    } finally {
      const queued = await this.server.request("thread/queue/list", { threadId: params.threadId, limit: 1 }) as any;
      if (queued.data?.[0]) await this.server.request("thread/queue/start", { threadId: params.threadId, queuedSubmissionId: queued.data[0].id });
    }
  }

  private async sendFeishu(config: ChannelBotConfig, chatId: string, text: string) {
    const token = await this.getTenantToken(config);
    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text: text.slice(0, 120_000) }) }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    if (!response.ok || result.code !== 0) throw new Error(`HTTP ${response.status}: ${result.msg ?? JSON.stringify(result)}`);
    this.log("info", `已回复飞书会话 ${chatId}`);
  }

  private async getTenantToken(config: ChannelBotConfig, force = false) {
    if (!force && this.tenantToken && this.tenantToken.expiresAt > Date.now()) return this.tenantToken.value;
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    if (!response.ok || result.code !== 0 || !result.tenant_access_token) throw new Error(`HTTP ${response.status}: ${result.msg ?? JSON.stringify(result)}`);
    this.tenantToken = { value: result.tenant_access_token, expiresAt: Date.now() + Math.max(60, Number(result.expire ?? 7200) - 300) * 1000 };
    return this.tenantToken.value;
  }

  private readBody(request: IncomingMessage) {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          reject(new Error("飞书回调超过 1 MB"));
          request.destroy();
        } else chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", reject);
    });
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  }

  private async readBindings(): Promise<Bindings> {
    try { return JSON.parse(await fs.readFile(this.bindingsFile, "utf8")); }
    catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
  }

  private writeBindings() {
    return fs.writeFile(this.bindingsFile, JSON.stringify(this.bindings, null, 2), "utf8");
  }
}

function messageId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
