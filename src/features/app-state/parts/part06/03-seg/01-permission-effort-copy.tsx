/**
 * usePart06c1 —— usePart06c 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：权限/沙箱/力度/人格 · 复制与引用 · 编辑重发 — 图片/上下文/技能引用 · 分叉 · 备份导入导出 · 新会话
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { declaredModelEfforts } from "../../../../../lib/effort";
import "@xterm/xterm/css/xterm.css";
import { copyTextToClipboard } from "../../../../../lib/clipboard";
import { imageToken, splitPromptSegments, promptImagePaths, stripImageTokens, isImagePart, imagePartSrc, normalizeImagePartForSend } from "../../../../../lib/prompt-images";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../../lib/turn-fold";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../../lib/user-refs";
import { Turn } from "../../../../../lib/turn";
import { ThreadItem } from "../../../../../lib/thread-item";
import { justSentIds } from "../../../../../lib/just-sent-ids";
import { itemText } from "../../../../../lib/item-text";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export function usePart06c1(bag: Bag) {
  // 设置页全局审批权限的展示值（与 localStorage 双写，进页面读一次）
  const [globalPermApproval, setGlobalPermApproval] = useState(() => localStorage.getItem("default-approval") ?? "on-request");
bag.globalPermApproval = globalPermApproval as typeof bag.globalPermApproval; bag.setGlobalPermApproval = setGlobalPermApproval as typeof bag.setGlobalPermApproval;

  /** 设置页「全局审批权限」：只写全局默认并应用到**未被手动改过权限**的会话。
   *  与胶囊（changePermissionMode）的差异：胶囊会把当前会话写进本地记录（= 手动修改，
   *  之后不随全局）；这里不动任何会话的记录——手动改过的对话框保留自己的选择。
   *  全局默认落在 localStorage，重启/换供应商都不会变（沙箱策略同时按档位联动）。 */
  function applyGlobalPermissionMode(value: string) {
    const sandboxValue = value === "never" ? "danger-full-access" : "workspace-write";
    const approvalValue = value === "never" ? "never" : value;
    bag.setGlobalPermApproval(value);
    localStorage.setItem("default-sandbox", sandboxValue);
    localStorage.setItem("default-approval", approvalValue);
    const current = bag.threadRef.current;
    const manual = current ? loadThreadPermissions(current.id) : { sandbox: "", approval: "" };
    if (current && (manual.sandbox || manual.approval)) {
      bag.showToast("全局权限已更新", "当前会话手动改过权限，保留它自己的选择；其余会话与新会话使用新档位");
      return;
    }
    bag.setSandbox(sandboxValue);
    bag.setApprovalPolicy(approvalValue);
    if (current) void bag.pushThreadPermissions(current.id, sandboxValue, approvalValue);
    bag.showToast("全局权限已更新", "所有未手动改过权限的会话与新会话都使用新档位，重启不变");
  }
bag.applyGlobalPermissionMode = applyGlobalPermissionMode as typeof bag.applyGlobalPermissionMode;

  function changeSandbox(value: string) {
    // 切换执行范围不会废弃 Codex 的工具或推理能力；只改变命令/文件操作是否需要审批。
    // 从完全访问降级时默认启用按需审批，确保它仍会请求授权并继续执行。
    const nextApproval = value === "danger-full-access" ? "never" : bag.approvalPolicy === "never" ? "on-request" : bag.approvalPolicy;
    bag.setSandbox(value);
    bag.setApprovalPolicy(nextApproval);
    // ⛔ 多窗口作用域（09-13，对齐模型/effort 的修法）：有会话时权限只落到**该会话**
    // （saveThreadPermissions + pushThreadPermissions 双通道钉住引擎侧），不再写全局
    // default-sandbox/default-approval——那是全应用共享的，A 窗口切权限会把 B 窗口
    // 会话的重启兜底/新会话默认一起改掉（用户实测权限串扰）。无会话时选的才是全局默认。
    if (bag.threadRef.current) {
      saveThreadPermissions(bag.threadRef.current.id, value, nextApproval);
      void bag.pushThreadPermissions(bag.threadRef.current.id, value, nextApproval);
    } else {
      localStorage.setItem("default-sandbox", value);
      localStorage.setItem("default-approval", nextApproval);
    }
  }
