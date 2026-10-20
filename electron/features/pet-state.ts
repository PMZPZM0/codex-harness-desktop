/**
 * 桌面宠物 · 引擎事件 → 活动/状态归约（主进程侧，纯映射）。
 *
 * 10-21 按 Qoder 的桌宠改造：宠物不再只有一个「九态 + 一句气泡」，而是维护**每个会话一条活动**：
 *   waiting（等你处理）> running（执行中）> failed/interrupted > completed（本轮完成，等你看）
 * 宠物演最高优先级那条；活动气泡展示前两条。`completed` 不会被时钟自动抹回 idle ——
 * 它保持 review，直到用户从活动气泡「打开」或开始新一轮；`failed` 同样保持到处理。
 *
 * 为什么仍然放主进程：浮窗是独立 BrowserWindow，拿不到主窗口的 app 状态；主进程做唯一
 * 归约点，浮窗只收短字符串（标题 / 状态 / 最近一句），不拿原始事件与正文。
 */
import { engineActiveTurnIds } from "../runtime-refs";
import { isTurnEndMethod, turnIdOf } from "../turn-end";
import {
  petActivitySignature,
  petAttentionOfActivities,
  petDetailFromText,
  petItemText,
  petPhaseOfActivities,
  petTitleFromText,
  petToolDetail,
  normalizePetItemType,
  sortPetActivities,
} from "../../src/lib/pet-activity.mjs";

export type PetStateName =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type PetActivityStatus = "waiting" | "running" | "failed" | "interrupted" | "completed";

export interface PetActivity {
  threadId: string;
  turnId: string;
  title: string;
  detail: string;
  status: PetActivityStatus;
  updatedAt: number;
  canStop: boolean;
}

/** 推给浮窗的载荷（⛔ 只传短字符串，不传引擎原始事件 / 正文全文）。 */
export interface PetSignal {
  /** 当前动画状态（含一次性动作覆盖：完成时 jumping、失败时 failed） */
  state: PetStateName;
  /** 语义相位（waiting / running / failed / review / idle） */
  phase: PetStateName;
  /** 小气泡文案（空串 = 不显示） */
  bubble: string;
  /** 并行任务数（running + waiting） */
  busy: number;
  /** 最近一次工具名（兼容旧浮窗） */
  tool: string | null;
  /** 活动列表（最多两条，优先级排序） */
  activities: PetActivity[];
  /** 最高优先级会话 id */
  activeThreadId: string | null;
  /** 活动气泡提醒：pending / error */
  attention: "" | "pending" | "error";
  /** 用户手动收起了活动气泡 */
  activityCollapsed: boolean;
  /** 状态变更时间戳 */
  ts: number;
}

type Sink = (signal: PetSignal) => void;
let sink: Sink | null = null;

type ActivityRecord = PetActivity & { detailAt: number };

const activities = new Map<string, ActivityRecord>();
const pendingRequests = new Map<string, string>();
let activityCollapsed = false;
let bubble = "";
let bubbleUntil = 0;
let motion: { state: PetStateName; until: number; fallback: PetStateName } | null = null;
let clock: NodeJS.Timeout | null = null;
let lastTool: string | null = null;
const MAX_ACTIVITIES = 5;
const COMPLETED_TTL_MS = 30 * 60_000;
const DETAIL_THROTTLE_MS = 280;

const store = {
  signal: {
    state: "idle",
    phase: "idle",
    bubble: "",
    busy: 0,
    tool: null,
    activities: [],
    activeThreadId: null,
    attention: "",
    activityCollapsed: false,
    ts: 0,
  } as PetSignal,
};

function threadIdOf(params: any): string {
  if (!params || typeof params !== "object") return "";
  return String(params.threadId ?? params.thread_id ?? params.conversationId ?? params.thread?.id ?? params.turn?.threadId ?? "");
}

function fallbackTitle(threadId: string): string {
  return threadId ? `会话 ${threadId.slice(0, 8)}` : "当前任务";
}

function topActivities(): PetActivity[] {
  return sortPetActivities([...activities.values()]).slice(0, 2).map(({ detailAt, ...rest }) => ({
    ...rest,
    canStop: rest.status === "running" && Boolean(rest.turnId),
  }));
}

function runningCount(): number {
  return [...activities.values()].filter((item) => item.status === "running" || item.status === "waiting").length;
}

function pruneActivities(now: number) {
  const sorted = sortPetActivities([...activities.values()]);
  for (const item of sorted.slice(MAX_ACTIVITIES)) activities.delete(item.threadId);
  for (const item of [...activities.values()]) {
    if ((item.status === "completed" || item.status === "interrupted") && now - item.updatedAt > COMPLETED_TTL_MS) {
      activities.delete(item.threadId);
    }
  }
}

function currentPhase(now: number): PetStateName {
  if (motion && now < motion.until) return motion.state;
  const phase = petPhaseOfActivities([...activities.values()]);
  if (phase === "review") return "review";
  return phase;
}

