/**
 * main 的「turn-summary」部分（09-22 从同目录 main.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Menu, Notification, app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, session, shell, systemPreferences } from "electron";
import { HARNESS_PROVIDER_ID, RESERVED_PROVIDER_IDS, safeProviderId, stripReservedProviderTables } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { readCustomModel } from "./01-model-catalog";
import { engineActiveTurnIds, internalThreads, server } from "../runtime-refs";
import { GROUP_EVENT_TAG } from "../../src/lib/host-queue.mjs";
import { rememberInternalThread } from "../internal-threads";
import { threadModelOf } from "../thread-model";
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
 * 记忆蒸馏的模型通道。
 *
 * ⛔⛔ 10-31 用户令：「记忆蒸馏改一下，不要开新会话蒸馏，会话自己蒸馏」——
 *   **优先在传入的会话里跑这一轮**（`opts.inThread`）：不开新会话，用的是这条会话自己的
 *   模型与上下文，产出的蒸馏结果直接回给调用方。只有当**那条会话正在跑回合**时才退回
 *   「一次性内部会话」（不能在别人跑着的时候插一条 turn/start —— 会把用户那轮打断）。
 */
export async function distillSummarize(prompt: string, body: string, opts?: { threadId?: string; cwd?: string; inThread?: string }): Promise<string> {
  const model = await readCustomModel();
  /* ⛔ 10-30：没有自定义模型时（用官方供应商的用户）**退回本会话自己的模型** ——
     引擎在 turn/start 里已经给过它；不退回的话这类用户的功能永远抛「尚未配置自定义模型」。 */
  const sessionModel = opts?.threadId ? threadModelOf(opts.threadId) : null;
  const sessionConfig = (sessionModel?.config ?? null) as Record<string, any> | null;
  const effectiveModel = model?.model || sessionModel?.model;
  if (!effectiveModel) throw new Error("还没拿到本会话的模型，无法蒸馏（等这一轮跑完再试）");
  if (model?.encryptedKey && safeStorage.isEncryptionAvailable()) {
    const apiKey = safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64"));
    if (apiKey) server.setApiKey(apiKey);
  }
  /* ⛔⛔ provider 必须与「我们要传下去的 config」**同源**（10-31 用户实测「生成失败」）：
     会话实际走的是别名 `harness`（config.model_provider = harness），而 threadModelOf.provider
     记的是自定义供应商名（custom964）⇒ 两边不一致时引擎直接拒：
     `This chat uses custom964, but your current provider is harness. Switch to custom964 to continue.`
     ⇒ 有自定义 baseUrl 时用自家别名；退回会话配置时，**以 config.model_provider 为准**。 */
  const provider = model?.baseUrl
    ? HARNESS_PROVIDER_ID
    : safeProviderId(sessionConfig?.model_provider ?? sessionModel?.provider ?? model?.provider ?? "openai");

  const promptText = `${prompt}\n\n下面是原始日志：\n\n${body}`;
  /* ① 会话自己蒸馏（用户令）：那条会话空闲才走这条 —— 用 `[群事件]` 标记，
     时间线按事件块渲染，不会被当成"用户自己说的话"。 */
  const inThread = String(opts?.inThread ?? "").trim();
  if (inThread && ![...engineActiveTurnIds.values()].includes(inThread)) {
    const turn: any = await server.request("turn/start", {
      threadId: inThread,
      input: [{ type: "text", text: `${GROUP_EVENT_TAG}${promptText}`, text_elements: [] }],
      model: effectiveModel,
      effort: "low",
    });
    const turnId = turn.turn?.id;
    if (!turnId) throw new Error("蒸馏回合启动失败：未返回 turnId");
    const completed = await waitForTurnCompletion(inThread, turnId, 300_000);
    return turnOutputText(completed);
  }

  /* ② 兜底（会话正忙 / 调用方没给会话）：开一个只读的一次性内部会话。
     全程标记 internalThreads —— 否则它自己的 turn/completed 会被捕获逻辑当成对话写回日志。 */
  /* ⛔ cwd 不写死：优先用调用方给的本会话工作目录（任务监控传 threadCwd），否则才退回进程目录。
     AGENTS.md 与产物都跟着这个目录走 —— 写死在安装目录会让 mac 上写出意料之外的路径。 */
  const cwd = String(opts?.cwd ?? "").trim() || process.cwd();
  ensureProjectAgentsMd(cwd);
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    modelProvider: provider,
    /* 自定义模型走别名 provider（bridgeDial 改写 base_url）；否则用本会话那一轮的 provider 配置原文。 */
    config: model?.baseUrl
      ? { model_provider: provider, model_providers: { [provider]: { name: model?.name ?? provider, base_url: bridgeDial(provider, model.baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } }
      : sessionConfig ?? undefined,
  });
  const threadId = started.thread.id;
  internalThreads.add(threadId);
  /* ⛔ 必须落盘（10-31）：只放内存的话重启就忘了 ⇒ 这些内省会话又会爬回侧栏。
     见 electron/internal-threads.ts 的三道闸说明。 */
  rememberInternalThread(threadId);
  try {
    const turn: any = await server.request("turn/start", {
      threadId,
      input: [{ type: "text", text: promptText, text_elements: [] }],
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
