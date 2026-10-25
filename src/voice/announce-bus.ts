/**
 * 「语音播报」事件总线（10-08 新增板块 `src/features/voice-announce/` 的**源**）。
 *
 * 为什么要有它：播报的**触发源**（引擎事件）在 `app-state` 的事件路由里，而**执行者**
 * （合成 + 播放 + 开关判定）是一个独立功能板块，两者不在同一棵子树，props 传不动。
 * 与 `wave-level.ts` / `wake-state.ts` 同一套范式：模块级订阅广播。
 *
 * 职责边界（⛔ 别把逻辑塞进来）：
 *   · 本文件只做**事件转发**，不做开关判定、不做断句、不做合成 —— 那些都在播报板块里；
 *   · **通话中不走这里**：通话的播报由 `VoiceCallFloat` 自己的链路负责（它还要喂 AEC 参考环、
 *     走音量/世代号/打断那一套）。订阅方读 `getVoiceStage().active` 自己避让，
 *     否则通话中会出现「两个播报器同时念」。
 */

export type AnnounceEvent =
  /**
   * 正文流式增量（只在**当前会话**上转发；后台会话的输出不该被念出来）。
   * ⛔ 10-21 用户契约：**每个正文段都要播**（原先「只有 Codex 标记过的回合才念」已废 ——
   *    模型很少调标记工具 ⇒ 几乎听不到）。消费者只判总开关与通话避让，其余在 `speak()` 入口。
   */
  | { type: "delta"; threadId: string; text: string }
  /** 回合结束：带上**最终回复原文**，供「结束播报稿」解析后朗读 */
  | { type: "turnDone"; threadId: string; text: string; aborted: boolean }
  /**
   * 模型**主动**插播一句话（`voice_announce` 工具，10-09）。
   * ⛔ 它不受播报开关管 —— 开关只决定"要不要念 Codex 写的播报稿"，而这是显式调用，用户就要听这一句。
   */
  | { type: "toolSpeak"; threadId: string; text: string; speed?: number };

type Listener = (event: AnnounceEvent) => void;

const listeners = new Set<Listener>();

export function publishAnnounceEvent(event: AnnounceEvent): void {
  for (const fn of listeners) {
    try { fn(event); } catch { /* 单个订阅者出错不影响其他订阅者，更不能反过来影响事件路由 */ }
  }
}

