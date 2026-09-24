/**
 * responses-bridge 的「chat-convert」部分（09-22 从同目录 responses-bridge.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { randomUUID } from "node:crypto";
import { sseLine, finalizeItems, newItem, newToolItem } from "./01-sse-items";
import type { OutputItem } from "./01-sse-items";
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
