/**
 * responses-bridge 的「anthropic-convert」部分（09-22 从同目录 responses-bridge.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import * as http from "node:http";
import * as https from "node:https";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { sseLine, finalizeItems, newItem, newToolItem } from "./01-sse-items";
import type { OutputItem } from "./01-sse-items";
/** Anthropic Messages 的 max_tokens 上限保护。
 *  ⛔ Anthropic **要求 max_tokens 必填**，且不得超过模型上限（超了直接 400，不是截断）。
 *  而引擎给的 `max_output_tokens` 是「模型上下文级」的大值（本项目实测见过 393216），
 *  原样透传必被拒 —— 这里压到 Claude 系列通行的输出上限，保证「能跑」优先于「跑满」。 */
const ANTHROPIC_MAX_TOKENS_CAP = 64000;

/** 由供应商 Base URL 推出 Anthropic Messages 端点。
 *  ⛔ base 可能带 `/v1`（如 `https://api.anthropic.com/v1`）也可能不带
 *  （本项目 PPToken 的 Claude 线路就是 `https://api.pptoken.cc`）—— 两种都要落到
 *  `…/v1/messages`，所以先剥掉尾部的 `/v1` 再统一拼，避免出现 `/v1/v1/messages`。 */
export function anthropicMessagesUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  const prefix = base.endsWith("/v1") ? base.slice(0, -3) : base;
  return `${prefix}/v1/messages`;
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
