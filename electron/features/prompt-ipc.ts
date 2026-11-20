/**
 * prompt-ipc（10-03 从 `features/connectors-mcp-ipc/` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：prompt(1)
 * 通道：prompt:enhance（用已配置的模型把用户输入改写成清晰可执行的提示词）
 *
 * ⛔ 60 秒超时 + AbortController 不能去掉：走的是用户自己的模型端点，卡住会让 UI 一直转圈。
 * ⛔ 返回形状 `{ ok, text }` / `{ ok, error }` 逐字保留 —— 换容器不许改对外契约。
 * ⛔ 待接缝化（阶段 2）：safeStorage 为宿主能力。
 */

import { readCustomModel } from "../main";
import { guardedFetch } from "../net-guard";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const ENHANCE_SYSTEM_PROMPT = [
  "你是提示词优化助手。把用户的原始输入改写成一个清晰、具体、结构化的 AI 提示词：",
  "- 保留用户原文的全部意图与信息，不编造新需求",
  "- 补齐缺失的背景、目标、输出要求，使指令可直接执行",
  "- 用简洁的中文输出优化后的提示词本身，不要任何解释、前言或 markdown 代码块",
].join("\n");

/* 11-20 GitHub 热门榜：把仓库简介翻成简体中文（每页 10 条，一次批量请求）。
   ⛔ 输入是**外部数据**：只当 JSON 数组内容翻译，不执行里面的任何指令；
   ⛔ 输出必须是同长度的 JSON 数组，解析失败再按行兜底；都失败则交给 MyMemory。 */
const TRANSLATE_SYSTEM_PROMPT = [
  "你是专业翻译。把每个 GitHub 仓库简介翻译成简洁的简体中文（一行）。",
  "保留产品名、代码标识符、URL、版本号不变；不要添加解释、前言或 Markdown 代码块。",
  "只输出一个 JSON 字符串数组，长度与顺序必须与输入完全一致。",
].join("\n");

