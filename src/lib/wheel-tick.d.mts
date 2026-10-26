/** 刻度尺的滑动音（合成棘轮咔哒，见 wheel-tick.mjs 顶部选型与三个坑的注释）。 */

export type WheelTickOptions = {
  /** 节流通道：hover / scroll / ruler 各用各的（⛔ 共用一个窗口会互相吞声音） */
  channel?: string;
  /** 该通道的最小间隔（毫秒，默认 30） */
  minGapMs?: number;
};

/**
 * 播一声咔哒。
 * @param direction -1 = 上滑（音调略高），1 = 下滑（音调略低）
 * @returns 是否真的排了音（节流窗口内 / 上下文未 running / 环境不支持时返回 false）
 */
export function playWheelTick(direction: number, options?: WheelTickOptions): boolean;

/** 预解锁音频上下文（幂等）：第一次用户手势时就建好，避免"第一下没声音/延迟" */
export function primeWheelTick(): boolean;

/** 当前音频上下文状态：none / suspended / running（验收与排查用） */
export function wheelTickState(): string;
