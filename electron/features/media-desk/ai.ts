/**
 * 自媒体工作台 · 文本模型调用（11-09）。
 *
 * 只做一件事：把开源宿主 llm 适配层的请求，用**应用当前供应商**跑一轮（OpenAI 兼容 chat/completions）。
 * ⛔ 非流式：适配层把整段文本作为一段 text-delta 交回去；失败返回中文原因。
 * ⛔ 不在这里存/读 Key —— 调用方（embed.ts）用宿主 secure 接缝解出后传进来。
 */
export type ModelTarget = { baseUrl: string; model: string; apiKey: string };

type Msg = { role: "system" | "user" | "assistant"; content: string };

function chatUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/** 调一次文本模型；超时/非 2xx/空回复都抛中文错误。 */
export async function callModel(target: ModelTarget, messages: Msg[], timeoutMs = 120_000): Promise<string> {
  if (!target.baseUrl || !target.model) throw new Error("当前没有可用模型：请先在「设置 → 模型」配置供应商。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(chatUrl(target.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}) },
      body: JSON.stringify({ model: target.model, messages, temperature: 0.8, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 200)}`);
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { throw new Error("模型接口返回的不是 JSON（可能不是 OpenAI 兼容地址）"); }
    const content = String((data as any)?.choices?.[0]?.message?.content ?? (data as any)?.choices?.[0]?.text ?? "").trim();
    if (!content) throw new Error("模型没有返回正文（可能被内容策略拦截）");
    return content;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("模型超时（120 秒）");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}