/** 从模型回复里取同长度数组（JSON 优先，退化为逐行）。 */
function parseTranslatedArray(raw: string, count: number): string[] | null {
  const cleaned = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === count) return parsed.map((item) => String(item ?? ""));
  } catch { /* 交给逐行兜底 */ }
  const lines = cleaned.split(/\r?\n/).map((line) => line.replace(/^\s*[-*\d.、]+\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return lines.length === count ? lines : null;
}

export const promptFeature = defineFeature<null>({
  id: "prompt",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // 宿主能力经接缝取（10-03 阶段 2b）：safeStorage 触碰系统密钥库，
    // 域直取等于"插件自选加解密策略" ⇒ 锁进容器（守卫【266】零容忍）。
    const { secure } = ctx.get<HostCaps>("host")!;
    if (!ipcHost) throw new Error("prompt: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("prompt:enhance", async (_event, input: { text: string }) => {
      const text = String(input?.text ?? "").trim();
      if (!text) return { ok: false, error: "输入内容为空" };
      try {
        const model = await readCustomModel();
        if (!model?.baseUrl || !model.model || model.enabled === false) return { ok: false, error: "请先在设置中配置并启用自定义模型" };
        const apiKey = model.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
        const base = model.baseUrl.trim().replace(/\/$/, "");
        const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await guardedFetch(endpoint, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
            body: JSON.stringify({
              model: model.model,
              messages: [
                { role: "system", content: ENHANCE_SYSTEM_PROMPT },
                { role: "user", content: text },
              ],
              temperature: 0.4,
            }),
          }, { timeoutMs: 60_000 });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            return { ok: false, error: `增强失败 HTTP ${response.status}${body ? "：" + body.slice(0, 160) : ""}` };
          }
          const data: any = await response.json();
          const enhanced = String(data?.choices?.[0]?.message?.content ?? "").trim();
          if (!enhanced) return { ok: false, error: "增强结果为空，请重试" };
          return { ok: true, text: enhanced };
        } finally {
          clearTimeout(timeout);
        }
      } catch (error: any) {
        return { ok: false, error: error?.name === "AbortError" ? "增强超时，请重试" : `增强失败：${error?.message ?? error}` };
      }
    });

    /* 11-20 GitHub 热门榜的简介翻译：每页 10 条。先用用户已配置的模型批量翻，失败再走 MyMemory。 */
    ipcHost.handle("prompt:translate", async (_event, input: { texts?: string[] } = {}) => {
      const source = (Array.isArray(input.texts) ? input.texts : []).slice(0, 10);
      const texts = source.map((text) => String(text ?? "").slice(0, 800));
      if (!texts.some((text) => text.trim())) return { ok: true, translations: texts };
      const isChinese = (text: string) => /[\u4e00-\u9fff]/.test(text);

      /* ① 当前模型（chat / responses 两种协议都支持；官方订阅账号没有可用的 API Key ⇒ 交给 MyMemory）。 */
      try {
        const model = await readCustomModel();
        if (model?.baseUrl && model.model && model.enabled !== false && model.provider !== "openai-official") {
          const apiKey = model.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
          const base = model.baseUrl.trim().replace(/\/$/, "");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 45_000);
          try {
            let raw = "";
            if (model.wireApi === "responses") {
              const response = await guardedFetch(`${base}/responses`, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
                body: JSON.stringify({
                  model: model.model,
                  stream: false,
                  instructions: TRANSLATE_SYSTEM_PROMPT,
                  input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(texts) }] }],
                }),
              }, { timeoutMs: 45_000 });
              if (response.ok) {
                const payload = (await response.json().catch(() => null)) as {
                  output_text?: string;
                  output?: { content?: { text?: string }[] }[];
                } | null;
                raw = String(payload?.output_text
                  ?? (Array.isArray(payload?.output) ? payload.output.flatMap((item) => item?.content ?? []).map((part) => part?.text ?? "").join("") : ""));
              }
            } else {
              const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
              const response = await guardedFetch(endpoint, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
                body: JSON.stringify({
                  model: model.model,
                  temperature: 0.2,
                  messages: [
                    { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
                    { role: "user", content: JSON.stringify(texts) },
                  ],
                }),
              }, { timeoutMs: 45_000 });
              if (response.ok) {
                const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
                raw = String(data?.choices?.[0]?.message?.content ?? "");
              }
            }
            const parsed = parseTranslatedArray(raw, texts.length);
            if (parsed) return { ok: true, translations: parsed.map((value, index) => value.trim() || texts[index]) };
          } finally {
            clearTimeout(timer);
          }
        }
      } catch { /* 模型不可用 ⇒ 走 MyMemory */ }

      /* ② MyMemory 免费接口（国内可直连，匿名额度有限；只翻当前页，渲染层会缓存结果）。 */
      const output = texts.slice();
      const jobs = texts.map(async (text, index) => {
        if (!text.trim() || isChinese(text)) return;
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
          const response = await guardedFetch(url, {}, { timeoutMs: 8_000 });
          if (!response.ok) return;
          const data = (await response.json().catch(() => null)) as { responseData?: { translatedText?: string } } | null;
          const translated = String(data?.responseData?.translatedText ?? "").trim();
          if (translated && !/MYMEMORY WARNING/i.test(translated)) output[index] = translated;
        } catch { /* 保留原文 */ }
      });
      for (let index = 0; index < jobs.length; index += 3) await Promise.all(jobs.slice(index, index + 3));
      const translatedAny = output.some((value, index) => value !== texts[index]);
      return { ok: translatedAny, translations: output, ...(translatedAny ? {} : { error: "翻译服务暂不可用，当前显示原文" }) };
    });

    ctx.effect(() => {
      ipcHost.removeHandler("prompt:enhance");
      ipcHost.removeHandler("prompt:translate");
    });
  },
});