function publish(force = false) {
  const now = Date.now();
  if (motion && now >= motion.until) motion = null;
  if (bubbleUntil && now >= bubbleUntil) bubble = "";
  pruneActivities(now);
  const phase = petPhaseOfActivities([...activities.values()]) as PetStateName;
  const state = currentPhase(now);
  const tops = topActivities();
  const next: PetSignal = {
    state,
    phase,
    bubble,
    busy: Math.max(runningCount(), engineActiveTurnIds.size),
    tool: lastTool,
    activities: tops,
    activeThreadId: tops[0]?.threadId ?? null,
    attention: petAttentionOfActivities([...activities.values()]),
    activityCollapsed,
    ts: now,
  };
  const previous = store.signal;
  const changed =
    force ||
    next.state !== previous.state ||
    next.phase !== previous.phase ||
    next.bubble !== previous.bubble ||
    next.busy !== previous.busy ||
    next.activeThreadId !== previous.activeThreadId ||
    next.attention !== previous.attention ||
    next.activityCollapsed !== previous.activityCollapsed ||
    petActivitySignature(next.activities) !== petActivitySignature(previous.activities);
  store.signal = next;
  if (changed) sink?.(next);
}

/** 浮窗创建时登记；销毁时清空。 */
export function setPetSignalSink(fn: Sink | null) {
  sink = fn;
  if (fn) {
    ensureClock();
    fn(store.signal);
  }
}

/** 当前状态快照（浮窗首帧补水用）。 */
export function petSignal(): PetSignal {
  return store.signal;
}

export function petStateName(): PetStateName {
  return currentPhase(Date.now());
}

export function petActivityCollapsed(): boolean {
  return activityCollapsed;
}

export function togglePetActivity(): boolean {
  activityCollapsed = !activityCollapsed;
  publish(true);
  return !activityCollapsed;
}

export function petActivityRecord(threadId: string): PetActivity | null {
  const item = activities.get(String(threadId ?? ""));
  if (!item) return null;
  const { detailAt, ...rest } = item;
  return { ...rest, canStop: rest.status === "running" && Boolean(rest.turnId) };
}

/** 用户从活动气泡打开了会话 ⇒ completed/failed 视为已看，清掉（running/waiting 不动）。 */
export function markPetActivitySeen(threadId: string): boolean {
  const id = String(threadId ?? "");
  const item = activities.get(id);
  if (!item) return false;
  if (item.status === "completed" || item.status === "failed" || item.status === "interrupted") {
    activities.delete(id);
    publish(true);
    return true;
  }
  return false;
}

function upsertActivity(threadId: string, patch: Partial<ActivityRecord>): ActivityRecord | null {
  const id = String(threadId ?? "");
  if (!id) return null;
  const now = Date.now();
  const existing = activities.get(id);
  const next: ActivityRecord = {
    threadId: id,
    turnId: patch.turnId ?? existing?.turnId ?? "",
    title: patch.title ?? existing?.title ?? fallbackTitle(id),
    detail: patch.detail ?? existing?.detail ?? "",
    status: patch.status ?? existing?.status ?? "running",
    updatedAt: patch.updatedAt ?? now,
    canStop: false,
    detailAt: patch.detailAt ?? existing?.detailAt ?? 0,
  };
  next.canStop = next.status === "running" && Boolean(next.turnId);
  activities.set(id, next);
  ensureClock();
  publish();
  return next;
}

function setStatusIfNotWaiting(threadId: string, status: PetActivityStatus, patch: Partial<ActivityRecord> = {}) {
  const existing = activities.get(threadId);
  if (existing?.status === "waiting") return;
  upsertActivity(threadId, { ...patch, status });
}

function showBubble(text: string, holdMs = 3600) {
  bubble = text;
  bubbleUntil = Date.now() + holdMs;
  publish();
}

function pulseMotion(state: PetStateName, text: string, holdMs: number, fallback: PetStateName) {
  motion = { state, until: Date.now() + holdMs, fallback };
  bubble = text;
  bubbleUntil = Date.now() + holdMs;
  publish();
}

/**
 * 喂一个引擎事件。返回是否改变了状态（便于测试断言）。
 *
 * 10-21：事件 item 类型是 PascalCase（`CommandExecution`），纯函数统一归一成 camelCase；
 * 旧实现用 camelCase 集合匹配原始 item ⇒ 工具/文件类事件其实一直没命中。
 */
