/**
 * usePart06b1 —— usePart06b 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：回合运行态与运行时同步 · 模型选择与线程设置权限
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { isCompactionItem } from "../../../../../lib/compaction-item.mjs";
import { queueInlineNotice } from "../../../../../lib/inline-notices.mjs";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { resolveModelForOpen, shouldSyncOpenThread } from "../../../../../lib/model-scope.mjs";
import { composeScopeInstructions, sessionScopeBlock, sessionScopeSignature } from "../../../../../lib/session-scope.mjs";
import { getAnnounceGlobalEnabled, isAnnounceMutedForThread } from "../../../../../voice/announce-bus";
import { advanceMood, composeMoodInstructions, emptyMood, moodBlock, moodSignature, moodTone, normalizeMood, userSignalOf } from "../../../../../lib/agent-mood.mjs";
import { inquiryInstruction } from "../../../../../lib/reply-style.mjs";
import { handoffNudge } from "../../../../../lib/handoff-nudge.mjs";
import { LEGACY_PREFIX, dispatchSignature, emptyDispatch, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeDispatch, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeKey, runtimeSignature } from "../../../../../lib/thread-runtime.mjs";
import { describeTurnStop, turnHeadline, isAwaitingTurnClose } from "../../../../../lib/turn-stop-reason.mjs";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

/**
 * fileChange → 「正在生成文件」还是「正在编辑文件」。
 *
 * 引擎的 FileChange 只有 `changes[{ path, diff }]`（部分版本另带 kind/status）：
 * 新增文件的 diff 以 `--- /dev/null` 开头（或带 `new file mode`）。
 * ⛔ 判据只在这里：状态文案别在渲染层再判一次（两处判定迟早漂移）。
 */
type FileChangeLike = { path?: string; filePath?: string; diff?: string; kind?: string; status?: string };

function fileChangeActivity(item: { changes?: FileChangeLike[] } | null | undefined): "正在生成文件" | "正在编辑文件" {
  const changes: FileChangeLike[] = Array.isArray(item?.changes) ? item!.changes! : [];
  if (!changes.length) return "正在编辑文件";
  const allNew = changes.every((change) => {
    const kind = String(change?.kind ?? change?.status ?? "").toLowerCase();
    if (kind === "add" || kind === "added" || kind === "create" || kind === "created") return true;
    const diff = String(change?.diff ?? "");
    return /^---\s+\/dev\/null/m.test(diff) || /^new file mode/m.test(diff);
  });
  return allNew ? "正在生成文件" : "正在编辑文件";
}

