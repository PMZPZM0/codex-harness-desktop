/**
 * responses-bridge —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { SseParser } from "./responses-bridge/01-sse-items";
import { toChatRequest, ChatStreamTranslator, chatJsonToResponses } from "./responses-bridge/02-chat-convert";
import { anthropicMessagesUrl, toAnthropicRequest, AnthropicStreamTranslator, anthropicJsonToResponses } from "./responses-bridge/03-anthropic-convert";
export { SseParser, toChatRequest, ChatStreamTranslator, chatJsonToResponses, anthropicMessagesUrl, toAnthropicRequest, AnthropicStreamTranslator, anthropicJsonToResponses };


export type BridgeMode = "auto" | "responses" | "chat" | "anthropic";

export type BridgeTarget = { baseUrl: string; mode: BridgeMode; label?: string };

/** Anthropic 官方要求的版本头（不带会被拒；中转站普遍也认这个值）。 */
const ANTHROPIC_VERSION = "2023-06-01";

const HOP_BY_HOP = new Set([
  "host", "connection", "content-length", "keep-alive", "transfer-encoding",
  "upgrade", "proxy-connection", "te", "trailer",
  // 转换模式下要按行解析 SSE，不能拿到压缩流；统一去掉，让上游给明文
  "accept-encoding",
]);

/** 「上游不认这个端点」的措辞特征（用于 400 的歧义判定，见 probeResponses）。
 *  ⛔ 只在 400 且**响应体明确是这个意思**时才切 chat —— 宁可漏切（用户可手动指定
 *  「强制 chat」），也不能把「参数错误」误判成「端点不存在」而把本来能用的网关改坏。 */
const UNSUPPORTED_ENDPOINT_HINT = /not\s*found|unknown\s+(endpoint|route|path|url|method)|unsupported|not\s+implemented|no\s+such|invalid\s+(url|endpoint|path)|does\s*not\s*exist|无法找到|不支持|未知(的)?(端点|路径|接口)/i;

export type BridgeStatus = { running: boolean; port: number; targets: number; requests: number; converted: number; forwarded: number; failures: number };

export class ResponsesBridge {
  private server: http.Server | null = null;
  private port = 0;
  private targets = new Map<string, BridgeTarget>();
  private resolved = new Map<string, "responses" | "chat">();
  private counters = { requests: 0, converted: 0, forwarded: 0, failures: 0 };
  private log: (line: string) => void;
  private emitReasoning: boolean;

  constructor(private options: { preferredPort?: number; log?: (line: string) => void; emitReasoning?: boolean } = {}) {
    this.log = options.log ?? (() => {});
    // 推理内容是否转成 Responses 的 summary 事件：默认开（实证见 scripts/probe-bridge.cjs
    // —— 引擎容忍该事件，能拿到就展示，拿不到时上游本来也没有可展示的推理）
    this.emitReasoning = options.emitReasoning !== false;
  }

  /** 登记路由目标：`/p/<id>/…` → 该 id 的上游。每次下发配置前调用，保证目标最新。
   *
   *  ⛔ 目标**变了就必须丢掉已解析的协议**（09-19 加「上游协议」手动开关时补）：
   *     · mode 变了：用户从「自动」改成「强制 chat」后，桥若还按老的 `resolved` 走，
   *       表现为**改了设置不生效**（查半天查不出原因）；
   *     · base_url 变了：换了一家网关，能力可能完全不同，旧判定同样不能信。 */
  register(id: string, target: BridgeTarget) {
    const previous = this.targets.get(id);
    this.targets.set(id, target);
    if (previous && (previous.mode !== target.mode || previous.baseUrl !== target.baseUrl)) {
      this.resolved.delete(id);
    }
  }

  /** 该 id 当前是否已有确定的上游协议（供状态展示） */
  modeOf(id: string): "responses" | "chat" | "unknown" {
    return this.resolved.get(id) ?? "unknown";
  }

  /** 已解析出的协议快照（供设置页展示「这个网关实际走的是什么」） */
  modesSnapshot(): Record<string, "responses" | "chat"> {
    return Object.fromEntries(this.resolved.entries());
  }

  /** 各供应商**配置**的上游协议（register 进来的，不是探测结果）。
   *
   *  ⛔ 与 modesSnapshot 的区别：那个是「实际跑了什么」，这个是「用户配了什么」。
   *    排查「我改了设置但没生效」时，必须看**这个** —— 它为空/是旧值就说明配置没传到桥
   *    （链路断在注册那一步），而不是桥转发错了。09-19 加手动开关时补的。 */
  configuredModes(): Record<string, BridgeMode> {
    return Object.fromEntries([...this.targets.entries()].map(([id, target]) => [id, target.mode]));
  }

