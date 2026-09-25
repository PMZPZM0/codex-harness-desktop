/**
 * usePart01c2 —— usePart01c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：账号与连接器与技能 · 限流重试与中断/乐观输入
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { AUTO_CONTINUE_MAX_ATTEMPTS, AUTO_CONTINUE_WINDOW_MS, autoContinuePrompt, isTruncatedEmptyTurn, truncationNotice } from "../../../../../lib/turn-truncation.mjs";
import { isRateLimitError, rateLimitBackoffMs, RATE_LIMIT_MAX_ATTEMPTS } from "../../../../../lib/rate-limit-retry";
import { effortLabels } from "../../../../../lib/effort-labels";
import { ThreadItem } from "../../../../../lib/thread-item";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart01c2(bag: Bag) {
  /** 确保该会话有重试上下文：已登记则沿用（保持重试链的计数），否则现场恢复并登记。
   *  ⛔⛔ 09-19 用户严令「429 就该自动重试、每个会话独立，不要直接中止」：
   *   现场恢复失败（渲染层重启/后台会话没缓存/引擎只推了 error 没推回合内容）时**绝不放弃**——
   *   退「续接指令」重发：引擎侧会话历史里有完整上下文（用户的原始消息都在），
   *   让模型接着被限流打断的地方继续，语义与「回合结束后自动续接」完全一致。
   *   只有「既无原文、又连续接都发不出去」才如实报错。 */
  function ensureRateLimitCtx(threadId: string, turn: any): boolean {
    if (!threadId) return false;
    if (bag.retryContextsRef.current.has(threadId)) return true;
    const ctx = bag.recoverRateLimitCtx(threadId, turn) ?? {
      input: [{ type: "text", text: autoContinuePrompt() }],
      model: modelName(loadThreadModel(threadId)) || bag.activeModelRef.current || "",
      effort: null,
      personality: null,
    };
    bag.armRateLimitRetry(threadId, ctx);
    return true;
  }
bag.ensureRateLimitCtx = ensureRateLimitCtx as typeof bag.ensureRateLimitCtx;



  /** 为「排队释放」启动的回合登记 429 重试上下文——**排队是最常走的路径**（运行中发消息、
   *  自动续接、点「立即」、回合结束自动启动下一条）。原先只有手动发送登记，这些回合 429
   *  后检测点 `has()` 为假 ⇒ 连重试都不排、直接报错（用户截图实证）。
   *  input 用**排队条目自己的内容**（引擎将重跑的就是它，带原始结构）；
   *  模型/档位沿用当前生效值（与释放时下发的一致）。 */
  function armRetryForQueueRelease(threadId: string | null | undefined, entryInput: any[] | undefined) {
    if (!threadId || !entryInput?.length) return;
    bag.armRateLimitRetry(threadId, {
      input: entryInput,
      model: bag.activeModelRef.current || modelName(bag.modelId),
      effort: bag.effort || null,
      personality: null,
    });
  }
