/**
 * usePart01a（09-22：part01 按序切分出来的第 1 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { loadDraft, saveDraft } from "../../../../lib/composer-draft.mjs";
import { mergeDictation } from "../../../../lib/dictation-merge.mjs";
import { DEFAULT_EFFORT, pickDefaultEffort, normalizeEffort, ALL_EFFORTS, declaredModelEfforts } from "../../../../lib/effort";
import { requestVoiceDictation, setVoiceDictationSendHandler, setVoiceOpenSettingsHandler, subscribeVoiceStage } from "../../../../voice/wave-level";
import { matchesVoiceAccelerator } from "../../../../voice/hotkey-match";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";

export function usePart01a(bag: Bag) {
  const [serverStatus, setServerStatus] = useState("starting");
bag.serverStatus = serverStatus as typeof bag.serverStatus; bag.setServerStatus = setServerStatus as typeof bag.setServerStatus;


  /** 独立会话弹窗模式（09-13）：非空 = 本窗口是弹窗，值 = 弹窗锁定的会话 id。
   *  弹窗窗口与主窗口同构（完整侧边栏/顶栏都带着），只多一个「返回主应用」按钮；
   *  初始打开 popout 指定的会话而不是 last-thread。 */
  const [popoutThreadId, setPopoutThreadId] = useState<string | null>(null);
bag.popoutThreadId = popoutThreadId as typeof bag.popoutThreadId; bag.setPopoutThreadId = setPopoutThreadId as typeof bag.setPopoutThreadId;


  /** 主窗口侧：被弹窗锁定的会话 id 集合。弹窗窗口里渲染同一会话会与主窗口重复
   *  （两份渲染层各自维护 thread 状态，事件竞争/状态不同步），用户 09-13 明确要求
   *  「原界面侧边栏把弹窗出去的会话直接隐藏」。弹窗关闭后（popout-closed 事件）移出。 */
  const [poppedOutThreadIds, setPoppedOutThreadIds] = useState<Set<string>>(() => new Set());
bag.poppedOutThreadIds = poppedOutThreadIds as typeof bag.poppedOutThreadIds; bag.setPoppedOutThreadIds = setPoppedOutThreadIds as typeof bag.setPoppedOutThreadIds;


  const refreshPoppedOut = useCallback(() => {
    void window.codex.popoutList().then((ids) => bag.setPoppedOutThreadIds(new Set(ids ?? []))).catch(() => undefined);
  }, []);
bag.refreshPoppedOut = refreshPoppedOut as typeof bag.refreshPoppedOut;


  // null=首次使用/明确退出，true=跳过登录，false=已成功登录。
  // 旧逻辑把 false 也解释成“显示登录页”，导致每次重启都要重新输入已安全保存的 API Key。
  const [showLogin, setShowLogin] = useState(() => {
    const state = localStorage.getItem("login-skipped");
    return state == null || state === "logout";
  });
bag.showLogin = showLogin as typeof bag.showLogin; bag.setShowLogin = setShowLogin as typeof bag.setShowLogin;


  // 账号切换只改变认证/模型配置，保留当前打开的本地会话；登录完成后自动恢复。
  const accountSwitchThreadRef = useRef<string | null>(null);
bag.accountSwitchThreadRef = accountSwitchThreadRef as typeof bag.accountSwitchThreadRef;


  const [modelId, setModelId] = useState(() => localStorage.getItem("default-model") ?? "");
bag.modelId = modelId as typeof bag.modelId; bag.setModelId = setModelId as typeof bag.setModelId;


  // 历史遗留兜底：旧版本可能存过 minimal/xhigh/ultra，读取时归一化到引擎真实支持的档位
  const [effort, setEffort] = useState(() => normalizeEffort(localStorage.getItem("default-effort")) || DEFAULT_EFFORT);
