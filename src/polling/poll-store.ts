/**
 * 轮询板块的**状态机 + 模块级任务表**（10-09 建）。
 *
 * ⛔ 为什么是模块级而不是 React state：轮询任务的生命周期**跨组件**——
 *    卡在回合里、胶囊在输入框上、事件从主进程广播进来。三处各自 useState 就是三份真相，
 *    必然出现「胶囊显示 2 个、卡片一个都没有」。与 `src/voice/announce-bus.ts` 同一套做法
 *    （单一真相源 + 订阅），消费侧一律用 `useSyncExternalStore`。
 *
 * ⛔⛔ 闭环纪律（本板块最容易糊的地方）：
 *    · `polling` 是唯一的非终态；once settled, forever settled —— 迟到的 round **不许**把
 *      已结束的任务复活成「轮询中」（主进程超时判掉的那一刻，后面还在飞的那一轮结果已经没有
 *      意义了；复活 = 面板永远停在「轮询中」，用户等不到结论）。
 *    · 超时由**两侧**判：主进程（wait 循环自己到点）与这里（看门狗）都判，谁先到算谁。
 *      ⛔ 不能只靠主进程：模型自己循环调用 `video_status`（不带 wait）时主进程没有循环，
 *        没人判超时 ⇒ 卡会永远挂在「轮询中」。
 *    · `aborted` 只由用户动作产生（卡片/胶囊的中止按钮），不由错误推导。
 */
import { POLL_DEFAULTS, normalizePollConfig, type PollConfig, type PollStatus } from "../lib/poll-config.mjs";

export type { PollStatus, PollConfig };

/**
 * 任务来源（10-09 追加）：
 *   · `poll` = 真正的轮询（视频生成那类：提交后跑到厂商那边，模型/主进程隔一会儿查一次）
 *     —— 对话流里会为它渲染一张卡；
 *   · `tool` = **长命令 / 长耗时工具调用**（用户 10-09 追加要求：「长命令、长工具调用也算一条
 *     后台任务」）—— 只在输入框那颗「N 个后台任务运行中」胶囊里出现，**不进对话流**
 *     （它在流里已经有自己的工具卡了，再画一张就是同一件事两个地方看）。
 */
export type PollKind = "poll" | "tool";

export interface PollRound {
  /** 第几轮（1 起） */
  n: number;
  at: number;
  ok: boolean;
  /** 厂商/接口给的进展描述（如「排队中」「渲染 60%」） */
  summary?: string;
  progress?: string;
  error?: string;
}

export interface PollTask {
  id: string;
  /** 来源：`poll` = 轮询（对话流里也有卡）；`tool` = 长命令 / 长工具调用（只在胶囊里） */
  kind: PollKind;
  threadId: string;
  turnId: string;
  title: string;
  detail: string;
  status: PollStatus;
  rounds: PollRound[];
  intervalMs: number;
  timeoutMs: number;
  maxRetry: number;
  startedAt: number;
  endedAt?: number;
  /** 最近一次进展（卡头那一行显示） */
  progress?: string;
  /** 终态产物（成功=落盘路径/地址，失败/超时=原因） */
  result?: string;
  error?: string;
  /** 连续失败计数（退避用；成功一轮即清零） */
  retries: number;
  /** 主进程是否在**托管**这一轮等待（managed ⇒ 间隔用配置值；否则间隔是实测出来的） */
  managed: boolean;
}

/** 单任务最多留多少轮记录（超了丢最老的 —— 一轮一行，几百轮会把展开体撑爆）。 */
const MAX_ROUNDS = 200;
/** 全表最多留多少任务（历史会话会一直堆）。 */
const MAX_TASKS = 60;
const CONFIG_KEY = "poll-settings";

let tasks: PollTask[] = [];
let config: PollConfig = { ...POLL_DEFAULTS };
let snapshot: PollTask[] = tasks;
const listeners = new Set<() => void>();
let watchdog: number | null = null;

function emit() {
  snapshot = tasks.slice();
  for (const fn of listeners) {
    try { fn(); } catch { /* 一个订阅者崩了不影响别人 */ }
  }
}

/** ⛔ getSnapshot 必须返回**稳定引用**（useSyncExternalStore 契约）：只在 mutate 后重建数组。 */
export function getPollSnapshot(): PollTask[] {
  return snapshot;
}

