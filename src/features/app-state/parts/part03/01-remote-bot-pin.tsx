/**
 * usePart03a —— **组合根**（09-22：原 530 行 / 体内 123 条语句按序切成 2 段）。
 * 域：机器人/远程通道 · 钉顶几何与滚动锚
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart03a1 } from "./01-remote-bot-pin/01-bot-remote-channel";
import { usePart03a2 } from "./01-remote-bot-pin/02-pin-scroll-anchor";
import type { Bag } from "../bag-types";

export function usePart03a(bag: Bag) {
  const a = usePart03a1(bag);
  const b = usePart03a2(bag);

  return { ...a, ...b };
}