export function usePart06b1(bag: Bag) {
  // ── 运行动态状态行（09-16，学 WorkBuddy 消息底部那个）─────────────────────────
  // 状态 = 当前会话**最后一个进行中的 item** 的类型（执行命令/编辑文件/思考…），
  // 找不到进行中 item 时兜底「等待模型回复」；话语 = 任务开始时随机锁定一句，运行期不换。
  const taskRunning = Boolean(bag.sending || bag.activeTurnId);
bag.taskRunning = taskRunning as typeof bag.taskRunning;


  // ⛔ 收尾等待（09-18）：判据独立成布尔量，**不要用展示文案做状态判断** ——
  //   原先写成 `runActivity === "正文已完整，等待模型收尾"`（旧文案），把可读文案当逻辑判据，
  //   改一个字（文案优化）就会静默失效、退回「正在生成回复」而没人发现（审查抓出）。
  const lastTurnOfThread = bag.thread?.turns?.[bag.thread.turns.length - 1];
bag.lastTurnOfThread = lastTurnOfThread as typeof bag.lastTurnOfThread;


  const turnFinalizing = Boolean(bag.taskRunning && isAwaitingTurnClose(bag.lastTurnOfThread));
bag.turnFinalizing = turnFinalizing as typeof bag.turnFinalizing;


  const runActivity = useMemo(() => {
    if (!bag.taskRunning || !bag.thread) return "";
    const thread = bag.thread;
    /* ⛔ 三阶段的前两段来自**发送链路的真实事件边界**（send.tsx: 点发送→turn/start 发出→引擎回 turn），
       不是按时间瞎猜：有值时它最高优先，没有才轮到下面的 item 扫描。 */
    if (bag.sendPhase) return bag.sendPhase;
    /* ⛔ 待审批是**用户阻塞**状态，优先级高于"模型在干活"：审批卡已经弹出来了，
       状态行再写「正在运行命令」会让人以为它自己在跑（实际在等你点）。
       ⛔ 只认**本会话**的请求（pending 里可能有别的会话的）。 */
    const myPending = (bag.pending ?? []).filter((request) => {
      const params = (request as { params?: { threadId?: string | null } } | null)?.params;
      const tid = String(params?.threadId ?? "");
      return (!tid || tid === thread.id) && /approval/i.test(String(request?.method ?? ""));
    });
    if (myPending.length) return "等待你确认";
    const turns = thread.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const items = turns[i].items ?? [];
      for (let j = items.length - 1; j >= 0; j--) {
        const item = items[j] as any;
        /* ⛔ 10-28 用户实测（截图）：「思考板块输出思考内容的时候，映射的文字是『生成回复中』」——
           原因是流式中的 item 常常**还没有 status/durationMs**（引擎先建 item、后补状态），
           旧判据只看 status ⇒ 跳过它 ⇒ 掉到兜底文案。
           ⇒ 最后一个 item 只要没标完成，且在跑的回合里，就按"进行中"算。 */
        const started = item?.status === "inProgress" || item?.status === "running";
        const statusless = !item?.status && !item?.durationMs && j === items.length - 1 && i === turns.length - 1;
        if (!started && !statusless) continue;
        // ⛔ contextCompaction 不是「生成回复」（09-26 用户截图：压缩期间状态条挂
        //    「正在生成回复 · 正在落笔」）—— 压缩有自己的指示，但**状态条也不该装作在写回复**；
        //    这里如实说「正在整理上下文」，找不到真实活动才走兜底。
        if (isCompactionItem(item)) continue;
        /* ⛔ 10-28 用户令：状态精简为五种主状态 ——
             等待模型回复 / 生成回复中 / 正在编辑文件 / 正在运行命令 / 正在生成文件。
           其余状态** truthful 才出现**（搜索网页 / 调用工具），不参与"五种"的命名口径。
           ⛔ 文案是**逻辑的唯一出口**：别在别处再拼一份（bag-types 的联合类型同步改）。 */
        switch (item.type) {
          case "commandExecution": return "正在运行命令";
          case "fileChange": return fileChangeActivity(item);
          /* ⛔ 10-28 用户二次确认（两次原话）：「思考板块输出思考内容的时候，映射的文字就是生成回复中」
             「正在思考下面映射的文字要是生成回复中」⇒ 思考与正文**都算在产出回复**，
             统一映射为「生成回复中」；「正在思考」不再单独出现在状态行
             （思考卡自己写着「深度思考中」，状态行再写一遍就是同屏重复）。 */
          case "reasoning":
          case "agentMessage": return "生成回复中";
          case "webSearch": return "正在搜索网页";
          case "mcpToolCall":
          case "dynamicToolCall":
          case "collabAgentToolCall":
          case "subAgentActivity": return "正在调用工具";
        }
      }
    }
    // ⛔ 压缩进行中不给「等待模型回复」：引擎在压缩上下文，不在等回复（09-26 用户的原始抱怨）。
    if (bag.compactPendingRef.current.has(thread.id)) return "正在整理上下文";
    // ⛔ 兜底要分两种（09-18 用户实测「回复完了还没结束，啥情况」）：GPT 系模型输出完正文后，
    //   上游迟迟不发流结束信号（真机实测 gpt-5.6-sol 正文完成后 28 秒零事件才 task_complete），
    //   此时说「等待模型回复」会让人以为还在憋正文 —— 如实说「等待模型收尾」。
    //   判据**复用纯函数**，不在这里抄第二份（两份判定迟早漂移，且纯函数那份有行为断言守着）。
    return bag.turnFinalizing ? "等待模型收尾" : "等待模型回复";
  }, [bag.taskRunning, bag.thread, bag.turnFinalizing, bag.sendPhase]);
bag.runActivity = runActivity as typeof bag.runActivity;



  const [runPhrase, setRunPhrase] = useState("");
bag.runPhrase = runPhrase as typeof bag.runPhrase; bag.setRunPhrase = setRunPhrase as typeof bag.setRunPhrase;


  // 取词只做一次，用 ref 读「当时的活动」：不把 runActivity 放进依赖，
  // 否则状态一从「思考」切到「执行命令」就把句子换掉（运行期换句子会闹腾）。
  const runActivityRef = useRef("");
