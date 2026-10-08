/**
 * engine-bridge —— 把**引擎事件**翻译成播报事件（10-08 新增板块的内部件）。
 *
 * 为什么要单独一层（而不是让基座的 `announce-bus` 直接认引擎事件形态）：
 *   `src/voice/announce-bus.ts` 是**基座**、只负责 pub/sub；「引擎事件长什么样」属于域知识，
 *   放这里才能让「事件形态变了只改一处」。同款分层的既有样板：`voice-notice.ts`（文案）
 *   与 `wave-level.ts`（广播）分成两个文件。
 *
 * ⛔ 只有**当前会话**会被转发：后台会话（团队成员 / 被调度的子会话）的输出不该被念出来
 *   —— 这与「侧边栏转圈要跟真正在跑的会话」是同一类归属问题。
 * ⛔ `aborted` 判据与主进程 voice-service 完全一致（看 `turn.status`，不是看有没有 items）：
 *   `turn/interrupt` 之后引擎回的也是 `turn/completed`，只看方法名会把「打断」当正常结束。
 */
import { announceListenerCount, publishAnnounceEvent } from "../../voice/announce-bus";

/** 从 turn/completed 的 params 里取「最终回复原文」（与主进程同一口径：取最后一条 agentMessage）。 */
export function finalAgentText(params: any): string {
  const items = Array.isArray(params?.turn?.items) ? params.turn.items : [];
  const last = [...items].reverse().find((item: any) => item?.type === "agentMessage");
  return String(last?.text ?? "");
}

/**
 * 事件路由的接缝。`activeThreadId` = 当前正在看的会话 id（由调用方从自己的 ref 现取）。
 *
 * ⛔ 没人订阅时直接返回：这是**流式热路径**（每个 delta 都会走到），不能白付字符串处理。
 */
export function publishEngineAnnounce(method: string, params: any, activeThreadId: string): void {
  if (!announceListenerCount()) return;
  const threadId = String(params?.threadId ?? "");
  const current = String(activeThreadId ?? "");
  if (!threadId || !current || threadId !== current) return;

  if (method === "item/agentMessage/delta") {
    const text = String(params?.delta ?? "");
    if (text) publishAnnounceEvent({ type: "delta", threadId, text });
    return;
  }
  if (method === "turn/completed") {
    const status = String(params?.turn?.status ?? "");
    publishAnnounceEvent({
      type: "turnDone",
      threadId,
      text: finalAgentText(params),
      aborted: status === "interrupted" || status === "failed",
    });
  }
}
