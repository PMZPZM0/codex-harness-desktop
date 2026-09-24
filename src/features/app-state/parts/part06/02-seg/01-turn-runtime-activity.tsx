/**
 * usePart06b1 —— usePart06b 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：回合运行态与运行时同步 · 模型选择与线程设置权限
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { resolveModelForOpen, shouldSyncOpenThread } from "../../../../../lib/model-scope.mjs";
import { composeScopeInstructions, sessionScopeBlock, sessionScopeSignature } from "../../../../../lib/session-scope.mjs";
import { advanceMood, composeMoodInstructions, emptyMood, moodBlock, moodSignature, moodTone, normalizeMood, userSignalOf } from "../../../../../lib/agent-mood.mjs";
import { LEGACY_PREFIX, dispatchSignature, emptyDispatch, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeDispatch, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeKey, runtimeSignature } from "../../../../../lib/thread-runtime.mjs";
import { describeTurnStop, turnHeadline, isAwaitingTurnClose } from "../../../../../lib/turn-stop-reason.mjs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart06b1(bag: Bag) {
  // ── 运行动态状态行（09-16，学 WorkBuddy 消息底部那个）─────────────────────────
  // 状态 = 当前会话**最后一个进行中的 item** 的类型（执行命令/编辑文件/思考…），
  // 找不到进行中 item 时兜底「正在生成回复」；话语 = 任务开始时随机锁定一句，运行期不换。
  const taskRunning = Boolean(bag.sending || bag.activeTurnId);
bag.taskRunning = taskRunning as typeof bag.taskRunning;


  // ⛔ 收尾等待（09-18）：判据独立成布尔量，**不要用展示文案做状态判断** ——
  //   原先写成 `runActivity === "正文已完整，等待模型收尾"`，把可读文案当逻辑判据，
  //   改一个字（文案优化）就会静默失效、退回「正在生成回复」而没人发现（审查抓出）。
  const lastTurnOfThread = bag.thread?.turns?.[bag.thread.turns.length - 1];
bag.lastTurnOfThread = lastTurnOfThread as typeof bag.lastTurnOfThread;


  const turnFinalizing = Boolean(bag.taskRunning && isAwaitingTurnClose(bag.lastTurnOfThread));
bag.turnFinalizing = turnFinalizing as typeof bag.turnFinalizing;


  const runActivity = useMemo(() => {
    if (!bag.taskRunning || !bag.thread) return "";
    const turns = bag.thread.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const items = turns[i].items ?? [];
      for (let j = items.length - 1; j >= 0; j--) {
        const item = items[j] as any;
        if (item?.status !== "inProgress" && item?.status !== "running") continue;
        switch (item.type) {
          case "commandExecution": return "正在执行命令";
          case "fileChange": return "正在编辑文件";
          case "reasoning": return "正在深度思考";
          case "webSearch": return "正在搜索网页";
          case "mcpToolCall": return "正在调用工具";
        }
      }
    }
    // ⛔ 兜底要分两种（09-18 用户实测「回复完了还没结束，啥情况」）：GPT 系模型输出完正文后，
    //   上游迟迟不发流结束信号（真机实测 gpt-5.6-sol 正文完成后 28 秒零事件才 task_complete），
    //   此时说「正在生成回复」会让人以为还在憋正文 —— 如实说「正文已完整，等待模型收尾」。
    //   判据**复用纯函数**，不在这里抄第二份（两份判定迟早漂移，且纯函数那份有行为断言守着）。
    //   判据**复用纯函数**，不在这里抄第二份（两份判定迟早漂移，且纯函数那份有行为断言守着）。
    return bag.turnFinalizing ? "正文已完整，等待模型收尾" : "正在生成回复";
  }, [bag.taskRunning, bag.thread, bag.turnFinalizing]);
bag.runActivity = runActivity as typeof bag.runActivity;



  const [runPhrase, setRunPhrase] = useState("");
bag.runPhrase = runPhrase as typeof bag.runPhrase; bag.setRunPhrase = setRunPhrase as typeof bag.setRunPhrase;


  // 取词只做一次，用 ref 读「当时的活动」：不把 runActivity 放进依赖，
  // 否则状态一从「思考」切到「执行命令」就把句子换掉（运行期换句子会闹腾）。
  const runActivityRef = useRef("");
bag.runActivityRef = runActivityRef as typeof bag.runActivityRef;


  useEffect(() => { bag.runActivityRef.current = bag.runActivity; }, [bag.runActivity]);


  useEffect(() => {
    if (bag.taskRunning && !bag.runPhrase) bag.setRunPhrase(pickRunPhrase(bag.runActivityRef.current || "正在生成回复"));
    else if (!bag.taskRunning && bag.runPhrase) bag.setRunPhrase("");
  }, [bag.taskRunning, bag.runPhrase]);


  // ⛔ 跨进/跨出「收尾等待」时换一次句子（09-18 用户实测「回复完了还没结束」）：
  //   · 跨进 → 用**专属句**（pickRunPhraseExact，不过通用池）："正在把改动收拢干净" 这类
  //     干活句会让人以为还在干活（真机采样抽到通用句就是这么发现的）。
  //   · 跨出（模型又开始干活）→ 换回通用句，否则会出现「正在执行命令 · 就差上游一个结束信号」
  //     这种自相矛盾的状态行。
  //   只在**跨状态那一次**换（ref 记住当前是否处于收尾用语），「思考→命令→文件」之间不乱换。
  const finalizePhraseRef = useRef(false);
bag.finalizePhraseRef = finalizePhraseRef as typeof bag.finalizePhraseRef;


  useEffect(() => {
    if (!bag.taskRunning) { bag.finalizePhraseRef.current = false; return; }
    if (bag.turnFinalizing === bag.finalizePhraseRef.current) return;
    bag.finalizePhraseRef.current = bag.turnFinalizing;
    bag.setRunPhrase(bag.turnFinalizing ? pickRunPhraseExact("正文已完整，等待模型收尾") : pickRunPhrase(bag.runActivity || "正在生成回复"));
  }, [bag.taskRunning, bag.turnFinalizing, bag.runActivity]);



  // ⛔ 这两个 hook 必须放在 refreshDispatchOwner / refreshThreadRole 的 useCallback **之后**
  //    （放在事件订阅那段会撞 TDZ：block-scoped variable used before its declaration）。
  useEffect(() => { void bag.refreshDispatchOwner(); }, [bag.refreshDispatchOwner, bag.thread?.id]);


  // ⛔ 调度锁「孤儿持有者」自愈（09-17 用户实测「都关掉了，怎么还提示被锁住了」）：
  //   锁的持有者是从 thread-runtime 记录**派生**的，而会话被归档/删除时历史上没有清记录
  //   ⇒ 持有者可能已经不在会话列表里，那种情况下用户**没有任何入口**能关掉它（侧栏找不到它）。
  //   这里发现持有者不在 threads 里就请主进程释放 —— 与主进程的 thread/archived|deleted 事件清理
  //   构成两道防线（事件清理覆盖所有路径，这里是历史坏数据的自愈）。
  useEffect(() => {
    if (!bag.dispatchOwnerId || bag.threads.length === 0) return;
    if (bag.threads.some((entry) => entry.id === bag.dispatchOwnerId)) return;
    void window.codex.releaseDispatch(bag.dispatchOwnerId).then(() => bag.refreshDispatchOwner()).catch(() => undefined);
  }, [bag.dispatchOwnerId, bag.threads, bag.refreshDispatchOwner]);


  useEffect(() => { void bag.refreshThreadRole(bag.thread?.id); }, [bag.refreshThreadRole, bag.thread?.id]);



  /** 应用调度开关：落盘 → 重算界面 → 从「关」变「开」时自动往对话框发一条告知消息。
   *  刻意用普通函数而不是 useCallback —— 它要调 send()，闭包必须是最新一次渲染的。 */
  async function applyDispatch(next: { enabled: boolean; expert: boolean; team: boolean; subagent: boolean }, opts?: { takeOver?: boolean }) {
    const id = bag.threadRef.current?.id;
    if (!id) { bag.showToast("先打开一个会话", "调度开关是会话级的，每个会话各自独立"); return; }
    const before = loadThreadRuntime(id).dispatch;
    bag.setDispatchBusy(true);
    try {
      // 独占锁（09-16 用户要求「同一时间只能一个会话开」）：冲突时主进程**不改动任何东西**并回传
      // blockedBy；用户明确接管（takeover）才在同一笔写入里把原持有者关掉 —— 原子，不会有中间态。
      const result: any = await saveThreadRuntime(id, { dispatch: normalizeDispatch(next) }, { takeover: opts?.takeOver === true });
      if (result?.restrictedBy) {
        // 主进程身份闸拒绝（专家 / 专家团 / 被调度会话不许开调度）：把本地乐观写入纠正回去，
        // 否则界面会显示成「已开启」而实际没生效（本地镜像先写、权威值后到）。
        writeThreadRuntimeMirror(id, { ...loadThreadRuntimeRaw(id), dispatch: emptyDispatch() });
        bag.setDispatchTick((tick) => tick + 1);
        bag.showToast(`本会话是${result.restrictedBy}会话，不开放调度`, "专家 / 专家团在团内自有协作通道；这些会话对外派人会让「谁在干活」失控");
        return;
      }
      if (result?.blockedBy) {
        bag.setDispatchOwnerId(String(result.blockedBy));
        bag.showToast("同一时间只能一个会话调度", "权限在另一个会话手里；确认面板里的「接管并开启」可以把它移到本会话");
        return;
      }
      bag.setDispatchTick((tick) => tick + 1);
      if (result?.tookOverFrom) {
        bag.setDispatchOwnerId(id);
        bag.showToast("调度权限已移到本会话", "同一时间只允许一个会话调度，原会话的开关已自动关闭");
      } else if (next.enabled) {
        bag.setDispatchOwnerId(id);
      } else {
        void bag.refreshDispatchOwner();
      }
      // ⛔ 工具面注册已改走内置 MCP（09-16 引擎硬约束：dynamicTools 只在 thread/start 生效，
      // resume/fork/turn/start 一律不认 —— 对已存在的会话没有任何「补注册」通道）。
      // MCP 工具对**所有会话**可见（含老会话），开关的闸在主进程执行端（holdsLock / 身份闸）。
      // 这里只落盘开关 + 发告知消息，不再重放 resume（那条路是假绿，实测模型答「没有」）。
      if (next.enabled && !before.enabled) {
        try {
          const notice: any = await window.codex.dispatchNotice();
          const text = String(notice?.text ?? "");
          // 走 pendingCommandTextRef：send() 会优先消费它，跳过 / 与 # 解析，正好适合系统告知
          if (text) { bag.pendingCommandTextRef.current = text; void bag.send(); }
        } catch { /* 告知失败不影响开关本身已生效 */ }
      } else if (!next.enabled && before.enabled) {
        // 关闭也要告知：让 Codex 立刻知道权限被收回，别白费回合去试
        try {
          const off: any = await window.codex.dispatchOffNotice();
          const text = String(off?.text ?? "");
          if (text) { bag.pendingCommandTextRef.current = text; void bag.send(); }
        } catch { /* 同上 */ }
      }
    } finally {
      bag.setDispatchBusy(false);
    }
  }
