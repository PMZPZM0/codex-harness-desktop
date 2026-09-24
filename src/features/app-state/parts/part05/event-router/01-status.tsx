/**
 * handleEventRouter1 —— 01-seg 里那条事件总路由的第 1 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function handleEventRouter1(bag: Bag, event: any): boolean {
        bag.setServerStatus(event.status ?? "error");
        // 保存模型、切换或删除当前供应商都会主动重启引擎。主动重启只有
        // starting→ready，不会先发 error；同样要进入恢复分支，否则侧栏会暂时像是
        // “会话全没了”，直到下次手动刷新应用。
        if (event.status === "starting") bag.engineRestartedRef.current = true;
        // 引擎无响应/被心跳监控重启：清掉本地运行态，提示用户（thread 仍留在磁盘，
        // 引擎 ready 后自动 resume 当前线程即可恢复，不丢消息）。
        if (event.status === "error") {
          if (event.message && event.message.includes("重启")) {
            bag.showToast("引擎已自动重启", event.message);
            bag.engineRestartedRef.current = true;
          }
          if (bag.sendingRef.current || bag.activeTurnIdRef.current) {
            bag.setSending(false);
            bag.setActiveTurnId(null);
            bag.clearRunningThreads();
            bag.setWorkStartedAt(null);
          }
        }
        // 引擎重启完成（ready）：自动刷新线程列表，并 resume 之前打开的线程恢复内容。
        if (event.status === "ready" && bag.engineRestartedRef.current) {
          bag.engineRestartedRef.current = false;
          const tid = bag.threadRef.current?.id;
          void bag.refreshThreads();
          if (tid) {
            resumeThreadWithTurns({ threadId: tid, excludeTurns: false }).then((result) => {
              if (result?.thread && bag.threadRef.current?.id === tid) {
                bag.threadRef.current = result.thread;
                bag.threadCacheRef.current.set(tid, result.thread);
                bag.setThread(result.thread);
              }
            }).catch(() => undefined);
          }
        }
        return true;
      
  return false;
}
