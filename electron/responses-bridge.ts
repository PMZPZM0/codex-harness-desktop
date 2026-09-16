/**
 * Responses ↔ Chat Completions 本地协议桥（09-16）。
 *
 * 背景：Codex 引擎（0.153.x 实测）**只会发 Responses 协议**（POST /v1/responses），
 * 而不少第三方网关（火山方舟 coding 网关、Kimi Coding 之类的 Chat Completions 通道）
 * 只提供 /v1/chat/completions。这类网关在旧形态下「连接测试通过但对话用不了」——
 * 引擎发 /responses 上游 404，请求必然失败。
 *
 * 本桥把这条断链接上：引擎照常按 Responses 调用它，它按上游**实际能力**转发——
 *   · 上游支持 responses → 原样透传（零转换、零额外开销，行为与直连一致）；
 *   · 上游只支持 chat  → 把 Responses 请求体转成 Chat 请求，再把 Chat 的 SSE 流
 *                        转回 Responses 事件流（文本 / 工具调用 / usage）。
 *
 * 关键契约全部来自**真实引擎实证**（scripts/probe-responses-contract.cjs，独立 CODEX_HOME
 * + 真实 app-server 录制），不是照文档猜的：
 *   · 引擎请求 `POST <base_url>/responses`，头 `authorization: Bearer <key>`、
 *     `accept: text/event-stream`；请求体 keys：model / instructions / input / tools /
 *     tool_choice / parallel_tool_calls / reasoning / store / stream / include /
 *     prompt_cache_key / client_metadata。
 *   · input 元素：{type:"message",role,content:[{type:"input_text"|"output_text",text}]}、
 *     {type:"function_call",name,arguments,call_id}、{type:"function_call_output",call_id,output}。
 *   · tools 是**扁平**形状 {type:"function",name,description,parameters}（Chat 需要嵌到
 *     function 里），chat 独有工具（如 web_search）必须剔除。
 *   · 引擎消费的事件集（实测可跑通的最小集，只发这些，避免未知事件引发解析错误）：
 *     response.created / response.output_item.added / response.output_text.delta /
 *     response.function_call_arguments.delta / response.output_item.done / response.completed。
 *     实证：只发这一组（含 function_call 形状），引擎即执行了工具并在下一轮请求里回传了
 *     function_call_output —— 工具往返闭环成立。
 *
 * 凭据：引擎按 env_key 注入 `Authorization: Bearer <key>`，桥**原样透传**给上游，
 * 自己不留存任何密钥 —— 所以换电脑只需重填一次 Key，桥的行为与设备无关。
 */
import * as http from "node:http";
import * as https from "node:https";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

export type BridgeMode = "auto" | "responses" | "chat";
export type BridgeTarget = { baseUrl: string; mode: BridgeMode; label?: string };

const HOP_BY_HOP = new Set([
  "host", "connection", "content-length", "keep-alive", "transfer-encoding",
  "upgrade", "proxy-connection", "te", "trailer",
  // 转换模式下要按行解析 SSE，不能拿到压缩流；统一去掉，让上游给明文
  "accept-encoding",
]);

/** 把 Responses 请求体转成 Chat Completions 请求体（纯函数，可离线断言）。 */
export function toChatRequest(body: any): any {
  const messages: any[] = [];
  if (typeof body?.instructions === "string" && body.instructions.trim()) {
    // Responses 的 instructions 等价于 Chat 的 system 消息
    messages.push({ role: "system", content: body.instructions });
  }
  const parts = Array.isArray(body?.input)
    ? body.input
    : typeof body?.input === "string"
      ? [{ type: "message", role: "user", content: [{ type: "input_text", text: body.input }] }]
      : [];
  for (const item of parts) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") continue; // 推理项对 chat 无对应结构，回传只会污染上下文
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id ?? item.id ?? `call_${randomUUID().slice(0, 8)}`,
          type: "function",
          function: { name: item.name ?? "", arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}) },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? item.id ?? "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
      continue;
    }
    if (item.type === "message" || item.role) {
      // developer 是 Responses 独有角色：一律降级成 system，多数学网关只认 system/user/assistant
      const role = item.role === "developer" ? "system" : (item.role ?? "user");
      const content = Array.isArray(item.content) ? item.content : [];
      const pieces: any[] = [];
      for (const piece of content) {
        if (!piece || typeof piece !== "object") continue;
        if (piece.type === "input_image" || piece.type === "image_url") {
          const url = piece.image_url?.url ?? piece.image_url ?? piece.url;
          if (url) pieces.push({ type: "image_url", image_url: { url } });
        } else if (typeof piece.text === "string") {
          pieces.push({ type: "text", text: piece.text });
        }
      }
      if (!pieces.length && typeof item.content === "string") pieces.push({ type: "text", text: item.content });
      // 纯文本时用字符串形态（兼容性最好）；含图时用数组形态
      const onlyText = pieces.length > 0 && pieces.every((p) => p.type === "text");
      messages.push({ role, content: onlyText ? pieces.map((p) => p.text).join("\n") : pieces });
      continue;
    }
  }

  const tools = (Array.isArray(body?.tools) ? body.tools : [])
    .filter((tool: any) => tool && (tool.type === "function" || (tool.name && !tool.type)))
    .map((tool: any) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters ?? { type: "object", properties: {} },
        ...(tool.strict === undefined ? {} : { strict: tool.strict }),
      },
    }));

  const chat: any = {
    model: body?.model,
    messages,
    stream: body?.stream !== false,
  };
  if (tools.length) {
    chat.tools = tools;
    if (typeof body.tool_choice === "string") chat.tool_choice = body.tool_choice;
    else if (body?.tool_choice?.type === "function" && body.tool_choice.name) {
      chat.tool_choice = { type: "function", function: { name: body.tool_choice.name } };
    }
    if (body?.parallel_tool_calls !== undefined) chat.parallel_tool_calls = body.parallel_tool_calls;
  }
  // xhigh 是 Codex 特有档位，Chat 网关普遍只认 minimal/low/medium/high —— 降一档比 400 好
  const effort = body?.reasoning?.effort;
  if (effort) chat.reasoning_effort = effort === "xhigh" ? "high" : effort;
  if (body?.max_output_tokens) chat.max_tokens = body.max_output_tokens;
  if (body?.temperature !== undefined) chat.temperature = body.temperature;
  if (body?.top_p !== undefined) chat.top_p = body.top_p;
  // usage 在 Chat 流里默认不返回（引擎的 token 统计要靠它）
  if (chat.stream) chat.stream_options = { include_usage: true };
  return chat;
}

