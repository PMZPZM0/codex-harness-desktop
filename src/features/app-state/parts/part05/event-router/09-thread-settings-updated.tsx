/**
 * handleEventRouter9 —— 01-seg 里那条事件总路由的第 9 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../../lib/effort";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function handleEventRouter9(bag: Bag, params: any): boolean {
        bag.setWorkspace(params.threadSettings.cwd);
        const mode = sandboxMode(params.threadSettings.sandboxPolicy);
        const policy = typeof params.threadSettings.approvalPolicy === "string" ? params.threadSettings.approvalPolicy : bag.approvalPolicy;
        // 用户选择的权限必须原样生效：低权限只让需授权的操作走审批卡，
        // 不减少引擎可用能力，也不被前端自动回写成完全访问。
        // 引擎可能推不带 sandboxPolicy/approvalPolicy 的事件——此时保持用户当前权限，绝不降级覆盖。
        // 若本地已存有该会话的权限（用户明确选过），以本地为准，避免引擎回推的默认值覆盖选择。
        // 变灰根因补刀：openThread 回填后会触发引擎异步回推一条带旧策略的 settings/updated，
        // 若用户刚在胶囊里明确改过权限（5s 内推送过），这条回推是旧值，忽略之。
        const threadId = params.threadId as string | undefined;
        const recentPush = threadId && Date.now() - (bag.threadPermPushAtRef.current.get(threadId) ?? 0) < 5_000;
        const savedPerms = threadId ? loadThreadPermissions(threadId) : null;
        const localSandbox = savedPerms && (savedPerms.sandbox === "danger-full-access" || savedPerms.sandbox === "read-only" || savedPerms.sandbox === "workspace-write") ? savedPerms.sandbox : null;
        const localApproval = savedPerms && (savedPerms.approval === "never" || savedPerms.approval === "on-request" || savedPerms.approval === "untrusted") ? savedPerms.approval : null;
        // 记录可信度（09-10「权限总是掉」的真凶）：本地记录若 == 引擎本次推的值 且 ≠ 全局默认，
        // 说明是旧版本自动回写/引擎回推烙进来的脏数据（用户从没选过）——照单全收会把 UI 拖回
        // 低权限（实测 21:41 起沙箱被拖回 workspace-write，之后每轮都掉）。这种记录忽略，
        // 保持用户当前选择；引擎侧由 openThread 自愈与逐回合 sandboxPolicy 纠正，此处**不回推**
        // （回推会触发引擎再推 settings/updated，5s 节流挡不住周期性循环）。
        const globalDefaultSandbox = (["danger-full-access", "read-only", "workspace-write"] as const).includes(localStorage.getItem("default-sandbox") as never) ? (localStorage.getItem("default-sandbox") as string) : "danger-full-access";
        const globalDefaultApproval = (["never", "on-request", "untrusted"] as const).includes(localStorage.getItem("default-approval") as never) ? (localStorage.getItem("default-approval") as string) : "never";
        const recordTrustedHere = (value: string | null, engineValue: string | null | undefined, globalDefault: string) => Boolean(value) && !(value && engineValue && value === engineValue && value !== globalDefault);
        const trustedSandbox = recordTrustedHere(localSandbox, mode, globalDefaultSandbox) ? localSandbox : null;
        const trustedApproval = recordTrustedHere(localApproval, policy, globalDefaultApproval) ? localApproval : null;
        const effectiveSandbox = recentPush && localSandbox ? localSandbox : (trustedSandbox ?? bag.sandbox ?? globalDefaultSandbox);
        const effectiveApproval = recentPush && localApproval ? localApproval : (trustedApproval ?? bag.approvalPolicy ?? globalDefaultApproval);
        // 引擎回推的 sandboxPolicy 是线程当前状态，可能是被历史降级/创建时旧值，不可作为持久记录——
        // 本地无用户选择时只临时显示（等 resume 恢复给出权威值），绝不落盘。落盘会污染 localPerms，
        // 让 resume 恢复读到灰值并 push 回引擎 → 重启后完全权限被静默降级成 workspace-write（变灰根因）。
        if (effectiveSandbox && threadId && localSandbox) saveThreadPermissions(threadId, effectiveSandbox, effectiveApproval);
        if (effectiveSandbox) bag.setSandbox(effectiveSandbox);
        bag.setApprovalPolicy(effectiveApproval);
        // 思考等级同理：引擎回推的可能是创建时的旧值，本地有每会话记录时以本地为准
        {
          const localEffort = threadId ? loadThreadEffort(threadId) : "";
          bag.setEffort(normalizeEffort(localEffort || params.threadSettings.effort) || "");
        }
        bag.setPersonality(params.threadSettings.personality ?? "none");
      
  return false;
}
