/**
 * usePart01d（09-22：part01 按序切分出来的第 4 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { currentStreak, dayKey, formatTokens, lastDays, readUsageStats, recordTurnUsage, resetUsageStats, totalTokens } from "../../../../lib/usage-stats";
import { classifyUnit, buildSegments, buildOrderedToolRuns, foldItemStatus, computeFoldSummary, topToolGroup, isTurnRunning, normalizeLoadedThread, type FoldUnit } from "../../../../lib/turn-fold";
import { parseUserRefs, userDisplayText, userMessageMatchesInput, firstUserTextInTurn, cleanThreadDisplayTitle, extractThreadReferenceIds, stripThreadReferenceIds, formatThreadReferenceBlock, buildThreadReferencePayload, type ParsedUserRefs, type ThreadReferencePayload } from "../../../../lib/user-refs";
import { RunningProcessTime, CompletedChanges, ContextRing, UsageCounterSnapshot, ContextUsageBadge } from "../../../../features/status";
import { usageBucket } from "../../../../lib/usage-bucket";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../app-view/types";
import type { Bag } from "../bag-types";

/** 用量快照落盘的存储键与上限（**模块级**：不进 Bag 推断面，也不随 hook 重建）。 */
const TOKEN_SNAPSHOT_KEY = "token-usage-by-thread-v1";
const TOKEN_SNAPSHOT_MAX = 60;

export function usePart01d(bag: Bag) {
  // 09-17：本轮是否**确实出现过**运行中的回合 —— 乐观气泡安全阀的判据（见下方 effect 注释）。
  const sawRunningTurnRef = useRef(false);
bag.sawRunningTurnRef = sawRunningTurnRef as typeof bag.sawRunningTurnRef;


  // 只有目标回合里出现了非空 userMessage，才说明临时气泡已经被真实消息接管。
  // “新增了一个 turn”不够，因为 turn/started 的 userMessage 经常只有 id、content 为空。
  // 心跳监控联动：sending/activeTurnId 的快照 ref（status:error 复位时用最新值）
  useEffect(() => { bag.sendingRef.current = bag.sending; }, [bag.sending]);


  useEffect(() => { bag.activeTurnIdRef.current = bag.activeTurnId; }, [bag.activeTurnId]);


  const optimisticConfirmed = useMemo(() => {
    if (!bag.optimisticInput) return false;
    const content = bag.optimisticInput.content ?? [];
    const target = bag.optimisticTurnIdRef.current ? bag.thread?.turns.find((turn) => turn.id === bag.optimisticTurnIdRef.current) : null;
    if (target?.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, content))) return true;
    // 兜底：事件可能先于 turn/start 响应到达。只检查本次发送后新增的回合，
    // 并按用户可见正文匹配，避免隐藏的记忆/技能/引用段导致真实消息与乐观消息无法去重。
    const baseline = bag.optimisticBaselineRef.current;
    return Boolean(bag.thread?.turns.some((turn) => {
      if (baseline.threadId === bag.thread!.id && baseline.turnIds.has(turn.id)) return false;
      return turn.items.some((item) => item.type === "userMessage" && userMessageMatchesInput(item, content));
    }));
  }, [bag.optimisticInput, bag.thread]);
