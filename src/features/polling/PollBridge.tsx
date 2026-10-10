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
 *
 * ── 两个出口（都走 ref，回调每次渲染都是新函数）─────────────────────────────────
 *   · `onAbortTool`    —— 胶囊上的「中止」（长命令只能打断当前回合）；
 *   · `onPollSettled`  —— 轮询**成功**拿到结果时通知上层。⛔ 本组件**不判**要不要自动续跑
 *     （那是上层 `maybeAutoContinueAfterPoll` 的事：是不是当前会话 / 空闲否 / 额度剩不剩）。
 */
import { useEffect, useRef } from "react";
import {
  abortPollTask, backfillPollTurn, beginToolWatch, endToolWatch, endToolWatchesOfTurn, getPollTask,
  hydratePollConfig, openPollTask, pushPollRound, setPollConfig, setToolAbortHandler, settlePollTask,
} from "../../polling/poll-store";
import type { PollStatus, PollTask } from "../../polling/poll-store";

const SETTLEABLE: PollStatus[] = ["success", "failed", "timeout", "aborted"];

/** 算「长」的工具项类型（与 `SessionTurn` 的 workItemTypes 同口径，不含 reasoning/agentMessage）。 */
const WORK_ITEM_TYPES = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall",
  "webSearch", "collabAgentToolCall", "subAgentActivity", "imageGeneration",
]);

/** 引擎的**回合结束**事件（四类，按结束原因分别投递，见 app-state 的事件路由 03-thread-id.tsx）。
 *  ⛔ 只认 `turn/completed` 会让「被中断 / 失败 / 中止」的回合留下**永远在跑**的幽灵 watch
 *    —— 那些回合里命令的 `item/completed` 可能永远不来，而长命令任务**没有超时兜底**。 */
const TURN_END_METHODS = new Set(["turn/completed", "turn/aborted", "turn/failed", "turn/interrupted"]);

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

export function PollBridge({ threadId = "", turnId = "", onAbortTool, onPollSettled }: {
  threadId?: string; turnId?: string; onAbortTool?: () => void; onPollSettled?: (task: PollTask) => void;
}): null {
  /** 「中止」回调放 ref：它每次渲染都是新函数，直接进 effect deps 会让订阅反复重建。
   *  ⛔ 只在 effect 里同步（不在渲染期赋值）——渲染期写 ref 在并发渲染下不可靠。
   *    初值由 `useRef(onAbortTool)` 给出 ⇒ 首次点击读到的就是当前那个，不会有一帧的滞后。 */
  const abortRef = useRef(onAbortTool);
  useEffect(() => { abortRef.current = onAbortTool; });
  /** 同上：轮询**成功终结**时的回调（上层据此决定要不要自动续跑 —— 见 `onPollSettled`）。 */
  const settledRef = useRef(onPollSettled);
  useEffect(() => { settledRef.current = onPollSettled; });

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
        /* ★ 只在**轮询成功**时通知上层（10-10 用户要求「回合结束后轮询还在、返回结果了要自动继续」）：
           失败/超时/中止没有可继续的结果；渲染层看门狗判的超时走不到这里（那是本地 settle）。
           ⛔ 只**通知**，不在这里决定要不要续跑 —— 判据（是不是当前会话、空闲否、额度剩不剩）
              全在上层（`maybeAutoContinueAfterPoll`），本组件只负责"结果到了"这一个事实。 */
        if (status === "success") {
          const settled = getPollTask(taskId);
          if (settled) settledRef.current?.(settled);
        }
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
        后者收尾（没到阈值就是 no-op）。**回合结束事件**（四类，见 `TURN_END_METHODS`）兜底收掉
        本回合的残余 —— 被打断 / 失败的回合可能永远收不到 completed，而长命令**没有超时兜底**
        （见 poll-store 的 tickWatchdog），所以这里是唯一的收尾通道。 */
  useEffect(() => {
    if (!threadId) return;
    const off = window.codex.onEvent((event: any) => {
      if (event?.kind !== "notification") return;
      const params = event?.params ?? {};
      if (String(params.threadId ?? "") !== threadId) return;
      const method = String(event?.method ?? "");
      /* ⛔⛔ 2026-10-10 修「命令没有回传结果，就一直挂着」（用户反馈）：两个 bug 叠在一起 ——
         ① **回合 id 取错字段**：turn 类事件的回合 id 在 `params.turn.id`，**不在** `params.turnId`
            （`params.turnId` 是 item 类事件的字段 —— 见 app-view/helpers/stream.ts 的
            applyThreadEvent：`turn/*` 取 `params.turn`、`item/*` 取 `params.turnId`；事件路由也按
            `params.turn?.id ?? params.turnId` 取）。旧写法 `String(params.turnId ?? "")` 对
            turn/completed **恒为空串** ⇒ `endToolWatchesOfTurn("")` 里 `if (!turn) return` 直接返回
            ⇒ **这条兜底从上线起从未生效过**。
         ② **只认 turn/completed**：`turn/aborted` / `turn/failed` / `turn/interrupted` 三种收尾全漏
            （事件路由 03-thread-id.tsx 三处都处理了）。被中断 / 失败的回合里，命令的 `item/completed`
            可能永远不来 ⇒ 既没有 item/completed、又没有兜底 ⇒ **永久挂在胶囊里**。
         ⛔ 顺带把 threadId 传下去作二级兜底（watch 的 turnId 缺省时按会话收）。 */
      if (TURN_END_METHODS.has(method)) {
        endToolWatchesOfTurn(String(params.turn?.id ?? params.turnId ?? ""), String(params.threadId ?? ""));
        return;
      }
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