bag.changeSandbox = changeSandbox as typeof bag.changeSandbox;

  /** 只切档位、不碰模型声明（供菜单选择/命令与「声明被取消后回落」分别使用） */
  function applyEffort(value: string) {
    bag.setEffort(value);
    // ⛔ 多会话/多窗口作用域（09-13）：有会话只落会话级，无会话才写全局默认
    // （原实现无条件写 default-effort，A 会话切档位污染 B 会话的重启兜底/新会话默认）
    if (bag.threadRef.current?.id) saveThreadEffort(bag.threadRef.current.id, value);
    else localStorage.setItem("default-effort", value);
    bag.rememberEffortFor(bag.selectedModel?.model ?? modelName(bag.modelId), value);
    void bag.updateThreadSettings({ effort: value });
    // ⛔ 跟着模型保存（09-16 用户实测「思考等级不是跟着模型保存生效的，每次都要二次保存」）：
    // 过去只有「无会话」时才写档案，会话里选的档位只活在会话记录里 → 新会话/切回模型时
    // 走档案对账弹回旧档位，用户必须重选一次。现在无论有无会话都把档位写进档案
    // models[].effort（该模型自己的字段，不是全局共享），新会话自动跟随最后选择的档位。
    // 会话内仍由每轮 turn/start 的 effort 下发（权威），档案值只作新会话兜底默认。
    const provider = bag.customModel?.provider;
    const archivedModel = bag.selectedModel?.model ?? bag.customModel?.model;
    if (provider && archivedModel) {
      void window.codex.setProviderEffort({ provider, model: archivedModel, effort: value })
        .then((next) => bag.setCustomModel(next))
        .catch(() => undefined);
    }
  }
bag.applyEffort = applyEffort as typeof bag.applyEffort;

  function changeEffort(value: string) {
    // 档位声明（models[].efforts）已随模型配置里的勾选区一起删除（09-18）——
    // 这里不再 upsert 补声明：档位是纯会话级选择，不被支持时由发送失败自动降档兜底。
    bag.applyEffort(value);
  }
bag.changeEffort = changeEffort as typeof bag.changeEffort;

  /* ── Laya 思考等级自动切换（10-01 用户立项：「内置一个 laya 判断模型，自动切换思考等级」）──
     effortAuto 是**全局开关**（localStorage），不进 effort 值域（⛔ normalizeEffort 会把非白名单
     值洗成 high——auto 走独立布尔就零侵入）。发送链（send.tsx）在 effortAuto 开启时先调
     resolveAutoEffort 拿判定档：laya 33ms choice（低/中/高/极高）+ 校准置信度；置信 <0.45 或
     服务未装/失败 ⇒ null ⇒ 回落 bag.effort（手选档），判断器是增强不是依赖。 */
  const [effortAuto, setEffortAuto] = useState(() => localStorage.getItem("effort-auto-v1") === "1");
bag.effortAuto = effortAuto as typeof bag.effortAuto;

  function changeEffortAuto(on: boolean) {
    setEffortAuto(on);
    localStorage.setItem("effort-auto-v1", on ? "1" : "0");
  }
