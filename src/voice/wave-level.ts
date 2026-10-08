/**
 * 实时语音「舞台」状态广播（极简 store）。
 *
 * 为什么需要：采集/播报/识别都在 VoiceCallFloat（独立 portal 到 body）里，
 * 而波浪 + 字幕要挂在输入框（composer）正上方 —— 两处不在同一棵子树，
 * props 传不动，所以用一个模块级订阅把状态广播出去，绘制端订阅渲染。
 *
 * 承载：电平（0..1 RMS 近似，仅用于视觉）+ 当前模式 + 用户/Codex 字幕文本 + 是否激活。
 */

export type VoiceWaveMode = "idle" | "listening" | "thinking" | "speaking";

export type VoiceStageState = {
  level: number;
  mode: VoiceWaveMode;
  /** 用户侧字幕（识别中的话说） */
  userText: string;
  /** Codex 侧字幕（正在朗读/合成的文本） */
  agentText: string;
  /** 通话是否进行中（决定舞台要不要显示） */
  active: boolean;
  /** 是否是输入框语音听写（只转文字到 composer，不自动发送、不播报） */
  dictating: boolean;
};

type Listener = (state: VoiceStageState) => void;

const initial: VoiceStageState = {
  level: 0,
  mode: "idle",
  userText: "",
  agentText: "",
  active: false,
  dictating: false,
};

let current: VoiceStageState = initial;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅者出错不影响其他人 */ }
  }
}

/** 局部更新（未给的字段保持原值）。 */
export function patchVoiceStage(patch: Partial<VoiceStageState>): void {
  const level = patch.level === undefined
    ? current.level
    : Number.isFinite(patch.level) ? Math.max(0, Math.min(1, patch.level)) : 0;
  current = { ...current, ...patch, level };
  emit();
}

/** 只更新电平的便捷入口（采集/播放每帧都调，避免整对象重建）。 */
export function setVoiceLevel(level: number, mode: VoiceWaveMode): void {
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  if (current.level === safe && current.mode === mode) return; // 同值不广播，省掉大量重渲染
  current = { ...current, level: safe, mode };
  emit();
}

export function subscribeVoiceStage(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

export function getVoiceStage(): VoiceStageState {
  return current;
}

/** 通话结束：复位（保留 active=false）。 */
export function resetVoiceStage(): void {
  current = { ...initial };
  emit();
}

// ── 「结束通话」回调：VoiceCallFloat 注册，舞台上的按钮调用（两处不在同一子树）
let stopHandler: (() => void) | null = null;

export function setVoiceStopHandler(fn: (() => void) | null): void {
  stopHandler = fn;
}

export function requestVoiceStop(): void {
  try { stopHandler?.(); } catch { /* 结束通话失败不冒泡到 UI */ }
}

// ── 「打断」回调（10-08）：通话面只保留舞台条之后，把原先右下角面板上的「打断」按钮搬到舞台上
//    （跳过当前排队的播报，后续内容接着说）。与「结束通话」同一套广播范式 —— 两处不在同一子树。
let skipHandler: (() => void) | null = null;

export function setVoiceSkipHandler(fn: (() => void) | null): void {
  skipHandler = fn;
}

export function requestVoiceSkip(): void {
  try { skipHandler?.(); } catch { /* 打断失败不冒泡到 UI */ }
}

// ── 「通话开关 → 往对话里发一条告知」回调（10-08 用户要求）：让引擎明确感知实时语音何时开、何时关。
//    采集/播报在 VoiceCallFloat（body portal），而「发消息进对话」的能力在 AppView 的 bag 里
//    （pendingCommandTextRef + send）—— 两处不在同一子树，同样靠这条广播桥。
//    ⛔ 回调带 threadId：语音通话是**绑定会话**的，IPC/状态变更期间用户可能已切走会话，
//      把 A 会话的告知发进 B 是明确禁止的（与调度告知同款闸门）。
let callNoticeHandler: ((active: boolean, threadId: string) => void) | null = null;

export function setVoiceCallNoticeHandler(fn: ((active: boolean, threadId: string) => void) | null): void {
  callNoticeHandler = fn;
}

export function requestVoiceCallNotice(active: boolean, threadId: string): void {
  try { callNoticeHandler?.(active, threadId); } catch { /* 告知失败不影响通话本身 */ }
}

// ── 「跳转到语音设置」回调：悬浮球右键菜单用（悬浮球是 body portal，
//    拿不到 App 里的 setSettingsPage，所以由 App 注册一个打开设置页的钩子）
let openSettingsHandler: (() => void) | null = null;

export function setVoiceOpenSettingsHandler(fn: (() => void) | null): void {
  openSettingsHandler = fn;
}

export function requestVoiceOpenSettings(): void {
  try { openSettingsHandler?.(); } catch { /* 打开设置失败不冒泡到 UI */ }
}

// ── 输入框旁的语音听写按钮：由 App 请求，VoiceCallFloat 执行真正的采集/停止 ──
type DictationRequest = { action?: "toggle" | "start" | "stop"; send?: boolean };
let dictationHandler: ((request?: DictationRequest) => void) | null = null;

export function setVoiceDictationHandler(fn: ((request?: DictationRequest) => void) | null): void {
  dictationHandler = fn;
}

export function requestVoiceDictation(request?: DictationRequest): void {
  try { dictationHandler?.(request); } catch { /* 听写启动失败由 VoiceCallFloat 的 notice 呈现 */ }
}

// ── 听写 final 后「松手即发送」回调：App 注册 send()，VoiceCallFloat 在停止前请求 ──
let dictationSendHandler: (() => void) | null = null;

export function setVoiceDictationSendHandler(fn: (() => void) | null): void {
  dictationSendHandler = fn;
}

export function requestVoiceDictationSend(): void {
  try { dictationSendHandler?.(); } catch { /* 发送错误由现有 send 链路呈现 */ }
}
