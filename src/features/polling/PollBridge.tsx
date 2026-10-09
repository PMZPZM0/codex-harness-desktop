/**
 * 轮询板块的**挂载件**（null 渲染）：把主进程广播的轮询事件写进本地任务表。
 *
 * ⛔ 为什么单独一个 null 组件：shell（AppView）只要加一行就能把整个板块挂起来，且
 *    「挂在哪、挂几次」一眼可见 —— 本模块订阅的是**模块级总线**，挂两次不会重复渲染
 *    （写入是幂等的），但会多一份订阅者与一次 IPC。与 `VoiceAnnounceBridge` 同一套做法。
 *
 * ⛔⛔ **会话闸**：`harness:event` 广播到**所有窗口**（主窗口 + 独立会话弹窗），不比对
 *    threadId 的话，另一个会话的轮询会出现在当前会话里 —— 正是语音播报那次踩过的坑。
 *
 * ⛔ turnId 由本窗口补：主进程只知道 threadId（引擎的 tool 调用里没有 turnId），
 *    而卡要挂在**某一回合**下 —— 这里用「当前在跑的回合，没有就用最后一个回合」。
 */
import { useEffect } from "react";
import { abortPollTask, backfillPollTurn, hydratePollConfig, openPollTask, pushPollRound, setPollConfig, settlePollTask } from "../../polling/poll-store";
import type { PollStatus } from "../../polling/poll-store";

const SETTLEABLE: PollStatus[] = ["success", "failed", "timeout", "aborted"];

export function PollBridge({ threadId = "", turnId = "" }: { threadId?: string; turnId?: string }): null {
  // 配置：先读本地镜像（立刻可用），再用主进程的真相源覆盖（另一窗口改过的情况）
  useEffect(() => {
    hydratePollConfig();
    void window.codex.pollConfigRead().then((next) => { if (next && Number(next.intervalMs) > 0) setPollConfig(next); }).catch(() => undefined);
  }, []);

  // 回合 id 一变就把「本会话里还没归属回合的任务」补挂上去（⛔ 少了这张卡就永远不显示 ——
  // 主进程广播时只有 threadId，turnId 是本窗口才知道的）
  useEffect(() => {
    if (threadId && turnId) backfillPollTurn(threadId, turnId);
  }, [threadId, turnId]);

  useEffect(() => {
    const off = window.codex.onHarnessEvent((payload: any) => {
      if (!payload || payload.type !== "poll") return;
      const target = String(payload.threadId ?? "");
      if (threadId && target && target !== threadId) return;   // 会话闸（同上）
      const taskId = String(payload.taskId ?? "").trim();
      if (!taskId) return;
      // 先补挂一次：任务可能是"迟到的 round"现场建出来的（那时还没有 turnId），
      // 而 backfill 的 effect 只在 turnId **变化时**跑 —— 不在这里补一次它就永远没有回合归属。
      if (threadId && turnId) backfillPollTurn(threadId, turnId);
      const action = String(payload.action ?? "");
      if (action === "start") {
        openPollTask({
          id: taskId,
          threadId: target || threadId,
          turnId,
          title: String(payload.title ?? "").trim() || "后台任务",
          detail: String(payload.detail ?? "").trim(),
          intervalMs: Number(payload.intervalMs) || undefined,
          timeoutMs: Number(payload.timeoutMs) || undefined,
          maxRetry: Number(payload.maxRetry) || undefined,
          managed: payload.managed !== false,
        });
        return;
      }
      if (action === "round") {
        pushPollRound(taskId, {
          ok: payload.ok !== false && !payload.error,
          summary: payload.summary ? String(payload.summary) : undefined,
          progress: payload.progress ? String(payload.progress) : undefined,
          error: payload.error ? String(payload.error) : undefined,
        });
        return;
      }
      if (action === "end") {
        const status = SETTLEABLE.includes(payload.status) ? payload.status : "failed";
        settlePollTask(taskId, {
          status,
          result: payload.result ? String(payload.result) : undefined,
          error: payload.error ? String(payload.error) : undefined,
        });
        return;
      }
      if (action === "aborted") abortPollTask(taskId);
    });
    return () => { off?.(); };
  }, [threadId, turnId]);

  return null;
}
