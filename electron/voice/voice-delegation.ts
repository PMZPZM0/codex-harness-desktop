/**
 * 语音委派执行器（11-11，MOSS-Live `delegation: {type:"client"}`）。
 *
 * 服务端在 `session.delegation.created` 里给出 objective + 最近对话摘录；这里把任务交给
 * **Codex 会话**执行，再把结果用 `session.commentary.append` 回传（模型会念给用户听）。
 *
 * ⛔ 优先在当前语音绑定的会话里跑（用户说「调用 codex 会话干活」）：
 *    - 会话空闲 ⇒ 直接 `turn/start` + 等完成；
 *    - 会话正在跑回合 ⇒ **绝不插 turn/start**（会打断用户那轮），改开一条独立工作会话，
 *      跑完把结果回传；原会话完全不受影响。
 * ⛔ 结果回传有 2000 字符上限；这里截断并在末尾提示详情在哪。
 */
import { originSessionModel } from "../main/01-model-catalog";
import { TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { server, threadCwd, threadRuntimeStore } from "../runtime-refs";
import { buildVoiceDelegationPrompt } from "../../src/lib/voice-delegation.mjs";

export type VoiceDelegationTask = {
  id: string;
  /** 语音通话绑定的会话 id（优先在它里面跑；忙则另开工作会话） */
  originThreadId: string;
  objective: string;
  context?: { role?: string; content?: string }[];
  purpose?: string;
  timeoutMs?: number;
};

export type VoiceDelegationResult = {
  ok: boolean;
  output: string;
  error?: string;
  cancelled?: boolean;
  threadId?: string;
};

const MAX_RESULT_CHARS = 1800;
const MAX_TASK_MS = 10 * 60 * 1000;

function brief(text: string, max = MAX_RESULT_CHARS): string {
  const clean = String(text ?? "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n…（内容较长，完整结果见 Codex 会话）`;
}

function taskPrompt(task: VoiceDelegationTask): string {
  return buildVoiceDelegationPrompt({
    objective: task.objective,
    context: task.context,
    purpose: task.purpose,
  });
}

/** 会话当前是否正在跑回合（引擎侧真相：thread/turns 的 inProgress）。 */
function threadBusy(thread: any): boolean {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return turns.some((turn: any) => String(turn?.status ?? "") === "inProgress");
}

async function startTurnOnThread(threadId: string, inputText: string): Promise<{ threadId: string; turnId: string }> {
  const runtime = await threadRuntimeStore.get(threadId).catch(() => null);
  const model = (await originSessionModel(threadId, threadRuntimeStore).catch(() => "")) || runtime?.model || "";
  const started: any = await server.request("turn/start", {
    threadId,
    input: [{ type: "text", text: inputText, text_elements: [] }],
    ...(model ? { model } : {}),
    ...(runtime?.effort ? { effort: runtime.effort } : {}),
    personality: "pragmatic",
  });
  const turnId = String(started?.turn?.id ?? started?.turnId ?? "");
  if (!turnId) throw new Error("引擎没有返回回合 id");
  return { threadId, turnId };
}

/** 开一条独立工作会话（当前会话忙时用；不打断用户那轮）。 */
async function startWorkerThread(originThreadId: string, inputText: string, title: string): Promise<{ threadId: string; turnId: string }> {
  const runtime = await threadRuntimeStore.get(originThreadId).catch(() => null);
  const cwd = threadCwd.get(originThreadId) || "";
  const model = (await originSessionModel(originThreadId, threadRuntimeStore).catch(() => "")) || runtime?.model || "";
  const created: any = await server.request("thread/start", {
    ...(model ? { model } : {}),
    ...(cwd ? { cwd } : {}),
    ...(runtime?.sandbox ? { sandbox: runtime.sandbox } : {}),
    ...(runtime?.approval ? { approvalPolicy: runtime.approval } : {}),
    personality: "pragmatic",
  });
  const threadId = String(created?.thread?.id ?? "");
  if (!threadId) throw new Error("无法创建 Codex 工作会话");
  await server.request("thread/name/set", { threadId, name: `语音委派·${title}`.slice(0, 40) }).catch(() => undefined);
  const started = await startTurnOnThread(threadId, inputText);
  return started;
}

/** 取消某条委派：尽力中断对应回合（语音侧已标记取消时不再回传结果）。 */
export async function cancelVoiceDelegation(active: { threadId: string; turnId: string }): Promise<void> {
  if (!active.threadId || !active.turnId) return;
  await server.request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId }).catch(() => undefined);
}

/**
 * 执行一条语音委派。
 * `onStarted` 在回合真正开跑后回调（可用于回传 thinking 进度 / 记录取消句柄）。
 */
export async function runVoiceDelegation(
  task: VoiceDelegationTask,
  onStarted?: (active: { threadId: string; turnId: string; worker: boolean }) => void,
): Promise<VoiceDelegationResult> {
  const objective = String(task.objective ?? "").trim();
  if (!objective) return { ok: false, output: "", error: "委派目标为空" };
  const prompt = taskPrompt(task);
  const origin = String(task.originThreadId ?? "");
  const timeout = Math.max(60_000, Math.min(MAX_TASK_MS, Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) + 60_000 : MAX_TASK_MS));
  try {
    let active: { threadId: string; turnId: string; worker: boolean } | null = null;
    // 优先当前会话（用户明确希望「调用 codex 会话」）；忙则开独立工作会话。
    if (origin) {
      try {
        const resumed: any = await server.request("thread/resume", { threadId: origin, excludeTurns: false });
        const thread = resumed?.thread;
        if (thread?.id && !threadBusy(thread)) {
          const started = await startTurnOnThread(String(thread.id), prompt);
          active = { ...started, worker: false };
        }
      } catch { /* 读不到当前会话 ⇒ 走工作会话 */ }
    }
    if (!active) {
      const started = await startWorkerThread(origin, prompt, objective.slice(0, 28));
      active = { ...started, worker: true };
    }
    onStarted?.(active);
    const turn = await waitForTurnCompletion(active.threadId, active.turnId, timeout);
    const output = brief(turnOutputText(turn) || "（任务已执行完，但没有留下文本产出；详情看 Codex 会话）");
    return { ok: true, output, threadId: active.threadId };
  } catch (error: any) {
    const timedOut = error?.code === TURN_WAIT_TIMEOUT_CODE;
    return {
      ok: false,
      output: "",
      error: timedOut ? "处理超时了（任务可能还在 Codex 会话里继续跑）" : String(error?.message ?? error),
    };
  }
}
