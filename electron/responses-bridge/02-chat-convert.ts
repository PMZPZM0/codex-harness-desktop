/**
 * responses-bridge 的「chat-convert」部分（09-22 从同目录 responses-bridge.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { randomUUID } from "node:crypto";
import { sseLine, finalizeItems, newItem, newToolItem } from "./01-sse-items";
import type { OutputItem } from "./01-sse-items";

/** 最近一次请求的配对修复统计（10-17）：供桥日志打印"这次修掉了多少条不成对"，
 *  ⛔ 只用于诊断，不进入请求体。 */
/** 缓存/推理字段的透传（10-17）：上游 chat usage 里这些字段的**三种方言**——
 *  OpenAI 兼容 `prompt_tokens_details.cached_tokens`、DeepSeek `prompt_cache_hit_tokens`、
 *  Anthropic `cache_read_input_tokens`。Responses 侧统一映射进 `input_tokens_details.cached_tokens`；
 *  ⛔ 上一版只写 input/output/total ⇒ 命中信息整块丢失，界面「缓存输入 0 / 命中率 0%」恒成立。 */
function usageDetailsOf(u: any) {
  const det = u?.prompt_tokens_details ?? u?.promptTokensDetails ?? {};
  const cached = Number(det?.cached_tokens ?? det?.cachedTokens ?? u?.prompt_cache_hit_tokens ?? u?.cache_read_input_tokens ?? 0) || 0;
  const reasoning = Number((u?.completion_tokens_details ?? u?.completionTokensDetails ?? {})?.reasoning_tokens ?? 0) || 0;
  return {
    ...(cached > 0 ? { input_tokens_details: { cached_tokens: cached } } : {}),
    ...(reasoning > 0 ? { output_tokens_details: { reasoning_tokens: reasoning } } : {}),
  };
}
export let lastRepair = { droppedCalls: 0, droppedResults: 0 };
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
  /* ⛔⛔ 并行工具调用必须合并：引擎会连续给多个 function_call（call A、call B…），
     而 Chat 协议要求**同一条 assistant 的多个 tool_calls 的结果紧跟在它之后**。
     拆成 assistant[A] assistant[B] tool[A] tool[B] 会被严格网关判为
     "tool calls and tool results do not match"（code 11148 —— 10-17 实测，整个请求被拒）。 */
  let openToolMsg: any = null;

  for (const item of parts) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") continue; // 推理项对 chat 无对应结构，回传只会污染上下文
    if (item.type === "function_call") {
      const call = {
        id: item.call_id ?? item.id ?? `call_${randomUUID().slice(0, 8)}`,
        type: "function",
        function: { name: item.name ?? "", arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}) },
      };
      if (openToolMsg) {
        openToolMsg.tool_calls.push(call);   // 连续调用 ⇒ 并进同一轮 assistant
      } else {
        openToolMsg = { role: "assistant", content: null, tool_calls: [call] };
        messages.push(openToolMsg);
      }
      continue;
    }
    if (item.type === "function_call_output") {
      openToolMsg = null;   // 结果开始 ⇒ 不再往上一条 assistant 追加
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? item.id ?? "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
      continue;
    }
    openToolMsg = null;
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

  /* ⛔ 发送前兜底修复工具配对（见 repairToolPairing 注释）——放在最末尾，所有分支都已落进 messages。 */
  const repaired = repairToolPairing(messages);
  lastRepair = { droppedCalls: repaired.droppedCalls, droppedResults: repaired.droppedResults };

  const chat: any = {
    model: body?.model,
    messages: repaired.messages,
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
      ...usageDetailsOf(this.usage),   // 10-17：缓存/推理字段透传（否则界面恒 0%）
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
      ...usageDetailsOf(json?.usage),   // 10-17：同上
    },
  };
}

/** ⛔⛔ 工具配对修复（10-17 实测：上游 503 + `code 11148 tool calls and tool results do not match`）。
 *  引擎发来的历史里，`assistant.tool_calls` 与 `role: "tool"` 可能**不成对** —— 历史被裁剪/压缩、
 *  或某轮被中断没落结果。严格网关会**直接拒收整份请求**：表现为 503 + 引擎无限重试
 *  （实测 2 分钟 / 8 次 / 每次握手 16s）⇒ 用户看到"发不出去或太慢"。
 *  ⇒ 发送前双向收敛，保证任何网关都收得下：
 *    ① `assistant.tool_calls` 里**没有结果**的，从数组摘掉（摘空则降级为普通 assistant 文本）；
 *    ② `role: "tool"` 里**没有对应 call** 的，整条丢掉。
 *  ⛔ 只动"不成对"的那些；成对的一条不碰（顺序天然保持：tool 消息本就紧跟其 call）。 */
export function repairToolPairing(messages: any[]): { messages: any[]; droppedCalls: number; droppedResults: number } {
  const resultIds = new Set<string>();
  for (const m of messages) {
    if (m && m.role === "tool" && m.tool_call_id) resultIds.add(String(m.tool_call_id));
  }
  let droppedCalls = 0;
  const keptCallIds = new Set<string>();
  for (const m of messages) {
    if (!m || m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    const kept = m.tool_calls.filter((c: any) => c && c.id && resultIds.has(String(c.id)));
    droppedCalls += m.tool_calls.length - kept.length;
    if (kept.length) {
      m.tool_calls = kept;
      for (const c of kept) keptCallIds.add(String(c.id));
    } else {
      delete m.tool_calls;
      if (m.content === null || m.content === undefined) m.content = "";
    }
  }
  let droppedResults = 0;
  const out = messages.filter((m: any) => {
    if (!m || m.role !== "tool") return true;
    if (m.tool_call_id && keptCallIds.has(String(m.tool_call_id))) return true;
    droppedResults += 1;
    return false;
  });
  return { messages: out, droppedCalls, droppedResults };
}