bag.effort = effort as typeof bag.effort; bag.setEffort = setEffort as typeof bag.setEffort;


  /** 启动加载页（09-17）：首屏会话列表到达前一直盖着，避免"看着像好了但没内容"的空窗。
   *  实测启动到有内容 3.0~3.8s，其中挂载后还要等 1.3~2.1s —— 那段此前没有任何反馈。 */
  const [bootReady, setBootReady] = useState(false);
bag.bootReady = bootReady as typeof bag.bootReady; bag.setBootReady = setBootReady as typeof bag.setBootReady;


  const [threadsLoading, setThreadsLoading] = useState(true);
bag.threadsLoading = threadsLoading as typeof bag.threadsLoading; bag.setThreadsLoading = setThreadsLoading as typeof bag.setThreadsLoading;


  const [threads, setThreads] = useState<Thread[]>([]);
bag.threads = threads as typeof bag.threads; bag.setThreads = setThreads as typeof bag.setThreads;


  const [thread, setThread] = useState<Thread | null>(null);
bag.thread = thread as typeof bag.thread; bag.setThread = setThread as typeof bag.setThread;


  /** 会话切换耗时诊断（09-12 压测）：openThread 落笔，thread 真正换上去时结算并写入
       window.__adbg。这是「点一下到内容可见」的真实值——比 e2e 里轮询文本可靠得多
       （会话内容相同时文本不变，轮询会一直等到超时）。 */
  const switchStartRef = useRef(0);
bag.switchStartRef = switchStartRef as typeof bag.switchStartRef;


  /** 本次切换是「命中缓存秒开」还是「冷加载」—— 结算时一起记进 __adbg，
      否则 P95 里两拨数据混在一起，看不出优化到底作用在哪一拨（09-14）。 */
  const switchModeRef = useRef<"cached" | "fresh">("fresh");
bag.switchModeRef = switchModeRef as typeof bag.switchModeRef;


  /** 本次切换开始时该会话已渲染的回合数（验收用：证明"秒开"是真的有内容，不是空壳）。 */
  const switchTurnsRef = useRef(0);
bag.switchTurnsRef = switchTurnsRef as typeof bag.switchTurnsRef;


  /** 每个会话离开时的阅读位置（距底像素）。命中缓存切回时还原——09-14：
   *  原先无条件跳底，用户「切出去看一眼再切回来」会丢掉正在读的位置。 */
  const scrollMemoRef = useRef<Map<string, number>>(new Map());
bag.scrollMemoRef = scrollMemoRef as typeof bag.scrollMemoRef;


  const threadRef = useRef<Thread | null>(null);
bag.threadRef = threadRef as typeof bag.threadRef;


  /** 弹窗锁定会话 id 的 ref 形态：boot effect（[] 空依赖）闭包里要读到它，
   *  用 state 会在首次渲染拿到 null（popoutThreadId 是异步探测的）。 */
  const popoutThreadIdRef = useRef<string | null>(null);
bag.popoutThreadIdRef = popoutThreadIdRef as typeof bag.popoutThreadIdRef;


  /** threads 列表的 ref 镜像：harness:event 处理函数（闭包）里同步查会话是否存在。 */
  const threadsRef = useRef<Thread[]>([]);
bag.threadsRef = threadsRef as typeof bag.threadsRef;


  // 心跳监控联动：记录「引擎无响应→自动重启」标记，ready 时自动恢复当前线程；
  // 以及发送/运行态的快照 ref，供 status:error 分支复位（避免闭包读到旧 state）。
  const engineRestartedRef = useRef(false);
bag.engineRestartedRef = engineRestartedRef as typeof bag.engineRestartedRef;


  const sendingRef = useRef(false);
bag.sendingRef = sendingRef as typeof bag.sendingRef;


  const activeTurnIdRef = useRef<string | null>(null);
bag.activeTurnIdRef = activeTurnIdRef as typeof bag.activeTurnIdRef;


  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
