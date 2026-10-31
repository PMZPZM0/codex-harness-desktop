/**
 * 悬浮播报（event-broadcast）· 状态与队列
 *
 * 用户令（10-31）：「群事件当前的展示方式太丑，重构为悬浮播报组件：指定位置新增一个悬浮图标，
 * 专门播报群事件广播，播报完成后自动收纳为图标；点击图标可展开查看历史记录；图标支持拖拽并
 * 吸附到对话框边框上；把语音播报也迁移到该悬浮窗统一播报；其它播报类型一并接入。」
 *
 * ── 为什么单独一块 ─────────────────────────────────────────────────────────
 * 播报的**触发源**分散在三处（对话流里的群事件 item、`voice/announce-bus` 的播报状态、
 * bag 里的 `systemEvents`），而**展示者**是挂在 AppView 顶层的悬浮图标 —— 三者不在同一棵子树，
 * props 传不动。与 `wave-level` / `announce-bus` 同一套范式：模块级订阅广播。
 *
 * ── 边界（⛔ 别把渲染逻辑塞进来）────────────────────────────────────────────
 * · 这里只做「条目进出 + 去重 + 播报排队 + 历史持久化 + 未读/暂停」，不含任何样式与 DOM；
 * · 「什么算一条播报」由采集端决定（见 `collector.tsx` 与各 bridge）—— 加新类型只加 `kind`，
 *   不用改本文件之外的展示逻辑。
 * · 语音的**合成/播放**不在这里（仍在 `features/voice-announce`）—— 这里只把"正在念哪句"
 *   当作一条播报展示出来，并对接「停止」出口。
 */

/** 播报类型（⛔ 新增类型只往后加，展示端按 kind 取图标/配色；未知 kind 走默认样式）。 */
export type BroadcastKind =
  | "group"      // 群事件广播（成员进群/交活/审查结论/群提示）
  | "voice"      // 语音播报（正在念的那句话）
  | "system"     // 应用级系统提示（成功/警告/错误）
  | "turn"       // 回合异常（出错 / 中断 / 上下文超限）
  | "compact"    // 自动压缩上下文
  | "approval";  // 等待确认 / 等待审批

export type BroadcastTone = "info" | "ok" | "warn" | "error";

export type BroadcastItem = {
  /** 去重键（同一件事重复推只保留第一条） */
  id: string;
  kind: BroadcastKind;
  /** 一行标题（图标旁的主文案） */
  title: string;
  /** 正文/摘要（面板里展开看全文） */
  text?: string;
  tone?: BroadcastTone;
  /** 毫秒时间戳 */
  at: number;
  /** 归属会话（切会话时面板按会话过滤；空 = 全局） */
  threadId?: string;
  /** 次要信息（如群事件的成员名/任务名），面板以 chip 展示 */
  tags?: string[];
};

/** 历史条数上限（面板只展示最近这些；⛔ 不无限增长 —— 群事件在长会话里非常密集）。 */
export const BROADCAST_MAX = 80;
/** 单条播报气泡的展示时长（按类型区分）。
 *  ⛔ 10-31 用户令：「忙碌提醒同样需要加长展示」—— 等待确认/回合异常这类需要用户**行动**的，
 *     4.2 秒根本来不及看清；群事件与语音是"知会一下就够"，保持短。
 *     ⛔ 逐字动画的时长上限（约 1.4s）也在这个预算里，别把短的再压。 */
const ANNOUNCE_MS: Record<BroadcastKind, number> = {
  group: 4200,
  voice: 3200,
  system: 5200,
  compact: 5200,
  turn: 8000,
  approval: 9000,
};
const announceMsOf = (kind: BroadcastKind) => ANNOUNCE_MS[kind] ?? 4200;
const STORAGE_KEY = "harness-broadcast-history";
/** 只保留最近 7 天（更早的群事件没有回看价值，还占 localStorage 配额）。 */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

