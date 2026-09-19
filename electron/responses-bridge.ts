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

export type BridgeMode = "auto" | "responses" | "chat" | "anthropic";
export type BridgeTarget = { baseUrl: string; mode: BridgeMode; label?: string };

/** Anthropic Messages 的 max_tokens 上限保护。
 *  ⛔ Anthropic **要求 max_tokens 必填**，且不得超过模型上限（超了直接 400，不是截断）。
 *  而引擎给的 `max_output_tokens` 是「模型上下文级」的大值（本项目实测见过 393216），
 *  原样透传必被拒 —— 这里压到 Claude 系列通行的输出上限，保证「能跑」优先于「跑满」。 */
const ANTHROPIC_MAX_TOKENS_CAP = 64000;
/** Anthropic 官方要求的版本头（不带会被拒；中转站普遍也认这个值）。 */
const ANTHROPIC_VERSION = "2023-06-01";

/** 由供应商 Base URL 推出 Anthropic Messages 端点。
 *  ⛔ base 可能带 `/v1`（如 `https://api.anthropic.com/v1`）也可能不带
 *  （本项目 PPToken 的 Claude 线路就是 `https://api.pptoken.cc`）—— 两种都要落到
 *  `…/v1/messages`，所以先剥掉尾部的 `/v1` 再统一拼，避免出现 `/v1/v1/messages`。 */
export function anthropicMessagesUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  const prefix = base.endsWith("/v1") ? base.slice(0, -3) : base;
  return `${prefix}/v1/messages`;
}

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
  // chat 上游一般只认标准档：xhigh/ultra（UI 的「极高/最高」）压到 high，其余原样
  if (effort) chat.reasoning_effort = effort === "xhigh" || effort === "ultra" ? "high" : effort;
  if (body?.max_output_tokens) chat.max_tokens = body.max_output_tokens;
  if (body?.temperature !== undefined) chat.temperature = body.temperature;
  if (body?.top_p !== undefined) chat.top_p = body.top_p;
  // usage 在 Chat 流里默认不返回（引擎的 token 统计要靠它）
  if (chat.stream) chat.stream_options = { include_usage: true };
  return chat;
}

/**
 * 把 Responses 请求体转成 **Anthropic Messages** 请求体（纯函数，可离线断言）。
 *
 * 与 Chat 的三处结构性差异（照文档猜会全错，这里是协议硬要求）：
 *   ① `system` 是**顶层字段**，不在 messages 里；
 *   ② messages 的 role 只能 user/assistant，且必须**交替**出现 —— 连续的同类消息
 *      会被上游 400 拒掉，所以这里主动**合并**（Responses 的 input 里连续两个 user、
 *      或一次并行工具调用产生的多条 function_call_output，都是常态）；
 *   ③ 工具调用不是「消息上的 tool_calls 字段」，而是**内容块**：
 *      调用侧是 assistant 消息里的 `tool_use` 块，结果侧是 user 消息里的 `tool_result` 块，
 *      两者靠 `tool_use_id` 配对 —— 配错或漏配，上游会报「tool_use 没有对应的 tool_result」。
 *      注意 `tool_use.id` 与 `tool_result.tool_use_id` 必须是**引擎给的 call_id**，
 *      不能自己生成，否则下一轮把结果送回去时对不上。
 */