bag.changeEffortAuto = changeEffortAuto as typeof bag.changeEffortAuto;

  /* ⛔ 自动档延迟纪律（10-01 用户实测后定标：「判定要 50ms 内透出来，做不到就是废物」）：
     本机实测 laya-serve 单次判定 ~200ms（PyTorch CPU + HTTP），发anything送时现场判都超标 ——
     所以判定**前移到输入停顿**：打字停 700ms 就预先判好进缓存，发送时命中缓存 0ms 透出；
     只有最后 700ms 内还在改字才现场判（~200ms，仍在 3s 硬上限内且不阻塞上屏——乐观气泡
     先上、判定在 turn/start 之前完成）。 */
  const autoEffortCache = useRef(new Map<string, string>()); // 消息原文 → 判定档（已过支持档过滤）

  async function resolveAutoEffort(text: string): Promise<string | null> {
    const cached = autoEffortCache.current.get(text);
    if (cached) return cached; // 命中预判缓存：0ms
    try {
      const result = await window.codex.layaDecideEffort(text);
      if (!result?.effort) return null;
      // ⛔ 模型实际声明档过滤：判定档不被支持时降到相邻可用档（发送失败自动降档是兜底，别主动踩）
      const supported = declaredModelEfforts((bag.selectedModel as any)?.supportedReasoningEfforts ?? undefined);
      let chosen = result.effort;
      if (supported.length && !supported.includes(result.effort)) {
        const order = ["low", "medium", "high", "xhigh"];
        const idx = order.indexOf(result.effort);
        const near = [order[idx - 1], order[idx + 1]].filter((x): x is string => Boolean(x) && supported.includes(x));
        if (!near.length) return null;
        chosen = near[0];
      }
      if (autoEffortCache.current.size > 50) autoEffortCache.current.clear();
      autoEffortCache.current.set(text, chosen);
      return chosen;
    } catch {
      return null; // laya 未装/未就绪/超时 —— 判断器是增强，静默降级到手选档
    }
  }
bag.resolveAutoEffort = resolveAutoEffort as typeof bag.resolveAutoEffort;

  /* 预判：effortAuto 开着时，输入停顿 700ms 就把当前草稿的档位判好（打字期间零成本，
     发送时大概率命中缓存）。判定是纯读操作，改了草稿自然失效，不需要失效逻辑。 */
  useEffect(() => {
    if (!bag.effortAuto) return;
    const draft = bag.prompt.trim();
    if (draft.length < 2 || autoEffortCache.current.has(draft)) return;
    const timer = setTimeout(() => { void resolveAutoEffort(draft); }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bag.prompt, bag.effortAuto]);

  // Laya 安装/就绪状态（供 EffortPicker 自动档的可用性展示；15s 轮询够——状态变化低频）
  const [layaInstalled, setLayaInstalled] = useState(false);
  const [layaReady, setLayaReady] = useState(false);
bag.layaInstalled = layaInstalled as typeof bag.layaInstalled;
bag.layaReady = layaReady as typeof bag.layaReady;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await window.codex.layaStatus();
        if (!alive) return;
        setLayaInstalled(Boolean(s?.installed));
        setLayaReady(Boolean(s?.ready));
      } catch { /* 未装时 IPC 也返回结构化状态，不该炸 */ }
    };
    void poll();
    const timer = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // ⛔「声明被取消后回落」的补正 effect 已删除（09-18）：模型档位声明不存在了，
  //   菜单恒为全集，任何档位都是合法选择 —— 不支持的档位交给发送时的自动降档兜底。

  function changePersonality(value: string) {
    bag.setPersonality(value);
    localStorage.setItem("default-personality", value);
    void bag.updateThreadSettings({ personality: value === "none" ? null : value });
  }
bag.changePersonality = changePersonality as typeof bag.changePersonality;

  async function copyMessage(text: string) {
    try {
      await copyTextToClipboard(text);
      bag.setNotice("消息已复制");
    } catch (error: any) {
      bag.setNotice(`复制失败：${error.message}`);
    }
  }
bag.copyMessage = copyMessage as typeof bag.copyMessage;

  async function copyThreadReferenceId(target: { id: string }) {
    try {
      await copyTextToClipboard(`会话 ID：${target.id}`);
      bag.showToast("会话 ID 已复制", "粘贴到其他会话并发送，即可读取这条会话的对话记录");
    } catch (error: any) {
      bag.setNotice(`复制会话 ID 失败：${error.message}`);
    }
  }
