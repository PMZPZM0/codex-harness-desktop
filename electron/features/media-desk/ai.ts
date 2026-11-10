/**
 * 自媒体工作台 · 文本模型调用 + 提示词（11-09 接入 dsh-media-desk 的口播/标题/计划管线，MIT）。
 *
 * ⛔ 模型来源两级：① 工作台设置里的 assistant（OpenAI 兼容 baseUrl/model/apiKey）；
 *    ② 留空则沿用本应用当前生效供应商（custom-model + safeStorage 解出的 Key）。
 *    ⛔ 绝不把 Key 回传渲染层、不写进提示词。
 * ⛔ 非流式即可：这里是"一键成稿"，一次拿全再落盘；失败返回中文原因，不静默。
 */
import { readCustomModel } from "../../main/01-model-catalog";
import type { MediaDeskSettings, Post, PostPlan, StylePreset } from "./store";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export type ModelTarget = { baseUrl: string; model: string; apiKey: string };

/** 宿主的密钥接缝（⛔ 域不许直取 safeStorage —— 守卫【266】；由 ipc.ts 的 setup 注入）。 */
export type SecureLike = { isEncryptionAvailable: () => boolean; decryptString: (buf: Buffer) => string };
let secureHost: SecureLike | null = null;
/** 注入密钥接缝（feature setup 调一次；卸载时传 null）。 */
export function setSecureHost(host: SecureLike | null): void {
  secureHost = host;
}

/** 解析实际要用的模型：设置优先；空则沿用应用当前供应商。 */
export async function resolveModel(settings: MediaDeskSettings): Promise<ModelTarget> {
  const s = settings.assistant;
  if (s.baseUrl.trim() && s.model.trim()) {
    return { baseUrl: s.baseUrl.trim(), model: s.model.trim(), apiKey: s.apiKey };
  }
  const active = await readCustomModel().catch(() => null);
  const key = active?.encryptedKey && secureHost?.isEncryptionAvailable()
    ? secureHost.decryptString(Buffer.from(active.encryptedKey, "base64"))
    : "";
  return { baseUrl: String(active?.baseUrl ?? "").trim(), model: String(active?.model ?? "").trim(), apiKey: key };
}

function chatUrl(baseUrl: string): string {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/** 调一次文本模型；超时/非 2xx/空回复都抛中文错误。 */
export async function callModel(target: ModelTarget, messages: Msg[], timeoutMs = 120_000): Promise<string> {
  if (!target.baseUrl || !target.model) throw new Error("还没有可用的文本模型：请到「自媒体工作台 → 设置」填写，或先在「设置 → 模型」配置供应商。");
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
    let data: any = null;
    try { data = JSON.parse(text); } catch { throw new Error("模型接口返回的不是 JSON（可能不是 OpenAI 兼容地址）"); }
    const content = String(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "").trim();
    if (!content) throw new Error("模型没有返回正文（可能被内容策略拦截）");
    return content;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("模型超时（120 秒）");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出里抠 JSON（可能带 ```json 围栏或前后废话）。 */
/** 从模型输出里抠 JSON（可能带 ```json 围栏或前后废话）。 */
export function extractJson(raw: string): any {
  const text = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

/** 计划归一：缺字段补空、shots 收成 {text}。 */
/** 计划归一：缺字段补空、shots 收成 {text}。 */
export function normalizePlan(input: unknown, fallbackTitle: string): PostPlan {
  const plan = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const points = Array.isArray(plan.points) ? plan.points.map((p) => String(p ?? "").trim()).filter(Boolean).slice(0, 8) : [];
  const shots = Array.isArray(plan.shots)
    ? plan.shots.map((s) => ({ text: String((s as any)?.text ?? s ?? "").trim() })).filter((s) => s.text).slice(0, 12)
    : [];
  return {
    title: String(plan.title ?? "").trim() || fallbackTitle,
    angle: String(plan.angle ?? "").trim(),
    points,
    coverText: String(plan.coverText ?? "").trim(),
    shots,
  };
}

function styleBlock(style?: StylePreset | null): string {
  return style ? `\n写作风格要求：${style.prompt}\n` : "";
}

/** 从灵感生成计划（标题 / 角度 / 要点 / 封面文案 / 分镜）。 */
/** 从灵感生成计划的提示词（标题/角度/要点/封面文案/分镜）。 */
export function planPrompts(inspirations: string[], style: StylePreset | null, platform: string): Msg[] {
  return [
    { role: "system", content: "你是资深自媒体编导。只输出一个 JSON 对象，不要解释、不要代码围栏。" },
    {
      role: "user",
      content: `目标平台：${platform || "通用"}。${styleBlock(style)}\n灵感素材：\n${inspirations.map((t, i) => `${i + 1}. ${t}`).join("\n") || "（无，自行选题）"}\n\n请输出 JSON：{"title":"标题","angle":"切入角度","points":["要点1","要点2"],"coverText":"封面大字（≤12字）","shots":[{"text":"分镜画面描述"}]}`,
    },
  ];
}

/** 由计划写口播脚本（Markdown）。 */
/** 由计划写口播脚本的提示词。 */
export function articlePrompts(plan: PostPlan, style: StylePreset | null): Msg[] {
  return [
    { role: "system", content: "你是短视频口播文案。直接输出 Markdown 正文，不要解释。" },
    {
      role: "user",
      content: `${styleBlock(style)}\n标题：${plan.title}\n角度：${plan.angle}\n要点：${plan.points.join("；") || "（自拟）"}\n封面文案：${plan.coverText}\n分镜：${plan.shots.map((s) => s.text).join("；") || "（自拟）"}\n\n写一段 60~120 秒的口播脚本：开头 3 秒抓人，中间分点讲清，结尾一句行动号召。`,
    },
  ];
}

/** 工作室对话：在现有稿子上继续改。 */
/** 工作室对话的提示词（带当前稿子上下文）。 */
export function chatPrompts(post: Post | null, message: string): Msg[] {
  const context = post
    ? `当前标题：${post.title}\n当前正文：\n${String(post.script ?? "").slice(0, 6000)}`
    : "当前还没有选中的稿子。";
  return [
    { role: "system", content: "你是自媒体创作助手。回答简洁、可执行；需要改稿时直接给改后的段落。" },
    { role: "user", content: `${context}\n\n我的要求：${message}` },
  ];
}

/** 图片提示词（封面 / 配图 / 黑白线稿分镜）。 */
/** 生图提示词（封面 / 配图 / 黑白线稿分镜）。 */
export function imagePrompt(kind: "cover" | "figure" | "shot", text: string, style: StylePreset | null): string {
  const base = String(text ?? "").trim() || "内容封面";
  const styleHint = style ? `，风格：${style.description}` : "";
  if (kind === "cover") return `为自媒体内容做一张封面图，主题：${base}${styleHint}。构图干净、主体明确、留白给标题，不要出现文字。`;
  if (kind === "shot") return `黑白线稿分镜：${base}。简笔线条、无文字、白底。`;
  return `配图：${base}${styleHint}。真实质感、自然光、不要文字。`;
}