export function subscribePollStore(fn: () => void): () => void {
  listeners.add(fn);
  ensureWatchdog();
  return () => {
    listeners.delete(fn);
    ensureWatchdog();
  };
}

export function getPollConfig(): PollConfig {
  return config;
}

export function setPollConfig(patch: Partial<PollConfig> | null): PollConfig {
  config = normalizePollConfig(patch, config);
  persistConfig();
  emit();
  return config;
}

function persistConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* 隐私模式/存储满：内存里照样生效 */ }
}

export function hydratePollConfig(): PollConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) config = normalizePollConfig(JSON.parse(raw), POLL_DEFAULTS);
  } catch { /* 存的是脏数据 ⇒ 用默认，不弹错 */ }
  emit();
  return config;
}

function indexOfTask(id: string): number {
  return tasks.findIndex((task) => task.id === id);
}

/**
 * 开一个任务（幂等：同一个 id 再来一次只补字段，不清历史轮次）。
 *
 * ⛔ **已结束的同 id 任务不复活**：`video_status` 成功后模型偶尔会再查一次（确认落盘），
 *    那时若把任务从 success 拉回 polling，用户刚看到的「成功」会自己变回「轮询中」。
 */
export function openPollTask(input: {
  id: string; kind?: PollKind; threadId?: string; turnId?: string; title?: string; detail?: string;
  intervalMs?: number; timeoutMs?: number; maxRetry?: number; managed?: boolean;
}): PollTask {
  const id = String(input?.id ?? "").trim();
  if (!id) throw new Error("openPollTask: id 必填（用 jobId 当任务 id）");
  const now = Date.now();
  const cfg = normalizePollConfig({ intervalMs: input?.intervalMs, timeoutMs: input?.timeoutMs, maxRetry: input?.maxRetry }, config);
  const found = indexOfTask(id);
  if (found >= 0) {
    const prev = tasks[found];
    const next: PollTask = {
      ...prev,
      threadId: prev.threadId || String(input?.threadId ?? ""),
      turnId: prev.turnId || String(input?.turnId ?? ""),
      title: prev.title || String(input?.title ?? "后台任务"),
      detail: prev.detail || String(input?.detail ?? ""),
      intervalMs: cfg.intervalMs,
      timeoutMs: cfg.timeoutMs,
      maxRetry: cfg.maxRetry,
      managed: Boolean(input?.managed ?? prev.managed),
    };
    tasks[found] = next;
    trimTasks();
    emit();
    ensureWatchdog();
    return next;
  }
  const task: PollTask = {
    id,
    kind: input?.kind === "tool" ? "tool" : "poll",
    threadId: String(input?.threadId ?? ""),
    turnId: String(input?.turnId ?? ""),
    title: String(input?.title ?? "后台任务"),
    detail: String(input?.detail ?? ""),
    status: "polling",
    rounds: [],
    intervalMs: cfg.intervalMs,
    timeoutMs: cfg.timeoutMs,
    maxRetry: cfg.maxRetry,
    startedAt: now,
    retries: 0,
    managed: Boolean(input?.managed),
  };
  tasks = [...tasks, task];
  trimTasks();
  emit();
  ensureWatchdog();
  return task;
}

/** 记一轮（⛔ 终态任务的迟到 round 一律丢弃 —— 见文件头「闭环纪律」）。 */
export function pushPollRound(id: string, round: { ok?: boolean; summary?: string; progress?: string; error?: string }): void {
  const idx = indexOfTask(String(id ?? ""));
  // 任务不在表里（渲染层晚启动 / 刷新后）⇒ 先建一个同 id 的空壳，别把这一轮丢掉
  if (idx < 0) {
    openPollTask({ id: String(id ?? "") });
  }
  const at = indexOfTask(String(id ?? ""));
  if (at < 0) return;
  const prev = tasks[at];
  if (prev.status !== "polling") return;
  const ok = round?.ok !== false && !round?.error;
  const list = [...prev.rounds, {
    n: prev.rounds.length + 1,
    at: Date.now(),
    ok,
    summary: round?.summary ? String(round.summary) : undefined,
    progress: round?.progress ? String(round.progress) : undefined,
    error: round?.error ? String(round.error) : undefined,
  }];
  tasks[at] = {
    ...prev,
    rounds: list.length > MAX_ROUNDS ? list.slice(list.length - MAX_ROUNDS) : list,
    // 成功一轮 = 连续失败清零（退避是给"连续失败"用的，成功一次就从头算）
    retries: ok ? 0 : prev.retries,
    progress: round?.progress ? String(round.progress) : (round?.summary ? String(round.summary) : prev.progress),
    error: ok ? undefined : (round?.error ? String(round.error) : prev.error),
  };
  emit();
}