bag.copyThreadReferenceId = copyThreadReferenceId as typeof bag.copyThreadReferenceId;

  async function loadThreadReference(id: string): Promise<ThreadReferencePayload | null> {
    // 新版桌面端优先从 rollout 原档只读，不触发会话切换；旧版本回退到 app-server resume。
    const previewConversation = (window.codex as any).previewConversation;
    if (typeof previewConversation === "function") {
      try {
        const preview = await previewConversation(id);
        if (preview?.messages?.length) {
          return buildThreadReferencePayload(id, preview.name, preview.messages);
        }
      } catch { /* 继续使用引擎回退 */ }
    }
    const result = await resumeThreadWithTurns({ threadId: id, excludeTurns: false });
    if (!result?.thread) return null;
    const source = normalizeLoadedThread(result.thread as Thread);
    const messages: { role: "user" | "assistant"; text: string }[] = [];
    for (const sourceTurn of source.turns ?? []) {
      for (const item of sourceTurn.items ?? []) {
        if (item.type === "userMessage") {
          const text = userDisplayText(itemText(item));
          if (text) messages.push({ role: "user", text });
        } else if (item.type === "agentMessage") {
          const text = itemText(item).trim();
          if (text) messages.push({ role: "assistant", text });
        }
      }
    }
    return buildThreadReferencePayload(id, source.name || source.preview || "未命名会话", messages);
  }
bag.loadThreadReference = loadThreadReference as typeof bag.loadThreadReference;

  async function resolveThreadReferences(text: string, currentThreadId?: string): Promise<{ text: string; blocks: string; referenced: boolean }> {
    const ids = extractThreadReferenceIds(text);
    if (!ids.length) return { text, blocks: "", referenced: false };
    const references: ThreadReferencePayload[] = [];
    const failures: string[] = [];
    for (const id of ids) {
      if (id === currentThreadId?.toLowerCase()) {
        failures.push(`${id.slice(0, 8)}（不能引用当前会话自身）`);
        continue;
      }
      try {
        const reference = await bag.loadThreadReference(id);
        if (reference) references.push(reference);
        else failures.push(`${id.slice(0, 8)}（没有可读取的消息）`);
      } catch {
        failures.push(`${id.slice(0, 8)}（未找到或无法读取）`);
      }
    }
    if (!references.length) throw new Error(`会话引用失败：${failures.join("；")}`);
    if (failures.length) bag.showToast("部分会话引用失败", failures.join("；"));
    return {
      text: stripThreadReferenceIds(text),
      blocks: references.map(formatThreadReferenceBlock).join("\n\n"),
      referenced: true,
    };
  }