bag.applyDispatch = applyDispatch as typeof bag.applyDispatch;




  /** 主进程权威值的唯一收敛点（两条来源共用：patch 的返回值、跨窗口广播）。
   *  ① 写本地镜像 → 同步读路径立刻看到新值；② 若是当前打开的会话 → 同步 React 状态。
   *  只在**值确实与当前状态不同**时才 setState；提示只给「确实来自别的窗口」的改动——
   *  自己的写入会被主进程原样广播回来，那条回声必须被认出来丢掉（否则用户自己切个模型
   *  就会看到「另一个窗口更新了…」，09-14 实测的误报）。 */
  function admitThreadRuntime(id: string, runtime: unknown, opts?: { conflict?: boolean; fromRemote?: boolean }) {
    if (!id || !runtime) return;
    const next = normalizeRuntime(runtime);
    // ⛔ 迟到的响应/广播不许把镜像**回退**到更旧的版本：连写两次（切模型会同时写模型与档位）时，
    //    第一次的响应常在第二次写入之后才回来，照写会把镜像里的模型改回旧值。rev 单调，只升不降。
    const knownRev = Math.max(normalizeRuntime(loadThreadRuntimeRaw(id)).rev, bag.adoptedRevRef.current[id] ?? 0);
    // 迟到者一律丢弃：连写两次（切模型先写档位、再写模型）时，先写的那次响应/广播常常后到，
    // 照收会把界面与镜像一起回退成中间态（用户看到模型自己跳回去）。
    if (next.rev > 0 && next.rev < knownRev) return;
    if (next.rev > 0) bag.adoptedRevRef.current[id] = next.rev;
    writeThreadRuntimeMirror(id, next);
    // 自己刚写出去、又原样广播回来的那一份：镜像已写好（rev 跟主进程对齐），
    // 但**不许**当成「别的窗口改的」——用户自己切模型不该弹「另一个窗口更新了…」。
    if (isOwnEcho(ownRuntimeWrites, id, next)) return;
    if (bag.threadRef.current?.id !== id) return;
    const cur = bag.runtimeStateRef.current;
    const changed = (next.model && next.model !== cur.model) || (next.effort && next.effort !== cur.effort)
      || (next.sandbox && next.sandbox !== cur.sandbox) || (next.approval && next.approval !== cur.approval);
    if (next.model && next.model !== cur.model) bag.setModelId(next.model);
    if (next.effort && next.effort !== cur.effort) bag.setEffort(next.effort);
    if (next.sandbox && next.sandbox !== cur.sandbox) bag.setSandbox(next.sandbox);
    if (next.approval && next.approval !== cur.approval) bag.setApprovalPolicy(next.approval);
    // ⛔ 只有「广播来的、且不是自己回声」的改动才提示（09-14 用户实测的误报）：
    //    patch 返回的 conflict 只说明「你的 baseRev 过期了」——**过期可能是自己上一次写入造成的**
    //    （切模型同时写模型+档位 = 两次 patch），拿它当「另一个窗口改的」就会自己吓自己。
    //    真·别的窗口的改动一定有广播，这条通道足够，conflict 一律静默合并。
    if (changed && opts?.fromRemote) {
      bag.showToast("会话配置已同步", "这个会话的配置在另一个窗口被改过，已更新为最新");
    }
  }