type OutputItem = { index: number; item: any; text?: string; args?: string };

/** Chat SSE 流 → Responses SSE 事件（有状态翻译器；每个 delta 返回要写出的字节）。 */
export class ChatStreamTranslator {
  private responseId = `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  private items: OutputItem[] = [];
  private textItem: OutputItem | null = null;
  private reasonItem: OutputItem | null = null;
  private toolItems = new Map<string, OutputItem>();
  private created = false;
  private usage: any = null;
  private model: string;
  private failed: string | null = null;
  private emitReasoning: boolean;

  constructor(model: string, options: { emitReasoning?: boolean } = {}) {
    this.model = model;
    this.emitReasoning = options.emitReasoning === true;
  }

  private sse(event: any): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  private nextIndex(): number {
    let index = 0;
    for (const item of this.items) index = Math.max(index, item.index + 1);
    return index;
  }

  /** 响应建立：引擎拿到 response.created 才会认后续增量 */
  begin(): string {
    if (this.created) return "";
    this.created = true;
    return this.sse({
      type: "response.created",
      response: { id: this.responseId, object: "response", status: "in_progress", model: this.model, output: [] },
    });
  }

  /** 处理一条 chat chunk（choices[0].delta / usage） */
  push(chunk: any): string {
    let out = this.begin();
    if (!chunk || typeof chunk !== "object") return out;
    if (chunk.usage) this.usage = chunk.usage;
    if (chunk.error) { this.failed = typeof chunk.error === "string" ? chunk.error : JSON.stringify(chunk.error); return out; }

    const choice = chunk.choices?.[0];
    if (!choice) return out;
    const delta = choice.delta ?? {};

    // 推理增量（火山方舟 chat 网关给 reasoning_content，部分网关给 reasoning）
    const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content
      : typeof delta.reasoning === "string" ? delta.reasoning : "";
    if (this.emitReasoning && reasoning) {
      if (!this.reasonItem) {
        const item = { index: this.nextIndex(), item: { id: `rs_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          type: "reasoning", status: "in_progress", summary: [] }, text: "" };
        this.reasonItem = item;
        this.items.push(item);
        out += this.sse({ type: "response.output_item.added", output_index: item.index, item: item.item });
      }
      this.reasonItem.text += reasoning;
      out += this.sse({
        type: "response.reasoning_summary_text.delta", item_id: this.reasonItem.item.id,
        output_index: this.reasonItem.index, summary_index: 0, delta: reasoning,
      });
    }

    // 文本增量
    if (typeof delta.content === "string" && delta.content.length) {
      if (!this.textItem) {
        const item = { index: this.nextIndex(), item: { id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          type: "message", role: "assistant", status: "in_progress", content: [] }, text: "" };
        this.textItem = item;
        this.items.push(item);
        out += this.sse({ type: "response.output_item.added", output_index: item.index, item: item.item });
      }
      this.textItem.text += delta.content;
      out += this.sse({
        type: "response.output_text.delta", item_id: this.textItem.item.id,
        output_index: this.textItem.index, content_index: 0, delta: delta.content,
      });
    }

    // 工具调用增量（chat 的 tool_calls 是分片下发的）
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const key = String(call.index ?? 0);
      let entry = this.toolItems.get(key);
      if (!entry) {
        entry = { index: this.nextIndex(), item: {
          id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "function_call",
          status: "in_progress", name: call.function?.name ?? "", arguments: "",
          call_id: call.id ?? `call_${randomUUID().slice(0, 8)}`,
        }, args: "" };
        this.toolItems.set(key, entry);
        this.items.push(entry);
        out += this.sse({ type: "response.output_item.added", output_index: entry.index, item: entry.item });
      }
      // 部分网关把 id/name 拆在后续分片里补发
      if (call.id && !entry.item.call_id) entry.item.call_id = call.id;
      if (call.function?.name) entry.item.name = call.function.name;
      const piece = call.function?.arguments;
      if (typeof piece === "string" && piece.length) {
        entry.args = (entry.args ?? "") + piece;
        out += this.sse({
          type: "response.function_call_arguments.delta", item_id: entry.item.id,
          output_index: entry.index, delta: piece,
        });
      }
    }
    return out;
  }

  /** 流结束：补齐 done / completed 事件 */
  finish(): string {
    let out = this.begin();
    if (this.failed) {
      // 没有实证过 response.failed 的解析宽容度 → 只把已产出的 item 收尾，
      // 让引擎按「流意外结束」处理（它自带 stream_max_retries 重试）
      this.failed = null;
      return out;
    }
    for (const entry of this.items) {
      if (entry.item.type === "message") {
        if (entry.item.status === "in_progress") {
          entry.item.status = "completed";
          entry.item.content = [{ type: "output_text", text: entry.text ?? "", annotations: [] }];
        }
      } else if (entry.item.type === "reasoning") {
        if (entry.item.status === "in_progress") {
          entry.item.status = "completed";
          entry.item.summary = [{ type: "summary_text", text: entry.text ?? "" }];
        }
      } else if (entry.item.type === "function_call") {
        if (entry.item.status === "in_progress") {
          entry.item.status = "completed";
          entry.item.arguments = entry.args ?? "";
        }
      }
      out += this.sse({
        type: "response.output_item.done",
        output_index: entry.index,
        item: entry.item,
      });
    }
    const usage = {
      input_tokens: this.usage?.prompt_tokens ?? 0,
      output_tokens: this.usage?.completion_tokens ?? 0,
      total_tokens: this.usage?.total_tokens ?? 0,
    };
    out += this.sse({
      type: "response.completed",
      response: {
        id: this.responseId, object: "response", status: "completed", model: this.model,
        output: this.items.map((entry) => entry.item), usage,
      },
    });
    return out;
  }

  /** 是否有实际产出（用于判断「上游返回空流」这种异常） */
  get produced(): boolean { return this.items.length > 0; }
}

