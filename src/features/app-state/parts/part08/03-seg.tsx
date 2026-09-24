/**
 * usePart08c（09-22：part08 按序切分出来的第 3 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import "@xterm/xterm/css/xterm.css";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { Turn } from "../../../../lib/turn";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Bag } from "../bag-types";

export function usePart08c(bag: Bag) {
  // /plan 确认执行：以默认协作模式把「按方案执行」发进同一会话
  function confirmPlanExecution() {
    const pc = bag.planConfirm;
    if (!pc || !bag.thread || bag.thread.id !== pc.threadId || bag.sendInFlightRef.current) return;
    bag.setPlanConfirm(null);
    bag.setPlanFeedback("");
    bag.pendingCommandTextRef.current = "方案已确认，请严格按照上述方案开始执行，完成后总结改动清单。";
    void bag.send();
  }
bag.confirmPlanExecution = confirmPlanExecution as typeof bag.confirmPlanExecution;

  function cancelPlanExecution() {
    bag.setPlanConfirm(null);
    bag.setPlanFeedback("");
    bag.showToast("计划模式已取消", "方案保留在对话里，可手动继续");
  }
bag.cancelPlanExecution = cancelPlanExecution as typeof bag.cancelPlanExecution;

  // /plan 提意见：不清计划旗标，带着反馈以 plan 模式再跑一轮修订，直到满意再执行
  function submitPlanFeedback() {
    const text = bag.planFeedback.trim();
    if (!bag.planConfirm || !text || !bag.thread || bag.thread.id !== bag.planConfirm.threadId || bag.sendInFlightRef.current) return;
    bag.setPlanConfirm(null);
    bag.setPlanFeedback("");
    bag.planOnceRef.current = true;
    bag.pendingCommandTextRef.current = text;
    bag.showToast("已提交意见", "正在按你的反馈修订方案");
    void bag.send();
  }
bag.submitPlanFeedback = submitPlanFeedback as typeof bag.submitPlanFeedback;

  // /goal 停止：清引擎长期目标（引擎随即不再自动续跑）
  function stopGoalLoop() {
    if (!bag.thread) return;
    void window.codex.request("thread/goal/clear", { threadId: bag.thread.id }).then(() => {
      bag.setGoalText("");
      bag.setGoalStatus(null);
      bag.showToast("目标模式已停止", "已清除长期目标，自动推进结束");
    }).catch((error: any) => bag.showToast("停止失败", error.message));
  }
bag.stopGoalLoop = stopGoalLoop as typeof bag.stopGoalLoop;

  async function interrupt() {
    if (!bag.thread) return;
    const turnId = bag.activeTurnId ?? bag.runningTurnIdsRef.current.get(bag.thread.id);
    if (!turnId) return;
    bag.setInterrupting(true);
    // 用户点停止 = 这个会话彻底停下：**只清它自己的**重试链（别的会话完全不受影响）
    bag.resetSessionRetryState(bag.thread.id);
    // ★ 「手动停止」= 这个回合到此为止，不再自动发起任何后续发送（09-23 用户要求；口径经用户更正为
    //   「排队消息**停留在输入框上面**，保持排队消息」，见 `bag.manualStopRef` 的注释）。
    //   这里只做一件事：**同步**写下「这次手动停止」的记录 —— 必须先于任何 await，
    //   因为 `turn/interrupt` 的回包与引擎的回合结束事件是两条独立异步流、事件可能**先到**，
    //   写在 await 之后会漏判（真机打点 `manual-stop-no-autostart` 就是这条链路的验收信号）。
    //   ⛔ **不动排队本身**：不摘引擎队列、不写回输入框（多条会糊成一条草稿，用户 09-23 明确否掉）。
    //   拦截点只有一处：`turn/completed` 的「自动启动下一条排队消息」
    //   （part05/event-router/07-turn-completed-settle.tsx 的 `wasManualStop` 分支）。
    const stopThreadId = bag.thread.id;
    bag.manualStopRef.current.set(stopThreadId, turnId);
    try {
      await window.codex.request("turn/interrupt", { threadId: bag.thread.id, turnId });
      bag.setInterruptedTurns((current) => ({ ...current, [turnId]: Date.now() }));
      // 在清 workStartedAt 之前算已工作秒数：渲染「你在 X 秒后停止了」需要
      const elapsed = bag.workStartedAt != null ? Math.max(1, Math.round((Date.now() - bag.workStartedAt) / 1000)) : 1;
      bag.setStoppedElapsed((current) => ({ ...current, [turnId]: elapsed }));
      bag.setSending(false);
      bag.setInterrupting(false);
      bag.markThreadStopped(bag.thread.id);
      bag.setWorkStartedAt(null);
      // 保留乐观消息（避免"停止后消息消失"）：从服务端重新拉回合恢复已生成内容
      const resumed = await resumeThreadWithTurns({ threadId: bag.thread.id, excludeTurns: false }).catch(() => null);
      if (resumed?.thread) {
        bag.threadRef.current = resumed.thread;
        bag.setThread(resumed.thread);
        if (bag.optimisticInput && resumed.thread.turns.some((entry: Turn) => entry.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, bag.optimisticInput!.content ?? [])))) bag.setOptimisticInput(null);
      }
      void bag.refreshThreads();
    } catch (error: any) {
      bag.setInterrupting(false);
      const message = String(error?.message ?? error);
      // ⛔ 引擎报「expected active turn id <X> but found <Y>」：宿主记录的回合已结束，引擎侧活跃
      //    回合已切到 <Y>（委派子智能体 / 自动续跑场景高发——09-24 老版本用户截图正是这个错
      //    反复弹、永远停不下来）。先按引擎报出的真实活跃回合 <Y> 重试一次中断：那个回合多半
      //    还在烧 token，必须真停掉；重试也失败再按「已停止」复位（绝不挂着「运行中」让用户
      //    反复点 ⇒ 反复弹窗）。
      const foundTurn = message.match(/but found ([0-9a-f-]{8,64})/i);
      if (foundTurn) {
        try {
          await window.codex.request("turn/interrupt", { threadId: bag.thread.id, turnId: foundTurn[1] });
          bag.setInterruptedTurns((current) => ({ ...current, [foundTurn[1]]: Date.now() }));
          bag.setSending(false);
          bag.setActiveTurnId(null);
          bag.markThreadStopped(bag.thread.id);
          bag.setWorkStartedAt(null);
          bag.setNotice("已停止（引擎活跃回合已切换，已按引擎侧实际回合中断）");
          const resumed = await resumeThreadWithTurns({ threadId: bag.thread.id, excludeTurns: false }).catch(() => null);
          if (resumed?.thread) {
            bag.threadRef.current = resumed.thread;
            bag.setThread(resumed.thread);
          }
          void bag.refreshThreads();
          return;
        } catch { /* 重试也失败 → 落到下面的复位分支，绝不挂着运行态 */ }
      }
      // 线程已失效（thread not found），或引擎报 expected active turn（重试也失败）。
      // ⛔ 09-24 用户反馈（老版本截图）：这类失败原来只 setNotice **不复位运行态** ⇒ 界面永远
      //    「运行中」，用户以为停止无效反复点 ⇒ 反复弹错误。语义上「回合已经不在了」就等于
      //    用户要的「停下」——按 not found 同款复位，给一句温和提示而不是原始报错。
      if (/not found|no such thread|unloaded|expected active turn/i.test(message)) {
        bag.setSending(false);
        bag.setActiveTurnId(null);
        bag.markThreadStopped(bag.thread.id);
        bag.setWorkStartedAt(null);
        bag.setNotice(/expected active turn/i.test(message)
          ? "回合已结束，已停止。（引擎侧活跃回合已切换）"
          : "原会话已失效，已停止。重新发送会自动重建会话。");
      } else {
        // 其它真失败也必须让界面停下来（可以报错，但不许挂着「运行中」）
        bag.setSending(false);
        bag.setNotice(error.message);
      }
    }
  }
bag.interrupt = interrupt as typeof bag.interrupt;
  return { confirmPlanExecution, cancelPlanExecution, submitPlanFeedback, stopGoalLoop, interrupt };
}
