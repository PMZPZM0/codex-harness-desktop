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
/** 「等待到点」的专用错误码（10-10）。⛔ 调用方据此区分**超时**与**回合真失败**：
 *  超时后成员的回合在引擎里**还在跑**（宿主只是不再同步等），不该标成 failed
 *  —— 用户反馈的"会话停在停止、其实活儿还在干"正是这个矛盾（见 delegation.ts / teams-ipc.ts 的 catch）。 */
export const TURN_WAIT_TIMEOUT_CODE = "TURN_WAIT_TIMEOUT";

/** 「等待到点 → 转后台」时交回调用方的**说明**（不是错误）。
 *  ⛔ 措辞要求讲清三件事：没失败 / 还在跑 / 结果会去哪（用户 10-10 反馈的核心误解就是
 *    "面板显示停止 = 活儿停了"）。委派与团队两条链路共用这一份，⛔ 不各写一句话。 */
export const TURN_WAIT_BACKGROUND_NOTE =
  "（该任务耗时超过同步等待上限，已**转入后台继续执行** —— 它没有失败。完成后结果会落进它的会话，"
  + "右侧头像轨与「办公室」也会同步显示；你可以先继续别的事。）";

/** 等待 app-server 的某个回合完成，返回 turn 对象；用于子智能体同步取回结果。 */
export function waitForTurnCompletion(threadId: string, turnId: string, timeoutMs = 600_000) {
  return new Promise<any>((resolve, reject) => {
    const handler = (event: any) => {
      if (event.kind !== "notification") return;
      const method = String(event.method ?? "");
      /* ⛔⛔ 四类结束事件都要认（10-10 修）：引擎按结束原因分别投递 turn/completed /
         turn/aborted / turn/failed / **turn/interrupted**（见渲染层事件路由 03-thread-id.tsx，
         那里四类都处理）。原来只认前三类 ⇒ 回合以 **interrupted** 结束时，这个 Promise
         **永不 settle**，只能白等满 timeoutMs 才报"超时"——用户看到的就是
         "每次调用都撞 10 分钟硬超时"（反馈原文）。与 PollBridge 的"只认 turn/completed"
         是**同型缺陷**（那处漏了三类，这处漏了一类）。 */
      if (!["turn/completed", "turn/aborted", "turn/failed", "turn/interrupted"].includes(method)) return;
      if (event.params?.threadId !== threadId || event.params?.turn?.id !== turnId) return;
      cleanup();
      if (method === "turn/completed") resolve(event.params.turn);
      else reject(new Error(`子智能体回合未正常完成（${method}）`));
    };
    /* ⛔ 文案必须反映**实际的**超时值（原来写死"10 分钟"，而 distillSummarize 传的是 300_000）。
       ⛔ 带上 TURN_WAIT_TIMEOUT_CODE：调用方要能区分「等待到点」与「回合真失败」。 */
    const timer = setTimeout(() => {
      cleanup();
      const error: any = new Error(`等待回合完成超时（${Math.round(timeoutMs / 60_000)} 分钟）`);
      error.code = TURN_WAIT_TIMEOUT_CODE;
      reject(error);
    }, timeoutMs);
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
