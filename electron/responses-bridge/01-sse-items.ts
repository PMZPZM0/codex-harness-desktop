/**
 * responses-bridge 的「sse-items」部分（09-22 从同目录 responses-bridge.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { randomUUID } from "node:crypto";
export type OutputItem = { index: number; item: any; text?: string; args?: string };

/** 一行 SSE（event + data）。chat 流与 anthropic 流共用同一输出契约。 */
export function sseLine(event: any): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 本轮请求里的 custom（freeform）工具名集合。chat / anthropic 两条协议都只有 function 工具，
 *  custom 工具会被降级成 function 下发（见 02-chat-convert 的 toChatRequest）—— 回程要按这份名单
 *  把调用还原成 `custom_tool_call`，否则引擎按名字找不到工具。 */
export function customToolNames(body: any): Set<string> {
  const names = new Set<string>();
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    if (tool?.type === "custom" && tool?.name) names.add(String(tool.name));
  }
  return names;
}

/** 收尾：把未完结的 item 标成 completed，逐个发 output_item.done，最后发 response.completed。
 *  ⛔ chat 流与 anthropic 流**共用**这一段：两条流的差异只在「怎么解析上游增量」，
 *    收尾契约必须逐字一致 —— 否则同样的模型输出会因为走了不同协议而表现不同。 */
export function finalizeItems(items: OutputItem[], responseId: string, model: string, usage: any): string {
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
    } else if (entry.item.type === "custom_tool_call") {
      // custom 工具（引擎侧的 freeform apply_patch 等）：上游只能按 function 调用，参数被包成
      // {"input": "<原样工具输入>"}。收尾时把内层 input 取出来，还原成引擎认的 custom_tool_call
      // （⛔ 引擎按 name 匹配工具；item.type 给错成 function_call 会让它找不到工具而丢弃这次调用）。
      if (entry.item.status === "in_progress") {
        entry.item.status = "completed";
        entry.item.input = customInputFromArgs(entry.args);
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
export function newItem(kind: "message" | "reasoning", index: number): OutputItem {
  if (kind === "message") {
    return { index, item: { id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "message", role: "assistant", status: "in_progress", content: [] }, text: "" };
  }
  return { index, item: { id: `rs_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "reasoning", status: "in_progress", summary: [] }, text: "" };
}

/** 新建一个工具调用输出项。
 *  `custom=true` 生成 `custom_tool_call`（freeform 工具，如引擎的 apply_patch）：chat / anthropic
 *  协议只有 function 工具，所以下发给上游时被包成 `{input: string}`，回来后 `args` 里是
 *  `{"input":"*** Begin Patch…"}` —— 由 `customInputFromArgs` 拆回原样文本。 */
export function newToolItem(index: number, callId: string, name: string, custom = false): OutputItem {
  if (custom) {
    return {
      index,
      item: { id: `ctc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "custom_tool_call", status: "in_progress", name, input: "", call_id: callId },
      args: "",
    };
  }
  return {
    index,
    item: { id: `fc_${randomUUID().replace(/-/g, "").slice(0, 24)}`, type: "function_call", status: "in_progress", name, arguments: "", call_id: callId },
    args: "",
  };
}

/** 从上游 function 调用的 arguments 里取回 custom 工具的原始输入。
 *  ⛔ 取不到 `{input}`（上游没按 schema 发 / 模型直接发裸文本）时**原样返回**：
 *  宁可让引擎按原 content 报一次格式错误，也不能静默丢成空 patch（那会变成"什么都没改"的假成功）。 */
export function customInputFromArgs(args: string | undefined): string {
  const raw = String(args ?? "");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as any).input === "string") return (parsed as any).input;
    if (typeof parsed === "string") return parsed;
  } catch { /* 不是 JSON：原样当输入 */ }
  return raw;
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
