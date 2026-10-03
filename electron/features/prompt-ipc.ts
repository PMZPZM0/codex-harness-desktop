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
import { safeStorage } from "electron";
import { readCustomModel } from "../main";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const ENHANCE_SYSTEM_PROMPT = [
  "你是提示词优化助手。把用户的原始输入改写成一个清晰、具体、结构化的 AI 提示词：",
  "- 保留用户原文的全部意图与信息，不编造新需求",
  "- 补齐缺失的背景、目标、输出要求，使指令可直接执行",
  "- 用简洁的中文输出优化后的提示词本身，不要任何解释、前言或 markdown 代码块",
].join("\n");

export const promptFeature = defineFeature<null>({
  id: "prompt",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("prompt: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("prompt:enhance", async (_event, input: { text: string }) => {
      const text = String(input?.text ?? "").trim();
      if (!text) return { ok: false, error: "输入内容为空" };
      try {
        const model = await readCustomModel();
        if (!model?.baseUrl || !model.model || model.enabled === false) return { ok: false, error: "请先在设置中配置并启用自定义模型" };
        const apiKey = model.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
        const base = model.baseUrl.trim().replace(/\/$/, "");
        const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(endpoint, {
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
          });
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

    ctx.effect(() => {
      ipcHost.removeHandler("prompt:enhance");
    });
  },
});