bag.optimisticConfirmed = optimisticConfirmed as typeof bag.optimisticConfirmed;


  useEffect(() => {
    // ★ 乐观气泡**安全阀**（09-13）：回合已经跑完、气泡却始终没被真实消息接管 → 回收。
    // 触发场景：排队消息点「立即」走 `turn/steer` 把输入补进**已有回合**（不产生新回合），
    // 而下面的确认逻辑只认「新回合里的用户消息」→ 永远匹配不到，气泡会一直赖在聊天区。
    // 有它兜底，最坏情况也只是"这一轮跑完时气泡消失"，绝不会跨回合残留。
    // ⛔ 原判据「当前没有任何 running 回合」在**正常发送**时同样成立（09-17 实测）：
    //   气泡上屏（t+552ms）→ 本轮 turn 还没建（要等 turn/start 往返 + 记忆召回）→ 条件命中 →
    //   气泡 **8ms 就被回收**，而真实消息 3.3s 才到 ⇒ 用户自己的消息有 2.7 秒完全不在界面上，
    //   只剩一条「正在生成回复」状态条（用户截图里"中间那个"就是它）。
    //   所以判据改成：**本轮确实出现过运行中回合**（发送真的跑起来了）之后回合结束，才回收。
    const running = (bag.thread?.turns ?? []).some((turn) => isTurnRunning(turn));
    if (running) bag.sawRunningTurnRef.current = true;
    if (bag.optimisticInput && !bag.optimisticConfirmed) {
      if (!running && bag.sawRunningTurnRef.current) {
        bag.dbg("confirm-timeout", { inp: String(bag.optimisticInput.id).slice(0, 12) });
        bag.sawRunningTurnRef.current = false;
        bag.setOptimisticInput(null);
        return;
      }
      // 超时兜底：气泡存活期间 15s 内既没被真实消息接管、也没有过运行中回合 → 认定本轮没起来，回收。
      const timer = window.setTimeout(() => {
        if (!(bag.threadRef.current?.turns ?? []).some((turn) => isTurnRunning(turn))) {
          bag.sawRunningTurnRef.current = false;
          bag.setOptimisticInput(null);
        }
      }, 15_000);
      return () => window.clearTimeout(timer);
    }
    if (!bag.optimisticInput || !bag.optimisticConfirmed) return;
    bag.dbg("confirm-fired", { inp: !!bag.optimisticInput });
    // 锚定模式：真实回合接管临时气泡的瞬间，把锚点平滑换到真实回合——
    // 乐观气泡挂在回合列表末尾、真实 turn 在其前一位，位置相邻但不重合，
    // 不重锚的话「消息钉在顶部」会在确认瞬间跳一下（锚定模式的核心承诺就是不跳）。
    // 确认瞬间**不再自己做一次重锚**（09-12：两处各自钉一次 = 互相抢 = 抖）。
    // 位置统一由 [thread] 布局 effect 里的 pinSentMessage 按"真实消息元素"实测维持：
    // 真实回合一接管，它量到 gap 变了就一次性纠正，量到没变就什么都不做。
    if (bag.anchorTopRef.current) {
      const baseline = bag.optimisticBaselineRef.current;
      const newTurn = bag.thread?.turns.find((turn) => !(baseline.threadId === bag.thread?.id && baseline.turnIds.has(turn.id)));
      if (newTurn) bag.anchorTurnIdRef.current = newTurn.id;
    }
    bag.optimisticTurnIdRef.current = null;
    bag.setOptimisticInput(null);
  }, [bag.optimisticConfirmed, bag.optimisticInput, bag.thread]);


  const [openingThread, setOpeningThread] = useState<string | null>(null);
bag.openingThread = openingThread as typeof bag.openingThread; bag.setOpeningThread = setOpeningThread as typeof bag.setOpeningThread;


  const [pending, setPending] = useState<PendingRequest[]>([]);
