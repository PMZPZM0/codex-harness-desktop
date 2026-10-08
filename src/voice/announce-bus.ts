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
  /** 正文流式增量（只在**当前会话**上转发；后台会话的输出不该被念出来） */
  | { type: "delta"; threadId: string; text: string }
  /** 回合结束：带上**最终回复原文**，供「结束汇总播报」压缩后朗读 */
  | { type: "turnDone"; threadId: string; text: string; aborted: boolean };

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