type Snapshot = {
  history: BroadcastItem[];
  /** 正在播报的那条（null = 已收纳为图标） */
  announcing: BroadcastItem | null;
  /** 面板是否展开 */
  open: boolean;
  /** 未读条数（按会话分账：⛔ 用户令「播报内容按会话独立显示」——
   *  别的会话来的播报不能算到当前会话头上，否则角标一直挂着、点开却看不到东西） */
  unreadBy: Record<string, number>;
  /** 暂停自动播报（仍入库，只是不自动冒泡） */
  paused: boolean;
};

/** 内存去重集合：启动时用历史回填 ⇒ 重开应用不会把同一批群事件再播一遍。 */
const seen = new Set<string>();
let history: BroadcastItem[] = [];
let announcing: BroadcastItem | null = null;
let open = false;
let unreadBy: Record<string, number> = {};
let paused = false;
let timer = 0;
/** 队列：同时到多条时依次播，而不是互相顶掉 */
const queue: BroadcastItem[] = [];
const listeners = new Set<(snap: Snapshot) => void>();

function load(): BroadcastItem[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    const cutoff = Date.now() - KEEP_MS;
    /* ⛔ 走 `Record<string, unknown>` 而不是 `any`：本仓守卫对"单文件 any 数"是棘轮，
       新板块一落地就破基线会被判红（12af）。unknown + 显式收窄同样是零校验成本。 */
    return list
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .filter((row) => typeof row.id === "string" && Number(row.at) > cutoff)
      .map((row) => ({
        id: String(row.id),
        kind: String(row.kind || "system") as BroadcastKind,
        title: String(row.title || ""),
        text: row.text ? String(row.text) : undefined,
        tone: (row.tone ? String(row.tone) : undefined) as BroadcastTone | undefined,
        at: Number(row.at) || Date.now(),
        threadId: row.threadId ? String(row.threadId) : undefined,
        tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 4) : undefined,
      }))
      .slice(0, BROADCAST_MAX);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* 隐私模式/配额满：内存里仍然可用，不因为存不下就丢播报 */
  }
}

history = load();
for (const item of history) seen.add(item.id);

/** ⛔ 快照必须**缓存同一个对象**：组件用 `useSyncExternalStore` 订阅，每次返回新对象
 *  会被 React 判成"一直在变"⇒ 无限重渲染（本仓 09-xx 踩过同型）。 */
let cached: Snapshot | null = null;

function snapshot(): Snapshot {
  if (!cached) cached = { history, announcing, open, unreadBy, paused };
  return cached;
}

function emit(): void {
  cached = null;
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* 单个订阅者出错不影响其它订阅者与采集端 */ }
  }
}

/** 当前快照（新订阅者立刻拿到，不用等下一次变化）。 */
export function getBroadcastSnapshot(): Snapshot {
  return snapshot();
}

