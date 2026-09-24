/**
 * handleEventRouter7 —— 01-seg 里那条事件总路由的第 7 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { AUTO_CONTINUE_MAX_ATTEMPTS, AUTO_CONTINUE_WINDOW_MS, autoContinuePrompt, isTruncatedEmptyTurn, truncationNotice } from "../../../../../lib/turn-truncation.mjs";
import { isQueueAlreadyStartedError } from "../../../../../lib/queue-errors.mjs";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { ThreadItem } from "../../../../../lib/thread-item";
import { reasoningDuration } from "../../../../../lib/reasoning-duration";
import { itemText } from "../../../../../lib/item-text";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function handleEventRouter7(bag: Bag, params: any): boolean {
        bag.setSending(false);
        bag.setInterrupting(false);
        bag.setActiveTurnId(null);
        bag.markThreadStopped(params.threadId);
        bag.setWorkStartedAt(null);
        // 回合真正结束：统一结算本回合所有 reasoning 的耗时（起点在 item/started 或
        // item/completed 时已记录）。不在 item/completed 结算的原因见上——避免引擎
        // 「提前 completed + 继续发 delta」时运行状态被打断。
        if (params.turn?.items) {
          for (const item of params.turn.items) {
            if (item?.type !== "reasoning") continue;
            const key = String(item.id ?? "");
            if (key && !reasoningDuration.has(key)) {
              const start = reasoningStart.get(key);
              if (start) reasoningDuration.set(key, Date.now() - start);
              reasoningStart.delete(key);
            }
          }
        }
        // ★ 本回合是不是**用户手动停止**的（09-23 用户：「当用户手动停止程序/任务的运行状态时，排队中的
        //   消息不应被自动发送」，并更正为「**停留在输入框上面**，保持排队消息」）。旗标由 `interrupt()`
        //   在**它第一个 await 之前**同步写下（见 `bag.manualStopRef` 注释），这里按 turnId 精确比对
        //   ⇒ 只对这一次生效。手动停止的语义 = 「这个回合到此为止，别再自动发起任何后续发送」，
        //   因此下面两处都必须短路：
        //     ① 截断空转的**自动续接**（否则会再发一条"接着写"并直接启动）；
        //     ② 排队消息的**回合结束自动启动**（排队消息本身原地不动，见下方分支）。
        const manualStopTurnId = bag.manualStopRef.current.get(String(params.threadId ?? ""));
        const wasManualStop = Boolean(manualStopTurnId && manualStopTurnId === String(params.turn?.id ?? ""));
        if (wasManualStop) bag.manualStopRef.current.delete(String(params.threadId ?? ""));
        // 只有服务端回合里的 userMessage 文本和乐观消息匹配才清；
        // 否则保留——清早了而服务端消息又没渲染出来，用户消息就"消失"了
        const takeoverItem = (params.turn?.items ?? []).find((entry: ThreadItem) => entry.type === "userMessage" && userMessageMatchesInput(entry, bag.optimisticInput?.content ?? []));
        if (bag.optimisticInput && takeoverItem) bag.setOptimisticInput(null);
        if (params.turn.error?.message) bag.showToast("任务失败", params.turn.error.message);
        // ⛔ 09-19 用户实测「思考内容过长会被截断，运行状态就断了」（昨天「鹈鹕骑自行车」）。
        //   真机取证（会话 01a0b515 回合 8）：应用配 model_max_output_tokens=393216，但当时的
        //   商汤网关把单次响应**钳到 8192 tokens**；模型思考 16365 字符（≈8000+ tokens）把预算
        //   吃光 ⇒ 正文 0 字符 ⇒ 引擎把「空输出」当 task_complete 正常收尾 ⇒ 用户以为"莫名断了"。
        //   引擎 rollout 不记录 finish_reason，只能靠渲染层已有数据兜底检测：
        //   思考极长 + 正文为空 + 全程无工具动作 = 被截断的空转（有正文或有工具的一律不判，防误报）。
        //   只对**当前会话**判定（后台会话的 items 不在 threadRef 里，且用户没在看）。
        if (params.threadId === bag.threadRef.current?.id) {
          const turnId = String(params.turn?.id ?? "");
          const localTurn = bag.threadRef.current?.turns.find((entry) => entry.id === turnId);
          // ⛔ 手动停止的回合**不自动续接**（见上方 wasManualStop）：被停掉的长思考回合在形态上
          //   与「截断空转」可能一模一样（思考很长 + 正文为空 + 无工具），不拦就会在用户点停止后
          //   2.5 秒自动再发一条"接着写"并启动新回合 —— 正是用户要禁止的「自动发送」。
          if (isTruncatedEmptyTurn(localTurn ?? params.turn) && !wasManualStop) {
            bag.showToast("回合可能被上游截断", truncationNotice());
            bag.maybeAutoContinueTruncated(String(params.threadId ?? ""));
          }
        }
        // 图片模态自愈（09-18 用户反馈：升级上来的模型配置标了「视觉」，但接入点实际不支持图片
        // → 带图回合全部 InvalidParameter）。错误原话明确点名时才触发，只动该模型的 inputTypes。
        void bag.healImageModalityIfUnsupported(params.turn.error?.message);
        // ⛔ 429 的**排重试**已提到跨会话区（见上，per-thread 上下文）——这里只负责：
        //   回合**正常结束**时清掉该会话的重试上下文（否则下次它再失败会误用旧输入重发）。
        if (!params.turn.error?.message && bag.retryContextsRef.current.has(String(params.threadId ?? ""))) {
          bag.cancelRateLimitRetry(String(params.threadId ?? ""), true);
        }
        // 运行结束通知：窗口最小化/失焦时弹系统通知，点击通知聚焦回窗口
        try {
          const isCurrent = params.threadId === bag.threadRef.current?.id;
          const blurred = document.visibilityState !== "visible" || !document.hasFocus();
          if (blurred || !isCurrent) {
            // ⛔ 09-19 用户实测「通知栏总是显示未命名会话」：cleanThreadDisplayTitle 的内部
            //   fallback 是「未命名会话」（恒非空）⇒ 后面的 `|| firstUserTextInTurn(...) || "任务"`
            //   **永远执行不到**——threads 快照里查不到该会话（后台会话刚建、列表未回填）或
            //   name 为空时，通知永远叫「未命名会话」。fallback 传空串把兜底权交回调用方：
            //   先用回合里第一条用户消息，再退「任务」。
            const entry = bag.threads.find((t) => t.id === params.threadId);
            const name = cleanThreadDisplayTitle(entry?.name, { preview: entry?.preview, fallback: "" })
              || firstUserTextInTurn(params.turn).slice(0, 30)
              || "任务";
            void window.codex.showNotification(params.turn.error?.message ? "任务失败" : "任务完成", `${name.slice(0, 40)} ${params.turn.error?.message ? "运行失败" : "已运行完成"}`);
          }
        } catch { /* 通知失败不影响主流程 */ }
        // 回合结束 → 自动启动下一条排队消息。
        // ⛔ 但**用户手动停止过这一回合 ⇒ 不启动**（09-23 用户要求，口径见上方 `wasManualStop`）。
        //   这是**唯一**拦截点，成立的前提是一条真机实测事实：被**中断**的回合结束时，**引擎不会**
        //   自己释放队列（排队卡里那条 12.5s 后仍在、也没被当用户消息发出）⇒ 排队消息原地留在
        //   输入框上方那张卡里，由用户自己决定「立即 / 编辑 / 删除」—— 不需要动队列，更不能把它
        //   塞回输入框（多条会糊成一条草稿，用户 09-23 明确否掉）。
        // ⛔ 短路只加在 `if (wasManualStop)` 这一支：正常回合结束照旧自动启动（`else` 分支一个字没动）。
        // ⛔ 必须**立刻从本地队列摘掉这一条**（用户实测「排队消息在聊天框里重复展示」）：
        // 引擎把它变成真实用户消息气泡后，不会再保证发 `thread/queue/changed`，
        // 于是 `.timeline-queue` 里那条「排队中」气泡会与真实气泡**同时存在**——
        // 同一条消息显示两次，直到用户切会话/再发一条才刷新掉。
        let armedByAutoStart = false;
        if (wasManualStop) {
          bag.dbg("manual-stop-no-autostart", { threadId: params.threadId });
        } else {
          void window.codex.request("thread/queue/list", { threadId: params.threadId, limit: 1 }).then((result) => {
            const head = result?.data?.[0];
            if (!head) return undefined;
            bag.setQueue((current) => current.filter((entry) => entry.id !== head.id));
            // 这条排队消息马上会变成真实回合的用户消息 → 先建立钉顶意图（否则它落进内容流，
            // 用户看到的就是「钉顶没生效」）。只对当前正在看的会话生效，见函数注释。
            armedByAutoStart = bag.armPinForReleasedQueue(params.threadId, "auto-start");
            // 429 兜底也要覆盖这条自动启动的回合（用户实测缺口：429 后直接报错、不重试）
            bag.armRetryForQueueRelease(params.threadId, head.input ?? []);
            return window.codex.request("thread/queue/start", { threadId: params.threadId, queuedSubmissionId: head.id });
          }).catch((error) => {
            const message = String(error?.message ?? error);
            // ⛔⛔ 09-24 用户反馈（截图：「排队消息出去，正常的，为啥报这个错」）：
            //   报错 `queued submission not found: <id>` —— 这不是真失败，是**竞态被我们当成了失败**。
            //   实测事实（见本文件上方 93-99 行与 AGENTS）：排队消息**由引擎自己启动** —— 上一回合
            //   结束后约 9ms 引擎就发 `thread/queue/changed` 并把队列清空。等我们这次
            //   `thread/queue/start` 落到引擎时，那一条**已经被启动并出队** ⇒ 引擎自然回「找不到」。
            //   症状：消息**照常发出去**（用户看到的正是这个），却弹一个红错，纯噪声。
            //   ⇒ 这类「已被启动 / 已不在队列」的失败按**成功**处理：不弹 toast，且**保留**钉顶意图
            //     （消息确实要出现，意图是对的）；只留一行 dbg 供排查。判据见 lib/queue-errors.mjs。
            if (isQueueAlreadyStartedError(message)) {
              bag.dbg("queue-autostart-raced-by-engine", { threadId: params.threadId, message });
              return;
            }
            // 启动失败 ⇒ 那条消息不会出现，撤回意图（否则钉顶会去钉别的消息）
            if (armedByAutoStart) bag.disarmPinIntent("auto-start-fail");
            bag.showToast("队列启动失败", message);
          });
        }
        // 计划模式：方案回合正常结束 → 弹「开始执行」确认条；失败则静默复位（错误已 toast）
        if (bag.planTurnRef.current && bag.planTurnRef.current.threadId === params.threadId && bag.planTurnRef.current.turnId === String(params.turn?.id ?? "")) {
          if (!params.turn.error?.message) {
            const planText = (Array.isArray(params.turn?.items) ? params.turn.items : []).filter((item: any) => item.type === "agentMessage").map((item: any) => itemText(item)).join("\n\n").trim();
            bag.setPlanConfirm({ threadId: params.threadId, text: planText });
            bag.showToast("方案已生成", "确认无误后点击「开始执行」");
          }
          bag.planTurnRef.current = null;
          bag.setPlanRunning(false);
        }
        // 多会话性能（09-12）：这里原本**每个回合结束都打一发全量 thread/list**，
        // N 个会话并行就是 N 发（每次都要主进程扫 rollout 兜底）。而这次 turn/completed
        // 事件本身就带了完整 turn —— 本地就能把侧栏那一项更新到位：
        //   ① 先把本条 turn 合并进当前会话缓存（前端纯函数，零 RPC）；
        //   ② 侧栏只把这一项的状态/时间戳就地改掉；
        //   ③ 仍在跑或还没记录过的会话，才走一次去抖刷新兜底（渠道机器人等后台会话
        //      不在当前事件流里，靠 scheduleSidebarRefresh 那条路径）。
        {
          const tid = String(params.threadId ?? "");
          const doneTurn = params.turn;
          if (tid && doneTurn?.id) {
            const cached = bag.threadCacheRef.current.get(tid);
            if (cached) {
              const merged = mergeTurn(cached, doneTurn);
              if (merged && merged !== cached) {
                bag.threadCacheRef.current.set(tid, merged);
                if (bag.threadRef.current?.id === tid) {
                  bag.threadRef.current = merged;
                  bag.setThread(merged);
                }
              }
            }
            bag.setThreads((current) => current.map((entry) => entry.id === tid
              ? { ...entry, updatedAt: Math.floor(Date.now() / 1000), status: doneTurn.status ?? entry.status }
              : entry));
          }
          // 兜底：当前会话刚结束却没有缓存（罕见），或者还有别的会话在跑 → 去抖刷新一次
          if (!tid || !bag.threadCacheRef.current.has(tid) || bag.runningThreadIdsRef.current.size > 0) {
            bag.scheduleSidebarRefresh();
          }
        }
      
  return false;
}
