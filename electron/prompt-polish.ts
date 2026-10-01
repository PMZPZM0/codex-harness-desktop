/**
 * 提示词润色：**一次性短请求**（非流式），给画布「写提示词」卡的「AI 润色」按钮用。
 *
 * ⛔ 为什么不开会话（09-29 用户：「那你就加一个，不要新开会话」）：让 Codex 润色要么弹会话
 *    选择器、要么切会话，体验是"为了一句话开一次对话"；而且要模型把结果写回卡片还得有写回通道。
 *    直接在主进程用**用户已配置的模型**发一次 chat completion 最省事，结果就地写回卡片。
 *
 * ⛔ 边界（诚实报错，不猜）：
 *   · 只支持 `wireApi` 为 chat 的供应商（/chat/completions）；responses-only 的网关明确报错；
 *   · 官方订阅账号（openai-official）走的是另一套鉴权，这条通道不支持 —— 明确提示去配自定义供应商；
 *   · 超时 30 秒（网关慢就报错，不能挂住 UI）。
 */
import { safeStorage } from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCustomModel } from "./main/01-model-catalog";

const SYSTEM = [
  "你是生图提示词润色助手。要求：",
  "1. 保留原意与主体，不要换题材；",
  "2. 补上主体细节 / 环境 / 光线 / 构图视角 / 风格质感；",
  "3. 只输出一行可直接使用的中文提示词 —— 不要解释、不要分点、不要用引号包裹。",
].join("");

export async function polishPromptOnce(text: string, context?: string): Promise<string> {
  const cfg = await readCustomModel();
  if (!cfg?.baseUrl || !cfg?.model) {
    throw new Error("还没配置模型 —— 先到「设置 → 模型」配一个带 API Key 的供应商，润色才能用");
  }
  if (cfg.provider === "openai-official") {
    throw new Error("官方订阅账号不支持这条润色调用 —— 请另配一个「自定义 API Key」的供应商来润色");
  }
  const key = cfg.encryptedKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(cfg.encryptedKey, "base64"))
    : "";
  if (!key) throw new Error("这个供应商没有可用的 API Key —— 到「设置 → 模型」补上再试");

  const base = cfg.baseUrl.replace(/\/$/, "");
  const userText = context ? `${context}\n\n原提示词：${text}` : text;
  /* ⛔ 两种协议都支持（10-01 用户实测「AI 润色用不了」）：他的供应商走 responses 协议，
      旧实现只认 chat ⇒ 直接报错不给用。两个分支都返回一段纯文本，调用方不感知协议差异。 */
  if (cfg.wireApi === "responses") {
    const response = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        instructions: SYSTEM,
        input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`润色请求失败（HTTP ${response.status}）${raw ? "：" + raw.slice(0, 160) : ""}`);
    }
    const payload: any = await response.json().catch(() => null);
    const out = String(
      payload?.output_text
      ?? (Array.isArray(payload?.output) ? payload.output.flatMap((item: any) => item?.content ?? []).map((part: any) => part?.text ?? "").join("") : ""),
    ).trim();
    if (!out) throw new Error("模型没有返回内容（换一个模型再试）");
    return out;
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userText },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`润色请求失败（HTTP ${response.status}）${raw ? "：" + raw.slice(0, 160) : ""}`);
  }
  const data: any = await response.json().catch(() => null);
  const out = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!out) throw new Error("模型没有返回内容（换一个模型再试）");
  return out;
}

/* ───────────────────────── 锁主体：商品图 → 固定主体描述（09-29 电商出图工作流）

   用途：六类图（主图 / SKU / 详情 / 场景 / 白底 / 买家秀）共用同一段主体描述 ⇒ 文本层面锁死
   「同一件商品」，避免一套图里商品变样（这是调研里「参考图锁主体」在纯文生图通道下的可行替代）。
   ⛔ 边界与 polishPromptOnce 相同：只支持 chat 协议 + 需要**支持视觉输入**的模型；
      模型不支持图输入时网关会报错，这里把原始错误如实带出来，不猜。 */

const DESCRIBE_SYSTEM = [
  "你是电商商品图分析师。看图后输出**一段**中文描述，用于复现同一件商品。必须包含：",
  "品类、材质、主色与配色、外形结构、表面工艺与纹理、可见文字或 logo。",
  "要求：只输出这段描述本身（一行，60–100 字）；不要分点、不要解释、不要用引号包裹；",
  "不要描述背景、不要写拍摄建议（背景与光线由后续每张图的提示词决定）。",
].join("");

/** 把本地路径或 http/data URL 统一成模型能吃的图源。 */
async function toVisionSource(ref: string): Promise<string> {
  const source = String(ref || "").trim();
  if (/^(https?:|data:)/i.test(source)) return source;
  const candidate = path.isAbsolute(source) ? source : path.resolve(source);
  if (!existsSync(candidate)) throw new Error("参考图本地文件不存在：" + candidate);
  const mime = /\.jpe?g$/i.test(candidate) ? "image/jpeg" : /\.webp$/i.test(candidate) ? "image/webp" : /\.gif$/i.test(candidate) ? "image/gif" : "image/png";
  return `data:${mime};base64,` + (await readFile(candidate)).toString("base64");
}

export async function describeProductOnce(imageRef: string, context?: string): Promise<string> {
  const ref = String(imageRef || "").trim();
  if (!ref) throw new Error("这张卡还没有参考图 —— 先在「商品参考图」卡上上传一张，再点「锁定主体」");
  const cfg = await readCustomModel();
  if (!cfg?.baseUrl || !cfg?.model) {
    throw new Error("还没配置模型 —— 先到「设置 → 模型」配一个带 API Key 的供应商，识图才能用");
  }
  if (cfg.provider === "openai-official") {
    throw new Error("官方订阅账号不支持这条识图调用 —— 请另配一个「自定义 API Key」的供应商");
  }
  if (cfg.wireApi === "responses") {
    throw new Error("当前供应商用的是 responses 协议，识图暂时只支持 chat 协议的供应商（换一个再试）");
  }
  const key = cfg.encryptedKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(cfg.encryptedKey, "base64"))
    : "";
  if (!key) throw new Error("这个供应商没有可用的 API Key —— 到「设置 → 模型」补上再试");

  const source = await toVisionSource(ref);
  const base = cfg.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: context ? `${DESCRIBE_SYSTEM}\n\n补充要求：${context}` : DESCRIBE_SYSTEM },
          { type: "image_url", image_url: { url: source } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let hint = raw.slice(0, 160);
    try { hint = JSON.parse(raw)?.error?.message ?? hint; } catch { /* 原样截断 */ }
    throw new Error(`识图请求失败（HTTP ${response.status}）${hint ? "：" + hint : ""}（模型需支持视觉输入）`);
  }
  const data: any = await response.json().catch(() => null);
  const out = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!out) throw new Error("模型没有返回描述（换一个支持视觉的模型再试）");
  return out;
}
