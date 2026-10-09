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
  id: string; threadId?: string; turnId?: string; title?: string; detail?: string;
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

/** 某个回合里要显示的卡（turnId 精确匹配）。 */
export function pollTasksOfTurn(turnId: string): PollTask[] {
  const id = String(turnId ?? "");
  if (!id) return [];
  return snapshot.filter((task) => task.turnId === id);
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

function trimTasks() {
  if (tasks.length > MAX_TASKS) tasks = tasks.slice(tasks.length - MAX_TASKS);
}

/* ── 超时看门狗 ───────────────────────────────────────────────────────────────
   ⛔ 只在**真的有任务在轮询**时挂定时器（空闲时零心跳）。
   ⛔ 判据是 startedAt（总耗时），不是「距上一轮」——「超时上限」说的是"这件事最多等这么久"，
      用静默时长会让它永远等下去（模型每 9 分钟查一次就能无限续命）。 */
function ensureWatchdog() {
  const busy = tasks.some((task) => task.status === "polling");
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
  tasks = tasks.map((task) => {
    if (task.status !== "polling") return task;
    if (now - task.startedAt < task.timeoutMs) return task;
    changed = true;
    return { ...task, status: "timeout" as PollStatus, endedAt: now, error: `已等 ${Math.round(task.timeoutMs / 1000)} 秒仍无结果，按超时上限停了` };
  });
  if (changed) {
    emit();
    ensureWatchdog();
  }
}