bag.activeTurnId = activeTurnId as typeof bag.activeTurnId; bag.setActiveTurnId = setActiveTurnId as typeof bag.setActiveTurnId;


  // 多会话运行状态必须按 threadId 隔离。单个 runningThreadId 会让 A 完成时清掉
  // 正在运行的 B，也会让切换到 B 后仍沿用 A 的停止按钮/排队逻辑。
  const [runningThreadIds, setRunningThreadIds] = useState<Set<string>>(() => new Set());
bag.runningThreadIds = runningThreadIds as typeof bag.runningThreadIds; bag.setRunningThreadIds = setRunningThreadIds as typeof bag.setRunningThreadIds;


  const runningThreadIdsRef = useRef<Set<string>>(new Set());
bag.runningThreadIdsRef = runningThreadIdsRef as typeof bag.runningThreadIdsRef;


  const runningTurnIdsRef = useRef<Map<string, string>>(new Map());
bag.runningTurnIdsRef = runningTurnIdsRef as typeof bag.runningTurnIdsRef;


  const runningStartedAtRef = useRef<Map<string, number>>(new Map());
bag.runningStartedAtRef = runningStartedAtRef as typeof bag.runningStartedAtRef;


  const markThreadRunning = useCallback((threadId: string, turnId?: string, startedAt = Date.now()) => {
    if (!threadId) return;
    if (turnId) bag.runningTurnIdsRef.current.set(threadId, turnId);
    if (!bag.runningStartedAtRef.current.has(threadId)) bag.runningStartedAtRef.current.set(threadId, startedAt);
    // 值判短路（09-12 多会话性能）：引擎会为**每个**会话反复推 thread/status/changed +
    // turn/started，旧实现无条件 `new Set` + setState → 每来一条就整棵 App 重渲染一次
    // （多会话时事件数 × N，而 App 是 1.1MB 单组件）。id 已在集合里就什么都不做。
    if (bag.runningThreadIdsRef.current.has(threadId)) return;
    const next = new Set(bag.runningThreadIdsRef.current);
    next.add(threadId);
    bag.runningThreadIdsRef.current = next;
    bag.setRunningThreadIds(next);
  }, []);
bag.markThreadRunning = markThreadRunning as typeof bag.markThreadRunning;


  const markThreadStopped = useCallback((threadId?: string) => {
    if (!threadId) return;
    bag.runningTurnIdsRef.current.delete(threadId);
    bag.runningStartedAtRef.current.delete(threadId);
    // 同上：本来就不在集合里（重复的 turn/completed、或从未标记过）→ 不 setState
    if (!bag.runningThreadIdsRef.current.has(threadId)) return;
    const next = new Set(bag.runningThreadIdsRef.current);
    next.delete(threadId);
    bag.runningThreadIdsRef.current = next;
    bag.setRunningThreadIds(next);
  }, []);
bag.markThreadStopped = markThreadStopped as typeof bag.markThreadStopped;


  const clearRunningThreads = useCallback(() => {
    bag.runningThreadIdsRef.current = new Set();
    bag.runningTurnIdsRef.current.clear();
    bag.runningStartedAtRef.current.clear();
    bag.setRunningThreadIds(new Set());
  }, []);
bag.clearRunningThreads = clearRunningThreads as typeof bag.clearRunningThreads;


  /** 已结束的回合 id（completed / aborted / failed / interrupted）。
   *  用途：**已结束的回合不得再被 turn/started 点亮**（09-19 用户截图：消息回完了停止键还亮着）。
   *  乱序/重复投递的 turn/started 若命中这里的 id，一律忽略，不再 setSending(true)/markThreadRunning。
   *  只保留最近 80 个（新→旧），防长会话无限增长。 */
  const finishedTurnIdsRef = useRef<Set<string>>(new Set());
bag.finishedTurnIdsRef = finishedTurnIdsRef as typeof bag.finishedTurnIdsRef;


  const rememberFinishedTurn = useCallback((turnId: string) => {
    if (!turnId) return;
    const set = bag.finishedTurnIdsRef.current;
    if (set.size > 80) {
      set.clear();   // 溢出即整清：判定只需覆盖「最近刚结束、可能被迟到 start 复活」的窗口
    }
    set.add(turnId);
  }, []);