/** 收尾（success / failed / timeout / aborted）。⛔ 已是终态就不再改（先到先得，避免互相覆盖）。 */
export function settlePollTask(id: string, patch: { status: PollStatus; result?: string; error?: string; progress?: string }): void {
  const idx = indexOfTask(String(id ?? ""));
  if (idx < 0) return;
  const prev = tasks[idx];
  if (prev.status !== "polling") return;
  const status = patch?.status === "polling" ? "failed" : (patch?.status ?? "failed");
  tasks[idx] = {
    ...prev,
    status,
    endedAt: Date.now(),
    result: patch?.result ? String(patch.result) : prev.result,
    error: patch?.error ? String(patch.error) : prev.error,
    progress: patch?.progress ? String(patch.progress) : prev.progress,
  };
  emit();
  ensureWatchdog();
}

/** 用户中止（唯一能产生 `aborted` 的入口 —— 错误/超时/失败都不许走这里）。 */
export function abortPollTask(id: string): void {
  settlePollTask(id, { status: "aborted", error: "已被你中止" });
}

export function getPollTask(id: string): PollTask | null {
  const idx = indexOfTask(String(id ?? ""));
  return idx < 0 ? null : tasks[idx];
}

/**
 * 补挂回合 id（⛔ 少这一步卡就会"凭空消失"）。
 *
 * 场景：主进程广播 `poll:start` 时只知道 threadId（引擎的 tool 调用里**没有** turnId）；
 * 渲染层那一瞬间也可能还没拿到"当前回合是哪个"（turn/started 与工具调用几乎同帧到达）。
 * ⇒ 先把任务存下来，等本窗口知道 turnId 了，把属于本会话、还没有归属的任务补挂上去。
 */
export function backfillPollTurn(threadId: string, turnId: string): void {
  const tid = String(threadId ?? "");
  const turn = String(turnId ?? "");
  if (!tid || !turn) return;
  let changed = false;
  tasks = tasks.map((task) => {
    if (task.threadId !== tid || task.turnId) return task;
    changed = true;
    return { ...task, turnId: turn };
  });
  if (changed) emit();
}

/** 某个回合里要显示的**卡**（turnId 精确匹配；⛔ 只取 `poll` 类 —— `tool` 类在流里已有自己的工具卡）。 */
export function pollTasksOfTurn(turnId: string): PollTask[] {
  const id = String(turnId ?? "");
  if (!id) return [];
  return snapshot.filter((task) => task.kind === "poll" && task.turnId === id);
}

/** 某个会话里**还在跑**的任务（胶囊的数就来自这里）。 */
export function runningPollTasksOfThread(threadId: string): PollTask[] {
  const id = String(threadId ?? "");
  if (!id) return [];
  return snapshot.filter((task) => task.threadId === id && task.status === "polling");
}

/** 切会话/清场用（不主动调；留作拓展接口）。 */
export function clearPollTasks(threadId?: string): void {
  tasks = threadId ? tasks.filter((task) => task.threadId !== threadId) : [];
  emit();
  ensureWatchdog();
}

/* ── 长命令 / 长工具调用 → 后台任务（10-09 用户追加：「长命令、长工具调用也算一条后台任务」）────
   ⛔ 为什么要**阈值**（不是每个工具调用都弹）：一次 `read` / `ls` 也就几十毫秒，全弹进胶囊
      等于给每个工具调用挂个转圈 —— 用户要的是"哪些活儿还在跑"，不是"刚刚跑了什么"。
   ⛔ 为什么提升动作放在**看门狗**而不是 `beginToolWatch` 里定时：时间到了才登记的判据是"现在
      这一刻还在跑"，只有周期 tick 知道；而且这样**空闲时一个定时器都不挂**（与轮询同一套）。
   ⛔ 阈值是**判定门槛**不是任务寿命上限：过了门槛就登记，之后跑多久都留在胶囊里，直到
      `item/completed` 或回合结束来收尾（长命令本来就可能跑十几分钟）。 */

