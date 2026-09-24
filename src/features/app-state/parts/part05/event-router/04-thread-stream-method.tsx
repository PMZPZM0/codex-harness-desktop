/**
 * handleEventRouter4 —— 01-seg 里那条事件总路由的第 4 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function handleEventRouter4(bag: Bag, params: any, method: any): boolean {
        // delta 批量落盘：把累积到这一帧的 delta 一次性 apply 成新 thread 引用（只触发一次重渲染）
        const flushDeltas = () => {
          const batch = bag.pendingDeltaRef.current;
          bag.pendingDeltaRef.current = [];
          if (bag.streamRafRef.current) { cancelAnimationFrame(bag.streamRafRef.current); bag.streamRafRef.current = 0; }
          bag.lastFlushAtRef.current = performance.now();
          bag.lastStreamTsRef.current = Date.now();
          if (!batch.length) return;
          let current = bag.threadRef.current;
          for (const { method: m, params: p } of batch) current = applyThreadEvent(current, m, p);
          if (current !== bag.threadRef.current) {
            bag.threadRef.current = current;
            bag.setThread(current);
            if (current?.id) bag.threadCacheRef.current.set(current.id, current);
          }
        };
        // delta 合帧：同一帧内的多条流式事件合并成一次 setThread，
        // 渲染节奏稳定在 60fps，不随引擎/中转出字的一波一波节奏跳变
        const apply = () => {
          // 结构性事件（item/completed 等）必须排在已缓冲的 delta 之后：
          // 否则会「先落完成态、后补字」，表现为完成后正文被覆盖或整段丢失。
          if (bag.pendingDeltaRef.current.length) flushDeltas();
          bag.lastStreamTsRef.current = Date.now();
          const next = applyThreadEvent(bag.threadRef.current, method, params);
          if (next !== bag.threadRef.current) {
            bag.threadRef.current = next;
            bag.setThread(next);
            if (next?.id) bag.threadCacheRef.current.set(next.id, next);
          }
        };
        if (isDeltaMethod(method)) {
          bag.pendingDeltaRef.current.push({ method, params });
          // 新一轮出字（距上次落盘已超过一帧）立即应用，不等 rAF：
          // 首 token / 停顿后的第一个字必须立刻可见，否则肉眼就是「慢半拍 + 憋一段才冒出来」。
          // 之后同帧内持续到来的 delta 才走 rAF 合帧，避免每字一次全树重渲染。
          if (performance.now() - bag.lastFlushAtRef.current > 24) flushDeltas();
          else if (!bag.streamRafRef.current) bag.streamRafRef.current = requestAnimationFrame(flushDeltas);
          return true;
        }
        apply();
      
  return false;
}