bag.rememberFinishedTurn = rememberFinishedTurn as typeof bag.rememberFinishedTurn;


/** 「手动停止」记录（threadId → 被停止的 turnId）。09-23 用户：「当用户手动停止程序/任务的运行状态时，
 *  排队中的消息不应被自动发送」；口径经用户**更正**为「排队消息要**保持在输入框上面**，维持排队状态」
 *  ⇒ 排队消息**原地不动**，只是不再自动发送（见 part05/event-router/07-turn-completed-settle.tsx）。
 *  ⛔ 必须是 **ref** 且**在第一个 await 之前同步写入**：`turn/interrupt` 的回包与引擎的回合结束
 *    事件是两条独立异步流、事件可能**先到** ⇒ 像 `interruptedTurns` 那样写在 await 之后会漏判。
 *  消费点：`turn/completed` 的「自动启动下一条排队消息」分支（命中 ⇒ 短路，不启动）。
 *  按 **turnId 精确比对** ⇒ 只对这一次手动停止生效；之后别的回合正常结束照旧自动启动。
 *  ⚠️ 只由渲染层 `interrupt()` 写入 ⇒ 语音插话 / 手机端停止（主进程直接 `turn/interrupt`）不享受本语义。 */
const manualStopRef = useRef<Map<string, string>>(new Map());
bag.manualStopRef = manualStopRef as typeof bag.manualStopRef;


  /** 缓存里缺整轮内容、**必须走一次 resume** 才能拿全的会话（09-19：后台完成的回合在缓存里
   *  还没有对应回合时不能只把「产出条目」并进去——会渲染出没有用户消息的孤儿回复）。
   *  openThread 的「30 秒跳过 resume」快速路径必须让开这些会话；resume 落地后清除。 */
  const needsFullReloadRef = useRef<Set<string>>(new Set());
bag.needsFullReloadRef = needsFullReloadRef as typeof bag.needsFullReloadRef;


  // 侧栏「任务已完成」绿点（09-19 用户需求：后台会话跑完，侧栏亮绿点，点进去消失——
  // 快速知道哪个会话任务完成了/运行结束了）。只在**非当前查看的会话**上点亮：
  // 当前正开着的会话用户全程看着，不需要反馈；点进该会话（openThread）即清除。
  const [unreadDoneIds, setUnreadDoneIds] = useState<Set<string>>(() => new Set());
bag.unreadDoneIds = unreadDoneIds as typeof bag.unreadDoneIds; bag.setUnreadDoneIds = setUnreadDoneIds as typeof bag.setUnreadDoneIds;


  const unreadDoneIdsRef = useRef<Set<string>>(new Set());
bag.unreadDoneIdsRef = unreadDoneIdsRef as typeof bag.unreadDoneIdsRef;


  const markThreadDoneUnread = useCallback((threadId?: string) => {
    if (!threadId || threadId === bag.threadRef.current?.id) return;   // 当前会话不点
    if (bag.unreadDoneIdsRef.current.has(threadId)) return;             // 值判短路（多会话性能同上）
    const next = new Set(bag.unreadDoneIdsRef.current);
    next.add(threadId);
    bag.unreadDoneIdsRef.current = next;
    bag.setUnreadDoneIds(next);
  }, []);
bag.markThreadDoneUnread = markThreadDoneUnread as typeof bag.markThreadDoneUnread;


  const clearThreadDoneUnread = useCallback((threadId?: string) => {
    if (!threadId || !bag.unreadDoneIdsRef.current.has(threadId)) return;
    const next = new Set(bag.unreadDoneIdsRef.current);
    next.delete(threadId);
    bag.unreadDoneIdsRef.current = next;
    bag.setUnreadDoneIds(next);
  }, []);