bag.admitThreadRuntime = admitThreadRuntime as typeof bag.admitThreadRuntime;


  admitThreadRuntimeRef.current = bag.admitThreadRuntime;



  /** 打开会话时与主进程对齐：主进程没有记录 → 把本地（含旧键迁移）值播种上去；
   *  主进程有记录 → 以主进程为准（它才是多窗口下的权威）。 */
  async function syncThreadRuntimeWithMain(id: string) {
    if (!id) return;
    try {
      const main = await window.codex?.getThreadRuntime?.(id);
      if (main && main.rev > 0) { bag.admitThreadRuntime(id, main); return; }
      const local = loadThreadRuntime(id);
      if (runtimeSignature(local) !== "|||") {
        const seeded = await window.codex?.seedThreadRuntime?.({ threadId: id, runtime: local });
        if (seeded) bag.admitThreadRuntime(id, seeded);
      }
    } catch { /* 主进程不可用：本地镜像继续独立工作 */ }
  }
bag.syncThreadRuntimeWithMain = syncThreadRuntimeWithMain as typeof bag.syncThreadRuntimeWithMain;



  async function loadBaseInstructions(): Promise<string> {
    if (bag.baseInstructionsRef.current) return bag.baseInstructionsRef.current;
    try {
      const read: any = await window.codex.request("config/read", {});
      bag.baseInstructionsRef.current = String(read?.config?.developer_instructions ?? "");
    } catch { /* 读不到就只发作用域块（降级不致命） */ }
    return bag.baseInstructionsRef.current;
  }
