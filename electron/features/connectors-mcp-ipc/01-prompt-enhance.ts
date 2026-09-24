/**
 * connectors-mcp-ipc 的「prompt-enhance」部分（09-22 从同目录 connectors-mcp-ipc.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import fs from "node:fs/promises";
import { app, ipcMain, safeStorage, session, shell } from "electron";
import { applyCustomModel, connectorEnv, connectorsFile, mcpOverrideEnabled, oauthSessions, readConnectors, readCustomModel, readMcpOverrides, refreshSkillDiscipline, safeConnectorId, writeMcpOverrides } from "../../main";
import { codexHome, server } from "../../runtime-refs";
import type { ConnectorConfig, ConnectorTransport } from "../../main";
type PublicConnectorConfig = Omit<ConnectorConfig, "headers" | "envHttpHeaders" | "env" | "encryptedSecrets"> & { hasSecrets: boolean; headerKeys: string[]; envKeys: string[]; envHttpHeaderKeys: string[] };

export function publicConnector(value: ConnectorConfig): PublicConnectorConfig {
  const { headers, env, encryptedSecrets, ...rest } = value;
  return { ...rest, hasSecrets: Boolean(Object.keys(encryptedSecrets ?? {}).length), headerKeys: Object.keys(headers ?? {}), envKeys: Object.keys(env ?? {}), envHttpHeaderKeys: Object.keys(value.envHttpHeaders ?? {}) };
}

export async function writeConnectors(list: ConnectorConfig[]) { await fs.writeFile(connectorsFile, JSON.stringify(list, null, 2), "utf8"); }

const ENHANCE_SYSTEM_PROMPT = [
  "你是提示词优化助手。把用户的原始输入改写成一个清晰、具体、结构化的 AI 提示词：",
  "- 保留用户原文的全部意图与信息，不编造新需求",
  "- 补齐缺失的背景、目标、输出要求，使指令可直接执行",
  "- 用简洁的中文输出优化后的提示词本身，不要任何解释、前言或 markdown 代码块",
].join("\n");

ipcMain.handle("prompt:enhance", async (_event, input: { text: string }) => {
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