bag.pending = pending as typeof bag.pending; bag.setPending = setPending as typeof bag.setPending;


  // e2e UI 场景入口（与 window.__adbg 同款测试钩子，只改内存、不碰引擎）：审批卡的形态
  // （一行摘要 + 点开预览 + 多条不占满）在 e2e 里没法从真实引擎触发——e2e profile 跑在
  // danger-full-access 下永不询问审批——所以留一个塞合成请求的口子，供截图与断言。
  useEffect(() => {
    const host = window as unknown as { __harnessApprovals?: { push: (input: { id?: string; method?: string; params?: Record<string, unknown> }) => string; clear: () => void } };
    host.__harnessApprovals = {
      push: (input) => {
        const id = String(input?.id ?? `harness-approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        bag.setPending((current) => [...current, { id, method: String(input?.method ?? "item/commandExecution/requestApproval"), params: input?.params ?? {} }]);
        return id;
      },
      clear: () => bag.setPending([]),
    };
    return () => { delete host.__harnessApprovals; };
  }, []);


  const [diff, setDiff] = useState("");
bag.diff = diff as typeof bag.diff; bag.setDiff = setDiff as typeof bag.setDiff;


  const [tokenUsage, setTokenUsage] = useState<any>(null);
bag.tokenUsage = tokenUsage as typeof bag.tokenUsage; bag.setTokenUsage = setTokenUsage as typeof bag.setTokenUsage;


  const tokenUsageRef = useRef<any>(null);
bag.tokenUsageRef = tokenUsageRef as typeof bag.tokenUsageRef;


  // 部分 0.0.1 兼容上游会把 last 的缓存量按增量上报、输入量却按当前总量上报，
  // 导致任务越长命中率越低。用 total 的连续快照做同口径差值，作为本轮展示兜底。
  const tokenUsageTotalsRef = useRef(new Map<string, UsageCounterSnapshot>());
bag.tokenUsageTotalsRef = tokenUsageTotalsRef as typeof bag.tokenUsageTotalsRef;


  const derivedTokenUsageRef = useRef(new Map<string, any>());
bag.derivedTokenUsageRef = derivedTokenUsageRef as typeof bag.derivedTokenUsageRef;

  /* 每个会话**各自**的用量快照（09-25 用户报「一切换供应商就爆了上下文」）。
     ⛔ 原先 tokenUsage 是全应用**单槽**：任何会话的 thread/tokenUsage/updated 都往里写、切会话
     也不清 ⇒ 环里可能亮着**上一个会话**的数字（长会话切走后那个大数字就"粘"在环上）。
     现在按 threadId 存一份，显示侧只取**当前会话**那一份（见 part05 的写入与切换同步）。

     ⛔⛔ **必须落盘**（用户 09-25 补充：「一切换供应商，显示从初始值开始统计，原来的不消耗识别出来，
     聊一会就爆了」）：切供应商会 **重启应用** ⇒ useRef 全丢 ⇒ 环只能显示空/0，而引擎那边上下文
     其实是满的（历史都在）⇒ 用户看到"进度被重置"，聊几轮又累加着涨上去、看着像爆。
     所以在 localStorage 里按会话留最后一份快照，重启后恢复真实进度。 */
  const tokenUsageByThreadRef = useRef<Map<string, any>>((() => {
    try {
      const raw = JSON.parse(localStorage.getItem(TOKEN_SNAPSHOT_KEY) || "{}") as Record<string, any>;
      return new Map(Object.entries(raw));
    } catch { return new Map(); }
  })());
bag.tokenUsageByThreadRef = tokenUsageByThreadRef as typeof bag.tokenUsageByThreadRef;

  /** 用量快照落盘（只保留最近 TOKEN_SNAPSHOT_MAX 个会话）。
   *  ⛔ **必须是真 LRU**（09-25 代码审查改）：Map 保持**插入顺序**，对已存在的键 `set` **不会**把它
   *  移到最后 ⇒ 原来那句 `slice(-N)` 实际是 **FIFO**：一个长期活跃的老会话（比如钉住的主会话）
   *  插入早、排前面，会被后来的一批新会话挤掉 —— 它重启后进度**照样归零**，正是本功能要防的症状。
   *  所以每次写入先 `delete` 再 `set`，把它挪到末尾。 */
  const persistTokenUsageSnapshot = useCallback((threadId: string, usage: any) => {
    try {
      const map = bag.tokenUsageByThreadRef.current;
      if (threadId) {
        map.delete(threadId);   // ⛔ 先删再插 = 挪到末尾（真 LRU 的关键）
        map.set(threadId, usage);
      }
      const entries = [...map.entries()].slice(-TOKEN_SNAPSHOT_MAX);
      bag.tokenUsageByThreadRef.current = new Map(entries);
      localStorage.setItem(TOKEN_SNAPSHOT_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* 配额满/隐私模式 ⇒ 忽略，内存里那份仍生效 */ }
  }, []);
bag.persistTokenUsageSnapshot = persistTokenUsageSnapshot as typeof bag.persistTokenUsageSnapshot;

  /** 接力（fork 到新会话 id）时把源会话的用量快照**继承**给新会话：
   *  fork 带走完整历史 ⇒ 真实上下文规模与原会话几乎一致。⛔ 不继承的话新会话环从 0 开始，
   *  用户看到的就是「进度被重置」。 */
  const inheritTokenUsageSnapshot = useCallback((fromThreadId: string, toThreadId: string) => {
    const snapshot = bag.tokenUsageByThreadRef.current.get(fromThreadId);
    if (!snapshot || !toThreadId) return;
    bag.persistTokenUsageSnapshot(toThreadId, snapshot);
  }, []);
bag.inheritTokenUsageSnapshot = inheritTokenUsageSnapshot as typeof bag.inheritTokenUsageSnapshot;


  const normalizeTokenUsage = useCallback((raw: any, threadId?: string) => {
    if (!raw || !threadId) return raw;
    const totalUsage = usageBucket(raw, "total");
    if (!totalUsage) return raw;
    const current = usageCounterSnapshot(totalUsage);
    const previous = bag.tokenUsageTotalsRef.current.get(threadId);
    bag.tokenUsageTotalsRef.current.set(threadId, current);
    if (previous && (current.input < previous.input || current.cached < previous.cached)) {
      bag.derivedTokenUsageRef.current.delete(threadId);
      return raw;
    }
    if (previous && current.input >= previous.input && current.cached >= previous.cached) {
      const inputTokens = current.input - previous.input;
      const cachedInputTokens = Math.min(inputTokens, current.cached - previous.cached);
      if (inputTokens > 0) {
        const derivedLast = {
          inputTokens,
          cachedInputTokens,
          outputTokens: Math.max(0, current.output - previous.output),
          totalTokens: Math.max(0, current.total - previous.total),
        };
        bag.derivedTokenUsageRef.current.set(threadId, derivedLast);
        return { ...raw, derivedLast };
      }
    }
    const derivedLast = bag.derivedTokenUsageRef.current.get(threadId);
    return derivedLast ? { ...raw, derivedLast } : raw;
  }, []);
bag.normalizeTokenUsage = normalizeTokenUsage as typeof bag.normalizeTokenUsage;


  // 回合开始时间（turnId -> 时间戳），用于统计「最长聊天时长」
  const turnStartedAtRef = useRef(new Map<string, number>());
bag.turnStartedAtRef = turnStartedAtRef as typeof bag.turnStartedAtRef;


  // 当前生效的模型名（统计按模型用量时避免闭包拿到旧值）
  const activeModelRef = useRef("");
bag.activeModelRef = activeModelRef as typeof bag.activeModelRef;


  const [usageStats, setUsageStats] = useState(() => readUsageStats());
bag.usageStats = usageStats as typeof bag.usageStats; bag.setUsageStats = setUsageStats as typeof bag.setUsageStats;


  // 流式 delta 合帧缓冲：同一帧的多条 delta 一次 setThread
  const streamRafRef = useRef(0);
bag.streamRafRef = streamRafRef as typeof bag.streamRafRef;


  const pendingDeltaRef = useRef<{ method: string; params: any }[]>([]);
bag.pendingDeltaRef = pendingDeltaRef as typeof bag.pendingDeltaRef;


  // 上次 delta 落盘时刻：用于判断「新一轮出字」，首字立即渲染不等 rAF
  const lastFlushAtRef = useRef(0);
bag.lastFlushAtRef = lastFlushAtRef as typeof bag.lastFlushAtRef;


  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("right-panel-open") === "true");
bag.rightOpen = rightOpen as typeof bag.rightOpen; bag.setRightOpen = setRightOpen as typeof bag.setRightOpen;

  // 启动默认展开：迁移旧的折叠偏好，桌面端始终先给完整导航；用户仍可手动收起。
  const [desktopAuto, setDesktopAuto] = useState(true);
bag.desktopAuto = desktopAuto as typeof bag.desktopAuto; bag.setDesktopAuto = setDesktopAuto as typeof bag.setDesktopAuto;


  const [browserAuto, setBrowserAuto] = useState(true);
bag.browserAuto = browserAuto as typeof bag.browserAuto; bag.setBrowserAuto = setBrowserAuto as typeof bag.setBrowserAuto;


  const [autoCompactRatio, setAutoCompactRatio] = useState(0.8);
bag.autoCompactRatio = autoCompactRatio as typeof bag.autoCompactRatio; bag.setAutoCompactRatio = setAutoCompactRatio as typeof bag.setAutoCompactRatio;


  const [hardwareAccel, setHardwareAccel] = useState<"auto" | "force" | "off">("auto");
bag.hardwareAccel = hardwareAccel as typeof bag.hardwareAccel; bag.setHardwareAccel = setHardwareAccel as typeof bag.setHardwareAccel;


  // 开发工具下载源（09-20 用户「下载太慢，所有工具下载加下载源选择」）：app-settings.downloadSource，
  // 「开发工具」页顶部可切；runtime:install 每次现读，切完下一次下载立即生效。
  const [downloadSource, setDownloadSource] = useState<"auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy">("auto");
bag.downloadSource = downloadSource as typeof bag.downloadSource; bag.setDownloadSource = setDownloadSource as typeof bag.setDownloadSource;


  /** 语气自适应（默认开）：按会话维护状态（心情/精力/默契），随会话自己的 instructions 下发语气指引。 */
  const [adaptiveTone, setAdaptiveTone] = useState(true);
bag.adaptiveTone = adaptiveTone as typeof bag.adaptiveTone; bag.setAdaptiveTone = setAdaptiveTone as typeof bag.setAdaptiveTone;


  const [restartPending, setRestartPending] = useState(false);
bag.restartPending = restartPending as typeof bag.restartPending; bag.setRestartPending = setRestartPending as typeof bag.setRestartPending;



  // SSH 服务器连接管理：设置页「SSH 服务器」分区，列表持久化在 userData/ssh-servers.json
  const [sshServers, setSshServers] = useState<SshServer[]>([]);
bag.sshServers = sshServers as typeof bag.sshServers; bag.setSshServers = setSshServers as typeof bag.setSshServers;


  const [sshLoaded, setSshLoaded] = useState(false);
bag.sshLoaded = sshLoaded as typeof bag.sshLoaded; bag.setSshLoaded = setSshLoaded as typeof bag.setSshLoaded;


  const [sshBusyId, setSshBusyId] = useState<string | null>(null);
bag.sshBusyId = sshBusyId as typeof bag.sshBusyId; bag.setSshBusyId = setSshBusyId as typeof bag.setSshBusyId;


  const [sshTestingId, setSshTestingId] = useState<string | null>(null);
bag.sshTestingId = sshTestingId as typeof bag.sshTestingId; bag.setSshTestingId = setSshTestingId as typeof bag.setSshTestingId;


  const [sshDraft, setSshDraft] = useState<SshServer | null>(null);
bag.sshDraft = sshDraft as typeof bag.sshDraft; bag.setSshDraft = setSshDraft as typeof bag.setSshDraft;


  const [sshSaving, setSshSaving] = useState(false);
bag.sshSaving = sshSaving as typeof bag.sshSaving; bag.setSshSaving = setSshSaving as typeof bag.setSshSaving;


  // 列表筛选：关键字搜索 + 状态分段 + 勾选批量操作
  const [sshQuery, setSshQuery] = useState("");
bag.sshQuery = sshQuery as typeof bag.sshQuery; bag.setSshQuery = setSshQuery as typeof bag.setSshQuery;


  const [sshFilter, setSshFilter] = useState<"all" | "on" | "off" | "star">("all");
bag.sshFilter = sshFilter as typeof bag.sshFilter; bag.setSshFilter = setSshFilter as typeof bag.setSshFilter;


  const [sshChecked, setSshChecked] = useState<string[]>([]);
bag.sshChecked = sshChecked as typeof bag.sshChecked; bag.setSshChecked = setSshChecked as typeof bag.setSshChecked;


  const [sshBatchBusy, setSshBatchBusy] = useState(false);
bag.sshBatchBusy = sshBatchBusy as typeof bag.sshBatchBusy; bag.setSshBatchBusy = setSshBatchBusy as typeof bag.setSshBatchBusy;


  // 内置终端会话与一次性命令执行
  const [sshTerminal, setSshTerminal] = useState<SshServer | null>(null);
bag.sshTerminal = sshTerminal as typeof bag.sshTerminal; bag.setSshTerminal = setSshTerminal as typeof bag.setSshTerminal;


  const [sshExecTarget, setSshExecTarget] = useState<SshServer | null>(null);
bag.sshExecTarget = sshExecTarget as typeof bag.sshExecTarget; bag.setSshExecTarget = setSshExecTarget as typeof bag.setSshExecTarget;


  // 编辑器内「测试连接」的结果：草稿未保存也能测，结果只在弹窗内展示
  const [sshEditorTest, setSshEditorTest] = useState<{ ok: boolean; message: string } | null>(null);
bag.sshEditorTest = sshEditorTest as typeof bag.sshEditorTest; bag.setSshEditorTest = setSshEditorTest as typeof bag.setSshEditorTest;


  // 联网搜索 UI 入口已整体下架（2026-09-04：引擎沙箱本就允许联网，web_search 工具默认常开，
  // 无需用户切换）。app-settings.webSearch 默认值仍由主进程写进 config.toml，引擎能力不受影响。
  useEffect(() => { void window.codex.readAppSettings().then((settings) => { bag.setDesktopAuto(settings.desktopAutomation !== false); bag.setBrowserAuto(settings.browserAutomation !== false); bag.setAutoCompactRatio(typeof settings.autoCompactRatio === "number" ? settings.autoCompactRatio : 0.8); bag.setHardwareAccel(settings.hardwareAcceleration ?? "auto"); bag.setAdaptiveTone(settings.adaptiveTone !== false); bag.setDownloadSource(settings.downloadSource ?? "auto"); }).catch(() => undefined); }, []);


  // 桌面/浏览器自动化是能力总闸：开关直接决定引擎能不能用，同时联动 nuphus MCP 与配套技能。
  // 具体实现在 applyGroup（见「能力总闸联动」块），这里只做转发，保证常规页是唯一入口。
  const toggleDesktopAuto = (next: boolean) => { void bag.applyGroup("desktop-automation", next); };
bag.toggleDesktopAuto = toggleDesktopAuto as typeof bag.toggleDesktopAuto;


  const toggleBrowserAuto = (next: boolean) => { void bag.applyGroup("browser-automation", next); };
bag.toggleBrowserAuto = toggleBrowserAuto as typeof bag.toggleBrowserAuto;


  /** 语气自适应开关（设置 → 个性化）：写 app-settings（全局开关），并让当前会话立刻跟上
   *  —— 关掉时重下发一次作用域，把已注入的语气块摘掉（否则要等下次改配置才消失）。 */
  const changeAdaptiveTone = (next: boolean) => {
    bag.setAdaptiveTone(next);
    bag.adaptiveToneRef.current = next;   // ref 立刻同步：onHarnessEvent 的闭包读不到新 state
    void window.codex.saveAppSettings({ adaptiveTone: next });
    const id = bag.threadRef.current?.id;
    if (id) void bag.pushSessionScope(id);
    bag.setNotice(next ? "语气自适应已开启：每个会话按自己的状态调整说法（只影响语气，不影响内容）" : "语气自适应已关闭：不再更新状态，已注入的语气块已从当前会话移除");
  };
bag.changeAdaptiveTone = changeAdaptiveTone as typeof bag.changeAdaptiveTone;


  // 硬件加速模式（设置 → 通用）：写入 app-settings，主进程下次启动时在 app ready 前应用。需重启生效。
  const changeHardwareAccel = (next: "auto" | "force" | "off") => {
    if (next === bag.hardwareAccel) return;
    bag.setHardwareAccel(next);
    bag.setRestartPending(true);
    const label = next === "force" ? "强制开启硬件加速" : next === "off" ? "关闭硬件加速" : "自动";
    bag.setNotice(`硬件加速已设为「${label}」，重启应用后生效${next === "force" ? "（适合低配机/软件渲染卡顿）" : ""}`);
    void window.codex.saveAppSettings({ hardwareAcceleration: next }).catch(() => { bag.setHardwareAccel(bag.hardwareAccel); bag.setRestartPending(false); });
  };
bag.changeHardwareAccel = changeHardwareAccel as typeof bag.changeHardwareAccel;


  // 开发工具下载源（设置 → 开发工具）：写入 app-settings；runtime:install 每次现读，
  // **下一次下载立即生效，无需重启**。切换失败回滚本地选择并提示。
  const changeDownloadSource = (next: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy") => {
    if (next === bag.downloadSource) return;
    bag.setDownloadSource(next);
    const labels: Record<string, string> = {
      auto: "自动（国内优先：镜像/加速在前，失败回落直连）",
      mirror: "国内镜像优先（npmmirror / gh 加速）",
      ghproxy: "GitHub 加速 · gh-proxy（失败回落官方直连）",
      ghfast: "GitHub 加速 · ghfast（失败回落官方直连）",
      direct: "官方直连",
      proxy: "本机代理优先（失败回落直连）",
    };
    bag.setNotice(`下载源已切为「${labels[next] ?? next}」，下一次下载立即生效`);
    void window.codex.saveAppSettings({ downloadSource: next }).catch(() => { bag.setDownloadSource(bag.downloadSource); bag.setNotice("下载源保存失败，请重试"); });
  };
bag.changeDownloadSource = changeDownloadSource as typeof bag.changeDownloadSource;
  return { sawRunningTurnRef, optimisticConfirmed, openingThread, setOpeningThread, pending, setPending, diff, setDiff, tokenUsage, setTokenUsage, tokenUsageRef, tokenUsageByThreadRef, persistTokenUsageSnapshot, inheritTokenUsageSnapshot, tokenUsageTotalsRef, derivedTokenUsageRef, normalizeTokenUsage, turnStartedAtRef, activeModelRef, usageStats, setUsageStats, streamRafRef, pendingDeltaRef, lastFlushAtRef, rightOpen, setRightOpen, desktopAuto, setDesktopAuto, browserAuto, setBrowserAuto, autoCompactRatio, setAutoCompactRatio, hardwareAccel, setHardwareAccel, downloadSource, setDownloadSource, adaptiveTone, setAdaptiveTone, restartPending, setRestartPending, sshServers, setSshServers, sshLoaded, setSshLoaded, sshBusyId, setSshBusyId, sshTestingId, setSshTestingId, sshDraft, setSshDraft, sshSaving, setSshSaving, sshQuery, setSshQuery, sshFilter, setSshFilter, sshChecked, setSshChecked, sshBatchBusy, setSshBatchBusy, sshTerminal, setSshTerminal, sshExecTarget, setSshExecTarget, sshEditorTest, setSshEditorTest, toggleDesktopAuto, toggleBrowserAuto, changeAdaptiveTone, changeHardwareAccel, changeDownloadSource };
}