export function feedPetEvent(event: unknown): boolean {
  const before = `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}`;
  const e = event as { id?: string; kind?: string; method?: string; status?: string; params?: Record<string, any> } | null;
  if (!e || typeof e !== "object") return false;
  ensureClock();

  /* 引擎向宿主发起的请求（审批 / 提问等）：对应会话进入 waiting，优先于其他一切。 */
  if (e.kind === "request") {
    const threadId = threadIdOf(e.params);
    const requestId = String(e.id ?? e.params?.requestId ?? "");
    const target = threadId || [...activities.values()].find((item) => item.status === "running")?.threadId || "";
    if (requestId && target) pendingRequests.set(requestId, target);
    if (target) {
      upsertActivity(target, { status: "waiting", detail: "等待你的确认…" });
      showBubble("等你确认一下");
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (e.kind === "status") {
    if (e.status === "ready" && activities.size === 0 && !motion && store.signal.state !== "idle") publish(true);
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }
  if (e.kind !== "notification") return false;

  const p = e.params ?? {};
  const threadId = threadIdOf(p);
  const method = String(e.method ?? "");

  if (method === "serverRequest/resolved") {
    const requestId = String(p.requestId ?? "");
    const waitingThread = pendingRequests.get(requestId);
    if (requestId) pendingRequests.delete(requestId);
    if (waitingThread && activities.get(waitingThread)?.status === "waiting") {
      upsertActivity(waitingThread, { status: "running", detail: "继续执行…" });
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (method === "thread/name/updated") {
    if (threadId && p.threadName) {
      const existing = activities.get(threadId);
      if (existing) upsertActivity(threadId, { title: petTitleFromText(p.threadName, existing.title) });
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (method === "thread/archived" || method === "thread/deleted") {
    if (threadId && activities.delete(threadId)) {
      pendingRequests.forEach((value, key) => { if (value === threadId) pendingRequests.delete(key); });
      publish(true);
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (method === "turn/started") {
    if (threadId) {
      motion = null;
      upsertActivity(threadId, {
        turnId: turnIdOf(p),
        status: "running",
        detail: "正在开始…",
        title: activities.get(threadId)?.title ?? fallbackTitle(threadId),
      });
      showBubble("");
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (isTurnEndMethod(method)) {
    if (threadId) {
      const existing = activities.get(threadId);
      const title = existing?.title ?? fallbackTitle(threadId);
      if (method === "turn/completed") {
        const detail = existing?.detail && !existing.detail.startsWith("正在") ? existing.detail : "本轮已完成";
        upsertActivity(threadId, { turnId: turnIdOf(p) || existing?.turnId || "", status: "completed", detail, title });
        pulseMotion("jumping", "搞定！", 1600, "review");
      } else if (method === "turn/failed") {
        const reason = String(p.error?.message ?? p.turn?.error?.message ?? "").slice(0, 120);
        upsertActivity(threadId, { turnId: turnIdOf(p) || existing?.turnId || "", status: "failed", detail: reason || "本轮执行失败", title });
        pulseMotion("failed", "这轮出错了", 3200, "failed");
      } else {
        upsertActivity(threadId, { turnId: turnIdOf(p) || existing?.turnId || "", status: "interrupted", detail: "本轮已中断", title });
        pulseMotion("failed", "已中断", 2200, "failed");
      }
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (method === "item/started" || method === "item/completed") {
    const item = (p.item ?? {}) as Record<string, unknown>;
    const type = normalizePetItemType(item.type);
    if (!threadId) return false;
    if (type === "userMessage") {
      const text = petItemText(item);
      const title = petTitleFromText(text, activities.get(threadId)?.title ?? fallbackTitle(threadId));
      upsertActivity(threadId, { title, turnId: turnIdOf(p) || activities.get(threadId)?.turnId || "" });
    } else if (type === "agentMessage") {
      const text = petItemText(item);
      setStatusIfNotWaiting(threadId, "running", { detail: petDetailFromText(text) || "正在整理结果…", detailAt: Date.now() });
    } else if (["commandExecution", "fileChange", "webSearch", "mcpToolCall", "dynamicToolCall"].includes(type)) {
      lastTool = type;
      setStatusIfNotWaiting(threadId, "running", { detail: petToolDetail(item), detailAt: Date.now(), turnId: turnIdOf(p) || activities.get(threadId)?.turnId || "" });
    } else if (type === "reasoning") {
      setStatusIfNotWaiting(threadId, "running", { detail: "正在推演…", detailAt: Date.now() });
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  if (method === "item/agentMessage/delta") {
    if (!threadId) return false;
    const delta = String(p.delta ?? "");
    const existing = activities.get(threadId);
    if (delta.trim() && (!existing || Date.now() - existing.detailAt >= DETAIL_THROTTLE_MS)) {
      setStatusIfNotWaiting(threadId, "running", { detail: petDetailFromText(delta, 96) || existing?.detail || "正在写回复…", detailAt: Date.now() });
    }
    return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
  }

  return `${petActivitySignature([...activities.values()])}|${store.signal.state}|${store.signal.bubble}` !== before;
}

/** 低频时钟：一次性动作到点回落 / 清理过期完成项；⛔ 不再把 review/failed 自动抹回 idle。 */
function ensureClock() {
  if (clock) return;
  clock = setInterval(() => {
    if (!sink && !motion && !activities.size) {
      clearInterval(clock!);
      clock = null;
      return;
    }
    const now = Date.now();
    const needPublish = Boolean((motion && now >= motion.until) || (bubbleUntil && now >= bubbleUntil));
    const beforeCount = activities.size;
    pruneActivities(now);
    if (needPublish || activities.size !== beforeCount) publish();
  }, 200);
  clock.unref?.();
}

/** 仅供测试/诊断：重置到空闲（不对外暴露给 IPC）。 */
export function resetPetState() {
  activities.clear();
  pendingRequests.clear();
  motion = null;
  bubble = "";
  bubbleUntil = 0;
  lastTool = null;
  activityCollapsed = false;
  publish(true);
}
