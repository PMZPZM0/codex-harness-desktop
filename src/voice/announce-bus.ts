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
   * ⛔ 10-09 第五轮恢复：正文朗读**由 Codex 逐条决定**（`voice_speak_reply` 工具标记本回合），
   *    所以这条通道回来了 —— 但消费者只有"被标记的回合"才真的念（不是"有事件就念"）。
   *    上一轮（第四轮）删它是因为当时正文一律不念；现在它有了受控的消费者，不再是死契约。
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

// ── 「停止播报」回调：悬浮球右键菜单调用，执行端（播报域）注册 ──
//    ⛔ 为什么必须有这个出口：非通话播报是**只管说、不管听**的（不开麦克风），
//      没有它用户就**没有任何办法让它闭嘴** —— 一条长回复能被念上好几分钟。
//      与 wave-level 的 setVoiceStopHandler / setVoiceSkipHandler 同一套广播范式。
let stopHandler: (() => void) | null = null;

export function setAnnounceStopHandler(fn: (() => void) | null): void {
  stopHandler = fn;
}

export function requestAnnounceStop(): void {
  try { stopHandler?.(); } catch { /* 停止失败不影响别的功能 */ }
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
};

export const IDLE_ANNOUNCE_STATUS: AnnounceStatus = { active: false, current: "", pending: 0, source: "", stopped: false };

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

/* ── 「播报开关翻转」告知出口（10-09：让 Codex 知道播报开没开、该不该写 ```voice 稿）────
   事件方向与上面相反：**说出去**（往会话里发一条告知）。文案的单一真相源在
   `voice/voice-notice.ts`，这里只转发"开/关"这个布尔。 */
let noticeHandler: ((enabled: boolean) => void) | null = null;

export function setAnnounceNoticeHandler(fn: ((enabled: boolean) => void) | null): void {
  noticeHandler = fn;
}

export function notifyAnnounceToggle(enabled: boolean): void {
  try { noticeHandler?.(enabled); } catch { /* 告知失败不该影响播报 */ }
}
