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
  if (cfg.wireApi === "responses") {
    throw new Error("当前供应商用的是 responses 协议，润色暂时只支持 chat 协议的供应商（换一个再试）");
  }
  const key = cfg.encryptedKey && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(cfg.encryptedKey, "base64"))
    : "";
  if (!key) throw new Error("这个供应商没有可用的 API Key —— 到「设置 → 模型」补上再试");

  const base = cfg.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: context ? `${context}\n\n原提示词：${text}` : text },
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