bag.clearThreadDoneUnread = clearThreadDoneUnread as typeof bag.clearThreadDoneUnread;


  const [workspace, setWorkspace] = useState(localStorage.getItem("workspace") ?? "");
bag.workspace = workspace as typeof bag.workspace; bag.setWorkspace = setWorkspace as typeof bag.setWorkspace;


  /** workspace 的 ref 镜像：send 里弹目录选择框后要立刻读到刚选的值
   *  （setState 异步，直接读 `workspace` 闭包变量还是旧值），09-14。 */
  const workspaceRef = useRef(bag.workspace);
bag.workspaceRef = workspaceRef as typeof bag.workspaceRef;


  const [prompt, setPrompt] = useState("");
bag.prompt = prompt as typeof bag.prompt; bag.setPrompt = setPrompt as typeof bag.setPrompt;


  // 输入框草稿按会话持久化（09-19 用户：「切换会话 / 关闭应用都不能丢」）：
  //   promptRef 镜像最新文本；draftThreadRef 镜像当前会话（无会话 = 欢迎页 "new" 草稿键）。
  //   保存点：① 输入框 onPromptChange 即时落盘（闭包里的 thread 是当前的，键一定正确）；
  //   ② 防抖兜底覆盖「程序化改 prompt」（语音听写 / 增强回填 / /命令）——⛔ 恢复动作前先置
  //   draftJustRestoredRef，防抖跳过这一次（恢复值本来就来自该键，无需写回；且此刻 thread 状态
  //   还没切过来，写回会落到旧会话键上）；③ 关应用前 beforeunload 同步落盘。
  const promptRef = useRef(bag.prompt);
bag.promptRef = promptRef as typeof bag.promptRef;


  bag.promptRef.current = bag.prompt;


  const draftThreadRef = useRef<string | null>(null);
bag.draftThreadRef = draftThreadRef as typeof bag.draftThreadRef;


  bag.draftThreadRef.current = bag.thread?.id ?? null;


  const draftJustRestoredRef = useRef(false);