export function toAnthropicRequest(body: any): any {
  const messages: any[] = [];
  /** input 里的 system/developer 消息内容 —— 必须收集起来提到顶层 system，
   *  ⛔ 不能只是 continue 跳过：那会把内容**静默丢掉**（Anthropic 没有 system 角色，
   *    而引擎会在 input 里塞 developer 项，丢一条就等于丢了上下文规则）。 */
  const systemChunks: string[] = [];
  const pushBlocks = (role: "user" | "assistant", blocks: any[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    // 见上 ②：连续同角色合并成一条（Anthropic 要求严格交替）
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };

  const parts = Array.isArray(body?.input)
    ? body.input
    : typeof body?.input === "string"
      ? [{ type: "message", role: "user", content: [{ type: "input_text", text: body.input }] }]
      : [];
  for (const item of parts) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") continue; // 与 chat 同理：推理项无对应结构，回传只会污染上下文
    if (item.type === "function_call") {
      // 调用侧 → assistant 的 tool_use 块（id 必须沿用引擎的 call_id，见上 ③）
      pushBlocks("assistant", [{
        type: "tool_use",
        id: item.call_id ?? item.id ?? `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        name: item.name ?? "",
        input: (() => {
          if (typeof item.arguments !== "string") return item.arguments ?? {};
          try { return JSON.parse(item.arguments); } catch { return {}; }   // 非法 JSON 不能让整轮失败
        })(),
      }]);
      continue;
    }
    if (item.type === "function_call_output") {
      // 结果侧 → user 的 tool_result 块
      pushBlocks("user", [{
        type: "tool_result",
        tool_use_id: item.call_id ?? item.id ?? "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      }]);
      continue;
    }
    if (item.type === "message" || item.role) {
      // developer 是 Responses 独有角色：Anthropic 只认 user/assistant，降级成 user 会改变语义，
      // 这里与 chat 路径保持一致地并入 system（语义最接近「系统级指令」）。
      const sourceRole = item.role ?? "user";
      const content = Array.isArray(item.content) ? item.content : [];
      const blocks: any[] = [];
      for (const piece of content) {
        if (!piece || typeof piece !== "object") continue;
        if (piece.type === "input_image" || piece.type === "image_url") {
          const url = piece.image_url?.url ?? piece.image_url ?? piece.url;
          // ⛔ Anthropic 只接受 base64 或 file_id，**不接受 URL**。data: URL 可直接拆出来；
          //    http(s) 链接在不下载的前提下无法转换 → 跳过（不抛错，避免整轮请求失败）。
          const dataUrl = typeof url === "string" ? /^data:([^;]+);base64,(.+)$/s.exec(url) : null;
          if (dataUrl) blocks.push({ type: "image", source: { type: "base64", media_type: dataUrl[1], data: dataUrl[2] } });
        } else if (typeof piece.text === "string" && piece.text) {
          blocks.push({ type: "text", text: piece.text });
        }
      }
      if (!blocks.length && typeof item.content === "string" && item.content) blocks.push({ type: "text", text: item.content });
      // Anthropic 没有 system 角色：系统级内容**收集到顶层 system**（不是丢弃，见 systemChunks 注释）
      if (sourceRole === "system" || sourceRole === "developer") {
        for (const block of blocks) if (block.type === "text" && block.text) systemChunks.push(block.text);
        continue;
      }
      pushBlocks(sourceRole === "assistant" ? "assistant" : "user", blocks);
      continue;
    }
  }

  const tools = (Array.isArray(body?.tools) ? body.tools : [])
    .filter((tool: any) => tool && (tool.type === "function" || (tool.name && !tool.type)))
    .map((tool: any) => ({
      name: tool.name,
      description: tool.description ?? "",
      // ⛔ Anthropic 用 `input_schema`（不是 Chat 的 `function.parameters`，也不是 Responses 的 `parameters`）
      input_schema: tool.parameters ?? { type: "object", properties: {} },
    }));

  const wanted = typeof body?.max_output_tokens === "number" && body.max_output_tokens > 0
    ? Math.min(body.max_output_tokens, ANTHROPIC_MAX_TOKENS_CAP)
    : 8192;

  const out: any = {
    model: body?.model,
    // ⛔ max_tokens 是**必填**项（缺了直接 400），且必须 ≤ 模型上限
    max_tokens: Math.max(1, Math.round(wanted)),
    messages,
    stream: body?.stream !== false,
  };
  // system 顶层：instructions 在前，input 里的 system/developer 消息按原顺序附后
  const systemText = [
    typeof body?.instructions === "string" ? body.instructions.trim() : "",
    ...systemChunks,
  ].filter(Boolean).join("\n\n");
  if (systemText) out.system = systemText;
  if (tools.length) {
    out.tools = tools;
    if (body?.tool_choice?.type === "function" && body.tool_choice.name) out.tool_choice = { type: "tool", name: body.tool_choice.name };
    else if (body?.tool_choice === "required") out.tool_choice = { type: "any" };
    // ⛔ Anthropic 没有「禁止调用工具」的取值：tool_choice="none" 只能靠**不下发 tools**表达，
    //    但那会同时丢失工具定义（下一轮模型就不知道有哪些工具了）。所以 none 时保持默认（auto）
    //    —— 宁可让模型偶尔调用工具，也不要让它「失忆」。
  }
  // 思考（extended thinking）默认**不开**：开启后 Anthropic 禁止同时传 temperature/top_p，
  // 且要求 max_tokens > budget_tokens，还会让部分中转站直接 400。模型若自发返回 thinking 块，
  // 桥仍会把它转成 reasoning 事件展示（见 AnthropicStreamTranslator）。
  if (body?.temperature !== undefined) out.temperature = body.temperature;
  if (body?.top_p !== undefined) out.top_p = body.top_p;
  return out;
}

type OutputItem = { index: number; item: any; text?: string; args?: string };

/** 一行 SSE（event + data）。chat 流与 anthropic 流共用同一输出契约。 */
function sseLine(event: any): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 收尾：把未完结的 item 标成 completed，逐个发 output_item.done，最后发 response.completed。
 *  ⛔ chat 流与 anthropic 流**共用**这一段：两条流的差异只在「怎么解析上游增量」，
 *    收尾契约必须逐字一致 —— 否则同样的模型输出会因为走了不同协议而表现不同。 */
function finalizeItems(items: OutputItem[], responseId: string, model: string, usage: any): string {
  let out = "";
  for (const entry of items) {
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
    out += sseLine({ type: "response.output_item.done", output_index: entry.index, item: entry.item });
  }
  out += sseLine({
    type: "response.completed",
    response: { id: responseId, object: "response", status: "completed", model, output: items.map((entry) => entry.item), usage },
  });
  return out;
}

/** 新建一个文本类输出项的骨架（message / reasoning 共用）。 */
function newItem(kind: "message" | "reasoning", index: number): OutputItem {
  if (kind === "message") {
    return { index, item: { id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "message", role: "assistant", status: "in_progress", content: [] }, text: "" };
  }
  return { index, item: { id: `rs_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "reasoning", status: "in_progress", summary: [] }, text: "" };
}

/** 新建一个工具调用输出项。 */
function newToolItem(index: number, callId: string, name: string): OutputItem {
  return {
    index,
    item: { id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "function_call", status: "in_progress", name, arguments: "", call_id: callId },
    args: "",
  };
}

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
    return sseLine(event);
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
        const item = newItem("reasoning", this.nextIndex());
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
        const item = newItem("message", this.nextIndex());
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
        entry = newToolItem(this.nextIndex(), call.id ?? `call_${randomUUID().slice(0, 8)}`, call.function?.name ?? "");
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

  /** 流结束：补齐 done / completed 事件（收尾逻辑与 anthropic 流共用 finalizeItems）。 */
  finish(): string {
    let out = this.begin();
    if (this.failed) {
      // 没有实证过 response.failed 的解析宽容度 → 只把已产出的 item 收尾，
      // 让引擎按「流意外结束」处理（它自带 stream_max_retries 重试）
      this.failed = null;
      return out;
    }
    const usage = {
      input_tokens: this.usage?.prompt_tokens ?? 0,
      output_tokens: this.usage?.completion_tokens ?? 0,
      total_tokens: this.usage?.total_tokens ?? 0,
    };
    return out + finalizeItems(this.items, this.responseId, this.model, usage);
  }

  /** 是否有实际产出（用于判断「上游返回空流」这种异常） */
  get produced(): boolean { return this.items.length > 0; }
}

/**
 * **Anthropic Messages** SSE 流 → Responses SSE 事件（有状态翻译器）。
 *
 * Anthropic 的事件体系与 Chat 完全不同，逐条映射如下（照文档猜必错，这是协议实际形状）：
 *   · `message_start`            → 拿到响应 id / model / 输入 token 数
 *   · `content_block_start`      → 新建输出项：text→message、tool_use→function_call、thinking→reasoning
 *   · `content_block_delta`      → 增量：text_delta / input_json_delta / thinking_delta
 *   · `content_block_stop`       → 该块结束（无需发事件，收尾在 finish 统一做）
 *   · `message_delta`            → 输出 token 数 + stop_reason
 *   · `message_stop`             → 流结束
 *   · `ping` / 未知事件           → 忽略（转发未知事件会让引擎解析报错）
 *
 * ⛔ 与 Chat 的**关键差异**：工具调用不是「分片下发的 tool_calls」，而是**独立的 content block**，
 *    且它的参数是 `input_json_delta.partial_json` 拼出来的 JSON **字符串片段**（不是对象）。
 *    拼完才能解析 —— 所以 arguments 必须按字符串累加，不能边收边 JSON.parse。
 */
export class AnthropicStreamTranslator {
  private responseId = `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  private items: OutputItem[] = [];
  /** content_block 的 index → 输出项（Anthropic 用 index 定位块，不是 id） */
  private blocks = new Map<number, OutputItem>();
  private created = false;
  private usage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 };
  private model: string;
  private failed: string | null = null;
  private emitReasoning: boolean;

  constructor(model: string, options: { emitReasoning?: boolean } = {}) {
    this.model = model;
    // ⛔ 与 chat 流**默认值相反**：Anthropic 的 thinking 块可能非常长，且引擎对
    //    reasoning 事件是容忍的（能拿到就展示）。chat 路径默认关是因为部分网关把
    //    reasoning 混在正文里，Anthropic 是**独立的块类型**，不会污染正文。
    this.emitReasoning = options.emitReasoning !== false;
  }

  private nextIndex(): number {
    let index = 0;
    for (const item of this.items) index = Math.max(index, item.index + 1);
    return index;
  }

  begin(): string {
    if (this.created) return "";
    this.created = true;
    return sseLine({
      type: "response.created",
      response: { id: this.responseId, object: "response", status: "in_progress", model: this.model, output: [] },
    });
  }

  push(event: any): string {
    let out = this.begin();
    if (!event || typeof event !== "object") return out;
    if (event.type === "error") {
      this.failed = String(event.error?.message ?? JSON.stringify(event.error ?? {}));
      return out;
    }
    if (event.type === "message_start") {
      const message = event.message ?? {};
      if (typeof message.model === "string" && message.model) this.model = message.model;
      if (message.usage) {
        this.usage.input_tokens = Number(message.usage.input_tokens ?? 0) || 0;
        if (message.usage.output_tokens) this.usage.output_tokens = Number(message.usage.output_tokens) || 0;
      }
      return out;
    }
    if (event.type === "content_block_start") {
      const block = event.content_block ?? {};
      const index = Number(event.index ?? 0);
      let item: OutputItem | null = null;
      if (block.type === "text") item = newItem("message", this.nextIndex());
      else if (block.type === "thinking" || block.type === "redacted_thinking") {
        if (!this.emitReasoning) return out;
        item = newItem("reasoning", this.nextIndex());
      } else if (block.type === "tool_use") {
        item = newToolItem(this.nextIndex(), String(block.id ?? `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`), String(block.name ?? ""));
      }
      if (!item) return out;   // server_tool_use / 未知块类型：不转发
      this.blocks.set(index, item);
      this.items.push(item);
      out += sseLine({ type: "response.output_item.added", output_index: item.index, item: item.item });
      // 少数实现会把完整 input 直接放在 start 里（规范上应是空对象 + 后续 delta）：
      // 这里补发一次完整 delta，避免参数整段丢失
      const initial = block.type === "tool_use" ? block.input : null;
      if (initial && typeof initial === "object" && Object.keys(initial).length) {
        const piece = JSON.stringify(initial);
        item.args = piece;
        out += sseLine({
          type: "response.function_call_arguments.delta", item_id: item.item.id,
          output_index: item.index, delta: piece,
        });
      }
      return out;
    }
    if (event.type === "content_block_delta") {
      const item = this.blocks.get(Number(event.index ?? 0));
      if (!item) return out;
      const delta = event.delta ?? {};
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        item.text = (item.text ?? "") + delta.text;
        out += sseLine({
          type: "response.output_text.delta", item_id: item.item.id,
          output_index: item.index, content_index: 0, delta: delta.text,
        });
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && delta.partial_json) {
        // ⛔ 字符串累加（见类注释）：片段拼起来才是完整 JSON
        item.args = (item.args ?? "") + delta.partial_json;
        out += sseLine({
          type: "response.function_call_arguments.delta", item_id: item.item.id,
          output_index: item.index, delta: delta.partial_json,
        });
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
        item.text = (item.text ?? "") + delta.thinking;
        out += sseLine({
          type: "response.reasoning_summary_text.delta", item_id: item.item.id,
          output_index: item.index, summary_index: 0, delta: delta.thinking,
        });
      }
      return out;
    }
    if (event.type === "message_delta") {
      if (event.usage) {
        if (event.usage.output_tokens !== undefined) this.usage.output_tokens = Number(event.usage.output_tokens) || 0;
        if (event.usage.input_tokens !== undefined) this.usage.input_tokens = Number(event.usage.input_tokens) || 0;
      }
      return out;
    }
    // content_block_stop / message_stop / ping / 其余：无需产出事件
    return out;
  }

  finish(): string {
    let out = this.begin();
    if (this.failed) {
      // 与 chat 路径同策略：不发 completed，让引擎按「流意外结束」处理（它会重试）
      this.failed = null;
      return out;
    }
    const usage = {
      input_tokens: this.usage.input_tokens,
      output_tokens: this.usage.output_tokens,
      total_tokens: this.usage.input_tokens + this.usage.output_tokens,
    };
    return out + finalizeItems(this.items, this.responseId, this.model, usage);
  }

  get produced(): boolean { return this.items.length > 0; }
}

/** 非流式 Anthropic Messages 响应 → responses 响应对象 */
export function anthropicJsonToResponses(json: any, model: string): any {
  const output: any[] = [];
  for (const block of Array.isArray(json?.content) ? json.content : []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      output.push({
        id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "message", role: "assistant",
        status: "completed", content: [{ type: "output_text", text: block.text, annotations: [] }],
      });
    } else if (block.type === "tool_use") {
      output.push({
        id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "function_call", status: "completed",
        name: block.name ?? "", arguments: JSON.stringify(block.input ?? {}),
        call_id: block.id ?? `call_${randomUUID().slice(0, 8)}`,
      });
    }
  }
  const input = Number(json?.usage?.input_tokens ?? 0) || 0;
  const outTokens = Number(json?.usage?.output_tokens ?? 0) || 0;
  return {
    id: json?.id ?? `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "response", status: "completed", model: json?.model ?? model, output,
    usage: { input_tokens: input, output_tokens: outTokens, total_tokens: input + outTokens },
  };
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