  getPort(): number { return this.port; }

  status(): BridgeStatus {
    return { running: Boolean(this.server), port: this.port, targets: this.targets.size, ...this.counters };
  }

  /** 把某个 id 的 base_url 换成本桥地址（未启动时返回 null，调用方降级为直连）。 */
  urlFor(id: string): string | null {
    return this.server && this.port ? `http://127.0.0.1:${this.port}/p/${encodeURIComponent(id)}` : null;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    const preferred = this.options.preferredPort ?? 0;
    try {
      this.port = await this.listen(server, preferred);
    } catch (error) {
      // 端口被占（另一个实例/其它软件）→ 退回随机端口，功能不受影响
      this.log(`[bridge] 端口 ${preferred} 不可用（${(error as Error).message}），改用随机端口`);
      this.port = await this.listen(server, 0);
    }
    this.server = server;
    this.log(`[bridge] 协议桥已启动 http://127.0.0.1:${this.port}`);
    return this.port;
  }

  private listen(server: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        resolve((server.address() as any).port);
      });
    });
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/p\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "not a bridge route" } })); }
    const id = decodeURIComponent(match[1]);
    const rest = match[2] ?? "";
    const target = this.targets.get(id);
    if (!target) {
      this.counters.failures += 1;
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `协议桥未登记供应商 ${id}` } }));
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    this.counters.requests += 1;

    const isResponses = rest === "/responses" || rest.endsWith("/responses");
    // 非 responses 端点（如 /models）：与协议无关，直接透传
    if (!isResponses) return void this.forward(req, res, target, rest, raw);

    const known = target.mode === "auto" ? this.resolved.get(id) : target.mode;
    if (known === "chat") return void this.convert(req, res, target, rest, raw);
    if (known === "anthropic") return void this.convertAnthropic(req, res, target, rest, raw);
    if (known === "responses") return void this.forward(req, res, target, rest, raw);

    // auto 且尚不确定：先按 responses 试一次；只有「上游根本不认这个端点」才切 chat 重放
    const verdict = await this.probeResponses(req, res, target, rest, raw);
    if (verdict !== "unsupported") return;
    this.log(`[bridge] ${id} 上游不接受 responses，改用 chat 转换`);
    this.resolved.set(id, "chat");
    return void this.convert(req, res, target, rest, raw);
  }

  /** auto 模式的第一跳：透传 responses；若判定上游不认该端点则**不写任何响应**，留给 convert 重放。 */
  private probeResponses(
    req: http.IncomingMessage, res: http.ServerResponse, target: BridgeTarget, rest: string, raw: Buffer,
  ): Promise<"unsupported" | "handled"> {
    return new Promise((resolve) => {
      const upstream = this.upstreamRequest(req, target, rest, raw);
      upstream.once("response", (up) => {
        const status = up.statusCode ?? 502;
        // ① 明确表示「没有这个端点」的状态码
        if (status === 404 || status === 405 || status === 501) {
          up.resume(); // 丢弃响应体，避免连接悬挂
          return resolve("unsupported");
        }
        // ② 400 是**歧义**状态：可能是"不认这个端点"（该切 chat），也可能是"请求体有问题"
        //    （端点正常，切了反而更糟 —— 有些 Responses 网关对不支持的参数就回 400）。
        //    只看状态码会误判，必须读一小段响应体看措辞（错误响应都很小，缓冲不影响流式）。
        if (status === 400) {
          const chunks: Buffer[] = [];
          let buffered = 0;   // 累加长度（别每次 data 都 reduce 重算 —— 那是 O(n²)）
          let settled = false;
          const verdictOf = () => (UNSUPPORTED_ENDPOINT_HINT.test(Buffer.concat(chunks).toString("utf8")) ? "unsupported" : "handled");
          const settle = (verdict: "unsupported" | "handled") => {
            if (settled) return;
            settled = true;
            if (verdict === "handled" && !res.headersSent) {
              // 端点正常 → 把缓冲的响应体原样回放给引擎（不能吞掉，否则用户看不到真实报错）
              this.counters.forwarded += 1;
              res.writeHead(status, this.responseHeaders(up.headers));
              res.end(Buffer.concat(chunks));
            }
            // ⛔ 无论哪种判决，都要把上游这条响应**排空**：只 resolve 不消费会让这条连接
            //    （以及 keep-alive 池里的 socket）永远挂着 —— 而 400 恰好是「网关不配套」
            //    时的高频路径，泄漏会随尝试次数累积。resume 让剩余数据流走并正常收尾。
            up.resume();
            resolve(verdict);
          };
          up.on("data", (chunk: Buffer) => {
            if (settled) return;
            chunks.push(chunk);
            // 攒够一段就能定性（避免超大响应把内存吃掉）
            buffered += chunk.length;
            if (buffered > 8192) settle(verdictOf());
          });
          up.once("end", () => settle(verdictOf()));
          up.once("error", () => settle("handled"));
          return;
        }
        this.counters.forwarded += 1;
        res.writeHead(status, this.responseHeaders(up.headers));
        up.pipe(res);
        up.once("end", () => resolve("handled"));
        up.once("error", () => resolve("handled"));
      });
      upstream.once("error", (error) => {
        this.counters.failures += 1;
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: `协议桥无法连接上游：${error.message}` } }));
        }
        resolve("handled");
      });
      upstream.end(raw);
    });
  }

  /** 透传：体与流都不改写（上游支持 responses 时走这里，行为与直连一致）。 */
  private forward(
    req: http.IncomingMessage, res: http.ServerResponse, target: BridgeTarget, rest: string, raw: Buffer,
  ) {
    const upstream = this.upstreamRequest(req, target, rest, raw);
    upstream.once("response", (up) => {
      this.counters.forwarded += 1;
      res.writeHead(up.statusCode ?? 502, this.responseHeaders(up.headers));
      up.pipe(res);
    });
    upstream.once("error", (error) => {
      this.counters.failures += 1;
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `协议桥无法连接上游：${error.message}` } }));
      } else res.end();
    });
    upstream.end(raw);
  }

  /** 转换路径：Responses 请求 → Chat 请求；Chat 响应/SSE → Responses 响应/SSE。 */
  private async convert(req: http.IncomingMessage, res: http.ServerResponse, target: BridgeTarget, rest: string, raw: Buffer) {
    let body: any;
    try { body = JSON.parse(raw.toString("utf8")); }
    catch { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "协议桥：请求体不是 JSON" } })); }
    this.counters.converted += 1;
    const chatBody = toChatRequest(body);
    const payload = Buffer.from(JSON.stringify(chatBody), "utf8");
    const upstream = this.upstreamRequest(req, target, rest.replace(/\/responses$/, "/chat/completions"), payload);

    upstream.once("response", (up) => {
      const status = up.statusCode ?? 502;
      const contentType = String(up.headers["content-type"] ?? "");
      if (status >= 400 || !/event-stream/.test(contentType)) {
        // 上游报错或给的是普通 JSON：整体缓冲后按需转换（错误体原样透传，让引擎看到上游原话）
        const parts: Buffer[] = [];
        up.on("data", (chunk) => parts.push(chunk as Buffer));
        up.once("end", () => {
          const text = Buffer.concat(parts).toString("utf8");
          if (status >= 400) {
            this.counters.failures += 1;
            res.writeHead(status, { "content-type": contentType || "application/json" });
            return res.end(text);
          }
          let json: any = null;
          try { json = JSON.parse(text); } catch { json = null; }
          if (!json) {
            res.writeHead(502, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: { message: `协议桥：上游返回无法解析的响应（${text.slice(0, 200)}）` } }));
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(chatJsonToResponses(json, body?.model ?? "")));
        });
        return;
      }

      // 流式：逐块把 Chat SSE 翻成 Responses SSE
      const translator = new ChatStreamTranslator(body?.model ?? "", { emitReasoning: this.emitReasoning });
      const parser = new SseParser();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(translator.begin());
      up.setEncoding("utf8");
      up.on("data", (chunk: string) => {
        for (const data of parser.push(chunk)) {
          if (data === "[DONE]") continue;
          let parsed: any = null;
          try { parsed = JSON.parse(data); } catch { continue; }
          const out = translator.push(parsed);
          if (out) res.write(out);
        }
      });
      up.once("end", () => { res.write(translator.finish()); res.end(); });
      up.once("error", (error) => {
        this.counters.failures += 1;
        this.log(`[bridge] ${target.label ?? ""} 上游流中断：${error.message}`);
        res.write(translator.finish());
        res.end();
      });
    });
    upstream.once("error", (error) => {
      this.counters.failures += 1;
      this.log(`[bridge] ${target.label ?? target.baseUrl} 上游连接失败：${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `协议桥无法连接上游：${error.message}` } }));
      } else { res.end(); }
    });
    upstream.end(payload);
  }

  /**
   * Anthropic 转换路径：Responses 请求 → Messages 请求；Messages 响应/SSE → Responses 响应/SSE。
   *
   * ⛔ 两处与 chat 路径不同的硬要求：
   *   ① **认证头**：引擎按 env_key 注入的是 `Authorization: Bearer <key>`，而 Anthropic 官方
   *      要 `x-api-key`。这里从 Bearer 里把 key 取出来**同时**放到 x-api-key（两种都带 ——
   *      官方与中转站各认一种，带两个不会冲突），并强制加 `anthropic-version`
   *      （缺它官方直接 400）。Authorization 本身保留在透传头里。
   *   ② **端点**：由 base 推出 `/v1/messages`（见 anthropicMessagesUrl），不是 `/chat/completions`。
   */
  private async convertAnthropic(req: http.IncomingMessage, res: http.ServerResponse, target: BridgeTarget, rest: string, raw: Buffer) {
    let body: any;
    try { body = JSON.parse(raw.toString("utf8")); }
    catch { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "协议桥：请求体不是 JSON" } })); }
    this.counters.converted += 1;
    const payload = Buffer.from(JSON.stringify(toAnthropicRequest(body)), "utf8");

    const authorization = String(req.headers.authorization ?? "");
    const apiKey = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    const extraHeaders: Record<string, string> = { "anthropic-version": ANTHROPIC_VERSION };
    if (apiKey) extraHeaders["x-api-key"] = apiKey;

    const upstream = this.upstreamRequest(req, target, rest, payload, {
      url: anthropicMessagesUrl(target.baseUrl),
      headers: extraHeaders,
    });

    upstream.once("response", (up) => {
      const status = up.statusCode ?? 502;
      const contentType = String(up.headers["content-type"] ?? "");
      if (status >= 400 || !/event-stream/.test(contentType)) {
        // 上游报错或给的是普通 JSON：整体缓冲后按需转换（错误体原样透传，让引擎看到上游原话）
        const parts: Buffer[] = [];
        up.on("data", (chunk) => parts.push(chunk as Buffer));
        up.once("end", () => {
          const text = Buffer.concat(parts).toString("utf8");
          if (status >= 400) {
            this.counters.failures += 1;
            res.writeHead(status, { "content-type": contentType || "application/json" });
            return res.end(text);
          }
          let json: any = null;
          try { json = JSON.parse(text); } catch { json = null; }
          if (!json) {
            res.writeHead(502, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: { message: `协议桥：上游返回无法解析的响应（${text.slice(0, 200)}）` } }));
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(anthropicJsonToResponses(json, body?.model ?? "")));
        });
        return;
      }

      const translator = new AnthropicStreamTranslator(body?.model ?? "", { emitReasoning: this.emitReasoning });
      const parser = new SseParser();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(translator.begin());
      up.setEncoding("utf8");
      up.on("data", (chunk: string) => {
        // Anthropic 的 SSE 负载**已经是事件对象本身**（带 type 字段），不像 Chat 那样是
        // 「OpenAI chunk 形状」—— 所以直接交给翻译器，不需要额外解包。
        for (const data of parser.push(chunk)) {
          let parsed: any = null;
          try { parsed = JSON.parse(data); } catch { continue; }
          const out = translator.push(parsed);
          if (out) res.write(out);
        }
      });
      up.once("end", () => { res.write(translator.finish()); res.end(); });
      up.once("error", (error) => {
        this.counters.failures += 1;
        this.log(`[bridge] ${target.label ?? ""} anthropic 上游流中断：${error.message}`);
        res.write(translator.finish());
        res.end();
      });
    });
    upstream.once("error", (error) => {
      this.counters.failures += 1;
      this.log(`[bridge] ${target.label ?? target.baseUrl} anthropic 上游连接失败：${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `协议桥无法连接上游：${error.message}` } }));
      } else { res.end(); }
    });
    upstream.end(payload);
  }

  /** 组装并发出上游请求（协议由上游 URL 决定；头以引擎发来的为准，凭据原样透传）。
   *  `overrides` 供 anthropic 路径改端点与补认证头（见 convertAnthropic）。 */
  private upstreamRequest(
    req: http.IncomingMessage, target: BridgeTarget, rest: string, payload: Buffer,
    overrides?: { url?: string; headers?: Record<string, string> },
  ) {
    const base = target.baseUrl.replace(/\/+$/, "");
    const url = overrides?.url
      ? new URL(overrides.url)
      : new URL(base + (rest.startsWith("/") ? rest : `/${rest}`));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }
    headers["content-type"] = "application/json";
    headers["content-length"] = String(payload.length);
    // 协议特有的头（如 anthropic-version / x-api-key）在透传头之后覆盖
    if (overrides?.headers) Object.assign(headers, overrides.headers);
    const transport = url.protocol === "https:" ? https : http;
    return transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search, method: req.method ?? "POST", headers,
    });
  }

  private responseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value)) out[key] = value.join(", ");
    }
    return out;
  }
}
