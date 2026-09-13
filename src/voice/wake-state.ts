/**
 * 语音唤醒状态广播（极简 store，同 wave-level 的做法）。
 *
 * 为什么需要：唤醒监听跑在 `VoiceCallFloat`，而「为什么没唤醒」必须显示在
 * **设置页的语音唤醒卡片**里（用户在那里开的开关、填的词）。两处不在同一棵子树，
 * props 传不动，所以用模块级订阅广播。
 *
 * 承载：是否正在聆听 / 用的什么唤醒词 / 词表可达性提示 / **最近听到的一句话**。
 * 「最近听到」是这类功能唯一的可用诊断手段 —— 通用识别模型把「小柯小柯」
 * 听成「小哥小哥」时，用户只有看见这句才知道该换词还是该改匹配。
 */

export type WakeState = {
  /** 是否正在持续聆听 */
  listening: boolean;
  /** 当前生效的唤醒词 */
  phrase: string;
  /** 正在用哪个引擎：kws=关键词模型（只认读音、不误唤醒）；asr=通用识别 + 同音容错回退 */
  engine: "kws" | "asr" | "";
  /** 词表可达性提示（唤醒词里有模型词表外的字时给出） */
  hint: string;
  /** 最近听到的一句（诊断） */
  heard: string;
  /** 最近听到的那句是否命中唤醒词 */
  matched: boolean;
  /** 启动失败原因（空 = 正常） */
  error: string;
};

type Listener = (state: WakeState) => void;

const initial: WakeState = {
  listening: false,
  phrase: "",
  engine: "",
  hint: "",
  heard: "",
  matched: false,
  error: "",
};

let current: WakeState = initial;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) {
    try { fn(current); } catch { /* 单个订阅者出错不影响其他人 */ }
  }
}

/** 局部更新（未给的字段保持原值）= 深比较后广播，避免每块音频都重渲染设置页。 */
export function patchWakeState(patch: Partial<WakeState>): void {
  const next: WakeState = { ...current, ...patch };
  if (
    next.listening === current.listening &&
    next.phrase === current.phrase &&
    next.engine === current.engine &&
    next.hint === current.hint &&
    next.heard === current.heard &&
    next.matched === current.matched &&
    next.error === current.error
  ) {
    return;
  }
  current = next;
  emit();
}

export function subscribeWakeState(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

export function getWakeState(): WakeState {
  return current;
}

/** 停止聆听：保留 phrase（设置页还要显示），清掉「听到什么」与错误 */
export function resetWakeState(): void {
  current = { ...initial, phrase: current.phrase };
  emit();
}
