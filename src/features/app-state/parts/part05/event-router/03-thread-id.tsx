/**
 * handleEventRouter3 —— 01-seg 里那条事件总路由的第 3 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { isRateLimitError, rateLimitBackoffMs, RATE_LIMIT_MAX_ATTEMPTS } from "../../../../../lib/rate-limit-retry";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../../components/scroll-utils";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function handleEventRouter3(bag: Bag, event: any, params: any): boolean {
        const method0 = event.method ?? "";
        // ⛔⛔ 09-19 用户实测「消息回完了，右下角停止键还亮着」（截图）：引擎/桥可能把
        //   `turn/started` 在这条回合的 `turn/completed` **之后**才投递（乱序/重复投递）。
        //   那样 setSending(true)/markThreadRunning 会在收尾**之后**把「运行中」重新点亮，
        //   而这条回合的结束事件已经用掉了、再没有任何东西来熄灭它 ⇒ 停止键永久亮着。
        //   不变量：**已结束的回合不得再被 turn/started 点亮**（不管它在哪个分支处理）。
        //   结束的回合 id 统一登记在 finishedTurnIdsRef（completed/aborted/failed/interrupted
        //   四类事件都会登记），这里与下面的当前会话分支共用同一份判定。
        const startedTurnId = String(params.turn?.id ?? params.turnId ?? "");
        const startedAlreadyDone = Boolean(startedTurnId) && bag.finishedTurnIdsRef.current.has(startedTurnId);
        if (method0 === "turn/started") {
          if (!startedAlreadyDone) bag.markThreadRunning(params.threadId, startedTurnId || undefined);
          // ⛔⛔ 09-19 用户实测「已经开始运行了，重试弹窗没消失，还在一直发」：
          //   该会话**已经跑起来了**（新回合开始）就说明上游缓过来了 / 用户自己重发了 ——
          //   此时必须**立刻取消它的重试链**，而不是把 10 次退避发完（那会重复投递同一条输入，
          //   把正在跑的会话打断/搞乱）。这正是"会话已恢复却还挂着重试条"的直接原因。
          if (bag.retryContextsRef.current.has(params.threadId)) {
            bag.cancelRateLimitRetry(params.threadId, true);
            bag.setRetryEntry(params.threadId, null);
          }
          // 引擎重连提示同理：已经跑起来了 → 上游通了，提示立刻消失
          bag.setUpstreamRetries((current) => {
            if (!(params.threadId in current)) return current;
            const next = { ...current };
            delete next[params.threadId];
            return next;
          });
        } else if (method0 === "turn/completed") {
          if (startedTurnId) bag.rememberFinishedTurn(startedTurnId);
          // 正常收尾（无 error）＝ 不需要重试了 → 立刻取消该会话的重试链与重试条
          if (!params.turn?.error?.message && bag.retryContextsRef.current.has(params.threadId)) {
            bag.cancelRateLimitRetry(params.threadId, true);
            bag.setRetryEntry(params.threadId, null);
          }
          bag.setUpstreamRetries((current) => {
            if (!(params.threadId in current)) return current;
            const next = { ...current };
            delete next[params.threadId];
            return next;
          });
          // ⛔⛔ 429 兜底重试的**检测点必须在这里**（跨会话区、threadId 过滤之前）：
          //   09-19 用户实测「多会话同时跑，只有当前看的那个会话会自动重试，后台的会话直接断」——
          //   旧检测点在当前会话事件流里，后台会话的 turn/completed(429) 根本走不到那段代码。
          //   判据用**该会话自己的**重试上下文（per-thread），不再要求它是当前会话。
          if (params.turn?.error?.message && isRateLimitError(params.turn.error.message)
            && bag.ensureRateLimitCtx(params.threadId, params.turn)) {
            bag.scheduleRateLimitRetry(params.threadId, (bag.rateLimitAttemptsRef.current.get(params.threadId) ?? 0) + 1);
            // 不 return：下面的常规收尾（标停/绿点/缓存合并/侧栏刷新）与重试链并不冲突，
            // 保持与旧行为一致（旧实现里 429 回合也是先收尾、再排重试）。
          }
          // 回合顺利收尾 → 会话状态向好（语气随之轻快）；失败/中断在下面的分支里把状态压低。
          // 位置刻意放在**跨会话**这一段：后台会话跑完也要记进它自己的状态（各自独立）。
          bag.bumpMood(params.threadId, "turn-ok");
          bag.markThreadStopped(params.threadId);
          // ⛔⛔ 09-19 用户实测「消息发出去立马切走 → 显示绿点 → 切回来 agent 回复没了」：
          //   根因是**后台会话的回复内容从来不落缓存** —— 落缓存的两条链路（流式 delta 的
          //   applyThreadEvent + turn/completed 的 mergeTurn）都在下面 threadId 过滤**之后**，
          //   切走期间该会话的 delta/completed 全被 `params.threadId !== threadRef.current?.id
          //   → return` 拦掉，threadCacheRef 里只剩切走那一刻的半截内容。
          //   而 openThread 有一条快速路径：「30 秒内刚完整 resume 过且不在运行 → 跳过 resume，
          //   直接用缓存」（频繁切换防卡顿）。用户「发出去就切走、马上切回」正好同时命中：
          //   **缓存没回复 + 不 resume ⇒ 回复永久缺失**（本人第一次复现没抓到，就是因为等 60 秒
          //   才切回，越过了 30 秒窗口）。
          //   修法：把「完成的回合落缓存」提到**跨会话区**（过滤之前）——引擎的 turn/completed
          //   事件自带完整 turn，纯前端合并、零 RPC。只写缓存**不动视图**（threadRef/setThread
          //   仍归当前会话那条链路），后台跑完的会话切回来即可命中完整缓存。
          // ⛔⛔ 09-19 用户实测「一个用户消息下面挂了两条回复 / 回复重复」（截图）：
          //   第一版无条件 `mergeTurn(cachedBg, params.turn)` —— 缓存里**还没有这一轮**时，
          //   mergeTurn 会把事件里的回合**当成新回合追加**，而引擎在 turn/completed 里给的是
          //   **产出条目**、不保证带 userMessage ⇒ 渲染出「没有用户消息的孤儿回复」，看起来
          //   就是上一轮多了一条回复。规则收死：
          //     · 缓存里**已有**这一轮 → 合并（按 id 合并会保住缓存里已有的用户消息）✅
          //     · 缓存里**没有**这一轮 → **不造半截回合**，改为登记「需要完整重载」，
          //       由 openThread 走 resume 拿完整回合（见 needsFullReloadRef 与跳过 resume 的判定）。
          if (params.threadId && params.threadId !== bag.threadRef.current?.id && params.turn?.id) {
            const tidBg = params.threadId;
            const cachedBg = bag.threadCacheRef.current.get(tidBg);
            const hasTurn = Boolean(cachedBg?.turns?.some((turn) => turn.id === params.turn.id));
            if (cachedBg && hasTurn) {
              const mergedBg = mergeTurn(cachedBg, params.turn);
              if (mergedBg && mergedBg !== cachedBg) bag.threadCacheRef.current.set(tidBg, mergedBg);
            } else if (cachedBg) {
              // 缓存缺这一轮（发出去就切走，连用户消息都还没落进缓存）：标记必须完整重载，
              // 否则切回时命中「跳过 resume」快速路径 → 拿到缺用户消息的半截回合。
              bag.needsFullReloadRef.current.add(tidBg);
            }
          }
          // ⛔ 09-20 用户定稿：「运行中的话就钉顶，运行完成就不要钉」。
          //   落实为**回合结束即脱钉**：① 解除锚定；② 留白归零；③ 贴底回到内容末尾
          //   （这样结束后下方不留空白、最新内容仍在视野里）。
          //   口径演变（别改回去）：
          //     · 09-13：无条件清留白 → 用户「流动空间太大，汇总时上面消息都看不到」；
          //     · 09-18：改成「钉顶仍生效就保留」→ 完成后下方残留一大片空白（09-20 中午截图）；
          //     · 09-20：**完成即脱钉**（用户明确要求）。本质是二选一 —— 留白量 N 与
          //       「滚到底时内容底部到视口底部的距离」严格 1:1，留着 N 就有 N 的空白，
          //       用户选「不要空白」，代价是完成后消息不再停在顶部。
          //   ⚠️ 仍限定**当前会话**（09-13 审计）：留白是当前会话的几何依赖，
          //      后台会话跑完顺手清当前会话的留白会让被 clamp 的 scrollTop 掉下来 → 画面无故跳。
          if (params.threadId === bag.threadRef.current?.id) {
            if (bag.anchorTopRef.current) {
              bag.anchorTopRef.current = false;
              bag.pinGapLockedRef.current = null;
              bag.pinThreadIdRef.current = null;
              bag.stickToBottomRef.current = true;
              const scroller = bag.scrollRef.current;
              if (scroller) {
                bag.selfScrollUntilRef.current = Date.now() + 80;
                scrollToOffsetInstant(scroller, bag.contentTailTarget(scroller));
                bag.pinnedScrollTopRef.current = scroller.scrollTop;
              }
            }
            bag.clearAnchorPad();
          }
          // 侧栏绿点：非当前会话跑完 → 点亮，点击进入清除。⛔ 必须在**跨会话生命周期区**
          // （这里 + 下面的 aborted/failed 分支）：下面的当前会话事件流有 threadId 过滤，
          // 后台会话的完成事件走不到——第一版挂在那边，真机验收当场红（绿点永不出现）。
          if (!params.threadId || params.threadId !== bag.threadRef.current?.id) bag.markThreadDoneUnread(params.threadId);
        } else if (method0 === "thread/status/changed") {
          // ⛔ 引擎的 `thread.status` 是**对象** `{type:"notLoaded"|"idle"|"systemError"|"active", activeFlags}`
          // （只有 TurnStatus 才是字符串，见 .workbuddy/codex-schema/*.schemas.json）。
          // 早期这里按字符串比较 → 对象恒不等于 "inProgress"/"running" ⇒ **永远走 markThreadStopped、
          // 永远不可能 markThreadRunning**：在跑会话收到 status/changed（引擎等审批/等输入时会推
          // {type:"active",activeFlags:[...]}）就当场被判成已停止 → 后台会话侧栏转圈中途消失、
          // 切回或渲染层重载后真正的运行回合被归一化成 completed（停止键消失、后续消息绕过排队）。
          const statusType = (params.status as any)?.type ?? params.status;
          bag.setThreads((current) => current.map((entry) => entry.id === params.threadId ? { ...entry, status: statusType } : entry));
          if (statusType === "active") bag.markThreadRunning(params.threadId);
          // 线程被卸载 / 引擎侧报错 ⇒ 引擎里不可能还有它的回合，清（这是**结构性**事实）
          else if (statusType === "notLoaded" || statusType === "systemError") bag.markThreadStopped(params.threadId);
          // ⛔ `idle` 绝不无条件熄灭（09-19 用户：「运行状态莫名其妙停止」的真根因之一）：
          //   `thread/status/changed` 是**快照式**信号 —— resume 回包、回合间隙、引擎重连、
          //   切会话重建状态时都会发一条 idle。旧写法 `else markThreadStopped(...)` 拿它把一个
          //   由 `turn/started` 点亮的运行态直接抹掉 ⇒ 界面停止键消失、侧栏转圈消失 ⇒ 用户以为
          //   任务停了；更糟的是**下一条消息会因此走 `turn/start`**，而引擎侧那个回合还在跑，
          //   turn/start 会把它打断 ⇒ 用户看到的就是「切会话/开关独立窗口，正在跑的任务自己断了」。
          //   现在改为：只有与**引擎侧真相**核对确认该会话没有活动回合，才熄灭。
          else if (statusType === "idle") {
            const verifyId = String(params.threadId ?? "");
            if (verifyId) void window.codex.engineActiveTurns().then((info) => {
              if (!(info?.threadIds ?? []).map(String).includes(verifyId)) bag.markThreadStopped(verifyId);
            }).catch(() => undefined);
          }
        } else if (method0 === "turn/aborted" || method0 === "turn/failed" || method0 === "turn/interrupted") {
          // 失败/中断/被中止 → 会话状态转差（语气收紧）。连续失败会累积（见 agent-mood 的连败惩罚）。
          bag.bumpMood(params.threadId, "turn-fail");
          bag.rememberFinishedTurn(String(params.turn?.id ?? params.turnId ?? ""));   // 同上：结束后不许再被 start 点亮
          // 429 也可能以 aborted/failed 的形态结束（引擎重试耗尽）→ 同样要排该会话的重试
          if (params.turn?.error?.message && isRateLimitError(params.turn.error.message)
            && bag.ensureRateLimitCtx(params.threadId, params.turn)) {
            bag.scheduleRateLimitRetry(params.threadId, (bag.rateLimitAttemptsRef.current.get(params.threadId) ?? 0) + 1);
          }
          // 回合级**权威**结束信号：被中断 / 失败 / 中止的回合也要熄灭指示器。
          // （原先只认 turn/completed ⇒ 被中断的回合转圈永远挂着，用户以为还在跑。）
          bag.markThreadStopped(params.threadId);
          // 侧栏绿点（失败/中止也算「运行结束了」，用户要知道）：非当前会话才点亮。
          // ⛔ 必须放在**跨会话生命周期区**（这里）：下面的当前会话事件流有 threadId 过滤
          //   （`params.threadId !== threadRef.current?.id → return`），后台会话的完成事件
          //   走不到那里 —— 第一版把点亮挂在那边，真机验收当场红（绿点永不出现）。
          if (!params.threadId || params.threadId !== bag.threadRef.current?.id) bag.markThreadDoneUnread(params.threadId);
          // 失败/被中断的回合也要落缓存（同 turn/completed 的修复）：部分回复同样是用户的
          // 可见内容，切走期间同样拿不到流式事件 —— 不落缓存则切回即丢。
          // ⛔ 与 turn/completed 同一条规则：**只有缓存里已有该回合时才合并**；缓存缺这一轮就
          //   登记「必须完整重载」，绝不把只有产出条目的半截回合追加成孤儿（会渲染成"多出来
          //   一条没有用户消息的回复"）。
          if (params.threadId && params.threadId !== bag.threadRef.current?.id && params.turn?.id) {
            const tidFail = params.threadId;
            const cachedFail = bag.threadCacheRef.current.get(tidFail);
            const hasTurnFail = Boolean(cachedFail?.turns?.some((turn) => turn.id === params.turn.id));
            if (cachedFail && hasTurnFail) {
              const mergedFail = mergeTurn(cachedFail, params.turn);
              if (mergedFail && mergedFail !== cachedFail) bag.threadCacheRef.current.set(tidFail, mergedFail);
            } else if (cachedFail) {
              bag.needsFullReloadRef.current.add(tidFail);
            }
          }
        } else if (method0 === "error") {
          // ⛔ engine 的 error 通知同样是**限流**的常见形态（引擎 RPC/流直接报错），
          //   而且后台会话的 error 事件也被 threadId 过滤挡掉 —— 所以排重试也要放在这里。
          // ⛔ 判定必须把 additionalDetails 一起看：引擎常把真因（httpStatusCode 429）
          //   放在 details 里，message 只有 `Reconnecting... 10/10`（不含 429 字样）。
          const errMsg0 = [
            String((params.error as any)?.message ?? params.message ?? ""),
            String((params.error as any)?.additionalDetails ?? params.additionalDetails ?? ""),
          ].join(" ");
          if (errMsg0 && isRateLimitError(errMsg0) && bag.ensureRateLimitCtx(params.threadId, params.turn ?? null)) {
            bag.scheduleRateLimitRetry(params.threadId, (bag.rateLimitAttemptsRef.current.get(params.threadId) ?? 0) + 1);
          }
        }
        // 渠道机器人等后台会话的 start/stop：走不到下面的当前会话事件流（threadId 过滤会拦掉），
        // 新建的机器人会话永远进不了侧栏 → 防抖刷新一次 thread/list
        if ((method0 === "turn/started" || method0 === "turn/completed") && params.threadId !== bag.threadRef.current?.id) {
          bag.scheduleSidebarRefresh();
        }
      
  return false;
}
