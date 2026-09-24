/**
 * usePart02b —— **组合根**（09-22：原 616 行 / 体内 156 条语句按序切成 2 段）。
 * 域：目标/复核/文件浏览 · 审批沙箱人格/通知中心
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart02b1 } from "./02-goal-browser-notice/01-goal-review-file-browser";
import { usePart02b2 } from "./02-goal-browser-notice/02-approval-notice-center";
import type { Bag } from "../bag-types";

export function usePart02b(bag: Bag) {
  const a = usePart02b1(bag);
  const b = usePart02b2(bag);

  return { ...a, ...b };
}
