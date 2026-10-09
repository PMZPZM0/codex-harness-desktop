/**
 * 轮询板块的**挂载件**（null 渲染）：把主进程广播的轮询事件与引擎的工具项事件，写进本地任务表。
 *
 * ⛔ 为什么单独一个 null 组件：shell（AppView）只要加一行就能把整个板块挂起来，且
 *    「挂在哪、挂几次」一眼可见 —— 本模块订阅的是**模块级总线**，挂两次不会重复渲染
 *    （写入是幂等的），但会多一份订阅者与一次 IPC。与 `VoiceAnnounceBridge` 同一套做法。
 *
 * ⛔⛔ **会话闸**：`harness:event` / `codex:event` 都会广播到**所有窗口**（主窗口 + 独立会话弹窗），
 *    不比对 threadId 的话，另一个会话的轮询会出现在当前会话里 —— 正是语音播报那次踩过的坑。
 *
 * ⛔ turnId 由本窗口补：主进程只知道 threadId（引擎的 tool 调用里没有 turnId），
 *    而卡要挂在**某一回合**下 —— 这里用「当前在跑的回合，没有就用最后一个回合」。
 *
 * ── 两条来源（10-09 第二轮扩）─────────────────────────────────────────────────
 *   ① 主进程广播的 `poll` 事件（视频生成那类真轮询）—— 有对话流里的卡；
 *   ② 引擎的**工具项事件**（长命令 / 长耗时工具调用）—— 用户追加要求「也算一条后台任务」。
 *      ⛔ 这条只在胶囊里出现（`kind:"tool"`）：流里它已经有自己的工具卡，再画一张就是
 *        同一件事两个地方看。判定门槛见 `SLOW_TOOL_MS`（不到阈值不登记，免得给每个
 *        `read` / `ls` 都挂个转圈）。
 */
import { useEffect, useRef } from "react";
import {
  abortPollTask, backfillPollTurn, beginToolWatch, endToolWatch, endToolWatchesOfTurn,
  hydratePollConfig, openPollTask, pushPollRound, setPollConfig, setToolAbortHandler, settlePollTask,
} from "../../polling/poll-store";
import type { PollStatus } from "../../polling/poll-store";

const SETTLEABLE: PollStatus[] = ["success", "failed", "timeout", "aborted"];

/** 算「长」的工具项类型（与 `SessionTurn` 的 workItemTypes 同口径，不含 reasoning/agentMessage）。 */
const WORK_ITEM_TYPES = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall",
  "webSearch", "collabAgentToolCall", "subAgentActivity", "imageGeneration",
]);

/** 胶囊那一行显示什么（够认出来是哪件事即可；详情看对话里那张工具卡）。 */
function titleOfItem(item: any): string {
  const type = String(item?.type ?? "");
  if (type === "commandExecution") return `命令 · ${String(item?.command ?? "").trim().slice(0, 60)}`;
  if (type === "mcpToolCall") return `${String(item?.server ?? "工具")} / ${String(item?.tool ?? "")}`;
  if (type === "dynamicToolCall") return String(item?.tool ?? "工具调用");
  if (type === "webSearch") return "联网搜索";
  if (type === "imageGeneration") return "图片生成";
  if (type === "fileChange") return "文件改动";
  return "工具调用";
}

export function PollBridge({ threadId = "", turnId = "", onAbortTool }: {
  threadId?: string; turnId?: string; onAbortTool?: () => void;
}): null {
  /** 「中止」回调放 ref：它每次渲染都是新函数，直接进 effect deps 会让订阅反复重建。
   *  ⛔ 只在 effect 里同步（不在渲染期赋值）——渲染期写 ref 在并发渲染下不可靠。
   *    初值由 `useRef(onAbortTool)` 给出 ⇒ 首次点击读到的就是当前那个，不会有一帧的滞后。 */
  const abortRef = useRef(onAbortTool);
  useEffect(() => { abortRef.current = onAbortTool; });

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

  // 「中止」出口：长命令的中止 = **打断当前回合**（命令是引擎在跑，宿主只能 interrupt），
  // 而 interrupt 在 app-state 的 bag 上 —— 模块级 store 拿不到，由本组件注册回调进去。
  // ⛔ 轮询任务（视频）不走这里：它有 `poll:abort` 通道，能真正停掉主进程那个等待循环。
  useEffect(() => {
    setToolAbortHandler(() => { abortRef.current?.(); });
    return () => setToolAbortHandler(null);
  }, []);

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

  /* ── 长命令 / 长耗时工具调用（10-09 第二轮）────────────────────────────────────
     ⛔ 为什么监听 `onEvent`（引擎事件）而不是再加一条 harness:event：工具项本来就在引擎事件流里，
        再加一条广播通道 = 主进程多一处发射点、多一处会漏的地方（本项目记过的「二房东」缺陷）。
     ⛔ 判据用 `item/started` + `item/completed` 配对：前者开始计时（可能到最后都不登记），
        后者收尾（没到阈值就是 no-op）。`turn/completed` 兜底收掉本回合的残余（被打断的回合
        可能永远收不到 completed）。 */
  useEffect(() => {
    if (!threadId) return;
    const off = window.codex.onEvent((event: any) => {
      if (event?.kind !== "notification") return;
      const params = event?.params ?? {};
      if (String(params.threadId ?? "") !== threadId) return;
      const method = String(event?.method ?? "");
      if (method === "turn/completed") { endToolWatchesOfTurn(String(params.turnId ?? "")); return; }
      const item = params.item;
      if (!item || !WORK_ITEM_TYPES.has(String(item.type ?? ""))) return;
      const id = String(item.id ?? params.itemId ?? "");
      if (!id) return;
      if (method === "item/started") {
        beginToolWatch({ id, threadId, turnId: String(params.turnId ?? ""), title: titleOfItem(item) });
      } else if (method === "item/completed") {
        endToolWatch(id, { failed: String(item.status ?? "") === "failed" || Boolean(item.error) });
      }
    });
    return () => { off?.(); };
  }, [threadId]);

  return null;
}