bag.loadBaseInstructions = loadBaseInstructions as typeof bag.loadBaseInstructions;



  /** 组装「会话作用域」下发体。引擎把 collaboration_mode.settings.developer_instructions
   *  **持久在该会话自己的 thread settings 里**（rollout 的 `thread_settings_applied` 可回读），
   *  天然按会话隔离——A 会话切模型不会改写 B 会话模型能读到的配置。
   *  09-14 用户实测的根因：会话实际跑 glm-5.3-flash（rollout `turn_context.model` 实证），
   *  但模型没有任何「会话级出口」能回答「我是什么模型」，只能去读全局 config.toml /
   *  custom-model.json 的顶层 model（那只是「新建会话的默认值」），于是自报 deepseek-v4-flash
   *  → 用户看到的「模型还是串全局的」。修法 = 把会话级取值写进会话自己的 instructions。 */
  async function buildSessionScope(threadId: string, override?: { model?: unknown; effort?: unknown; sandbox?: unknown; approval?: unknown; provider?: unknown }): Promise<{ signature: string; collaborationMode: Record<string, unknown> } | null> {
    if (!threadId) return null;
    const model = String(override?.model ?? bag.selectedModel?.model ?? modelName(bag.modelId) ?? "").trim();
    if (!model) return null;
    const effortValue = override && "effort" in override ? String(override.effort ?? "") : String(bag.effort ?? "");
    const values = {
      threadId,
      model,
      provider: String(override?.provider ?? bag.customModel?.provider ?? ""),
      effort: effortValue,
      // 权限取本轮即将生效的值（调用方刚 setSandbox 时 React 状态还没刷新，必须由 override 传）
      sandbox: String(override?.sandbox ?? bag.sandbox ?? ""),
      approval: String(override?.approval ?? bag.approvalPolicy ?? ""),
      workspace: String(bag.workspace ?? ""),
    };
    const base = await bag.loadBaseInstructions();
    return {
      // 签名带上语气档：只有语气真的变了才重新下发（浮点不进签名，否则每回合都发一次 RPC）
      signature: `${sessionScopeSignature(values)}|${bag.adaptiveToneRef.current ? moodSignature(bag.readMood(threadId)) : ""}`,
      collaborationMode: {
        // 本应用引擎侧的会话协作模式恒为 default（rollout `task_started.collaboration_mode_kind`
        // 实证）；「计划模式」由 /plan 旗标 + turn/start 实现，不走引擎的 collaboration mode。
        mode: "default",
        settings: {
          model,
          reasoning_effort: effortValue || null,
          developer_instructions: composeMoodInstructions(composeScopeInstructions(base, sessionScopeBlock(values)), bag.adaptiveToneRef.current ? moodBlock(bag.readMood(threadId)) : ""),
        },
      },
    };
  }