bag.draftJustRestoredRef = draftJustRestoredRef as typeof bag.draftJustRestoredRef;


  // 启动恢复：没有会话（欢迎页）恢复「新会话草稿」；有 last-thread 由 openThread 恢复对应会话草稿
  useEffect(() => {
    if (!bag.threadRef.current) {
      bag.draftJustRestoredRef.current = true;
      bag.setPrompt(loadDraft(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 防抖兜底（程序化改 prompt 的落盘；onChange 已即时落盘的这次会因值未变不触发）
  useEffect(() => {
    if (bag.draftJustRestoredRef.current) { bag.draftJustRestoredRef.current = false; return; }
    const id = bag.draftThreadRef.current;
    const timer = window.setTimeout(() => saveDraft(id, bag.promptRef.current), 400);
    return () => window.clearTimeout(timer);
  }, [bag.prompt]);


  // 关应用前把当前草稿落盘（beforeunload 是同步回调，直接读 ref）
  useEffect(() => {
    const persist = () => saveDraft(bag.threadRef.current?.id ?? null, bag.promptRef.current);
    window.addEventListener("beforeunload", persist);
    return () => window.removeEventListener("beforeunload", persist);
  }, []);


  // 输入框语音听写状态：partial/final 中文字幕实时回填到 composer，不自动发送。
  const [voiceDictating, setVoiceDictating] = useState(false);
bag.voiceDictating = voiceDictating as typeof bag.voiceDictating; bag.setVoiceDictating = setVoiceDictating as typeof bag.setVoiceDictating;


  const dictationBaseRef = useRef("");
bag.dictationBaseRef = dictationBaseRef as typeof bag.dictationBaseRef;


  /** 我们上一次写进输入框的那段字幕 —— 用作「用户期间是否动过输入框」的位标（见 dictation-merge.mjs）。 */
  const dictationWrittenRef = useRef("");
bag.dictationWrittenRef = dictationWrittenRef as typeof bag.dictationWrittenRef;


  useEffect(() => subscribeVoiceStage((stage) => {
    bag.setVoiceDictating(stage.active && stage.dictating);
    if (!stage.dictating) { bag.dictationWrittenRef.current = ""; return; }
    // partial/final 均表示**当前整段**字幕（不是增量）⇒ 只能替换"上次写进去的那段"。
    // ⛔ 原实现是 `setPrompt(base + 字幕)` 整段覆盖：听写期间用户手打的字会被下一次 partial 抹掉
    //   （WorkBuddy 5.6.0 的对应条目就是「语音输入过程中不再打断手动编辑」）。
    //   现在交给纯函数：用户动过 ⇒ 把他的内容并入基准、字幕接在后面，**永不覆盖用户输入**。
    const merged = mergeDictation({
      base: bag.dictationBaseRef.current,
      written: bag.dictationWrittenRef.current,
      current: bag.promptRef.current,
      dictation: stage.userText,
    });
    bag.dictationBaseRef.current = merged.base;
    bag.dictationWrittenRef.current = merged.written;
    bag.setPrompt(merged.text);
  }), []);



  // 长按语音输入快捷键：keydown 开始听写，keyup 结束；只在应用聚焦时响应。
  useEffect(() => {
    let held = false;
    let accelerator = "";
    let enabled = false;
    void window.codex.voiceSettingsGet().then((r: any) => {
      enabled = Boolean(r?.settings?.dictationHotkey?.enabled);
      accelerator = String(r?.settings?.dictationHotkey?.accelerator ?? "");
    }).catch(() => undefined);
    const down = (event: globalThis.KeyboardEvent) => {
      if (!enabled || held || event.repeat || !matchesVoiceAccelerator(event, accelerator)) return;
      held = true;
      event.preventDefault();
      bag.dictationBaseRef.current = bag.prompt;
      bag.dictationWrittenRef.current = "";
      requestVoiceDictation({ action: "start" });
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (!held || !matchesVoiceAccelerator(event, accelerator)) return;
      held = false;
      event.preventDefault();
      // 长按快捷键松开 = 结束识别并直接发送；点击麦克风仍是只填入输入框、不自动发。
      requestVoiceDictation({ action: "stop", send: true });
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [bag.prompt]);


  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
bag.attachmentMenuOpen = attachmentMenuOpen as typeof bag.attachmentMenuOpen; bag.setAttachmentMenuOpen = setAttachmentMenuOpen as typeof bag.setAttachmentMenuOpen;
  return { serverStatus, setServerStatus, popoutThreadId, setPopoutThreadId, poppedOutThreadIds, setPoppedOutThreadIds, refreshPoppedOut, showLogin, setShowLogin, accountSwitchThreadRef, modelId, setModelId, effort, setEffort, bootReady, setBootReady, threadsLoading, setThreadsLoading, threads, setThreads, thread, setThread, switchStartRef, switchModeRef, switchTurnsRef, scrollMemoRef, threadRef, popoutThreadIdRef, threadsRef, engineRestartedRef, sendingRef, activeTurnIdRef, activeTurnId, setActiveTurnId, runningThreadIds, setRunningThreadIds, runningThreadIdsRef, runningTurnIdsRef, runningStartedAtRef, markThreadRunning, markThreadStopped, clearRunningThreads, finishedTurnIdsRef, rememberFinishedTurn, manualStopRef, needsFullReloadRef, unreadDoneIds, setUnreadDoneIds, unreadDoneIdsRef, markThreadDoneUnread, clearThreadDoneUnread, workspace, setWorkspace, workspaceRef, prompt, setPrompt, promptRef, draftThreadRef, draftJustRestoredRef, voiceDictating, setVoiceDictating, dictationBaseRef, dictationWrittenRef, attachmentMenuOpen, setAttachmentMenuOpen };
}
