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
};

type Listener = (state: VoiceStageState) => void;

const initial: VoiceStageState = {
  level: 0,
  mode: "idle",
  userText: "",
  agentText: "",
  active: false,
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