bag.buildSessionScope = buildSessionScope as typeof bag.buildSessionScope;



  /** 把会话作用域下发到引擎（协议通道 = thread/settings/update；空会话无 rollout 时失败可忽略）。 */
  async function pushSessionScope(threadId: string, override?: { model?: unknown; effort?: unknown; sandbox?: unknown; approval?: unknown; provider?: unknown }) {
    if (!threadId) return;
    const built = await bag.buildSessionScope(threadId, override);
    if (!built) return;
    if (bag.scopeSigRef.current[threadId] === built.signature) return;
    try {
      await window.codex.request("thread/settings/update", { threadId, collaborationMode: built.collaborationMode });
      bag.scopeSigRef.current[threadId] = built.signature;
    } catch (error: any) {
      // 空会话还没落 rollout / 引擎重启中：留给下一次下发。**但要留痕** ——
      // 静默 catch 会让「状态变了、语气却没下发」这类问题完全查不出来（09-19 验收踩过）。
      bag.dbg("scope-push-fail", { threadId, err: String(error?.message ?? error).slice(0, 90) });
    }
  }
bag.pushSessionScope = pushSessionScope as typeof bag.pushSessionScope;



  /** 改「全局默认模型」的**唯一入口**（设置页「生效模型」/ 一键切中转站 / 启用官方订阅 /
   *  登录导入 / 供应商重启生效落定 / 无会话时在输入框选模型）。
   *  写全局默认 → 新会话用它；**若此刻有会话打开，只把这一个会话一并改过去**（用户意图：
   *  改了就生效）；其它会话一律不动 —— 「每个会话独立选模型」就靠这条保证，
   *  规则见 src/lib/model-scope.mjs。
   *  注意：不要在别处直接写 localStorage 的 `default-model`，否则会绕过这条作用域规则
   *  （离线预检有守卫断言盯着）。 */
  function applyGlobalModelChoice(nextId: string) {
    if (!nextId) return;
    try { localStorage.setItem("default-model", nextId); } catch { /* ignore */ }
    const openId = bag.threadRef.current?.id ?? "";
    if (shouldSyncOpenThread(openId)) saveThreadModel(openId, nextId);
  }
bag.applyGlobalModelChoice = applyGlobalModelChoice as typeof bag.applyGlobalModelChoice;



  function savedEffortFor(model: string | undefined) {
    if (!model) return "";
    try { return (JSON.parse(localStorage.getItem("model-efforts") ?? "{}") as Record<string, string>)[model] ?? ""; } catch { return ""; }
  }
bag.savedEffortFor = savedEffortFor as typeof bag.savedEffortFor;



  function rememberEffortFor(model: string | undefined, value: string) {
    if (!model || !value) return;
    try {
      const map = JSON.parse(localStorage.getItem("model-efforts") ?? "{}") as Record<string, string>;
      map[model] = value;
      localStorage.setItem("model-efforts", JSON.stringify(map));
    } catch { /* 忽略 */ }
  }
bag.rememberEffortFor = rememberEffortFor as typeof bag.rememberEffortFor;
  return { taskRunning, lastTurnOfThread, turnFinalizing, runActivity, runPhrase, setRunPhrase, runActivityRef, finalizePhraseRef, applyDispatch, admitThreadRuntime, syncThreadRuntimeWithMain, loadBaseInstructions, buildSessionScope, pushSessionScope, applyGlobalModelChoice, savedEffortFor, rememberEffortFor };
}
