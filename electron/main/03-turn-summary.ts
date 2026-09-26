/**
 * main 的「turn-summary」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import { RESERVED_PROVIDER_IDS, safeProviderId, stripReservedProviderTables } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { readCustomModel } from "./01-model-catalog";
import { internalThreads, server } from "../runtime-refs";
import { bridgeDial } from "../bridge-dial";
import { ensureProjectAgentsMd } from "../project-conventions";
/** 等待 app-server 的某个回合完成，返回 turn 对象；用于子智能体同步取回结果。 */
export function waitForTurnCompletion(threadId: string, turnId: string, timeoutMs = 600_000) {
  return new Promise<any>((resolve, reject) => {
    const handler = (event: any) => {
      if (event.kind !== "notification") return;
      const method = String(event.method ?? "");
      if (!["turn/completed", "turn/aborted", "turn/failed"].includes(method)) return;
      if (event.params?.threadId !== threadId || event.params?.turn?.id !== turnId) return;
      cleanup();
      if (method === "turn/completed") resolve(event.params.turn);
      else reject(new Error(`子智能体回合未正常完成（${method}）`));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("子智能体执行超时（10 分钟）")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); server.off("event", handler); };
    server.on("event", handler);
  });
}

export function turnOutputText(turn: any) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const text = items
    .filter((item: any) => item?.type === "agentMessage")
    .map((item: any) => String(item.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return text || String(turn?.finalMessage ?? "").trim();
}

/**
 * 记忆蒸馏的模型通道：开一个只读的一次性会话把旧日志提炼成长期记忆。
 * 全程标记 internalThreads —— 否则它自己的 turn/completed 会被捕获逻辑当成对话写回日志。
 */
export async function distillSummarize(prompt: string, body: string): Promise<string> {
  const model = await readCustomModel();
  const effectiveModel = model?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法蒸馏记忆");
  if (model?.encryptedKey && safeStorage.isEncryptionAvailable()) {
    const apiKey = safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64"));
    if (apiKey) server.setApiKey(apiKey);
  }
  const provider = model?.provider ?? "openai";
  ensureProjectAgentsMd(process.cwd());
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: process.cwd(),
    approvalPolicy: "never",
    sandbox: "read-only",
    modelProvider: provider,
    config: model?.baseUrl
      ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name: model?.name ?? provider, base_url: bridgeDial(provider, model.baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } }
      : undefined,
  });
  const threadId = started.thread.id;
  internalThreads.add(threadId);
  try {
    const turn: any = await server.request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${prompt}\n\n下面是原始日志：\n\n${body}`, text_elements: [] }],
      model: effectiveModel,
      effort: "low",
    });
    const turnId = turn.turn?.id;
    if (!turnId) throw new Error("蒸馏回合启动失败：未返回 turnId");
    const completed = await waitForTurnCompletion(threadId, turnId, 300_000);
    return turnOutputText(completed);
  } finally {
    internalThreads.delete(threadId);
  }
}
