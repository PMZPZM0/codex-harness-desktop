/**
 * 团队模式 · 成员会话的排队消息（11-08 用户令：「排队消息，插队消息，看看跟主对话框还差哪些，没同步过来，都完成一下」）
 *
 * 载体是**引擎自己的队列**（`thread/queue/*`），⛔ 不另造一套宿主机队列：
 *   · 每个伙伴各跑各的子会话，引擎队列天然按 threadId 分开；
 *   · 「回合结束后自动消费」是引擎的行为，宿主不用写调度；
 *   · 主对话那边也是这条路（`bag.refreshQueue` / `startQueued`），两处口径一致。
 *
 * 「立即」（插队）为什么必须走主进程：`turn/steer` 需要 `expectedTurnId`，
 * 而活动回合表的**唯一真相**在主进程（`engineActiveTurnIds`：turnId → threadId）。
 * 让渲染层自己拼，就只能靠 `thread/read` 猜最后一个 turn，猜错就是「no active turn to steer」。
 * ⛔ 所以这里只暴露一个动作：能插队就插队（并把队列里那条删掉，否则回合结束会再执行一遍），
 *    插不了（回合刚好结束）就退回 `thread/queue/start`。
 */
import { engineActiveTurnIds, server } from "../runtime-refs";

export type TeamQueueStartInput = {
  threadId?: string;
  queuedSubmissionId?: string;
};

export type TeamQueueStartResult = {
  ok: boolean;
  /** steer = 已并入正在跑的回合；start = 作为新回合启动 */
  mode?: "steer" | "start";
  error?: string;
  reason?: "idle" | "engine" | "input";
};

/** 从引擎队列条目里取正文（input 是 part 数组，只认 text 段）。 */
function textOfItem(item: unknown): string {
  const parts = (item as { input?: unknown } | null)?.input;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function activeTurnOf(threadId: string): string {
  for (const [turnId, owner] of engineActiveTurnIds) if (owner === threadId) return turnId;
  return "";
}

/** 启动一条团聊排队条目：先把队列里的正文原样读出来（steer 只送文本），再交给引擎。 */
export async function startTeamQueued(input: TeamQueueStartInput): Promise<TeamQueueStartResult> {
  const threadId = String(input?.threadId ?? "").trim();
  const queuedId = String(input?.queuedSubmissionId ?? "").trim();
  if (!threadId || !queuedId) return { ok: false, error: "缺会话或排队条目 id", reason: "input" };

  /* 先读队列那条的正文：steer 只送文本，队列条目必须原样读出来 */
  let text = "";
  try {
    const list = (await server.request("thread/queue/list", { threadId, limit: 50 })) as { data?: unknown[] } | null;
    const item = (list?.data ?? []).find((entry) => String((entry as { id?: unknown })?.id ?? "") === queuedId);
    text = textOfItem(item);
  } catch { /* 读不到就退回「按新回合启动」，start 不依赖正文 */ }

  const turnId = activeTurnOf(threadId);
  if (turnId && text) {
    try {
      await server.request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text, text_elements: [] }],
      });
      /* ⛔ 并入成功必须把队列里那条删掉：不删的话当前回合结束引擎会把同一条再跑一遍。 */
      await server.request("thread/queue/delete", { threadId, queuedSubmissionId: queuedId }).catch(() => undefined);
      return { ok: true, mode: "steer" };
    } catch { /* 回合刚好结束 / 引擎拒收 ⇒ 落到下面的按新回合启动 */ }
  }

  try {
    await server.request("thread/queue/start", { threadId, queuedSubmissionId: queuedId });
    return { ok: true, mode: "start" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), reason: "engine" };
  }
}