bag.runActivityRef = runActivityRef as typeof bag.runActivityRef;


  useEffect(() => { bag.runActivityRef.current = bag.runActivity; }, [bag.runActivity]);


  useEffect(() => {
    if (bag.taskRunning && !bag.runPhrase) bag.setRunPhrase(pickRunPhrase(bag.runActivityRef.current || "等待模型回复"));
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
    bag.setRunPhrase(bag.turnFinalizing ? pickRunPhraseExact("等待模型收尾") : pickRunPhrase(bag.runActivity || "等待模型回复"));
  }, [bag.taskRunning, bag.turnFinalizing, bag.runActivity]);



  // ⛔ 这两类 refresh 必须放在 refreshThreadRole 的 useCallback **之后**
  //    （放在事件订阅那段会撞 TDZ：block-scoped variable used before its declaration）。
  // 10-29：调度独占锁（持有者 / 孤儿锁自愈 / 一键释放）已随「每个会话都能调度」下线。

  useEffect(() => { void bag.refreshThreadRole(bag.thread?.id); }, [bag.refreshThreadRole, bag.thread?.id]);



  /** 应用调度许可：落盘 → 重算界面 → 把**差集**告诉 Codex（一条通知）。
   *  刻意用普通函数而不是 useCallback —— 它要读最新的 threadRef。
   *
   *  ⛔ 10-29：总开关 / 独占锁 / 接管全部删除（「每个会话都可以调度」）⇒ 只剩一条路径：
   *    before → next 的三类差集不为空就发一条「调度范围已更新」（含新开启类的对象名单）。
   *  ⚠️ before 必须取**确认前**的值（本函数开头取），拿 next 当 before ⇒ 差集恒空 ⇒ 永远不发（假绿）。 */
  async function applyDispatch(next: { expert: boolean; team: boolean; subagent: boolean }) {
    const id = bag.threadRef.current?.id;
    if (!id) { bag.showToast("先打开一个会话", "调度许可是会话级的，每个会话各自独立"); return; }
    const before = loadThreadRuntime(id).dispatch;
    bag.setDispatchBusy(true);
    try {
      const result: any = await saveThreadRuntime(id, { dispatch: normalizeDispatch(next) });
      if (result?.restrictedBy) {
        // 主进程身份闸拒绝（专家 / 专家团 / 被调度会话不许改许可）：把本地乐观写入纠正回去，
        // 否则界面会显示成「已开启」而实际没生效（本地镜像先写、权威值后到）。
        writeThreadRuntimeMirror(id, { ...loadThreadRuntimeRaw(id), dispatch: emptyDispatch() });
        bag.setDispatchTick((tick) => tick + 1);
        bag.showToast(`本会话是${result.restrictedBy}会话，不开放调度`, "专家 / 专家团在团内自有协作通道；这些会话对外派人会让「谁在干活」失控");
        return;
      }
      bag.setDispatchTick((tick) => tick + 1);
      const changed = before.expert !== next.expert || before.team !== next.team || before.subagent !== next.subagent;
      if (!changed) return;
      try {
        const chg: any = await window.codex.dispatchNotice(
          { expert: before.expert, team: before.team, subagent: before.subagent },
          { expert: next.expert, team: next.team, subagent: next.subagent },
        );
        const text = String(chg?.text ?? "");
        /* ⛔⛔ 会话作用域闸（10-04 用户报「新会话冒出调度已关闭」）：IPC 往返期间用户可能已切走会话，
           bag.thread 已变 ⇒ 会把 A 会话的通知发进 B。目标会话不在前台就丢弃（许可本身已按 id 落库）。
           ⛔ 10-26 用户令：不单独发一轮（会凭空多一条"我说的"气泡）⇒ 入队，随**下一条消息**注入。 */
        if (text && bag.threadRef.current?.id === id) queueInlineNotice(id, text);
      } catch { /* 告知失败不影响许可本身已生效 */ }
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
      /* 10-22：本会话喇叭状态随每轮 send 前的 pushSessionScope 下发（见 part08 send）。
         ⛔ 只读会话级 mute，不读全局 announce.enabled —— 全局 true 时本会话仍可能被 📢 关掉。 */
      announceMuted: isAnnounceMutedForThread(threadId) ? "1" : "0",
      /* 有效状态 = 总开关 ∧ 本会话未静音。⛔ 只在发送前注入 developer instructions，
         不再往对话里发可见告知（10-25 用户：「不要每次切换还发个消息出去」）。 */
      announceOn: getAnnounceGlobalEnabled() !== false && !isAnnounceMutedForThread(threadId) ? "1" : "0",
    };
    const base = await bag.loadBaseInstructions();
    return {
      // 签名带上语气档：只有语气真的变了才重新下发（浮点不进签名，否则每回合都发一次 RPC）
      /* 签名带上回复风格：切到「需求询问」要立刻重下发 instructions（否则要等下次开新会话才生效） */
      signature: `${sessionScopeSignature(values)}|${bag.adaptiveToneRef.current ? moodSignature(bag.readMood(threadId)) : ""}|style:${bag.personality ?? ""}`,
      /* 10-27 需求询问：developer_instructions = [语气块, 「先用 grill-me 问清需求」块]。
         后者是行为不是语气，不进引擎 personality（只认官方三档）。 */
      collaborationMode: {
        // 本应用引擎侧的会话协作模式恒为 default（rollout `task_started.collaboration_mode_kind`
        // 实证）；「计划模式」由 /plan 旗标 + turn/start 实现，不走引擎的 collaboration mode。
        mode: "default",
        settings: {
          model,
          reasoning_effort: effortValue || null,
          developer_instructions: [composeMoodInstructions(composeScopeInstructions(base, sessionScopeBlock(values)), bag.adaptiveToneRef.current ? moodBlock(bag.readMood(threadId)) : ""), inquiryInstruction(bag.personality), handoffNudge()].filter(Boolean).join("\n\n"),
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
