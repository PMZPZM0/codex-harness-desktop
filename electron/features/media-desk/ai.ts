/**
 * 自媒体工作台 · 文本模型调用（11-09）。
 *
 * 把开源宿主 llm 适配层的请求，用**应用当前供应商**跑一轮。
 * ⛔ 两种协议都要支持（10-01 已踩过：只认 chat/completions 时 responses 供应商直接不可用）：
 *    `wireApi === "responses"` 走 `/responses`，否则走 `/chat/completions`。
 * ⛔ 非流式：适配层把整段文本作为一段 text-delta 交回去；失败返回中文原因。
 * ⛔ 不在这里存/读 Key —— 调用方（embed.ts）用宿主 secure 接缝解出后传进来。
 */
import { guardedFetch } from "../../net-guard";

export type ModelTarget = { baseUrl: string; model: string; apiKey: string; wireApi?: "chat" | "responses" };

type Msg = { role: "system" | "user" | "assistant"; content: string };

/** 当前协议的完整请求地址（base 可能已经是完整端点）。 */
function endpoint(baseUrl: string, wireApi: "chat" | "responses"): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return wireApi === "responses" ? `${base}/responses` : (/\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`);
}

/** 从 responses 载荷里取正文（output_text 或 output[].content[].text）。 */
function responsesText(data: any): string {
  return String(
    data?.output_text
    ?? (Array.isArray(data?.output) ? data.output.flatMap((item: any) => item?.content ?? []).map((part: any) => part?.text ?? "").join("") : ""),
  ).trim();
}

/** 调一次文本模型；超时/非 2xx/空回复都抛中文错误。 */
export async function callModel(target: ModelTarget, messages: Msg[], timeoutMs = 120_000): Promise<string> {
  if (!target.baseUrl || !target.model) throw new Error("当前没有可用模型：请先在「设置 → 模型」配置供应商。");
  const wireApi = target.wireApi === "responses" ? "responses" : "chat";
  const url = endpoint(target.baseUrl, wireApi);
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const userText = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
  const body = wireApi === "responses"
    ? {
      model: target.model,
      stream: false,
      ...(systems ? { instructions: systems } : {}),
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
    }
    : { model: target.model, messages, temperature: 0.8, stream: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await guardedFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    }, { timeoutMs });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 200)}`);
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { throw new Error("模型接口返回的不是 JSON（可能不是 OpenAI 兼容地址）"); }
    const content = wireApi === "responses"
      ? responsesText(data)
      : String((data as any)?.choices?.[0]?.message?.content ?? (data as any)?.choices?.[0]?.text ?? "").trim();
    if (!content) throw new Error("模型没有返回正文（可能被内容策略拦截）");
    return content;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("模型超时（120 秒）");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}
