/**
 * usePart02b1 —— **组合根**（09-22：原 455 行 / 体内 105 条语句按序切成 2 段）。
 * 域：目标状态/复核/文件树 — 会话关注与集群行渲染
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart02b11 } from "./01-goal-review-file-browser/01-goal-review-file-tree";
import { usePart02b12 } from "./01-goal-review-file-browser/02-thread-attention-rows";
import type { Bag } from "../../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart02b1(bag: Bag) {
  const a = usePart02b11(bag);
  const b = usePart02b12(bag);

  return { ...a, ...b };
}