/** 非流式 chat 响应 → responses 响应对象 */
export function chatJsonToResponses(json: any, model: string): any {
  const message = json?.choices?.[0]?.message ?? {};
  const output: any[] = [];
  if (typeof message.content === "string" && message.content.length) {
    output.push({ id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "message", role: "assistant",
      status: "completed", content: [{ type: "output_text", text: message.content, annotations: [] }] });
  }
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    output.push({ id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "function_call",
      status: "completed", name: call.function?.name ?? "", arguments: call.function?.arguments ?? "",
      call_id: call.id ?? `call_${randomUUID().slice(0, 8)}` });
  }
  return {
    id: json?.id ?? `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "response", status: "completed", model: json?.model ?? model, output,
    usage: {
      input_tokens: json?.usage?.prompt_tokens ?? 0,
      output_tokens: json?.usage?.completion_tokens ?? 0,
      total_tokens: json?.usage?.total_tokens ?? 0,
    },
  };
}

/** 解析 SSE 文本块（返回若干 data 负载字符串）。跨 chunk 的半条消息留在 buffer 里。 */
export class SseParser {
  private buffer = "";
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    let cut: number;
    while ((cut = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (data) out.push(data);
    }
    return out;
  }
}

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

  /** 登记路由目标：`/p/<id>/…` → 该 id 的上游。每次下发配置前调用，保证目标最新。 */
  register(id: string, target: BridgeTarget) {
    this.targets.set(id, target);
  }

  /** 该 id 当前是否已有确定的上游协议（供状态展示） */
  modeOf(id: string): "responses" | "chat" | "unknown" {
    return this.resolved.get(id) ?? "unknown";
  }

  /** 已解析出的协议快照（供设置页展示「这个网关实际走的是什么」） */
  modesSnapshot(): Record<string, "responses" | "chat"> {
    return Object.fromEntries(this.resolved.entries());
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
        if (status === 404 || status === 405 || status === 501) {
          up.resume(); // 丢弃响应体，避免连接悬挂
          return resolve("unsupported");
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

  /** 组装并发出上游请求（协议由上游 URL 决定；头以引擎发来的为准，凭据原样透传）。 */
  private upstreamRequest(
    req: http.IncomingMessage, target: BridgeTarget, rest: string, payload: Buffer,
  ) {
    const base = target.baseUrl.replace(/\/+$/, "");
    const url = new URL(base + (rest.startsWith("/") ? rest : `/${rest}`));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }
    headers["content-type"] = "application/json";
    headers["content-length"] = String(payload.length);
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