/** 跑多久才算"长"（毫秒）。不到这个时长的工具调用不占胶囊。 */
export const SLOW_TOOL_MS = 8000;

type ToolWatch = { id: string; threadId: string; turnId: string; title: string; startedAt: number };
const watchingTools = new Map<string, ToolWatch>();

/** 长命令任务的 id 前缀 —— ⛔ 必须与视频 jobId 分开命名空间（两套 id 都来自主进程，会撞）。 */
const toolTaskId = (itemId: string) => `tool:${itemId}`;

/** 一个工具项开始跑了（引擎 `item/started`）。幂等：同 id 再来一次不重置计时。 */
export function beginToolWatch(input: { id: string; threadId?: string; turnId?: string; title?: string }): void {
  const id = String(input?.id ?? "").trim();
  if (!id || watchingTools.has(id)) return;
  watchingTools.set(id, {
    id,
    threadId: String(input?.threadId ?? ""),
    turnId: String(input?.turnId ?? ""),
    title: String(input?.title ?? "正在执行").trim() || "正在执行",
    startedAt: Date.now(),
  });
  ensureWatchdog();
}

/** 一个工具项结束了（引擎 `item/completed`）。没到阈值（从未登记成任务）时收尾是 no-op。 */
export function endToolWatch(id: string, patch: { failed?: boolean } = {}): void {
  const key = String(id ?? "");
  const watch = watchingTools.get(key);
  if (!watch) return;
  watchingTools.delete(key);
  settlePollTask(toolTaskId(key), patch?.failed ? { status: "failed", error: "工具调用失败" } : { status: "success" });
  ensureWatchdog();
}

/** 回合结束了（`turn/completed` / `turn/aborted` / `turn/failed` / `turn/interrupted`）：
 *  把这一回合还没收到 completed 的工具项一起收尾。
 *  ⛔ 少了它：被打断/中途报错的回合里，工具项的 completed 可能永远不来 ⇒ 胶囊里挂一条
 *    "永远在跑"的幽灵（**长命令任务没有任何超时兜底** —— 见 tickWatchdog ② 显式只收 `poll` 类，
 *    理由是"长命令跑多久是它自己的事"⇒ 唯一收尾通道就是这里，一旦漏掉即永久残留）。
 *  ⛔ 2026-10-10 加 `threadId` 二级兜底（用户反馈「命令没有回传结果，就一直挂着」）：
 *    万一某条 watch 的 `turnId` 缺省（事件的 turnId 字段缺省时 watch 记的是空串），
 *    回合级匹配会永远落空 ⇒ 按**会话**收掉它。只在事件确实带了 threadId 时启用，不跨会话误收。
 *  ⛔ 状态用 `failed` 不用 `aborted`：`aborted` 在本模块的语义是「**用户**按了中止」，
 *    这里的收尾不代表用户动作（正常结束的回合里，工具项早已被 item/completed 收走 ⇒ 这里是 no-op）。 */
export function endToolWatchesOfTurn(turnId: string, threadId?: string): void {
  const turn = String(turnId ?? "");
  const thread = String(threadId ?? "");
  if (!turn && !thread) return;
  let changed = false;
  for (const [id, watch] of [...watchingTools]) {
    const sameTurn = Boolean(turn) && watch.turnId === turn;
    const orphanOfThread = Boolean(thread) && !watch.turnId && watch.threadId === thread;
    if (!sameTurn && !orphanOfThread) continue;
    watchingTools.delete(id);
    settlePollTask(toolTaskId(id), { status: "failed", error: "回合已结束，这次工具调用没有收到完成回执" });
    changed = true;
  }
  if (changed) ensureWatchdog();
}

/* ── 「中止」出口（胶囊里那颗按钮）─────────────────────────────────────────────
   长命令的中止 = 打断当前回合（命令是引擎在跑，宿主只能 interrupt），而 interrupt 在 app-state
   的 bag 上 —— 模块级 store 拿不到。⇒ 与 `announce-bus.setAnnounceStopHandler` 同一套范式：
   有 bag 的组件（PollBridge）把回调注册进来，store 只负责转调。
   ⛔ 轮询任务（视频）不走这里：它有自己的 `poll:abort` 通道，能真正停掉厂商那边在等的循环。 */