bag.resolveThreadReferences = resolveThreadReferences as typeof bag.resolveThreadReferences;

  async function editResend(turnId: string, item: ThreadItem) {
    if (!bag.thread) return;
    if (bag.sending || bag.activeTurnId) { bag.setNotice("请先停止当前任务，再编辑重发"); return; }
    /* ⛔ 原先这里有一道并发闸门（编辑重发 = 新增一路并发，超限就拦）。09-25 用户要求删除并发限制
       ⇒ 移除；编辑重发不再受「同时跑几路」约束。 */
    if (!bag.customModel || !bag.selectedModel) { bag.setNotice("请先配置并启用自定义模型"); bag.setSettingsOpen(true); return; }
    const text = (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    if (!text.trim()) { bag.setNotice("该消息没有可编辑的文本"); return; }
    // ⛔⛔ 09-19 用户要求（原话：「我点编辑消息，保存就知道新建会话，要在原会话继续跑」）：
    //   编辑重发**不再 fork 分支** —— 直接在**当前会话**重新发送编辑后的内容。
    //   引擎的 rollout 不可改写，所以时间线上会保留原消息 + 新消息（可见、可追溯），
    //   但会话是同一个：上下文、模型、权限、侧栏位置全不变，不再有"另开一个会话"的错觉。
    //   （09-18 那套「fork 失败要回退 thread」的逻辑已随 fork 一起去掉：没换过 thread，
    //     失败时什么都不用回退 —— 代码审查发现 `before` 当时已沦为死代码。）
    try {
      const forked = { thread: bag.threadRef.current ?? bag.thread };
      const input = [
        { type: "text", text, text_elements: [] },
        ...(item.content ?? []).filter(isImagePart).map(normalizeImagePartForSend).filter(Boolean),
      ];
      bag.setSending(true);
      bag.setWorkStartedAt(Date.now());
      bag.optimisticTurnIdRef.current = null;
      bag.optimisticBaselineRef.current = { threadId: forked.thread.id, turnIds: new Set((forked.thread.turns ?? []).map((entry: Turn) => entry.id)) };
      const optimisticId = `local-${Date.now()}`;
      justSentIds.add(optimisticId);
      armSendAnimationClaim(text);   // 编辑重发同样让真实消息认领入场动画
      // ⛔ 必须重置安全阀判据（与两条普通发送路径同款，见该 effect 的 09-17 注释）：
      //   编辑重发换了 thread（fork），旧 thread 的「曾出现过运行中回合」不适用；
      //   不重置的话，fork 回来时新回合还没建（running=false）+ 上轮残留的 true ⇒
      //   气泡**当帧就被回收**，用户编辑后的那 1~2 秒里自己的消息完全不在界面上
      //   （09-18 实测埋点 confirm-timeout + pending 恒为 0）。
      bag.sawRunningTurnRef.current = false;
      bag.setOptimisticInput({ id: optimisticId, type: "userMessage", content: input });
      // 编辑分支发送同样锚顶（与主发送一致，见 anchorTopRef 注释）
      bag.stickToBottomRef.current = false;
      bag.anchorTopRef.current = true;
      bag.anchorTurnIdRef.current = null;
      bag.dbg("send-arm-fork");
      bag.activeModelRef.current = bag.selectedModel?.model ?? modelName(bag.modelId);
      const result = await window.codex.request("turn/start", {
        threadId: forked.thread.id,
        input,
        model: bag.selectedModel?.model ?? modelName(bag.modelId),
        effort: bag.effort || null,
        personality: bag.selectedModel?.supportsPersonality ? bag.personality : null,
        approvalPolicy: bag.approvalPolicy,
        // 沙箱逐回合下发：编辑重发就在原会话里跑，按该会话自己的权限（白名单校验后）
        sandboxPolicy: sandboxPolicy(threadSandboxOf(forked.thread.id) ?? bag.sandbox, forked.thread.cwd ?? bag.workspace ?? ""),
      });
      if (!result.turn?.id) {
        // 引擎返回了但没给回合（异常分支）：没换过 thread，只需复位运行态并说明
        bag.setSending(false);
        bag.setWorkStartedAt(null);
        bag.setOptimisticInput(null);
        bag.setNotice("编辑重发失败：引擎没有返回新回合，已回到原来的消息");
        return;
      }
      {
        const hydratedTurn = hydrateTurnUserMessage(result.turn, input);
        bag.optimisticTurnIdRef.current = hydratedTurn.id;
        bag.setActiveTurnId(hydratedTurn.id);
        bag.markThreadRunning(forked.thread.id, hydratedTurn.id);
        saveThreadModel(forked.thread.id, bag.modelId);
        bag.setThread((current) => { const next = mergeTurn(current, hydratedTurn); bag.threadRef.current = next; return next; });
        const forkHit = hydratedTurn.items.find((entry) => entry.type === "userMessage" && userMessageMatchesInput(entry, input));
        if (forkHit) bag.setOptimisticInput(null);
      }
      void bag.refreshThreads();
      bag.showToast("已编辑重发", "已在原会话重新发送（历史保留原消息）");
    } catch (error: any) {
      // 没换过 thread，无需回退会话；只复位运行态并把编辑内容还给用户（消息本来就在历史里）
      bag.setSending(false);
      bag.setWorkStartedAt(null);
      bag.setOptimisticInput(null);
      bag.setNotice(`编辑重发失败：${error.message}（原消息仍在，可重试）`);
    }
  }
bag.editResend = editResend as typeof bag.editResend;
  return { globalPermApproval, setGlobalPermApproval, applyGlobalPermissionMode, changeSandbox, applyEffort, changeEffort, changePersonality, copyMessage, copyThreadReferenceId, loadThreadReference, resolveThreadReferences, editResend };
}
