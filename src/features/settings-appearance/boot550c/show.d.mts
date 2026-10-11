/**
 * 550C 启动动画驱动（./show.mjs）的对外类型面。
 * ⛔ 仅类型声明；实现是逐字移植的未检查 .mjs（见 show.mjs 头注释）。
 */

export interface BootShowOptions {
  /** simple = 只播 logo 书写；full = 完整覆写流程 */
  mode: "simple" | "full";
  /** 跳过时 sleep()/later() 的 reject 哨兵（调用方提供，用于 unwind） */
  cancelled: unknown;
}

export interface BootShowHandle {
  start: () => Promise<void>;
  cancel: () => void;
}

export function createShow(
  stage: ShadowRoot | HTMLElement,
  options: BootShowOptions
): BootShowHandle;
