/**
 * delegate-settle —— 被委派 / 团队成员会话的**回合真正结束**时收敛登记（10-10）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────────────
 * 用户令「委派超时不判失败，转后台等」之后，`delegation` / `teams-ipc` 在等待到点时
 * **不再**标 failed（那条记录保持 running）—— 但引擎里那个回合并没有停，它迟早会结束。
 * 而"把记录标成终态"这件事原先**只有** delegation / teams-ipc 的 await 路径会做
 * ⇒ 一旦宿主提前放手，记录就永远停在 running（下次启动的自愈会把它当"应用重启中断"
 * 标成 failed，比放着不管更糟）。
 * ⇒ 必须有一个**独立于 await** 的收敛点 —— 就是这里，挂在 boot 的引擎事件流上。
 *
 * ⛔ 幂等且不抢跑：只在登记表 / 运行表**仍认为它是 running** 时动手
 *   （正常路径早已 markStatus ⇒ activeThreads 已清 ⇒ 这里直接跳过，不重复广播）。
 * ⛔ 四类结束事件都要认（completed / aborted / failed / interrupted）—— 与
 *   `waitForTurnCompletion` 同口径；漏一个就漏一种收尾（同型缺陷本月已踩过三次）。
 */
import { broadcastHarnessEvent } from "./features/window-bus";
import { turnOutputText } from "./main/03-turn-summary";
import { delegateRegistry, teamRunStore } from "./runtime-refs";

const TURN_END_METHODS = new Set(["turn/completed", "turn/aborted", "turn/failed", "turn/interrupted"]);

/** 引擎事件 → 收敛后台运行。返回 true = 这次事件确实收敛了某条（委派 / 团队）运行。 */
export function settleBackgroundRunsOnTurnEnd(event: any): boolean {
  if (!event || event.kind !== "notification") return false;
  const method = String(event.method ?? "");
  if (!TURN_END_METHODS.has(method)) return false;
  const threadId = String(event.params?.threadId ?? "");
  if (!threadId) return false;
  const ok = method === "turn/completed";
  const text = turnOutputText(event.params?.turn);
  const error = ok ? undefined : `回合未正常结束（${method}）`;
  let settled = false;

  /* ① 被委派会话（子智能体 / 专家 / 专家团主理人的直达会话） */
  if (delegateRegistry.isRunningThread(threadId)) {
    settled = true;
    void delegateRegistry.setOutput(threadId, text).catch(() => undefined);
    void delegateRegistry.markStatus(threadId, ok ? "done" : "failed", error ? { error } : {}).catch(() => undefined);
    broadcastHarnessEvent({ type: "delegates-changed", threadId } as any);
    broadcastHarnessEvent({
      type: "delegate-run", phase: "finished", threadId,
      status: ok ? "done" : "failed", output: text, ...(error ? { error } : {}), at: Date.now(),
    } as any);
  }
  /* ② 专家团成员会话（状态与广播由 TeamRunStore 负责） */
  if (teamRunStore.activeRunOfThread(threadId)) {
    settled = true;
    teamRunStore.settleRunByThread(threadId, { status: ok ? "done" : "failed", output: text, ...(error ? { error } : {}) });
  }
  return settled;
}