export function subscribeAnnounce(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 订阅者数量（仅用于诊断/守卫，不参与逻辑）。 */
export function announceListenerCount(): number {
  return listeners.size;
}

// ── 「停止播报」回调：悬浮球右键菜单 / 状态条按钮调用，执行端（播报域）注册 ──
//    ⛔ 为什么必须有这个出口：非通话播报是**只管说、不管听**的（不开麦克风），
//      没有它用户就**没有任何办法让它闭嘴** —— 一条长回复能被念上好几分钟。
//      与 wave-level 的 setVoiceStopHandler / setVoiceSkipHandler 同一套广播范式。
let stopHandler: ((threadId?: string) => void) | null = null;
let resumeHandler: ((threadId?: string) => void) | null = null;

export function setAnnounceStopHandler(fn: ((threadId?: string) => void) | null): void {
  stopHandler = fn;
}

export function requestAnnounceStop(threadId?: string): void {
  try { stopHandler?.(threadId); } catch { /* 停止失败不影响别的功能 */ }
}

/* ── 「恢复播报」出口（10-12 用户：「停止都停止不了，一直播报」）────────────────────
   ⛔ 为什么必须有**反向**出口：用户按「停止」之后，执行端会置**静音闩锁**（在 `speak()` 入口
      拦下后续所有播报——正文实时 / 工具插播 / 结束播报稿三条入口全过那一处）。
      只有闩锁没有解除口 = 用户按一次就把播报永久废了（比"停不下来"更糟：他再也听不到了）。
      出口放在**状态条**上（按停后它本来就不消失 ⇒ 那里正是用户手指刚离开的地方）。 */
export function setAnnounceResumeHandler(fn: ((threadId?: string) => void) | null): void {
  resumeHandler = fn;
}

export function requestAnnounceResume(threadId?: string): void {
  try { resumeHandler?.(threadId); } catch { /* 恢复失败不影响别的功能 */ }
}

/* ── 会话级播报开关（10-22 用户：「每个会话独立状态，喇叭开关只决定当前会话」）──────
   为什么放在总线：TurnView 的 📢 按钮、悬浮球右键菜单、状态条、执行端 hook 四处都要读/写
   同一个状态；总线是它们唯一的公共面。状态按 threadId 分开，并落 localStorage ——
   同一会话重开仍保持用户的选择，不同会话互不影响。 */
const THREAD_MUTE_KEY = "announce-muted-threads";
function readMutedThreads(): Set<string> {
  try {
    const raw = localStorage.getItem(THREAD_MUTE_KEY);
    const list = JSON.parse(raw || "[]");
    return new Set(Array.isArray(list) ? list.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}
const mutedThreads = readMutedThreads();
const threadMuteListeners = new Set<() => void>();

export function isAnnounceMutedForThread(threadId: string): boolean {
  return Boolean(threadId) && mutedThreads.has(threadId);
}

export function subscribeAnnounceThreadMuted(listener: () => void): () => void {
  threadMuteListeners.add(listener);
  return () => { threadMuteListeners.delete(listener); };
}

export function setAnnounceMutedForThread(threadId: string, muted: boolean): void {
  const id = String(threadId ?? "");
  if (!id) return;
  const had = mutedThreads.has(id);
  if (had === muted) return;
  if (muted) mutedThreads.add(id);
  else mutedThreads.delete(id);
  try { localStorage.setItem(THREAD_MUTE_KEY, JSON.stringify([...mutedThreads])); } catch { /* 隐私模式 */ }
  for (const listener of threadMuteListeners) {
    try { listener(); } catch { /* 单个订阅者失败不影响其它 */ }
  }
}

/* ── 「播报状态」广播（10-09 用户：「增加播报进行中的实时反馈」）────────────────────
   为什么再起一条：执行端（合成 + 播放队列）在 hook 里，而显示层是贴在输入框上的那一条状态栏，
   两者不在一个 React 子树 ⇒ 与 announce 事件、wave-level 完全同一套范式。
   ⛔ 这里只转**事实**（有没有在念、正在念哪句、还排着几句），不做任何"该怎么显示"的判断。 */
export type AnnounceStatus = {
  /** 有东西要念（含还在合成的那句）⇒ 状态栏该出现 */
  active: boolean;
  /** 当前正在出声的那一句（没有则空串） */
  current: string;
  /** 还在排队的段数（不含正在念的这一句） */
  pending: number;
  /** 这一轮的来源：正文实时（Codex 逐条决定）/ 结束播报稿 / 模型主动插播 */
  source: "" | "live" | "summary" | "tool";
  /** 最近一次是否是被主动掐断的（用于文案切换；调用方自己复位） */
  stopped: boolean;
  /**
   * 用户已按「停止」⇒ **静音闩锁**已置位（10-12：「停止都停止不了，一直播报」）。
   * ⛔ 与 `stopped` 的区别不是"多一个布尔"：`stopped` 只是 1.6 秒的回执，
   *    而 `muted` 是**真的把后续播报全拦下来**（`speak()` 入口那一处）——
   *    模型再调插播工具、下一句正文 delta 到达、回合结束的播报稿，全都念不出来。
   *    状态条靠它显示「恢复播报」按钮（否则用户按一次就永久失去播报）。
   */
  muted: boolean;
};

export const IDLE_ANNOUNCE_STATUS: AnnounceStatus = { active: false, current: "", pending: 0, source: "", stopped: false, muted: false };

type StatusListener = (status: AnnounceStatus) => void;

const statusListeners = new Set<StatusListener>();
/** 最新一帧状态（新订阅者立刻拿到当前值，不用等下一次更新 —— 与 wave-level 的 stage 一致）。 */
let announceStatus: AnnounceStatus = IDLE_ANNOUNCE_STATUS;

export function publishAnnounceStatus(next: AnnounceStatus): void {
  announceStatus = next;
  for (const fn of statusListeners) {
    try { fn(next); } catch { /* 单个订阅者出错不影响执行端 */ }
  }
}

export function getAnnounceStatus(): AnnounceStatus {
  return announceStatus;
}

export function subscribeAnnounceStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

/* ── 播报「有效状态」的总开关半边（10-25）──────────────────────────────────────
   ⛔ 现在不再往对话里发可见告知（用户令：「不要每次切换还发个消息出去」）。
      发送前的 `buildSessionScope` 会读这里，把「当前会话语音播报：已开启/已关闭」
      写进会话的 developer instructions（隐藏注入，输入框与消息里都看不到）。
   ⛔ 会话级静音走 `isAnnounceMutedForThread`；两者一起才是有效状态。 */
let announceGlobalEnabled: boolean | null = null;

export function setAnnounceGlobalEnabled(enabled: boolean): void {
  announceGlobalEnabled = enabled;
}

export function getAnnounceGlobalEnabled(): boolean | null {
  return announceGlobalEnabled;
}