let toolAbortHandler: ((taskId: string) => void) | null = null;

export function setToolAbortHandler(fn: ((taskId: string) => void) | null): void {
  toolAbortHandler = fn;
}

export function requestToolAbort(taskId: string): void {
  try { toolAbortHandler?.(String(taskId ?? "")); } catch { /* 中止失败不影响别的功能 */ }
}

/* ── 「后台任务完成 → 自动续跑」的防循环记录（10-10）──────────────────────────────
   ⛔ 为什么放模块级（而不是某个组件的 useRef）：任务表本来就在这里，配额与它同源；
      放模块级还让**守卫能直接 import 真跑**（本项目纪律：判据要能实测，不靠读代码猜）。
   ⛔ 为什么要有它：自动续跑 = 应用**替用户发消息**（烧 token）。没有闸就可能
      「结果 → 续跑 → 模型又开一个轮询 → 又续跑」地滚下去。
   返回 false = 本会话在窗口内已达上限，调用方**静默停手**（不弹错、不打扰）。 */
const pollContinueLog = new Map<string, { count: number; firstAt: number }>();

export function notePollAutoContinue(threadId: string, windowMs: number, maxAttempts: number): boolean {
  const key = String(threadId ?? "");
  if (!key) return false;
  const now = Date.now();
  const rec = pollContinueLog.get(key);
  if (!rec || now - rec.firstAt > Number(windowMs)) {
    pollContinueLog.set(key, { count: 1, firstAt: now });
    return true;
  }
  if (rec.count >= Number(maxAttempts)) return false;
  rec.count += 1;
  return true;
}

function trimTasks() {
  if (tasks.length > MAX_TASKS) tasks = tasks.slice(tasks.length - MAX_TASKS);
}

/* ── 超时看门狗 ───────────────────────────────────────────────────────────────
   ⛔ 只在**真的有任务在轮询**时挂定时器（空闲时零心跳）。
   ⛔ 判据是 startedAt（总耗时），不是「距上一轮」——「超时上限」说的是"这件事最多等这么久"，
      用静默时长会让它永远等下去（模型每 9 分钟查一次就能无限续命）。 */
function ensureWatchdog() {
  // 忙 = 有轮询任务在跑，**或**还有工具项在跑（长命令得等它过阈值才登记成任务）
  const busy = tasks.some((task) => task.status === "polling") || watchingTools.size > 0;
  if (busy && watchdog == null && listeners.size > 0) {
    watchdog = window.setInterval(tickWatchdog, 1000);
  } else if ((!busy || listeners.size === 0) && watchdog != null) {
    window.clearInterval(watchdog);
    watchdog = null;
  }
}

function tickWatchdog() {
  const now = Date.now();
  let changed = false;
  /* ① 跑过阈值的长命令 / 长工具调用 ⇒ 提升成后台任务。
     ⛔ kind:"tool" —— 只在胶囊里出现，**不进对话流**（它在流里已经有自己的工具卡了）。
     ⛔ startedAt 用 watch 的真实起点：这样胶囊上的"已跑多久"是从命令开始算的，不是从登记算的。 */
  for (const watch of watchingTools.values()) {
    const id = toolTaskId(watch.id);
    if (now - watch.startedAt < SLOW_TOOL_MS || indexOfTask(id) >= 0) continue;
    tasks = [...tasks, {
      id, kind: "tool", threadId: watch.threadId, turnId: watch.turnId,
      title: watch.title, detail: "",
      status: "polling", rounds: [],
      intervalMs: config.intervalMs, timeoutMs: config.timeoutMs, maxRetry: config.maxRetry,
      startedAt: watch.startedAt, retries: 0, managed: false,
    }];
    changed = true;
  }
  /* ② 超时判定（⛔ 只对 kind:"poll" —— 长命令跑多久是它自己的事，别拿轮询超时上限把它掐了） */
  tasks = tasks.map((task) => {
    if (task.status !== "polling" || task.kind !== "poll") return task;
    if (now - task.startedAt < task.timeoutMs) return task;
    changed = true;
    return { ...task, status: "timeout" as PollStatus, endedAt: now, error: `已等 ${Math.round(task.timeoutMs / 1000)} 秒仍无结果，按超时上限停了` };
  });
  if (changed) {
    trimTasks();
    emit();
    ensureWatchdog();
  }
}