export function subscribeBroadcast(fn: (snap: Snapshot) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function nextInQueue(): void {
  window.clearTimeout(timer);
  timer = 0;
  if (paused || open) { announcing = null; emit(); return; }
  const item = queue.shift();
  if (!item) { announcing = null; emit(); return; }
  announcing = item;
  emit();
  timer = window.setTimeout(() => nextInQueue(), announceMsOf(item.kind));
}

/**
 * 推入一条播报。返回 false = 这条之前已经推过（调用方不需要做任何事）。
 * ⛔ 去重发生在**入库之前**：群事件在对话流里每次重渲染都会扫到同一批 item，
 *    没有这一层，滚动一下就会把同一条播报重复念 N 遍。
 */
export function pushBroadcast(item: Omit<BroadcastItem, "at"> & { at?: number }): boolean {
  const id = String(item?.id ?? "").trim();
  if (!id || seen.has(id)) return false;
  const entry: BroadcastItem = {
    id,
    kind: item.kind,
    title: String(item.title ?? "").trim() || "播报",
    text: item.text ? String(item.text) : undefined,
    tone: item.tone,
    at: Number(item.at) || Date.now(),
    threadId: item.threadId,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags.slice(0, 4) : undefined,
  };
  seen.add(id);
  history = [entry, ...history].slice(0, BROADCAST_MAX);
  persist();
  /* 面板开着时不抢注意力（用户正在回看历史）——只入库，不弹气泡、不计数未读。 */
  if (open) { emit(); return true; }
  const bucket = entry.threadId ?? "";
  unreadBy = { ...unreadBy, [bucket]: (unreadBy[bucket] ?? 0) + 1 };
  queue.push(entry);
  if (!announcing) nextInQueue();
  else emit();
  return true;
}

/** 面板开合：打开时收起气泡并清未读（用户已经看到了）。 */
export function setBroadcastOpen(next: boolean, threadId = ""): void {
  if (open === next) return;
  open = next;
  if (next) {
    /* ⛔ 只清当前会话的未读：别的会话攒着的播报不能被我这一下抹掉 */
    if (unreadBy[threadId]) {
      const rest = { ...unreadBy };
      delete rest[threadId];
      unreadBy = rest;
    }
    window.clearTimeout(timer);
    timer = 0;
    announcing = null;
    queue.length = 0;
  }
  emit();
}

/** 暂停自动播报：入库照旧，只是不再自动冒泡（面板里仍能看到）。 */
export function setBroadcastPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  if (next) {
    window.clearTimeout(timer);
    timer = 0;
    announcing = null;
    queue.length = 0;
  }
  emit();
}

/** 只登记「这些已经播过」，不入库、不弹气泡。
 *  ⛔ 冷启动/切会话时对话流里本来就有一堆历史群事件 —— 不静默登记就会一次性糊用户一脸。 */
export function markBroadcastSeen(ids: string[]): void {
  for (const id of ids) if (id) seen.add(id);
}

/** 立刻收起当前气泡（"知道了"）。 */
export function dismissBroadcast(): void {
  window.clearTimeout(timer);
  timer = 0;
  announcing = null;
  if (!open) nextInQueue();
  else emit();
}

export function clearBroadcastHistory(): void {
  history = [];
  queue.length = 0;
  seen.clear();
  unreadBy = {};
  announcing = null;
  open = false;
  persist();
  emit();
}

/* ── 对外推送入口（CustomEvent，与 `codex-profile-updated` / 壁纸联动同一套范式）──────
   为什么要有：① 演示/自动化需要从外部推一条播报来验效果；② 将来任何模块、插件槽、
   外部脚本想"播报一句话"都走这里 —— 不必 import 组件，也不会开出第二个渲染实例。
   ⛔ 事件名是契约（`harness:broadcast`），detail 形状见 `BroadcastPushDetail`。 */
export const BROADCAST_CHANNEL = "harness:broadcast";

export type BroadcastPushDetail = {
  kind?: BroadcastKind;
  title: string;
  text?: string;
  tone?: BroadcastTone;
  threadId?: string;
  tags?: string[];
};

/** 从任意位置推一条播报（派发事件，由 `BroadcastHost` 统一消费）。 */
export function pushBroadcastViaChannel(detail: BroadcastPushDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<BroadcastPushDetail>(BROADCAST_CHANNEL, { detail }));
  } catch {
    /* 非浏览器环境（单测 / 纯逻辑导入）：静默忽略，不因为"没有 window"就抛 */
  }
}

/** 仅诊断/守卫用：当前入库条数与去重集合大小。 */
export function broadcastStats(): { history: number; seen: number; queued: number } {
  return { history: history.length, seen: seen.size, queued: queue.length };
}

/* ── 面板开合的对外出口（供键盘/全局入口调用；⛔ 不给外部直接改 open） ── */
export function toggleBroadcastPanel(threadId = ""): void {
  setBroadcastOpen(!open, threadId);
}