bag.armRetryForQueueRelease = armRetryForQueueRelease as typeof bag.armRetryForQueueRelease;



  /** ⛔⛔ 会话级状态**彻底重置**（用户 09-19 严令：「每个会话必须从根源上完全独立，
   *  分支和复制会话 ID 接力的也是一样，必须从根源上完全重置」）。
   *  一个会话的生命周期结束时（归档/删除/被中断/被 fork 取代/接力到新 id），
   *  它的**全部衍生状态**都要一起作废，否则会以各种形式"串"给别的会话：
   *    · 重试上下文 / 尝试计数 / 退避定时器（到点会对着已不存在的会话重发）
   *    · 重试条与侧栏标记（界面上残留别人的状态）
   *    · 上游重连提示（B 的提示挂在 A 的窗口上）
   *  调用点：归档/删除、用户点停止、fork/接力把源会话取代、provider 切换。 */
  function resetSessionRetryState(threadId: string) {
    if (!threadId) return;
    bag.clearRateLimitTimer(threadId);
    bag.retryContextsRef.current.delete(threadId);
    bag.rateLimitAttemptsRef.current.delete(threadId);
    bag.retryGatesRef.current.delete(threadId);
    bag.setRetryEntry(threadId, null);
    bag.setUpstreamRetries((current) => {
      if (!(threadId in current)) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }
bag.resetSessionRetryState = resetSessionRetryState as typeof bag.resetSessionRetryState;



  /** 取消某会话的重试链（不传 threadId = 全部取消，如切换供应商/清空前）。 */
  function cancelRateLimitRetry(threadId?: string, silent = false) {
    if (threadId) {
      bag.resetSessionRetryState(threadId);
    } else {
      bag.clearRateLimitTimer();
      bag.retryContextsRef.current.clear();
      bag.rateLimitAttemptsRef.current.clear();
      bag.retryGatesRef.current.clear();
      bag.setRateLimitRetries({});
      bag.setUpstreamRetries({});
    }
    if (!silent) bag.showToast("已停止限流重试", "不再自动重发该消息", threadId);
  }
bag.cancelRateLimitRetry = cancelRateLimitRetry as typeof bag.cancelRateLimitRetry;



  async function executeRateLimitRetry(threadId: string) {
    bag.clearRateLimitTimer(threadId);
    const ctx = bag.retryContextsRef.current.get(threadId);
    const attempt = bag.rateLimitAttemptsRef.current.get(threadId) ?? 0;
    if (!ctx || !attempt) {
      bag.setRetryEntry(threadId, null);
      return;
    }
    bag.setRetryEntry(threadId, null);
    /* ⛔ 这里原先是「并发闸门」（09-19）：超限时 10 秒后再看槽位。09-25 用户要求删除并发限制
       （「直接把并发限制删了吧」）⇒ 整段移除，重试不再等槽位 —— 限流重试只按上游限流走。 */
    // 只有**当前正在看的会话**才动全局 sending/activeTurnId（后台会话的重试不能改别人的界面状态）
    const isFocused = () => bag.threadRef.current?.id === threadId;
    if (isFocused()) {
      bag.setSending(true);
      bag.setInterrupting(false);
      bag.setWorkStartedAt(Date.now());
    }
    bag.markThreadRunning(threadId);
    let guarded: Promise<unknown> | undefined;
    try {
      // 只串行化**同一个会话**的重试（防重复投递）；跨会话不排队、互不等待
      const gate = bag.retryGatesRef.current.get(threadId) ?? Promise.resolve();
      const run = gate.then(async () => {
        // 发送前最后核对一次：该会话若已有活动回合（用户手动重发/引擎自己缓过来了），
        // 不能重复投递同一条输入。
        try {
          const info = await window.codex.engineActiveTurns();
          if ((info?.threadIds ?? []).map(String).includes(threadId)) return { skipped: true };
        } catch { /* 记账不可用：按原计划重试 */ }
        return await window.codex.request("turn/start", {
          threadId,
          input: ctx.input,
          // ⛔ 兜底恢复来的上下文可能拿不到模型（见 recoverRateLimitCtx）——那时**不传**
          //   该字段，让引擎用会话自己的模型；传空串会被引擎拒掉，等于重试白排。
          ...(ctx.model ? { model: ctx.model } : {}),
          effort: ctx.effort,
          personality: ctx.personality,
          // ⛔⛔ 沙箱按**目标会话**取（用户 09-19 严令「会话与会话之间的配置和底层根源上必须
          //   彻底独立」）：cwd 与**权限模式**都要取目标会话自己的，不能借用当前查看会话的
          //   `sandbox`（那是全局 UI 状态）—— 否则后台会话的重试会带着**别的会话的权限**跑，
          //   属于配置层面的串会话（比 UI 串更危险：可能提权/降权）。
          sandboxPolicy: sandboxPolicy(threadSandboxOf(threadId) ?? bag.sandbox, bag.threadCacheRef.current.get(threadId)?.cwd ?? bag.threadRef.current?.cwd ?? bag.workspace ?? ""),
          approvalPolicy: threadApprovalOf(threadId) ?? bag.approvalPolicy,
        });
      });
      guarded = run.catch(() => undefined);
      bag.retryGatesRef.current.set(threadId, guarded);
      const result: any = await run;
      if (result?.skipped) {
        bag.cancelRateLimitRetry(threadId, true);
        return;
      }
      if (result?.turn?.id) {
        if (isFocused()) bag.setActiveTurnId(result.turn.id);
        bag.markThreadRunning(threadId, result.turn.id);
      }
      bag.showToast("限流重试已发出", `第 ${attempt}/${RATE_LIMIT_MAX_ATTEMPTS} 次重试已被接受，任务继续运行`, threadId);
    } catch (error: any) {
      if (isFocused()) { bag.setSending(false); bag.setWorkStartedAt(null); }
      bag.markThreadStopped(threadId);
      if (isRateLimitError(error?.message) && attempt < RATE_LIMIT_MAX_ATTEMPTS) {
        bag.showToast("仍被限流", `第 ${attempt} 次重试仍失败，稍后自动继续`, threadId);
        bag.scheduleRateLimitRetry(threadId, attempt + 1);
      } else {
        bag.scopedNotice(error?.message ?? "限流重试失败", threadId);
        bag.cancelRateLimitRetry(threadId, true);
      }
    } finally {
      // ⛔ 串行门**用后即清**（代码审查发现）：只在 Map 里仍是本次那道门时才删，
      //    避免误删后来者的门。不清的话条目会随重试次数无限累积（每条持有 Promise 与闭包）。
      if (bag.retryGatesRef.current.get(threadId) === guarded) bag.retryGatesRef.current.delete(threadId);
    }
  }
bag.executeRateLimitRetry = executeRateLimitRetry as typeof bag.executeRateLimitRetry;



  /**
   * 档位不被支持时的**降档重发**（09-18：模型配置里的档位声明删掉之后的兜底）。
   * 与限流重试的区别：不退避（档位错误不是"等等就好"）、只试一次、成功后 toast 说明换了档。
   * 上下文里已经是降过档的 effort（由调用方写好 retryContextRef）。
   */
  async function executeEffortFallbackRetry() {
    const ctx = bag.effortFallbackRef.current;
    if (!ctx) return;
    bag.setSending(true);
    bag.setInterrupting(false);
    bag.setWorkStartedAt(Date.now());
    bag.markThreadRunning(ctx.threadId);
    try {
      const result: any = await window.codex.request("turn/start", {
        threadId: ctx.threadId,
        input: ctx.input,
        model: ctx.model,
        effort: ctx.effort,
        personality: ctx.personality,
        // 同限流重试：沙箱 / 权限 / cwd 一律取**目标会话自己的**（会话间配置不得串）
        sandboxPolicy: sandboxPolicy(threadSandboxOf(ctx.threadId) ?? bag.sandbox, bag.threadCacheRef.current.get(ctx.threadId)?.cwd ?? bag.threadRef.current?.cwd ?? bag.workspace ?? ""),
        approvalPolicy: threadApprovalOf(ctx.threadId) ?? bag.approvalPolicy,
      });
      if (result?.turn?.id) {
        bag.setActiveTurnId(result.turn.id);
        bag.markThreadRunning(ctx.threadId, result.turn.id);
      }
      bag.showToast("已换档重发", `改用「${effortLabels[ctx.effort ?? ""] ?? ctx.effort}」重新发送`, ctx.threadId);
    } catch (error: any) {
      bag.setSending(false);
      bag.markThreadStopped(ctx.threadId);
      bag.setWorkStartedAt(null);
      bag.scopedNotice(error?.message ?? "换档重发失败", ctx.threadId);
    }
  }
bag.executeEffortFallbackRetry = executeEffortFallbackRetry as typeof bag.executeEffortFallbackRetry;



  function scheduleRateLimitRetry(threadId: string, attempt: number) {
    const ctx = bag.retryContextsRef.current.get(threadId);
    if (!ctx) return;
    if (attempt > RATE_LIMIT_MAX_ATTEMPTS) {
      // 放弃 = 该会话的重试链结束：熄灭它的运行态（不给全局界面留下假运行）
      const wasFocused = bag.threadRef.current?.id === threadId;
      bag.markThreadStopped(threadId);
      if (wasFocused) { bag.setSending(false); bag.setInterrupting(false); bag.setActiveTurnId(null); bag.setWorkStartedAt(null); }
      bag.cancelRateLimitRetry(threadId, true);
      bag.showToast("限流重试放弃", `已连续重试 ${RATE_LIMIT_MAX_ATTEMPTS} 次仍被限流，请稍后手动重发`, threadId);
      return;
    }
    bag.rateLimitAttemptsRef.current.set(threadId, attempt);
    // 退避再叠 ±20% 抖动：多会话同时被限流时，避免它们在同一秒一起重发（那会把上游打成
    // 更严重的 429，等于自己踩自己）。
    const base = rateLimitBackoffMs(attempt);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    const wasFocused2 = bag.threadRef.current?.id === threadId;
    if (wasFocused2) { bag.setSending(false); bag.setActiveTurnId(null); bag.setInterrupting(false); bag.setWorkStartedAt(null); }
    bag.markThreadStopped(threadId);
    bag.setRetryEntry(threadId, { attempt, retryAt: Date.now() + delay });
    bag.clearRateLimitTimer(threadId);
    bag.rateLimitTimersRef.current.set(threadId, window.setTimeout(() => void bag.executeRateLimitRetry(threadId), delay));
  }
bag.scheduleRateLimitRetry = scheduleRateLimitRetry as typeof bag.scheduleRateLimitRetry;


  const compactPendingRef = useRef(new Set<string>());
bag.compactPendingRef = compactPendingRef as typeof bag.compactPendingRef;


  const [interrupting, setInterrupting] = useState(false);
bag.interrupting = interrupting as typeof bag.interrupting; bag.setInterrupting = setInterrupting as typeof bag.setInterrupting;


  const [optimisticInput, setOptimisticInput] = useState<ThreadItem | null>(null);
bag.optimisticInput = optimisticInput as typeof bag.optimisticInput; bag.setOptimisticInput = setOptimisticInput as typeof bag.setOptimisticInput;


  const optimisticTurnIdRef = useRef<string | null>(null);
bag.optimisticTurnIdRef = optimisticTurnIdRef as typeof bag.optimisticTurnIdRef;


  const optimisticBaselineRef = useRef<{ threadId: string | null; turnIds: Set<string> }>({ threadId: null, turnIds: new Set() });
bag.optimisticBaselineRef = optimisticBaselineRef as typeof bag.optimisticBaselineRef;
  return { ensureRateLimitCtx, armRetryForQueueRelease, resetSessionRetryState, cancelRateLimitRetry, executeRateLimitRetry, executeEffortFallbackRetry, scheduleRateLimitRetry, compactPendingRef, interrupting, setInterrupting, optimisticInput, setOptimisticInput, optimisticTurnIdRef, optimisticBaselineRef };
}
